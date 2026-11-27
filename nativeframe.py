"""Pen Pal's own title bar, done the way Windows apps do it.

The window keeps a real Windows frame, so Windows itself handles resizing, Aero Snap (drag to an
edge, Win+arrow keys), maximizing to the area above the taskbar, the minimize animation and the
shadow. Only the caption strip is removed: WM_NCCALCSIZE hands that space to the page.

The page draws its title strip and marks it with the CSS `app-region: drag`. With WebView2's
non-client region support switched on, WebView2 treats that strip as the window's caption: drag
to move (and snap), double-click to maximize, right-click for the system menu.

The top edge is part of that caption strip too, and WebView2 resizes from it the way Windows does
on a normal title bar. One gap is filled by hand, because WebView2 in a normal window cannot report
its buttons to Windows:
  Snap layouts     hovering the maximize button asks snap_layouts(), which presses Win+Z
begin_resize() and begin_move() hand a drag to Windows' own loops, for a WebView2 too old for app-region.

Windows only; everything here fails soft. If something cannot be set up, STATE says so and the
page falls back to the older, page-driven title bar.
"""
import ctypes
import logging
import sys
import threading
import time

LOG = logging.getLogger("penpal")
STATE = {"installed": False, "appRegion": False, "error": "", "sizing": 0.0}

WM_NCCALCSIZE = 0x0083
WM_ENTERSIZEMOVE = 0x0231
WM_SYSCOMMAND = 0x0112
WM_NCDESTROY = 0x0082
SC_SIZE = 0xF000
SC_MOVE = 0xF010
HTCAPTION = 2
GWLP_WNDPROC = -4
SWP_FRAMECHANGED, SWP_NOSIZE, SWP_NOMOVE, SWP_NOZORDER, SWP_NOACTIVATE = 0x20, 0x1, 0x2, 0x4, 0x10
SW_MINIMIZE, SW_MAXIMIZE, SW_RESTORE = 6, 3, 9
EDGES = {"left": 1, "right": 2, "top": 3, "topleft": 4, "topright": 5, "bottom": 6, "bottomleft": 7, "bottomright": 8}

_keep = {}  # the window procedure must outlive the window, or Windows calls freed memory


def is_windows():
    return sys.platform.startswith("win")


def windows_11():
    try:
        return is_windows() and sys.getwindowsversion().build >= 22000
    except Exception:  # noqa: BLE001
        return False


def _api():
    from ctypes import wintypes  # noqa: PLC0415

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    LRESULT = ctypes.c_ssize_t
    WNDPROC = ctypes.WINFUNCTYPE(LRESULT, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
    user32.SetWindowLongPtrW.restype = ctypes.c_void_p
    user32.SetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_void_p]
    user32.CallWindowProcW.restype = LRESULT
    user32.CallWindowProcW.argtypes = [ctypes.c_void_p, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
    user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
    user32.IsZoomed.argtypes = [wintypes.HWND]
    user32.ShowWindowAsync.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user32.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user32.ClientToScreen.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.POINT)]
    user32.SetForegroundWindow.argtypes = [wintypes.HWND]
    user32.GetForegroundWindow.restype = ctypes.c_void_p

    class NCCALCSIZE_PARAMS(ctypes.Structure):
        _fields_ = [("rgrc", wintypes.RECT * 3), ("lppos", ctypes.c_void_p)]

    return user32, WNDPROC, NCCALCSIZE_PARAMS, wintypes


def hwnd_of(window):
    return int(window.native.Handle.ToInt64())


def enable_app_region():
    """Turn on WebView2's support for `app-region: drag` before the first page loads.
    pywebview subscribes its own ready handler when the form is built, so this has to run before
    webview.start(). Returns an error message, or ''."""
    try:
        from webview.platforms import edgechromium  # noqa: PLC0415
    except Exception as e:  # noqa: BLE001
        return "WebView2 bridge not available: %r" % e
    orig = edgechromium.EdgeChrome.on_webview_ready
    if getattr(orig, "_penpal", False):
        return ""

    def on_webview_ready(self, sender, args):
        try:
            if args.IsSuccess:
                sender.CoreWebView2.Settings.IsNonClientRegionSupportEnabled = True
                STATE["appRegion"] = bool(sender.CoreWebView2.Settings.IsNonClientRegionSupportEnabled)
        except Exception as e:  # noqa: BLE001  an older WebView2 runtime: the page drags the window itself
            STATE["error"] = "app-region not supported: %r" % e
            LOG.warning(STATE["error"])
        return orig(self, sender, args)

    on_webview_ready._penpal = True
    edgechromium.EdgeChrome.on_webview_ready = on_webview_ready
    return ""


