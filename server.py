#!/usr/bin/env python3
"""Pen Pal: tiny local server.

Serves the page in ./public and saves your data to data/tracker.json.
Only listens on your own computer (127.0.0.1). Python 3.8+ standard library only.
penpal.py wraps this in a desktop window; run this file directly to use a browser instead.

Usage:  python server.py [--port 8765] [--no-browser]
"""
import argparse
import datetime
import html.parser
import ipaddress
import json
import os
import platform
import re
import shutil
import socket
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer



APP_NAME = "Pen Pal"
APP_VERSION = "2.5.0"


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
NATIVE_FRAME = False  # set by penpal.py: that title bar sits in a real Windows frame (nativeframe.py)
RESTART_HOOK = None  # set by penpal.py: closes the window after an update has been swapped in
TITLE_BARS = ("custom", "windows")
QUIET_OK = False  # the desktop app sets this so its log only gets failed requests


# Two folders. MACHINE_DIR is this PC's own: settings.json, daily backups, logs, and location.json,
# which says where the data lives if you moved it (say, into iCloud Drive). DATA_DIR holds tracker.json
# and reminders-sent.json; it is MACHINE_DIR unless you moved your data, and then it may be synced
# between computers. Anything that is about this PC stays in MACHINE_DIR.
MACHINE_DIR = DATA_DIR


def set_data_dir(path):
    """Everything in one folder (the normal case, and tests)."""
    global DATA_DIR, DATA_FILE, BACKUP_DIR, MACHINE_DIR
    DATA_DIR = path
    MACHINE_DIR = path
    DATA_FILE = os.path.join(path, "tracker.json")
    BACKUP_DIR = os.path.join(path, "backups")


def _use_folder(folder):
    global DATA_DIR, DATA_FILE
    DATA_DIR = folder
    DATA_FILE = os.path.join(folder, "tracker.json")


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
    return os.path.join(MACHINE_DIR, "settings.json")


def load_settings():
    """Settings the program needs before the page loads (or outside the data file)."""
    out = {"backupFolder": "", "titleBar": "custom", "remindClosed": True}
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
        if isinstance(obj.get("remindClosed"), bool):
            out["remindClosed"] = obj["remindClosed"]
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
    return {"backupFolder": st["backupFolder"], "titleBar": st["titleBar"], "remindClosed": st["remindClosed"], "mirror": dict(MIRROR)}


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


# ---- the journal directory: the copy inside the app, plus newer ones downloaded from GitHub ----
DIRECTORY_URL = os.environ.get("PENPAL_DIRECTORY_URL") or "https://raw.githubusercontent.com/%s/main/public/directory.json" % updater.REPO
DIRECTORY_CACHE = "directory-update.json"  # in MACHINE_DIR, next to settings.json
DIRECTORY_STATE = "directory-check.json"   # when this computer last looked, and what went wrong
DIRECTORY_MAX = 4 * 1024 * 1024
DIR_LOCK = threading.Lock()


def _read_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def valid_directory(doc):
    """A directory worth using: at least one journal, each with an id and a name."""
    if not isinstance(doc, dict) or not isinstance(doc.get("journals"), list) or not doc["journals"]:
        return False
    rev = doc.get("rev", 0)
    if not isinstance(rev, int) or isinstance(rev, bool):
        return False
    return all(isinstance(j, dict) and isinstance(j.get("id"), str) and j["id"] and isinstance(j.get("name"), str) and j["name"].strip()
               for j in doc["journals"])


def _dir_rank(doc):
    return (doc.get("rev", 0), str(doc.get("checked") or ""))


def directory_view():
    """The newest good directory this computer has. Never touches the network."""
    bundled = _read_json(os.path.join(PUBLIC, "directory.json"))
    if not valid_directory(bundled):
        bundled = {"rev": 0, "checked": "", "journals": []}
    cached = _read_json(os.path.join(MACHINE_DIR, DIRECTORY_CACHE))
    state = _read_json(os.path.join(MACHINE_DIR, DIRECTORY_STATE)) or {}
    use_cache = valid_directory(cached) and _dir_rank(cached) > _dir_rank(bundled)
    return {"directory": cached if use_cache else bundled, "source": "update" if use_cache else "app",
            "lastCheck": str(state.get("at") or ""), "error": str(state.get("error") or "")}


