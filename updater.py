"""Pen Pal: checking for and installing updates from the GitHub releases page.

Standard library only. The flow:
  check()          ask GitHub for the latest release and compare it with this version
  Downloader       fetch PenPal.exe next to the running one as PenPal.new.exe, checking that it
                   comes from this repo's releases, has the published size and sha256 fingerprint,
                   and looks like a Windows program
  apply_update()   Windows lets a running .exe be renamed (not deleted), so: running exe -> .old,
                   new exe -> the original name. Then relaunch() starts it and the old one exits.
  cleanup_old()    the new copy deletes the .old file the next time it starts
"""
import hashlib
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request

REPO = "ThatOneGuyCpr/pen-pal"
API_URL = os.environ.get("PENPAL_UPDATE_API") or "https://api.github.com/repos/%s/releases/latest" % REPO
ALLOWED_PREFIX = os.environ.get("PENPAL_UPDATE_PREFIX") or "https://github.com/%s/releases/download/" % REPO
RELEASES_PAGE = "https://github.com/%s/releases" % REPO
ASSET_NAME = "PenPal.exe"
USER_AGENT = "PenPal-updater"


def parse_version(v):
    """'v2.10.1' -> (2, 10, 1). Anything after a '-' (pre-release) is ignored. Bad input -> ()."""
    v = str(v or "").strip().lstrip("vV").split("-")[0]
    try:
        return tuple(int(p) for p in v.split("."))
    except ValueError:
        return ()


def is_newer(latest, current):
    a, b = parse_version(latest), parse_version(current)
    if not a or not b:
        return False
    n = max(len(a), len(b))
    return a + (0,) * (n - len(a)) > b + (0,) * (n - len(b))


def _get(url, timeout):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"})
    return urllib.request.urlopen(req, timeout=timeout)  # noqa: S310  (https GitHub URLs only)


def fetch_latest(timeout=10):
    """The latest release, reduced to what Pen Pal needs. Raises on network or format problems."""
    with _get(API_URL, timeout) as r:
        rel = json.loads(r.read().decode("utf-8"))
    asset = None
    for a in rel.get("assets") or []:
        if a.get("name") == ASSET_NAME:
            digest = str(a.get("digest") or "")
            asset = {
                "url": str(a.get("browser_download_url") or ""),
                "size": int(a.get("size") or 0),
                "sha256": digest[7:].lower() if digest.startswith("sha256:") else "",
            }
            break
    return {
        "version": str(rel.get("tag_name") or "").lstrip("vV"),
        "notes": str(rel.get("body") or "")[:4000],
        "page": str(rel.get("html_url") or RELEASES_PAGE),
        "asset": asset,
    }


def check(current, timeout=10):
    """Never raises. Returns {current, latest, newer, notes, page, size, error}."""
    try:
        rel = fetch_latest(timeout)
    except Exception as e:  # noqa: BLE001
        return {"current": current, "latest": "", "newer": False, "notes": "", "page": RELEASES_PAGE, "size": 0, "error": "Could not reach GitHub: %s" % e}
    return {
        "current": current,
        "latest": rel["version"],
        "newer": is_newer(rel["version"], current),
        "notes": rel["notes"],
        "page": rel["page"],
        "size": rel["asset"]["size"] if rel["asset"] else 0,
        "hasAsset": bool(rel["asset"]),
        "error": "",
        "_asset": rel["asset"],
    }


class Downloader:
    """Downloads one release asset in a background thread. `state` is safe to read at any time."""

    def __init__(self):
        self.lock = threading.Lock()
        self.state = {"state": "idle", "got": 0, "total": 0, "error": "", "version": "", "path": ""}

    def snapshot(self):
        with self.lock:
            return dict(self.state)

    def _set(self, **kw):
        with self.lock:
            self.state.update(kw)

    def start(self, asset, version, dest):
        with self.lock:
            if self.state["state"] == "downloading":
                return False
            self.state = {"state": "downloading", "got": 0, "total": int(asset.get("size") or 0), "error": "", "version": version, "path": dest}
        threading.Thread(target=self._run, args=(asset, dest), daemon=True).start()
        return True

    def _run(self, asset, dest):
        part = dest + ".part"
        try:
            url = asset.get("url") or ""
            if not url.startswith(ALLOWED_PREFIX):
                raise ValueError("The download link does not point at Pen Pal's own releases.")
            h = hashlib.sha256()
            got = 0
            with _get(url, 30) as r, open(part, "wb") as f:
                while True:
                    chunk = r.read(256 * 1024)
                    if not chunk:
                        break
                    if got == 0 and not chunk.startswith(b"MZ"):
                        raise ValueError("The downloaded file is not a Windows program.")
                    f.write(chunk)
                    h.update(chunk)
                    got += len(chunk)
                    self._set(got=got)
            if asset.get("size") and got != asset["size"]:
                raise ValueError("The download was incomplete (%d of %d bytes)." % (got, asset["size"]))
            if asset.get("sha256") and h.hexdigest() != asset["sha256"]:
                raise ValueError("The download's fingerprint does not match the release, so it was thrown away.")
            os.replace(part, dest)
            self._set(state="ready")
        except Exception as e:  # noqa: BLE001
            try:
                if os.path.exists(part):
                    os.remove(part)
            except OSError:
                pass
            self._set(state="error", error=str(e))


def paths_for(exe_path):
    base, ext = os.path.splitext(exe_path)
    return {"new": base + ".new" + ext, "old": base + ".old" + ext}


def apply_update(exe_path, new_path):
    """Swap the new program in. The running one is renamed out of the way, which Windows allows."""
    old = paths_for(exe_path)["old"]
    if os.path.exists(old):
        os.remove(old)
    os.replace(exe_path, old)
    try:
        os.replace(new_path, exe_path)
    except Exception:
        os.replace(old, exe_path)  # put things back as they were
        raise
    return old


def relaunch(exe_path, args=()):
    kw = {"close_fds": True}
    if sys.platform.startswith("win"):
        kw["creationflags"] = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    return subprocess.Popen([exe_path, *args], cwd=os.path.dirname(exe_path), **kw)  # noqa: S603


def cleanup_old(exe_path, tries=5):
    """Delete the previous version left behind by an update. It may still be closing, so retry briefly."""
    old = paths_for(exe_path)["old"]
    for _ in range(tries):
        if not os.path.exists(old):
            return True
        try:
            os.remove(old)
            return True
        except OSError:
            time.sleep(1)
    return False