def install(window):
    """Remove the caption from the window's real frame. Call on the UI thread before the window shows
    (pywebview's before_show event). Returns '' or an error message."""
    try:
        user32, WNDPROC, NCP, wintypes = _api()
        hwnd = hwnd_of(window)
        old = {"proc": None}

        def proc(h, msg, wp, lp):
            try:
                if msg == WM_NCCALCSIZE and wp:
                    p = ctypes.cast(lp, ctypes.POINTER(NCP)).contents
                    top, left = p.rgrc[0].top, p.rgrc[0].left
                    res = user32.CallWindowProcW(old["proc"], h, msg, wp, lp)
                    if res == 0:
                        # Windows moved the client edge in by the frame on every side and by the caption at the top.
                        # Keep the side and bottom frame (Windows resizes from it), give the caption to the page.
                        # Maximized windows hang a frame's width off each monitor edge, so keep that much at the top.
                        border = p.rgrc[0].left - left
                        p.rgrc[0].top = top + (border if user32.IsZoomed(h) else 0)
                    return res
                if msg == WM_ENTERSIZEMOVE:
                    STATE["sizing"] = time.monotonic()
                if msg == WM_NCDESTROY:
                    prev = old["proc"]
                    user32.SetWindowLongPtrW(h, GWLP_WNDPROC, prev)
                    return user32.CallWindowProcW(prev, h, msg, wp, lp)
            except Exception:  # noqa: BLE001  never let an error escape into Windows
                pass
            return user32.CallWindowProcW(old["proc"], h, msg, wp, lp)

        cb = WNDPROC(proc)
        _keep[hwnd] = cb
        old["proc"] = user32.SetWindowLongPtrW(hwnd, GWLP_WNDPROC, ctypes.cast(cb, ctypes.c_void_p).value)
        if not old["proc"]:
            raise OSError("SetWindowLongPtr failed (%d)" % ctypes.get_last_error())
        user32.SetWindowPos(hwnd, None, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE)
        STATE["installed"] = True
        return ""
    except Exception as e:  # noqa: BLE001
        STATE["error"] = "could not remove the caption: %r" % e
        LOG.warning(STATE["error"])
        return STATE["error"]


# ---- what the page's title bar buttons call (through penpal.Api) ----
def minimize(window):
    user32 = _api()[0]
    user32.ShowWindowAsync(hwnd_of(window), SW_MINIMIZE)


def is_max(window):
    user32 = _api()[0]
    return bool(user32.IsZoomed(hwnd_of(window)))


def toggle_max(window):
    """Maximize or restore the Windows way. Returns the new state."""
    user32 = _api()[0]
    hwnd = hwnd_of(window)
    was = bool(user32.IsZoomed(hwnd))
    user32.ShowWindowAsync(hwnd, SW_RESTORE if was else SW_MAXIMIZE)
    for _ in range(40):  # wait (up to 1 s) for Windows to finish, so the answer is the real state
        time.sleep(0.025)
        if bool(user32.IsZoomed(hwnd)) != was:
            break
    return bool(user32.IsZoomed(hwnd))


def _start_loop(window, command):
    """Hand the mouse to Windows' own move or size loop while the button is still down.
    Returns True if Windows started it."""
    user32 = _api()[0]
    hwnd = hwnd_of(window)
    before = STATE["sizing"]
    user32.ReleaseCapture()
    user32.PostMessageW(hwnd, WM_SYSCOMMAND, command, 0)
    for _ in range(20):
        time.sleep(0.02)
        if STATE["sizing"] != before:
            return True
    return False


def begin_resize(window, edge):
    n = EDGES.get(str(edge))
    return bool(n) and _start_loop(window, SC_SIZE + n)


def begin_move(window):
    return _start_loop(window, SC_MOVE + HTCAPTION)


def snap_layouts(window):
    """Show Windows 11's Snap layouts for this window, as hovering a real maximize button does."""
    if not windows_11():
        return False
    user32 = _api()[0]
    if user32.GetForegroundWindow() != hwnd_of(window):
        return False
    VK_LWIN, VK_Z, KEYUP = 0x5B, 0x5A, 0x2
    user32.keybd_event(VK_LWIN, 0, 0, 0)
    user32.keybd_event(VK_Z, 0, 0, 0)
    user32.keybd_event(VK_Z, 0, KEYUP, 0)
    user32.keybd_event(VK_LWIN, 0, KEYUP, 0)
    return True


def geometry(window):
    """For the build's self-test: window and client rectangles in screen pixels."""
    user32, _w, _n, wintypes = _api()
    hwnd = hwnd_of(window)
    wr, cr, pt = wintypes.RECT(), wintypes.RECT(), wintypes.POINT(0, 0)
    user32.GetWindowRect(hwnd, ctypes.byref(wr))
    user32.GetClientRect(hwnd, ctypes.byref(cr))
    user32.ClientToScreen(hwnd, ctypes.byref(pt))
    return {"window": [wr.left, wr.top, wr.right, wr.bottom], "client": [pt.x, pt.y, pt.x + cr.right, pt.y + cr.bottom],
            "zoomed": bool(user32.IsZoomed(hwnd))}


def run_later(fn, delay):
    t = threading.Timer(delay, fn)
    t.daemon = True
    t.start()
    return t


