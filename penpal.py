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
  python penpal.py --remind       check for reading-period reminders and show them, then exit
                                (what the daily Task Scheduler task runs while Pen Pal is closed)
  python penpal.py --remind-check FILE
                                self-test of reminders (used by the build)
  python penpal.py --smoke FILE [--title-bar windows]
                                open the real window against a throwaway data folder, drive the
                                title bar controls and a close during a save, write FILE, exit
"""
import argparse
import datetime
import faulthandler
import json
import logging
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

import notify  # noqa: E402
import server  # noqa: E402
import updater  # noqa: E402

LOG_NAME = "pen-pal-log.txt"
LOG = logging.getLogger("penpal")


def setup_logging(folder, name=LOG_NAME):
    """Keep a log of this run (and the one before) in the data folder, so a crash leaves a reason behind.
    It holds start-up details, warnings and errors. Never poem text: request bodies are not logged."""
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, name)
    prev = os.path.join(folder, name.replace(".txt", ".prev.txt"))
    try:
        if os.path.exists(path):
            os.replace(path, prev)
    except OSError:
        pass
    f = open(path, "a", encoding="utf-8", buffering=1)  # noqa: SIM115  stays open for the life of the app
    # A windowed exe has nowhere to print: send stray output and Python's own error reports to the log.
    if sys.stderr is None or getattr(sys.stderr, "name", "") == os.devnull:
        sys.stderr = f
    if sys.stdout is None or getattr(sys.stdout, "name", "") == os.devnull:
        sys.stdout = f
    faulthandler.enable(file=f)  # a hard crash in native code still writes a stack trace
    root = logging.getLogger()
    for h in list(root.handlers):
        if getattr(h, "_penpal", False):
            root.removeHandler(h)
    h = logging.StreamHandler(f)
    h._penpal = True
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s", "%Y-%m-%d %H:%M:%S"))
    root.addHandler(h)
    root.setLevel(logging.INFO)

    def hook(kind, info):
        LOG.error("%s", kind, exc_info=info)

    sys.excepthook = lambda *exc: hook("crash", exc)
    threading.excepthook = lambda a: hook("crash in thread %s" % (a.thread.name if a.thread else "?"), (a.exc_type, a.exc_value, a.exc_traceback))
    return path


def start_server():
    """Start the HTTP server in a background thread. Returns (httpd, url)."""
    httpd, port = server.make_server(8765)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, "http://127.0.0.1:%d/" % port


def check_data_file():
    """The same promise as server.py: never start over a data file that cannot be read,
    and never start an empty one in a moved-to folder that is not ready."""
    problem = server.location_problem()
    if problem:
        return problem
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

    # pywebview walks every public attribute of this object to build window.pywebview.api, recursing
    # into objects it finds. Anything that is not a method the page may call must start with "_":
    # a public window here would send that walk through the native WinForms and WebView2 objects
    # from a background thread, which can crash the app.

    def __init__(self):
        self._window = None
        self._saved_bounds = None  # where the window was before "maximize"
        self._busy = False  # the page has an edit that is not saved yet

    def set_busy(self, busy):
        """The page reports whether it has unsaved edits, so closing never has to ask it (see closing_handler)."""
        self._busy = bool(busy)

    # ---- reading-period reminders (which ones is decided in logic.js) ----
    def notify(self, alerts):
        return notify.deliver(alerts, reminder_folder())

    def test_notification(self):
        return notify.show("Pen Pal notifications are on", "Reminders look like this, a few days before a reading period opens or closes.") or ""

    def sync_reminders(self, want):
        return sync_task(bool(want))

    # ---- window controls for Pen Pal's own title bar ----
    def win_minimize(self):
        self._window.minimize()

    def win_bounds(self):
        w = self._window
        return [w.x, w.y, w.width, w.height]

    def win_set_bounds(self, x, y, width, height):
        w = self._window
        width, height = max(900, int(width)), max(620, int(height))
        w.resize(width, height)
        w.move(int(x), int(y))
        self._saved_bounds = None

    def win_is_max(self):
        return self._saved_bounds is not None

    def win_toggle_max(self):
        w = self._window
        if self._saved_bounds:
            x, y, width, height = self._saved_bounds
            self._saved_bounds = None
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
        self._saved_bounds = before
        return True

    def win_close(self):
        self._window.destroy()  # closing_handler waits for a save in flight

    def save_file(self, name, text):
        """Native Save dialog, then write the text. Returns the saved path, or '' if cancelled."""
        import webview  # noqa: PLC0415

        fd = getattr(webview, "FileDialog", None)
        result = self._window.create_file_dialog(fd.SAVE if fd else 30, save_filename=os.path.basename(str(name)))
        if not result:
            return ""
        path = result if isinstance(result, str) else result[0]
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(str(text))
        return path

    def pick_folder(self, start=""):
        """Native folder picker. Returns the folder, or '' if cancelled."""
        import webview  # noqa: PLC0415

        fd = getattr(webview, "FileDialog", None)
        kind = fd.FOLDER if fd else 20  # 20 is FOLDER_DIALOG in older pywebview
        result = self._window.create_file_dialog(kind, directory=str(start or ""))
        if not result:
            return ""
        return result if isinstance(result, str) else result[0]

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


def closing_handler(api, window, timeout=5.0):
    """Runs when the window is about to close. pywebview calls it on the UI thread and waits for it,
    so it must not block or call evaluate_js (that waits on the UI thread too, and would freeze the app).
    If a save is still pending, cancel this close, give the save a few seconds on another thread, then close again."""
    state = {"waiting": False, "force": False}

    def finish():
        end = time.monotonic() + timeout
        while api._busy and time.monotonic() < end:
            time.sleep(0.1)
        if api._busy:
            LOG.warning("closing with an edit still unsaved after %.0f seconds", timeout)
        state["force"] = True
        window.destroy()

    def on_closing():
        if state["force"] or not api._busy:
            return True
        if not state["waiting"]:
            state["waiting"] = True
            threading.Thread(target=finish, daemon=True).start()
        return False  # cancel for now

    return on_closing


def run_check(out_path):
    """Start against a throwaway data folder, fetch every part the page needs, report, exit."""
    lines, ok = [], True
    tmp = tempfile.mkdtemp(prefix="penpal-check-")
    try:
        server.set_data_dir(tmp)
        httpd, url = start_server()
        for path in ("", "logic.js", "app.js", "style.css", "remind.html", "remind.js", "icon.png", "directory.json", "fonts/young-serif-400.woff2", "api/data", "api/info", "api/settings"):
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


def reminder_folder():
    # With the data file: when it is shared between computers, a reminder shown on one is not shown again on the other.
    return os.path.dirname(server.DATA_FILE)


def icon_path():
    return os.path.join(server.resource_dir(), "public", "icon.png")


def sync_task(want):
    """Add or remove the daily check that runs while Pen Pal is closed. Only the installed exe on Windows
    has one: from source, the program path would be Python itself."""
    if not (server.frozen() and notify.is_windows()):
        return {"supported": False, "on": False, "error": ""}
    want = want and server.load_settings()["remindClosed"]
    exe = sys.executable
    current = notify.task_command()
    if want:
        same = current and os.path.normcase(os.path.abspath(current)) == os.path.normcase(os.path.abspath(exe))
        err = None if same else notify.add_task(exe)
    else:
        err = notify.remove_task() if current is not None else None
    if err:
        LOG.warning("reminder task: %s", err)
    return {"supported": True, "on": bool(want and not err), "error": err or ""}


class RemindApi:
    """The bridge for the hidden window that --remind opens: it only hands back the reminders."""

    def __init__(self):
        self._window = None
        self._result = None

    def finish(self, alerts, error):
        try:
            self._result = {"alerts": alerts or [], "error": error or "", "delivered": notify.deliver(alerts, reminder_folder())}
        except Exception as e:  # noqa: BLE001
            self._result = {"alerts": alerts or [], "error": repr(e), "delivered": {"shown": 0, "errors": []}}
        finally:
            # Close after this call has returned to the page: closing from inside it leaves a thread
            # waiting for a page that is gone, and the process would never exit.
            t = threading.Timer(0.3, self._window.destroy)
            t.daemon = True
            t.start()


def remind_once(webview, url, limit=90):
    """Open a hidden window on remind.html, which runs the rules in logic.js and calls finish()."""
    api = RemindApi()
    w = webview.create_window("Pen Pal reminders", url + "remind.html", js_api=api, hidden=True, width=420, height=300)
    api._window = w
    timer = threading.Timer(limit, w.destroy)
    timer.daemon = True
    timer.start()
    webview.start()
    timer.cancel()
    return api._result or {"alerts": [], "error": "timed out", "delivered": {"shown": 0, "errors": []}}


def wants_reminders(doc):
    return any(isinstance(j, dict) and j.get("notify") is True for j in (doc or {}).get("journals") or [])


def exit_now(code):
    """End a reminder run for certain. A run that lingered would also block the next day's run,
    because the task starts no new copy while one is still going."""
    logging.shutdown()
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.flush()
        except Exception:  # noqa: BLE001
            pass
    os._exit(code)


def run_remind():
    """What the daily task runs while Pen Pal is closed: show any reminders due, then exit."""
    server.apply_location()
    setup_logging(server.MACHINE_DIR, "pen-pal-reminders-log.txt")
    problem = server.location_problem()
    if problem:
        LOG.warning("skipped: %s", problem)
        return 0
    try:
        doc = server.load_data()
    except Exception as e:  # noqa: BLE001
        LOG.error("could not read the data file: %s", e)
        return 1
    if not wants_reminders(doc):
        LOG.info("no journals have reminders on")
        return 0
    import webview  # noqa: PLC0415

    notify.register_app(icon_path(), sys.executable if server.frozen() else None)
    server.DESKTOP = True
    server.QUIET_OK = True
    httpd, url = start_server()
    res = remind_once(webview, url)
    httpd.shutdown()
    LOG.info("reminders: %d due, %d shown%s", len(res["alerts"]), res["delivered"]["shown"],
             "; " + "; ".join([res["error"]] + res["delivered"]["errors"]) if res["error"] or res["delivered"]["errors"] else "")
    return 1 if res["error"] else 0


def run_remind_check(out_path):
    """Build self-test: reminders end to end against a throwaway data folder, plus (on Windows) the
    notification registration and the Task Scheduler task under a test name."""
    import webview  # noqa: PLC0415

    tmp = tempfile.mkdtemp(prefix="penpal-remind-")
    lines, ok = [], [True]

    def check(cond, label):
        lines.append(("ok   " if cond else "FAIL ") + label)
        if not cond:
            ok[0] = False

    server.set_data_dir(tmp)
    setup_logging(tmp, "pen-pal-reminders-log.txt")
    today = datetime.date.today()

    def d(n):
        return (today + datetime.timedelta(days=n)).isoformat()

    doc = {"rev": 0, "poems": [], "submissions": [{"id": "s1", "poemIds": [], "journalId": "e", "sentDate": d(-5), "status": "pending"}], "journals": [
        {"id": "a", "name": "Opens Soon Review", "opens": d(2), "closes": d(40), "notify": True},
        {"id": "b", "name": "Quiet Quarterly", "opens": d(1), "closes": d(30), "notify": False},
        {"id": "c", "name": "Closing Journal", "opens": d(-30), "closes": d(1), "notify": True},
        {"id": "e", "name": "Already Sent Mag", "opens": d(-30), "closes": d(1), "notify": True}]}
    with open(server.DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(doc, f)
    check(wants_reminders(doc) and not wants_reminders({"journals": [{"notify": False}]}), "only runs when a journal has reminders on")

    shown, real = [], notify.show

    def record(title, body, clickable=True):
        shown.append(title)
        return real(title, body, clickable)

    notify.show = record
    if notify.is_windows():
        check(notify.register_app(icon_path(), sys.executable) is None, "registered with Windows for notifications")
        import winreg  # noqa: PLC0415

        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Classes\AppUserModelId\%s" % notify.APP_ID) as k:
                check(winreg.QueryValueEx(k, "DisplayName")[0] == "Pen Pal", "notifications carry the name Pen Pal")
                check(os.path.isfile(winreg.QueryValueEx(k, "IconUri")[0]), "and its icon")
        except OSError as e:
            check(False, "registration readable: %s" % e)
    server.DESKTOP = True
    server.QUIET_OK = True
    httpd, url = start_server()
    res = remind_once(webview, url)
    httpd.shutdown()
    lines.append("     " + json.dumps({"alerts": [a.get("key") for a in res["alerts"]], "error": res["error"], "delivered": res["delivered"]}))
    check(not res["error"], "the rules ran in the hidden window")
    check(sorted(a.get("key") for a in res["alerts"]) == ["a:opens:" + d(2), "c:closes:" + d(1)], "due: one opening, one closing (not a journal with reminders off, not one already sent to)")
    check(res["delivered"]["shown"] == 2 and not res["delivered"]["errors"], "Windows accepted both notifications" if notify.is_windows() else "both notifications delivered")
    check(sorted(shown) == ["Closing Journal closes tomorrow", "Opens Soon Review opens in 2 days"], "notification titles")
    again = notify.deliver(res["alerts"], reminder_folder())
    check(again["shown"] == 0, "each reminder is shown once")
    notify.show = real

    if notify.is_windows():
        name = notify.TASK_NAME + " (build test)"
        check(notify.add_task(sys.executable, name) is None, "daily task created")
        cmd = notify.task_command(name)
        check(cmd is not None and os.path.normcase(cmd) == os.path.normcase(sys.executable), "task runs this program (%s)" % cmd)
        check(notify.remove_task(name) is None and notify.task_command(name) is None, "task removed")

    try:
        with open(os.path.join(tmp, "pen-pal-reminders-log.txt"), encoding="utf-8") as f:
            log = f.read()
    except OSError:
        log = ""
    bad = [ln for ln in log.splitlines() if " ERROR " in ln or "Traceback" in ln or "Error while processing" in ln]
    check(not bad, "no errors in the log")
    lines.append("ALL OK" if ok[0] else "FAILED")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n--- log ---\n" + log)
    return 0 if ok[0] else 1


SMOKE_JS = r"""
(async () => {
  const r = {};
  try {
    const a = window.pywebview.api;
    r.api = Object.keys(a).sort();
    r.nav = document.querySelectorAll('#nav .navitem').length;
    r.titlebar = !document.getElementById('titlebar').hidden;
    r.b0 = await a.win_bounds();
    r.max1 = await a.win_toggle_max();
    r.isMax = await a.win_is_max();
    r.b1 = await a.win_bounds();
    r.max2 = await a.win_toggle_max();
    await a.win_set_bounds(80, 60, 1000, 700);
    await new Promise((s) => setTimeout(s, 600));
    r.b2 = await a.win_bounds();
    await a.win_set_bounds(80, 60, 500, 300);
    await new Promise((s) => setTimeout(s, 600));
    r.b3 = await a.win_bounds();
  } catch (e) { r.error = String(e && e.message || e); }
  window.__smoke = r;
})();
"""


def run_smoke(out_path, title_bar):
    """Open the real window (as the installed app does) against a throwaway data folder, drive the
    title bar controls through the same bridge the page uses, then close while a save is pending.
    Used by the Windows build; a hang or crash here fails the build instead of reaching anyone's PC."""
    import webview  # noqa: PLC0415

    tmp = tempfile.mkdtemp(prefix="penpal-smoke-")
    lines, ok = [], [True]

    def check(cond, label):
        lines.append(("ok   " if cond else "FAIL ") + label)
        if not cond:
            ok[0] = False

    server.set_data_dir(tmp)
    log_path = setup_logging(tmp)
    httpd, url = start_server()
    frameless = title_bar == "custom"
    window, api = open_window(webview, url, frameless)
    timing = {}

    def drive():
        try:
            check(window.events.loaded.wait(90), "page loaded")
            res = None
            for _ in range(150):  # wait for the app to draw its sidebar
                if window.evaluate_js("document.querySelectorAll('#nav .navitem').length") or 0:
                    break
                time.sleep(0.2)
            window.evaluate_js(SMOKE_JS)
            for _ in range(150):
                res = window.evaluate_js("window.__smoke || null")
                if res:
                    break
                time.sleep(0.2)
            res = res or {}
            lines.append("     " + json.dumps(res))
            check(not res.get("error"), "bridge calls work")
            names = res.get("api") or []
            check("win_toggle_max" in names and "set_busy" in names, "page sees the window controls")
            check(all(not n.startswith("_") and n != "window" for n in names), "only methods are exposed to the page")
            check(res.get("nav") == 12, "app drew all twelve sections")
            check(res.get("titlebar") == frameless, "Pen Pal's title bar is %s" % ("shown" if frameless else "hidden"))
            b0, b1, b2, b3 = (res.get(k) or [0, 0, 0, 0] for k in ("b0", "b1", "b2", "b3"))
            check(res.get("max1") is True and res.get("isMax") is True and res.get("max2") is False, "maximize and restore")
            check(b1 != b0, "maximize moved or resized the window")
            check(abs(b2[2] - 1000) <= 2 and abs(b2[3] - 700) <= 2, "resize to 1000x700")
            check(b3[2] >= 899 and b3[3] >= 619, "never smaller than 900x620")
            # Close while the page reports an unsaved edit: the close waits, then goes through. No freeze.
            window.evaluate_js("window.pywebview.api.set_busy(true); setTimeout(() => window.pywebview.api.set_busy(false), 1500)")
            time.sleep(0.5)
            timing["close"] = time.monotonic()
            window.destroy()
        except Exception as e:  # noqa: BLE001
            check(False, "drive the window: %r" % e)
            window.destroy()

    def watchdog():  # if the window freezes, fail instead of hanging the build
        time.sleep(150)
        lines.append("FAIL timed out: the window froze")
        finish(1)

    def finish(code):
        try:
            with open(log_path, encoding="utf-8") as f:
                log = f.read()
        except OSError:
            log = ""
        bad = [ln for ln in log.splitlines() if " ERROR " in ln or "Error while processing" in ln or "Traceback" in ln]
        if bad:
            code = 1
            lines.append("FAIL errors in the log:")
            lines.extend("     " + ln for ln in bad[:20])
        lines.append("ALL OK" if code == 0 else "FAILED")
        with open(out_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n--- log ---\n" + log)
        os._exit(code)

    threading.Thread(target=watchdog, daemon=True).start()
    webview.start(drive)
    waited = time.monotonic() - timing.get("close", time.monotonic())
    check(0.6 <= waited <= 8, "close waited for the save (%.1f s) and then closed" % waited)
    httpd.shutdown()
    time.sleep(0.5)
    finish(0 if ok[0] else 1)


def main():
    ap = argparse.ArgumentParser(description="Pen Pal")
    ap.add_argument("--browser", action="store_true", help="open in the web browser instead of a window")
    ap.add_argument("--check", metavar="FILE", help="self-test and write the result to FILE")
    ap.add_argument("--smoke", metavar="FILE", help="open the real window, drive it, write the result to FILE")
    ap.add_argument("--remind", action="store_true", help="show any reading-period reminders that are due, then exit")
    ap.add_argument("--remind-check", metavar="FILE", help="self-test of reminders, write the result to FILE")
    ap.add_argument("--title-bar", choices=server.TITLE_BARS, default="custom", help="with --smoke: which title bar to test")
    args = ap.parse_args()

    if args.check:
        sys.exit(run_check(args.check))
    if args.smoke:
        sys.exit(run_smoke(args.smoke, args.title_bar))
    if args.remind_check:
        exit_now(run_remind_check(args.remind_check))
    if args.remind:
        exit_now(run_remind())

    server.apply_location()
    log_path = setup_logging(server.MACHINE_DIR)
    LOG.info("Pen Pal %s starting (%s, Python %s, frozen=%s)", server.APP_VERSION, sys.platform, sys.version.split()[0], server.frozen())
    LOG.info("data file %s; log %s", server.DATA_FILE, log_path)
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
        # The previous copy may take a while to close (2.1.0 could hang on close), so keep trying for a few minutes.
        threading.Thread(target=updater.cleanup_old, args=(sys.executable, 60, 5), daemon=True).start()
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

    # Pen Pal's own title bar unless the person chose the standard Windows one in Settings.
    frameless = server.load_settings()["titleBar"] == "custom"
    window, _api = open_window(webview, url, frameless)
    LOG.info("window created (%s title bar)", "custom" if frameless else "standard")
    if notify.is_windows():
        def register():
            err = notify.register_app(icon_path(), sys.executable if server.frozen() else None)
            if err:
                LOG.warning("notification registration: %s", err)
        threading.Thread(target=register, daemon=True).start()
    webview.start()
    LOG.info("window closed")
    httpd.shutdown()


def open_window(webview, url, frameless):
    server.DESKTOP = True
    server.QUIET_OK = True
    server.FRAMELESS = frameless
    api = Api()
    window = webview.create_window("Pen Pal", url, js_api=api, width=1280, height=840, min_size=(900, 620), background_color="#F8F9F9",
                                   frameless=frameless, easy_drag=False, shadow=True)
    api._window = window
    server.RESTART_HOOK = window.destroy  # after an update is swapped in, the new copy is already starting
    window.events.closing += closing_handler(api, window)
    try:
        webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
    except Exception:  # noqa: BLE001  older pywebview without settings
        pass
    return window, api


if __name__ == "__main__":
    main()