def _save_dir_state(error):
    st = {"at": datetime.datetime.now().astimezone().isoformat(timespec="seconds"), "error": error}
    try:
        save_data(st, os.path.join(MACHINE_DIR, DIRECTORY_STATE))
    except OSError:
        pass


def directory_check(force=False, timeout=15):
    """Look on GitHub for a newer directory (at most every 20 hours unless forced).
    Returns directory_view() plus "updated": True when a newer one was saved."""
    with DIR_LOCK:
        view = directory_view()
        if not force and view["lastCheck"]:
            try:
                last = datetime.datetime.fromisoformat(view["lastCheck"])
                if (datetime.datetime.now().astimezone() - last).total_seconds() < 20 * 3600:
                    return dict(view, updated=False)
            except ValueError:
                pass
        try:
            req = urllib.request.Request(DIRECTORY_URL, headers={"User-Agent": updater.USER_AGENT, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310  (fixed https GitHub URL)
                body = r.read(DIRECTORY_MAX + 1)
            if len(body) > DIRECTORY_MAX:
                raise ValueError("the directory file is too large")
            doc = json.loads(body.decode("utf-8"))
            if not valid_directory(doc):
                raise ValueError("the downloaded directory did not look right")
        except Exception as e:  # noqa: BLE001
            _save_dir_state("Could not check for a newer directory: %s" % e)
            return dict(directory_view(), updated=False)
        updated = _dir_rank(doc) > _dir_rank(view["directory"])
        if updated:
            try:
                save_data(doc, os.path.join(MACHINE_DIR, DIRECTORY_CACHE))
            except OSError as e:
                _save_dir_state("Could not save the newer directory: %s" % e)
                return dict(directory_view(), updated=False)
        _save_dir_state("")
        return dict(directory_view(), updated=updated)


# ---- quick add: read a journal's guidelines page so the page can fill in the journal form ----
GUIDELINES_MAX = 3 * 1024 * 1024


class _TextOnly(html.parser.HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "template", "head"}
    BLOCK = {"p", "div", "li", "br", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "td", "dd", "dt"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.title, self._skip, self._in_title = [], "", 0, False

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self._in_title = True
        elif tag in self.SKIP:
            self._skip += 1
        elif tag in self.BLOCK:
            self.parts.append(" \n")

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag in self.SKIP and self._skip:
            self._skip -= 1
        elif tag in self.BLOCK:
            self.parts.append(" \n")

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif not self._skip:
            self.parts.append(data)


def html_to_text(raw):
    p = _TextOnly()
    try:
        p.feed(raw)
        p.close()
    except Exception:  # noqa: BLE001  a broken page still gives whatever text came before the problem
        pass
    text = re.sub(r"[ \t\r\f\v]+", " ", "".join(p.parts))
    text = re.sub(r"\s*\n\s*", "\n", text).strip()
    return re.sub(r"\s+", " ", p.title).strip(), text


def public_host(host):
    """True when every address the name points to is on the public internet (not this computer or the home network)."""
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            return False
    return bool(infos)


def fetch_guidelines(url, timeout=15):
    """(result, error). result: {url, title, text}. Only http(s) pages on the public internet."""
    url = str(url or "").strip()
    if url and "://" not in url:
        url = "https://" + url
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None, "That does not look like a web address."
    if not public_host(parts.hostname):
        return None, "Pen Pal only reads pages on the public internet."
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PenPal/%s" % APP_VERSION,
                                                   "Accept": "text/html,text/plain;q=0.9,*/*;q=0.1"})
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310  (checked above: http(s), public host)
            final = r.geturl()
            fp = urllib.parse.urlsplit(final)
            if fp.scheme not in ("http", "https") or not public_host(fp.hostname or ""):
                return None, "That page redirected somewhere Pen Pal will not follow."
            kind = (r.headers.get("Content-Type") or "").lower()
            if kind and not any(k in kind for k in ("text/html", "text/plain", "application/xhtml")):
                return None, "That link is not a web page (it is %s)." % kind.split(";")[0]
            body = r.read(GUIDELINES_MAX + 1)[:GUIDELINES_MAX]
            charset = r.headers.get_content_charset() or "utf-8"
    except urllib.error.HTTPError as e:
        return None, "The site answered with an error (%s)." % e.code
    except Exception as e:  # noqa: BLE001
        return None, "Could not open that page: %s" % getattr(e, "reason", e)
    raw = body.decode(charset, errors="replace")
    if "text/plain" in kind:
        title, text = "", raw
    else:
        title, text = html_to_text(raw)
    return {"url": final, "title": title[:300], "text": text[:200000]}, None


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


# ---- where the data lives, and keeping two computers honest through a synced folder ----
LOCATION_NAME = "location.json"
LAST_SAVED_NAME = "last-saved.json"  # in MACHINE_DIR: this PC's own copy of its latest save
META_KEYS = ("saveId", "savedOn", "savedAt", "lineage")
CONFLICT_RE = re.compile(r"^tracker.+\.json$", re.I)  # tracker 2.json, tracker-LAPTOP.json, tracker (conflicted copy).json


def machine_name():
    return (os.environ.get("COMPUTERNAME") or platform.node() or "this PC")[:60]


def stamp_save(obj, base):
    """Mark a save as building on `base`: new id, where and when, and the ids it descends from."""
    lineage = [x for x in (base.get("lineage") or []) if isinstance(x, str)]
    if base.get("saveId"):
        lineage.append(base["saveId"])
    obj["lineage"] = lineage[-50:]
    obj["saveId"] = uuid.uuid4().hex[:16]
    obj["savedOn"] = machine_name()
    obj["savedAt"] = datetime.datetime.now().isoformat(timespec="seconds")
    obj["rev"] = int(base.get("rev") or 0) + 1
    return obj


def save_meta(obj):
    return {"rev": obj["rev"], "saveId": obj.get("saveId", ""), "savedOn": obj.get("savedOn", ""), "savedAt": obj.get("savedAt", ""), "lineage": obj.get("lineage", [])}


def builds_on(doc, save_id):
    """Does this file contain the save `save_id` (it is that save, or a later one made on top of it)?"""
    return not save_id or doc.get("saveId") == save_id or save_id in (doc.get("lineage") or [])


def custom_location():
    return os.path.normcase(os.path.abspath(DATA_DIR)) != os.path.normcase(os.path.abspath(MACHINE_DIR))


def remember_my_save(obj):
    """With the data in a shared folder, keep this PC's latest save here too, so if the other computer's
    copy replaces it (iCloud can keep one file and drop the other), it can be put back."""
    if custom_location():
        save_data(obj, os.path.join(MACHINE_DIR, LAST_SAVED_NAME))


def location_path():
    return os.path.join(MACHINE_DIR, LOCATION_NAME)


def read_location():
    try:
        with open(location_path(), "r", encoding="utf-8") as f:
            obj = json.load(f)
        folder = obj.get("dataFolder") if isinstance(obj, dict) else ""
        return folder if isinstance(folder, str) and os.path.isabs(folder) else ""
    except (OSError, ValueError):
        return ""


def apply_location():
    """At start-up: use the folder you moved your data to, if you did."""
    folder = read_location()
    if folder:
        _use_folder(folder)
    return folder


def location_problem():
    """Why the data cannot be used right now, or None. Never start an empty file in a moved-to folder:
    a missing file there usually means the cloud service has not caught up, not that you have no data."""
    if not custom_location():
        return None
    if not os.path.isdir(DATA_DIR):
        return ("Pen Pal keeps your data in %s, and that folder is not available right now. If it is in iCloud Drive "
                "or another cloud folder, make sure that app is running and signed in, then open Pen Pal again." % DATA_DIR)
    if not os.path.exists(DATA_FILE):
        return ("Pen Pal keeps your data in %s, but tracker.json is not there. If the folder syncs from the cloud, wait for it "
                "to finish (or mark the folder \"Always keep on this device\"), then open Pen Pal again." % DATA_DIR)
    return None


def cloud_label(path):
    p = os.path.normcase(os.path.abspath(path)).replace("\\", "/").lower()
    for key, label in (("iclouddrive", "iCloud Drive"), ("icloud drive", "iCloud Drive"), ("onedrive", "OneDrive"),
                       ("dropbox", "Dropbox"), ("google drive", "Google Drive"), ("my drive", "Google Drive")):
        if key in p:
            return label
    return ""


def folder_suggestions():
    """Cloud folders found on this PC, each with a Pen Pal folder inside."""
    home = os.path.expanduser("~")
    cands = [os.path.join(home, "iCloudDrive"), os.path.join(home, "iCloud Drive"),
             os.environ.get("OneDrive") or os.path.join(home, "OneDrive"), os.path.join(home, "Dropbox"), "G:\\My Drive"]
    out, seen = [], set()
    for c in cands:
        if c and os.path.isdir(c) and os.path.normcase(c) not in seen:
            seen.add(os.path.normcase(c))
            out.append({"label": cloud_label(c) or os.path.basename(c), "path": os.path.join(c, APP_NAME)})
    return out


def summary(doc):
    doc = doc or {}
    n = lambda k: len(doc.get(k) or []) if isinstance(doc.get(k), list) else 0  # noqa: E731
    return {"journals": n("journals"), "poems": n("poems"), "submissions": n("submissions"),
            "savedOn": str(doc.get("savedOn") or ""), "savedAt": str(doc.get("savedAt") or "")}


def check_target(raw):
    """Look at a folder you want to keep your data in. Returns (folder, info, error)."""
    folder = (raw or "").strip().strip('"').strip()
    if not folder or not os.path.isabs(folder):
        return None, None, "Give the full path, for example C:\\Users\\you\\iCloudDrive\\Pen Pal."
    folder = os.path.abspath(folder)
    nc = os.path.normcase
    if nc(folder) == nc(os.path.abspath(DATA_DIR)):
        return None, None, "Your data is already in that folder."
    home = nc(folder) == nc(os.path.abspath(MACHINE_DIR))  # this PC's own data folder is always fine
    own = [BACKUP_DIR, PUBLIC] + ([getattr(sys, "_MEIPASS", "")] if frozen() else [])
    for o in (nc(os.path.abspath(x)) for x in own if x):
        if not home and (nc(folder) == o or nc(folder).startswith(o + os.sep)):
            return None, None, "Pick a folder outside Pen Pal's own files."
    info = {"folder": folder, "create": False, "hasData": False, "summary": None, "cloud": cloud_label(folder)}
    if not os.path.isdir(folder):
        if not os.path.isdir(os.path.dirname(folder)):
            return None, None, "That folder does not exist, and neither does the one it would go in."
        info["create"] = True
        return folder, info, None
    target = os.path.join(folder, "tracker.json")
    if os.path.exists(target):
        try:
            info["summary"] = summary(load_data(target))
            info["hasData"] = True
        except Exception as e:  # noqa: BLE001
            return None, None, "There is a tracker.json in that folder that Pen Pal cannot read (%s). Pick another folder or fix that file first." % e
    try:
        fd, tmp = tempfile.mkstemp(prefix="pen-pal-write-test-", dir=folder)
        os.close(fd)
        os.remove(tmp)
    except OSError as e:
        return None, None, "Pen Pal cannot write to that folder: %s" % e
    return folder, info, None


def change_location(raw, mode):
    """Keep the data in another folder. mode: "move" (folder has no Pen Pal data: take this data there),
    "use" (switch to the data already there), "replace" (put this data there; theirs goes to backups).
    The copy left behind is renamed, never deleted. Returns (result, error)."""
    folder, info, err = check_target(raw)
    if err:
        return None, err
    if mode not in ("move", "use", "replace"):
        return None, "Unknown choice."
    if info["hasData"] and mode == "move":
        return None, "That folder already has Pen Pal data. Choose to use it or to replace it."
    if not info["hasData"] and mode != "move":
        return None, "That folder has no Pen Pal data to use or replace."
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    target = os.path.join(folder, "tracker.json")
    current = load_data()
    os.makedirs(folder, exist_ok=True)
    os.makedirs(BACKUP_DIR, exist_ok=True)
    if mode == "move":
        save_data(current, target)
    elif mode == "replace":
        theirs = load_data(target)
        shutil.copy2(target, os.path.join(BACKUP_DIR, "replaced-%s.json" % stamp))
        save_data(stamp_save(dict(current), theirs), target)
    if os.path.exists(DATA_FILE):
        os.replace(DATA_FILE, os.path.join(os.path.dirname(DATA_FILE), "moved-away-tracker-%s.json" % stamp))
    if os.path.normcase(folder) == os.path.normcase(os.path.abspath(MACHINE_DIR)):
        if os.path.exists(location_path()):
            os.remove(location_path())
    else:
        save_data({"dataFolder": folder}, location_path())
    _use_folder(folder)
    lp = os.path.join(MACHINE_DIR, LAST_SAVED_NAME)
    if os.path.exists(lp):
        os.remove(lp)  # a fresh start: nothing of this PC's can have been lost in the new folder
    return {"folder": folder}, None


def conflict_copies():
    """Second copies a cloud service left next to tracker.json when two computers changed it at once."""
    out = []
    try:
        names = sorted(os.listdir(DATA_DIR))
    except OSError:
        return out
    for name in names:
        if name.lower() == "tracker.json" or not CONFLICT_RE.match(name):
            continue
        path = os.path.join(DATA_DIR, name)
        item = {"name": name, "modified": datetime.datetime.fromtimestamp(os.path.getmtime(path)).isoformat(timespec="seconds")}
        try:
            item["summary"] = summary(load_data(path))
        except Exception as e:  # noqa: BLE001
            item["error"] = str(e)
        out.append(item)
    return out


def sync_state():
    """What the page polls: the file's current save, any second copies, and whether a save this PC
    made has been replaced by another computer's version that does not include it."""
    doc = load_data()
    out = save_meta(doc)
    out["custom"] = custom_location()
    out["conflicts"] = conflict_copies() if out["custom"] else []
    out["lost"] = None
    lp = os.path.join(MACHINE_DIR, LAST_SAVED_NAME)
    if out["custom"] and os.path.exists(lp):
        try:
            mine = load_data(lp)
        except Exception:  # noqa: BLE001
            mine = {}
        if mine.get("saveId") and not builds_on(doc, mine["saveId"]):
            out["lost"] = {"mine": summary(mine), "theirs": summary(doc)}
    return out


def resolve_sync(action, name=""):
    """keep-theirs / restore-mine (after a lost save), keep-current / use-copy (a second copy). Nothing is
    deleted: whatever is set aside goes to this PC's backups folder. Returns (result, error)."""
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    os.makedirs(BACKUP_DIR, exist_ok=True)
    lp = os.path.join(MACHINE_DIR, LAST_SAVED_NAME)
    if action in ("keep-theirs", "restore-mine"):
        if not os.path.exists(lp):
            return None, "Nothing to resolve."
        if action == "keep-theirs":
            os.replace(lp, os.path.join(BACKUP_DIR, "set-aside-mine-%s.json" % stamp))
            return {"ok": True}, None
        mine, current = load_data(lp), load_data()
        shutil.copy2(DATA_FILE, os.path.join(BACKUP_DIR, "replaced-%s.json" % stamp))
        obj = stamp_save({k: v for k, v in mine.items() if k not in META_KEYS}, current)
        save_data(obj)
        remember_my_save(obj)
        return save_meta(obj), None
    if action in ("keep-current", "use-copy"):
        names = {c["name"] for c in conflict_copies()}
        if name not in names:
            return None, "That copy is not there any more."
        path = os.path.join(DATA_DIR, name)
        if action == "use-copy":
            copy, current = load_data(path), load_data()
            shutil.copy2(DATA_FILE, os.path.join(BACKUP_DIR, "replaced-%s.json" % stamp))
            obj = stamp_save({k: v for k, v in copy.items() if k not in META_KEYS}, current)
            save_data(obj)
            remember_my_save(obj)
        shutil.move(path, os.path.join(BACKUP_DIR, "second-copy-%s-%s" % (stamp, name)))
        return {"ok": True}, None
    return None, "Unknown choice."


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
                                         "frameless": FRAMELESS, "titleBar": load_settings()["titleBar"], "canInstall": can_install(),
                                         "remindClosed": load_settings()["remindClosed"], "dataCustom": custom_location(), "dataCloud": cloud_label(DATA_DIR), "canRemindClosed": DESKTOP and frozen() and sys.platform.startswith("win")})
        route = self.path.split("?")[0]
        if route in ("/api/data/stat", "/api/location", "/api/location/check"):
            try:
                with LOCK:
                    if route == "/api/data/stat":
                        return self._send_json(200, sync_state())
                    if route == "/api/location":
                        return self._send_json(200, {"folder": DATA_DIR, "custom": custom_location(), "local": MACHINE_DIR,
                                                     "cloud": cloud_label(DATA_DIR), "suggestions": folder_suggestions()})
                    q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                    folder, info, err = check_target((q.get("folder") or [""])[0])
                    return self._send_json(200, {"ok": False, "error": err} if err else dict(info, ok=True))
            except Exception as e:  # noqa: BLE001
                return self._send_json(500, {"error": str(e)})
        if self.path.split("?")[0] == "/api/directory":
            return self._send_json(200, directory_view())
        if self.path.split("?")[0] == "/api/update":
            return self._send_json(200, update_check(force="force=1" in self.path))
        if self.path.split("?")[0] == "/api/update/status":
            return self._send_json(200, DOWNLOADER.snapshot())
        return super().do_GET()

    def do_PUT(self):
        if not self._host_ok():
            return self._send_json(403, {"error": "bad host"})
        route = self.path.split("?")[0]
        if route not in ("/api/data", "/api/settings", "/api/update/download", "/api/update/apply", "/api/location", "/api/sync",
                         "/api/directory/check", "/api/guidelines"):
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
        if route == "/api/directory/check":
            return self._send_json(200, directory_check(force=isinstance(obj, dict) and obj.get("force") is True))
        if route == "/api/guidelines":
            res, err = fetch_guidelines(obj.get("url") if isinstance(obj, dict) else "")
            return self._send_json(400, {"error": err}) if err else self._send_json(200, res)
        if route in ("/api/location", "/api/sync"):
            if not isinstance(obj, dict):
                return self._send_json(400, {"error": "unexpected shape"})
            with LOCK:
                try:
                    if route == "/api/location":
                        res, err = change_location(str(obj.get("folder") or ""), str(obj.get("mode") or ""))
                    else:
                        res, err = resolve_sync(str(obj.get("action") or ""), str(obj.get("name") or ""))
                except Exception as e:  # noqa: BLE001
                    return self._send_json(500, {"error": "Could not do that: %s" % e})
            return self._send_json(400, {"error": err}) if err else self._send_json(200, res)
        if not valid_payload(obj):
            return self._send_json(400, {"error": "unexpected data shape"})

        with LOCK:
            try:
                current = load_data()
            except Exception as e:
                return self._send_json(500, {"error": "Could not read data file: %s" % e})
            # Optimistic concurrency: refuse if anything saved since this page loaded: another
            # window (rev moved on) or another computer through a synced folder (saveId differs).
            if obj["rev"] != current["rev"] or str(obj.get("saveId") or "") != str(current.get("saveId") or ""):
                return self._send_json(409, {"error": "stale", "data": current})
            stamp_save(obj, current)
            try:
                daily_backup()
                save_data(obj)
                remember_my_save(obj)
            except OSError as e:
                return self._send_json(500, {"error": "Could not save: %s" % e})
            mirror_copy()
        return self._send_json(200, save_meta(obj))

    def _put_settings(self, obj):
        """Changes only the keys sent: backupFolder, titleBar, remindClosed."""
        if not isinstance(obj, dict) or not isinstance(obj.get("backupFolder", ""), str):
            return self._send_json(400, {"error": "unexpected settings shape"})
        if "titleBar" in obj and obj["titleBar"] not in TITLE_BARS:
            return self._send_json(400, {"error": "unexpected title bar"})
        if "remindClosed" in obj and not isinstance(obj["remindClosed"], bool):
            return self._send_json(400, {"error": "unexpected reminder setting"})
        with LOCK:
            st = load_settings()
            if "backupFolder" in obj:
                folder, err = check_backup_folder(obj["backupFolder"])
                if err:
                    return self._send_json(400, {"error": err})
                st["backupFolder"] = folder
            if "titleBar" in obj:
                st["titleBar"] = obj["titleBar"]
            if "remindClosed" in obj:
                st["remindClosed"] = obj["remindClosed"]
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

    apply_location()
    problem = location_problem()
    if problem:
        print(problem)
        sys.exit(1)
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
