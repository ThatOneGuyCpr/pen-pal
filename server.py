#!/usr/bin/env python3
"""Pen Pal: tiny local server.

Serves the page in ./public and saves your data to data/tracker.json.
Only listens on your own computer (127.0.0.1). Python 3.8+ standard library only.
penpal.py wraps this in a desktop window; run this file directly to use a browser instead.

Usage:  python server.py [--port 8765] [--no-browser]
"""
import argparse
import datetime
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer



APP_NAME = "Pen Pal"
APP_VERSION = "2.1.1"


def frozen():
    return bool(getattr(sys, "frozen", False))


def app_dir():
    """The folder the program lives in: next to PenPal.exe when built, else this file's folder."""
    if frozen():
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


def resource_dir():
    """Where public/ is. Inside the bundle when built with PyInstaller --onefile."""
    if frozen():
        return getattr(sys, "_MEIPASS", app_dir())
    return app_dir()


def default_data_dir():
    """Running from source: ./data, as before. Built exe: a data folder next to the exe if there is
    one (portable use, or an old tracker folder), otherwise the user's own app-data folder."""
    if not frozen():
        return os.path.join(app_dir(), "data")
    beside = os.path.join(app_dir(), "data")
    if os.path.isdir(beside):
        return beside
    base = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".config")
    return os.path.join(base, APP_NAME, "data")


HERE = app_dir()
PUBLIC = os.path.join(resource_dir(), "public")
DATA_DIR = default_data_dir()
DATA_FILE = os.path.join(DATA_DIR, "tracker.json")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
MAX_BODY = 2 * 1024 * 1024  # 2 MB is far more than a poetry tracker needs
KEEP_BACKUPS = 14
DESKTOP = False  # set by penpal.py when the page runs in its own window
FRAMELESS = False  # set by penpal.py when the window uses Pen Pal's own title bar
RESTART_HOOK = None  # set by penpal.py: closes the window after an update has been swapped in
TITLE_BARS = ("custom", "windows")
QUIET_OK = False  # the desktop app sets this so its log only gets failed requests


def set_data_dir(path):
    global DATA_DIR, DATA_FILE, BACKUP_DIR
    DATA_DIR = path
    DATA_FILE = os.path.join(path, "tracker.json")
    BACKUP_DIR = os.path.join(path, "backups")


LOCK = threading.Lock()
LISTS = ("poems", "journals", "submissions")
OPTIONAL_LISTS = ("manuscripts", "entries")  # added later; older files do not have them
MIRROR = {"ok": None, "when": "", "error": ""}  # result of the last copy to the second folder


def empty_data():
    return {"rev": 0, "poems": [], "journals": [], "submissions": [], "manuscripts": [], "entries": [], "settings": {}}


def load_data(path=None):
    path = path or DATA_FILE
    if not os.path.exists(path):
        return empty_data()
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError("data file is not a JSON object")
    for key in LISTS + OPTIONAL_LISTS:
        if not isinstance(data.get(key), list):
            data[key] = []
    if not isinstance(data.get("settings"), dict):
        data["settings"] = {}
    if not isinstance(data.get("rev"), int):
        data["rev"] = 0
    return data


def valid_payload(obj):
    if not isinstance(obj, dict):
        return False
    for key in LISTS:
        if not isinstance(obj.get(key), list):
            return False
        if not all(isinstance(x, dict) for x in obj[key]):
            return False
    for key in OPTIONAL_LISTS:
        if key in obj and not (isinstance(obj[key], list) and all(isinstance(x, dict) for x in obj[key])):
            return False
    if "settings" in obj and not isinstance(obj["settings"], dict):
        return False
    return isinstance(obj.get("rev"), int)


