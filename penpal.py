#!/usr/bin/env python3
"""Pen Pal: the desktop app.

Starts the local server (server.py) on 127.0.0.1 and shows the page in its own window,
using the Edge WebView2 engine that ships with Windows 10 and 11 (through pywebview).
If pywebview is not installed it falls back to your web browser, so running from source
with plain Python still works.

Usage:
  python penpal.py              open the app
  python penpal.py --browser    use the web browser instead of a window
  python penpal.py --check FILE self-test (used by the build): start, load every part, write FILE, exit
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import webbrowser

# A windowed exe (PyInstaller --windowed) starts with no console, so sys.stdout and sys.stderr
# are None. Point them at the null device so nothing that prints or logs can crash the app.
for _name in ("stdout", "stderr"):
    if getattr(sys, _name) is None:
        setattr(sys, _name, open(os.devnull, "w", encoding="utf-8"))

import server  # noqa: E402
import updater  # noqa: E402


def start_server():
    """Start the HTTP server in a background thread. Returns (httpd, url)."""
    httpd, port = server.make_server(8765)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, "http://127.0.0.1:%d/" % port


def check_data_file():
    """The same promise as server.py: never start over a data file that cannot be read."""
    try:
        server.load_data()
        return None
    except Exception as e:  # noqa: BLE001
        return "Your data file (%s) could not be read: %s\nNothing has been changed. Restore a copy from the backups folder next to it." % (server.DATA_FILE, e)


def work_area(window):
    """The usable part of the window's monitor (without the taskbar), in the logical pixels pywebview uses.
    A frameless window maximized the normal way covers the taskbar, so Pen Pal maximizes to this instead."""
    import ctypes  # noqa: PLC0415
    from ctypes import wintypes  # noqa: PLC0415

    class MONITORINFO(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT), ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD)]

    form = window.native
    hwnd = form.Handle.ToInt64()
    user32 = ctypes.windll.user32
    user32.MonitorFromWindow.restype = ctypes.c_void_p
    mon = user32.MonitorFromWindow(ctypes.c_void_p(hwnd), 2)  # MONITOR_DEFAULTTONEAREST
    mi = MONITORINFO()
    mi.cbSize = ctypes.sizeof(MONITORINFO)
    if not user32.GetMonitorInfoW(ctypes.c_void_p(mon), ctypes.byref(mi)):
        raise OSError("GetMonitorInfo failed")
    scale = float(getattr(form, "_scale", 1) or 1)
    r = mi.rcWork
    return int(r.left / scale), int(r.top / scale), int((r.right - r.left) / scale), int((r.bottom - r.top) / scale)


class Api:
    """Functions the page can call through window.pywebview.api (desktop window only)."""

    def __init__(self):
        self.window = None
        self.saved_bounds = None  # where the window was before "maximize"

    # ---- window controls for Pen Pal's own title bar ----
    def win_minimize(self):
        self.window.minimize()

    def win_bounds(self):
        w = self.window
        return [w.x, w.y, w.width, w.height]

    def win_set_bounds(self, x, y, width, height):
        w = self.window
        width, height = max(900, int(width)), max(620, int(height))
        w.resize(width, height)
        w.move(int(x), int(y))
        self.saved_bounds = None

    def win_is_max(self):
        return self.saved_bounds is not None

    def win_toggle_max(self):
        w = self.window
        if self.saved_bounds:
            x, y, width, height = self.saved_bounds
            self.saved_bounds = None
            w.resize(width, height)
            w.move(x, y)
            return False
        before = self.win_bounds()
        try:
            x, y, width, height = work_area(w)
            w.move(x, y)
            w.resize(width, height)
        except Exception:  # noqa: BLE001  not Windows, or the native call failed: use the stock maximize
            w.maximize()
        self.saved_bounds = before
        return True

    def win_close(self):
        wait_for_saves(self.window)
        self.window.destroy()

    def save_file(self, name, text):
        """Native Save dialog, then write the text. Returns the saved path, or '' if cancelled."""
        import webview  # noqa: PLC0415

        result = self.window.create_file_dialog(webview.SAVE_DIALOG, save_filename=os.path.basename(str(name)))
        if not result:
            return ""
        path = result if isinstance(result, str) else result[0]
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(str(text))
        return path

    def open_data_folder(self):
        folder = os.path.dirname(server.DATA_FILE)
        os.makedirs(folder, exist_ok=True)
        if sys.platform.startswith("win"):
            os.startfile(folder)  # noqa: S606
        elif sys.platform == "darwin":
            subprocess.Popen(["open", folder])  # noqa: S603, S607
        else:
            subprocess.Popen(["xdg-open", folder])  # noqa: S603, S607
        return folder


def wait_for_saves(window):
    """Give a save that is still in flight a few seconds to finish."""
    for _ in range(25):
        try:
            busy = window.evaluate_js("window.PenPal ? window.PenPal.busy() : false")
        except Exception:  # noqa: BLE001
            return
        if not busy:
            return
        time.sleep(0.2)


def run_check(out_path):
    """Start against a throwaway data folder, fetch every part the page needs, report, exit."""
    lines, ok = [], True
    tmp = tempfile.mkdtemp(prefix="penpal-check-")
    try:
        server.set_data_dir(tmp)
        httpd, url = start_server()
        for path in ("", "logic.js", "app.js", "style.css", "directory.json", "fonts/young-serif-400.woff2", "api/data", "api/info", "api/settings"):
            try:
                with urllib.request.urlopen(url + path, timeout=10) as r:
                    body = r.read()
                    lines.append("ok   %s (%d bytes)" % ("/" + path, len(body)))
                    if path == "api/info":
                        lines.append("     " + body.decode("utf-8"))
            except Exception as e:  # noqa: BLE001
                ok = False
                lines.append("FAIL /%s: %s" % (path, e))
        req = urllib.request.Request(url + "api/data", data=json.dumps({"rev": 0, "poems": [], "journals": [], "submissions": []}).encode(),
                                     method="PUT", headers={"Content-Type": "application/json", "X-Pen-Pal": "1"})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                lines.append("ok   save works (%s)" % r.read().decode())
        except Exception as e:  # noqa: BLE001
            ok = False
            lines.append("FAIL save: %s" % e)
        try:
            import webview  # noqa: F401, PLC0415

            lines.append("ok   pywebview %s is bundled" % getattr(webview, "__version__", ""))
        except Exception as e:  # noqa: BLE001
            ok = False
            lines.append("FAIL pywebview: %s" % e)
        # Informational only (GitHub rate limits are shared on build machines): can this build reach GitHub?
        r = updater.check(server.APP_VERSION, timeout=15)
        lines.append("info update check: " + (r["error"] or "latest release is %s, this is %s" % (r["latest"], r["current"])))
        httpd.shutdown()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    lines.append("ALL OK" if ok else "FAILED")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(description="Pen Pal")
    ap.add_argument("--browser", action="store_true", help="open in the web browser instead of a window")
    ap.add_argument("--check", metavar="FILE", help="self-test and write the result to FILE")
    args = ap.parse_args()

    if args.check:
        sys.exit(run_check(args.check))

    problem = check_data_file()
    try:
        import webview  # noqa: PLC0415
    except ImportError:
        webview = None

    if problem:
        if webview:
            # Show the problem in a small window: a windowed exe has no console to print to.
            w = webview.create_window("Pen Pal", html="<body style='font:15px system-ui;padding:24px;white-space:pre-wrap'>%s</body>"
                                      % problem.replace("&", "&amp;").replace("<", "&lt;"), width=640, height=260)
            webview.start()
        else:
            print(problem)
        sys.exit(1)

    if server.frozen():
        threading.Thread(target=updater.cleanup_old, args=(sys.executable,), daemon=True).start()
    server.mirror_copy()
    httpd, url = start_server()

    if args.browser or webview is None:
        if webview is None:
            print("pywebview is not installed, so Pen Pal opens in your browser. (pip install pywebview for the app window.)")
        print("Pen Pal is running at %s" % url)
        print("Your data is saved in: %s" % server.DATA_FILE)
        print("Close this window (or press Ctrl+C) to stop.")
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            print("\nStopped.")
        return

    server.DESKTOP = True
    # Pen Pal's own title bar unless the person chose the standard Windows one in Settings.
    frameless = server.load_settings()["titleBar"] == "custom"
    server.FRAMELESS = frameless
    api = Api()
    window = webview.create_window("Pen Pal", url, js_api=api, width=1280, height=840, min_size=(900, 620), background_color="#F8F9F9",
                                   frameless=frameless, easy_drag=False, shadow=True)
    api.window = window
    server.RESTART_HOOK = window.destroy  # after an update is swapped in, the new copy is already starting

    def on_closing():
        wait_for_saves(window)
        return True

    window.events.closing += on_closing
    try:
        webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
    except Exception:  # noqa: BLE001  older pywebview without settings
        pass
    webview.start()
    httpd.shutdown()


if __name__ == "__main__":
    main()