# ---- for the build's self-test on a real Windows runner ----
def work_rect(window):
    """The monitor's area above the taskbar, in screen pixels."""
    user32, _w, _n, wintypes = _api()

    class MONITORINFO(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT), ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD)]

    user32.MonitorFromWindow.restype = ctypes.c_void_p
    user32.MonitorFromWindow.argtypes = [wintypes.HWND, wintypes.DWORD]
    user32.GetMonitorInfoW.argtypes = [ctypes.c_void_p, ctypes.POINTER(MONITORINFO)]
    mi = MONITORINFO()
    mi.cbSize = ctypes.sizeof(MONITORINFO)
    user32.GetMonitorInfoW(user32.MonitorFromWindow(hwnd_of(window), 2), ctypes.byref(mi))
    r = mi.rcWork
    return [r.left, r.top, r.right, r.bottom]


def mouse_drag(window, x, y, dx, dy):
    """Press at (x, y) in screen pixels, move by (dx, dy), release. Returns the window rectangle before and after."""
    user32 = _api()[0]
    LEFTDOWN, LEFTUP = 0x2, 0x4
    hwnd = hwnd_of(window)
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.4)
    before = geometry(window)["window"]
    user32.SetCursorPos(int(x), int(y))
    time.sleep(0.3)
    user32.mouse_event(LEFTDOWN, 0, 0, 0, 0)
    time.sleep(0.25)
    for i in range(1, 13):
        user32.SetCursorPos(int(x + dx * i / 12), int(y + dy * i / 12))
        time.sleep(0.04)
    time.sleep(0.25)
    user32.mouse_event(LEFTUP, 0, 0, 0, 0)
    time.sleep(0.6)
    return before, geometry(window)["window"]


def capture(window, path):
    """Save what is on screen where the window is, as a .bmp (the build converts it to .png)."""
    from ctypes import wintypes  # noqa: PLC0415

    user32 = _api()[0]
    gdi32 = ctypes.WinDLL("gdi32")
    for name, res, args in (("GetDC", ctypes.c_void_p, [ctypes.c_void_p]), ("ReleaseDC", ctypes.c_int, [ctypes.c_void_p, ctypes.c_void_p])):
        getattr(user32, name).restype = res
        getattr(user32, name).argtypes = args
    gdi32.CreateCompatibleDC.restype = ctypes.c_void_p
    gdi32.CreateCompatibleDC.argtypes = [ctypes.c_void_p]
    gdi32.CreateCompatibleBitmap.restype = ctypes.c_void_p
    gdi32.CreateCompatibleBitmap.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int]
    gdi32.SelectObject.restype = ctypes.c_void_p
    gdi32.SelectObject.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    gdi32.BitBlt.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_void_p, ctypes.c_int, ctypes.c_int, wintypes.DWORD]
    gdi32.GetDIBits.argtypes = [ctypes.c_void_p, ctypes.c_void_p, wintypes.UINT, wintypes.UINT, ctypes.c_void_p, ctypes.c_void_p, wintypes.UINT]
    gdi32.DeleteObject.argtypes = [ctypes.c_void_p]
    gdi32.DeleteDC.argtypes = [ctypes.c_void_p]

    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [("biSize", wintypes.DWORD), ("biWidth", ctypes.c_long), ("biHeight", ctypes.c_long), ("biPlanes", wintypes.WORD),
                    ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD), ("biSizeImage", wintypes.DWORD),
                    ("biXPelsPerMeter", ctypes.c_long), ("biYPelsPerMeter", ctypes.c_long), ("biClrUsed", wintypes.DWORD), ("biClrImportant", wintypes.DWORD)]

    x, y, r, b = geometry(window)["window"]
    x, y = x - 12, y - 12  # a little of the desktop around it, to see the edges and shadow
    w, h = (r + 12) - x, (b + 12) - y
    screen = user32.GetDC(None)
    mem = gdi32.CreateCompatibleDC(screen)
    bmp = gdi32.CreateCompatibleBitmap(screen, w, h)
    old = gdi32.SelectObject(mem, bmp)
    gdi32.BitBlt(mem, 0, 0, w, h, screen, x, y, 0x00CC0020 | 0x40000000)
    bi = BITMAPINFOHEADER(40, w, -h, 1, 32, 0, 0, 0, 0, 0, 0)
    buf = ctypes.create_string_buffer(w * h * 4)
    gdi32.GetDIBits(mem, bmp, 0, h, buf, ctypes.byref(bi), 0)
    gdi32.SelectObject(mem, old)
    gdi32.DeleteObject(bmp)
    gdi32.DeleteDC(mem)
    user32.ReleaseDC(None, screen)
    import struct  # noqa: PLC0415

    with open(path, "wb") as f:
        f.write(b"BM" + struct.pack("<IHHI", 54 + len(buf.raw), 0, 0, 54))
        f.write(bytes(bi))
        f.write(buf.raw)
    return path
