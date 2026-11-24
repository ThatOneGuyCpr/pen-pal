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


class Api:
    """Functions the page can call through window.pywebview.api (desktop window only)."""

    def __init__(self):
        self.window = None

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
    api = Api()
    window = webview.create_window("Pen Pal", url, js_api=api, width=1280, height=840, min_size=(900, 620), background_color="#F8F9F9")
    api.window = window

    def on_closing():
        # Give a save that is still in flight a few seconds to finish before the window goes.
        for _ in range(25):
            try:
                busy = window.evaluate_js("window.PenPal ? window.PenPal.busy() : false")
            except Exception:  # noqa: BLE001
                return True
            if not busy:
                return True
            time.sleep(0.2)
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