def prune_dated(folder, prefix, keep=KEEP_BACKUPS):
    """Delete all but the newest `keep` files named <prefix>YYYYMMDD.json."""
    pat = re.compile("^" + re.escape(prefix) + r"\d{8}\.json$")
    old = sorted(f for f in os.listdir(folder) if pat.match(f))
    for f in old[:-keep]:
        try:
            os.remove(os.path.join(folder, f))
        except OSError:
            pass


def daily_backup(path=None, backup_dir=None, prefix="tracker-"):
    path = path or DATA_FILE
    backup_dir = backup_dir or BACKUP_DIR
    if not os.path.exists(path):
        return
    os.makedirs(backup_dir, exist_ok=True)
    name = "%s%s.json" % (prefix, datetime.date.today().strftime("%Y%m%d"))
    target = os.path.join(backup_dir, name)
    if not os.path.exists(target):
        shutil.copy2(path, target)
    prune_dated(backup_dir, prefix)


def copy_atomic(src, dst):
    folder = os.path.dirname(dst)
    fd, tmp = tempfile.mkstemp(prefix="copy-", suffix=".tmp", dir=folder)
    os.close(fd)
    try:
        shutil.copyfile(src, tmp)
        os.replace(tmp, dst)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


# ---- server-side settings (only the optional second backup folder, for now) ----
def settings_path():
    return os.path.join(os.path.dirname(DATA_FILE), "settings.json")


def load_settings():
    """Settings the program needs before the page loads (or outside the data file)."""
    out = {"backupFolder": "", "titleBar": "custom"}
    try:
        with open(settings_path(), "r", encoding="utf-8") as f:
            obj = json.load(f)
    except (OSError, ValueError):
        return out
    if isinstance(obj, dict):
        if isinstance(obj.get("backupFolder"), str):
            out["backupFolder"] = obj["backupFolder"]
        if obj.get("titleBar") in TITLE_BARS:
            out["titleBar"] = obj["titleBar"]
    return out


def check_backup_folder(raw):
    """Returns (folder, error). An empty folder switches the second copy off."""
    folder = (raw or "").strip().strip('"').strip()
    if not folder:
        return "", None
    if not os.path.isabs(folder):
        return None, "Please give the full path, for example D:\\Backups or C:\\Users\\you\\OneDrive\\Poetry."
    if not os.path.isdir(folder):
        return None, "That folder does not exist. Create it first, then try again."
    here = os.path.normcase(os.path.abspath(folder))
    own = [os.path.normcase(os.path.abspath(x)) for x in (os.path.dirname(DATA_FILE), BACKUP_DIR)]
    if here in own:
        return None, "That is the tracker's own data folder. Pick a different one."
    return folder, None


def mirror_copy():
    """Copy the data file to the second folder, if one is set. Never raises: a failure here
    must not stop a save, and it is reported on the Export page instead."""
    folder = load_settings()["backupFolder"]
    if not folder:
        MIRROR.update(ok=None, when="", error="")
        return
    now = datetime.datetime.now().isoformat(timespec="seconds")
    try:
        if not os.path.isdir(folder):
            raise OSError("The backup folder is not there: %s" % folder)
        if not os.path.exists(DATA_FILE):
            MIRROR.update(ok=None, when="", error="")
            return
        copy_atomic(DATA_FILE, os.path.join(folder, "pen-pal-latest.json"))
        dated = "pen-pal-%s.json" % datetime.date.today().strftime("%Y%m%d")
        copy_atomic(DATA_FILE, os.path.join(folder, dated))
        prune_dated(folder, "pen-pal-")
        MIRROR.update(ok=True, when=now, error="")
    except Exception as e:
        MIRROR.update(ok=False, when=now, error=str(e))


def settings_view():
    st = load_settings()
    return {"backupFolder": st["backupFolder"], "titleBar": st["titleBar"], "mirror": dict(MIRROR)}


# ---- updates (see updater.py) ----
import updater  # noqa: E402

DOWNLOADER = updater.Downloader()
UPDATE_CACHE = {"at": 0.0, "result": None}


def can_install():
    """Only the built PenPal.exe updates itself, and only where it is allowed to write its folder."""
    return frozen() and os.access(app_dir(), os.W_OK)


def update_check(force=False):
    now = time.time()
    if force or not UPDATE_CACHE["result"] or now - UPDATE_CACHE["at"] > 600:
        UPDATE_CACHE["result"] = updater.check(APP_VERSION)
        UPDATE_CACHE["at"] = now
    res = {k: v for k, v in UPDATE_CACHE["result"].items() if not k.startswith("_")}
    res["canInstall"] = bool(can_install() and res.get("hasAsset"))
    res["download"] = DOWNLOADER.snapshot()
    return res


def save_data(obj, path=None):
    """Atomic write: write a temp file in the same folder, then swap it in."""
    path = path or DATA_FILE
    folder = os.path.dirname(path)
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="tracker-", suffix=".tmp", dir=folder)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


class Handler(SimpleHTTPRequestHandler):
    # Pin content types. On some Windows machines the registry maps .js to text/plain,
    # and with "nosniff" the browser would then refuse to run the page's scripts.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        "": "application/octet-stream",
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
        ".txt": "text/plain; charset=utf-8",
    }

    server_version = "PenPal"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC, **kwargs)

    # Quiet, one-line logs; skip noisy static requests.
    def log_message(self, fmt, *args):
        # A windowed exe has no console: sys.stderr is None there, and writing to it would crash the request.
        if not self.path.startswith("/api/") or sys.stderr is None:
            return
        # The desktop app keeps a log file; only problems go there, not every save.
        if QUIET_OK and len(args) > 1 and str(args[1])[:1] in ("2", "3"):
            return
        sys.stderr.write("%s\n" % (fmt % args))

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def _host_ok(self):
        # Blocks DNS-rebinding tricks: only answer to our own address.
        host = (self.headers.get("Host") or "").split(":")[0].lower()
        return host in ("127.0.0.1", "localhost")

    def _send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self._host_ok():
            return self._send_json(403, {"error": "bad host"})
        if self.path.split("?")[0] == "/api/data":
            try:
                with LOCK:
                    data = load_data()
            except Exception as e:  # corrupt file: tell the page, do not overwrite it
                return self._send_json(500, {"error": "Could not read data file: %s" % e})
            return self._send_json(200, data)
        if self.path.split("?")[0] == "/api/settings":
            with LOCK:
                return self._send_json(200, settings_view())
        if self.path.split("?")[0] == "/api/info":
            return self._send_json(200, {"app": APP_NAME, "version": APP_VERSION, "dataFolder": os.path.dirname(DATA_FILE), "desktop": DESKTOP,
                                         "frameless": FRAMELESS, "titleBar": load_settings()["titleBar"], "canInstall": can_install()})
        if self.path.split("?")[0] == "/api/update":
            return self._send_json(200, update_check(force="force=1" in self.path))
        if self.path.split("?")[0] == "/api/update/status":
            return self._send_json(200, DOWNLOADER.snapshot())
        return super().do_GET()

    def do_PUT(self):
        if not self._host_ok():
            return self._send_json(403, {"error": "bad host"})
        route = self.path.split("?")[0]
        if route not in ("/api/data", "/api/settings", "/api/update/download", "/api/update/apply"):
            return self._send_json(404, {"error": "not found"})
        # Cross-site pages cannot set this header without a CORS preflight, which we never allow.
        if self.headers.get("X-Pen-Pal") != "1" and self.headers.get("X-Poetry-Tracker") != "1":
            return self._send_json(403, {"error": "missing header"})
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            return self._send_json(415, {"error": "expected JSON"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._send_json(400, {"error": "bad length"})
        if length <= 0 or length > MAX_BODY:
            return self._send_json(413, {"error": "body too large or empty"})
        try:
            obj = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return self._send_json(400, {"error": "invalid JSON"})
        if route == "/api/settings":
            return self._put_settings(obj)
        if route == "/api/update/download":
            return self._update_download()
        if route == "/api/update/apply":
            return self._update_apply()
        if not valid_payload(obj):
            return self._send_json(400, {"error": "unexpected data shape"})

        with LOCK:
            try:
                current = load_data()
            except Exception as e:
                return self._send_json(500, {"error": "Could not read data file: %s" % e})
            # Optimistic concurrency: refuse if another tab saved since this page loaded.
            if obj["rev"] != current["rev"]:
                return self._send_json(409, {"error": "stale", "data": current})
            obj["rev"] = current["rev"] + 1
            try:
                daily_backup()
                save_data(obj)
            except OSError as e:
                return self._send_json(500, {"error": "Could not save: %s" % e})
            mirror_copy()
        return self._send_json(200, {"rev": obj["rev"]})

    def _put_settings(self, obj):
        """Changes only the keys sent: backupFolder and/or titleBar."""
        if not isinstance(obj, dict) or not isinstance(obj.get("backupFolder", ""), str):
            return self._send_json(400, {"error": "unexpected settings shape"})
        if "titleBar" in obj and obj["titleBar"] not in TITLE_BARS:
            return self._send_json(400, {"error": "unexpected title bar"})
        with LOCK:
            st = load_settings()
            if "backupFolder" in obj:
                folder, err = check_backup_folder(obj["backupFolder"])
                if err:
                    return self._send_json(400, {"error": err})
                st["backupFolder"] = folder
            if "titleBar" in obj:
                st["titleBar"] = obj["titleBar"]
            try:
                save_data(st, settings_path())
            except OSError as e:
                return self._send_json(500, {"error": "Could not save settings: %s" % e})
            if "backupFolder" in obj:
                mirror_copy()
            return self._send_json(200, settings_view())

    def _update_download(self):
        res = update_check()
        asset = (UPDATE_CACHE["result"] or {}).get("_asset")
        if not res.get("newer"):
            return self._send_json(400, {"error": "You already have the latest version."})
        if not res.get("canInstall") or not asset:
            return self._send_json(400, {"error": "This copy of Pen Pal cannot update itself. Download the new version from the releases page."})
        dest = updater.paths_for(sys.executable)["new"]
        DOWNLOADER.start(asset, res["latest"], dest)
        return self._send_json(200, DOWNLOADER.snapshot())

    def _update_apply(self):
        st = DOWNLOADER.snapshot()
        if st["state"] != "ready" or not can_install():
            return self._send_json(400, {"error": "The update has not finished downloading."})
        try:
            updater.apply_update(sys.executable, st["path"])
            updater.relaunch(sys.executable)
        except Exception as e:  # noqa: BLE001
            return self._send_json(500, {"error": "Could not install the update: %s" % e})
        if RESTART_HOOK:
            threading.Timer(0.8, RESTART_HOOK).start()
        return self._send_json(200, {"ok": True})

    def do_POST(self):
        self._send_json(405, {"error": "method not allowed"})

    do_DELETE = do_POST


def make_server(port):
    last = None
    for p in range(port, port + 20):
        try:
            return ThreadingHTTPServer(("127.0.0.1", p), Handler), p
        except OSError as e:
            last = e
    raise last


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    # Refuse to start if the data file exists but is unreadable, so it never gets overwritten.
    try:
        load_data()
    except Exception as e:
        print("Your data file (%s) could not be read: %s" % (DATA_FILE, e))
        print("Nothing has been changed. Restore a copy from data/backups, or fix the file.")
        sys.exit(1)

    mirror_copy()
    httpd, port = make_server(args.port)
    url = "http://127.0.0.1:%d/" % port
    print("Pen Pal is running at %s" % url)
    print("Your data is saved in: %s" % DATA_FILE)
    print("Close this window (or press Ctrl+C) to stop.")
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
