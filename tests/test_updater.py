"""Tests for updater.py and the /api/update endpoints, against a local fake of GitHub."""
import hashlib
import http.client
import http.server
import json
import os
import sys
import tempfile
import threading
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server  # noqa: E402
import updater  # noqa: E402

GOOD = b"MZ" + b"pen pal build " * 5000
STATE = {"release": None, "files": {}}


class FakeGitHub(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == "/latest":
            body = json.dumps(STATE["release"]).encode()
        elif self.path in STATE["files"]:
            body = STATE["files"][self.path]
        else:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def release(version, data=GOOD, size=None, digest=None, url_path="/download/v/PenPal.exe", base=None):
    STATE["files"][url_path] = data
    return {
        "tag_name": "v" + version, "body": "What changed", "html_url": "https://github.com/x/releases/tag/v" + version,
        "assets": [{"name": "PenPal.exe", "size": len(data) if size is None else size,
                    "digest": "sha256:" + (digest or hashlib.sha256(data).hexdigest()),
                    "browser_download_url": (base or BASE) + url_path}],
    }


class UpdaterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        global BASE
        cls.gh = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeGitHub)
        BASE = "http://127.0.0.1:%d" % cls.gh.server_address[1]
        threading.Thread(target=cls.gh.serve_forever, daemon=True).start()
        cls.saved = (updater.API_URL, updater.ALLOWED_PREFIX)
        updater.API_URL = BASE + "/latest"
        updater.ALLOWED_PREFIX = BASE + "/download/"

    @classmethod
    def tearDownClass(cls):
        updater.API_URL, updater.ALLOWED_PREFIX = cls.saved
        cls.gh.shutdown()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        STATE["files"] = {}

    def tearDown(self):
        self.tmp.cleanup()

    def wait(self, d):
        for _ in range(200):
            if d.snapshot()["state"] != "downloading":
                return d.snapshot()
            time.sleep(0.02)
        self.fail("download never finished")

    def test_versions(self):
        self.assertEqual(updater.parse_version("v2.10.1"), (2, 10, 1))
        self.assertEqual(updater.parse_version("2.1.0-beta"), (2, 1, 0))
        self.assertEqual(updater.parse_version("nope"), ())
        self.assertTrue(updater.is_newer("2.10.0", "2.9.9"))
        self.assertTrue(updater.is_newer("v2.1", "2.0.9"))
        self.assertFalse(updater.is_newer("2.1.0", "2.1"))
        self.assertFalse(updater.is_newer("2.0.0", "2.1.0"))
        self.assertFalse(updater.is_newer("", "2.1.0"))

    def test_check(self):
        STATE["release"] = release("2.2.0")
        r = updater.check("2.1.0")
        self.assertEqual((r["latest"], r["newer"], r["size"], r["error"]), ("2.2.0", True, len(GOOD), ""))
        self.assertEqual(r["_asset"]["sha256"], hashlib.sha256(GOOD).hexdigest())
        self.assertFalse(updater.check("2.2.0")["newer"])
        STATE["release"] = {"tag_name": "v9.0.0", "assets": []}
        self.assertFalse(updater.check("2.1.0")["hasAsset"])

    def test_check_never_raises(self):
        old = updater.API_URL
        updater.API_URL = BASE + "/missing"
        try:
            r = updater.check("2.1.0")
        finally:
            updater.API_URL = old
        self.assertFalse(r["newer"])
        self.assertIn("Could not reach GitHub", r["error"])

    def download(self, rel):
        STATE["release"] = rel
        asset = updater.fetch_latest()["asset"]
        dest = os.path.join(self.tmp.name, "PenPal.new.exe")
        d = updater.Downloader()
        self.assertTrue(d.start(asset, "2.2.0", dest))
        return self.wait(d), dest

    def test_good_download(self):
        st, dest = self.download(release("2.2.0"))
        self.assertEqual(st["state"], "ready", st["error"])
        self.assertEqual(st["got"], len(GOOD))
        with open(dest, "rb") as f:
            self.assertEqual(f.read(), GOOD)
        self.assertFalse(os.path.exists(dest + ".part"))

    def test_bad_downloads_are_thrown_away(self):
        cases = [
            (lambda: release("2.2.0", digest="0" * 64, url_path="/download/a/PenPal.exe"), "fingerprint"),
            (lambda: release("2.2.0", size=10, url_path="/download/b/PenPal.exe"), "incomplete"),
            (lambda: release("2.2.0", data=b"<html>not an exe</html>", url_path="/download/c/PenPal.exe"), "not a Windows program"),
            (lambda: release("2.2.0", base="http://evil.example", url_path="/download/d/PenPal.exe"), "own releases"),
        ]
        for make, words in cases:
            st, dest = self.download(make())
            self.assertEqual(st["state"], "error")
            self.assertIn(words, st["error"])
            self.assertFalse(os.path.exists(dest))
            self.assertFalse(os.path.exists(dest + ".part"))

    def test_swap_and_cleanup(self):
        exe = os.path.join(self.tmp.name, "PenPal.exe")
        p = updater.paths_for(exe)
        self.assertEqual(p["new"], os.path.join(self.tmp.name, "PenPal.new.exe"))
        with open(exe, "wb") as f:
            f.write(b"MZ old")
        with open(p["new"], "wb") as f:
            f.write(b"MZ new")
        updater.apply_update(exe, p["new"])
        with open(exe, "rb") as f:
            self.assertEqual(f.read(), b"MZ new")
        with open(p["old"], "rb") as f:
            self.assertEqual(f.read(), b"MZ old")
        self.assertTrue(updater.cleanup_old(exe, tries=1))
        self.assertFalse(os.path.exists(p["old"]))

    def test_swap_rolls_back_when_the_new_file_is_missing(self):
        exe = os.path.join(self.tmp.name, "PenPal.exe")
        with open(exe, "wb") as f:
            f.write(b"MZ old")
        with self.assertRaises(OSError):
            updater.apply_update(exe, os.path.join(self.tmp.name, "nothing.exe"))
        with open(exe, "rb") as f:
            self.assertEqual(f.read(), b"MZ old")

    def test_relaunch_starts_a_detached_process(self):
        out = os.path.join(self.tmp.name, "ran.txt")
        p = updater.relaunch(sys.executable, ["-c", "open(%r, 'w').write('yes')" % out])
        p.wait(timeout=10)
        with open(out) as f:
            self.assertEqual(f.read(), "yes")


class UpdateEndpointTests(unittest.TestCase):
    """The page talks to these. From source (not frozen) checking works but installing is refused."""

    @classmethod
    def setUpClass(cls):
        cls.gh = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeGitHub)
        base = "http://127.0.0.1:%d" % cls.gh.server_address[1]
        threading.Thread(target=cls.gh.serve_forever, daemon=True).start()
        cls.saved = (updater.API_URL, updater.ALLOWED_PREFIX)
        updater.API_URL = base + "/latest"
        updater.ALLOWED_PREFIX = base + "/download/"
        STATE["release"] = release("9.9.9", base=base)
        cls.tmp = tempfile.TemporaryDirectory()
        cls.old_dir = server.DATA_DIR
        server.set_data_dir(cls.tmp.name)
        cls.httpd, cls.port = server.make_server(19765)
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.gh.shutdown()
        updater.API_URL, updater.ALLOWED_PREFIX = cls.saved
        server.set_data_dir(cls.old_dir)
        server.UPDATE_CACHE.update(at=0.0, result=None)
        cls.tmp.cleanup()

    def req(self, method, path, body=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port)
        h = {"Content-Type": "application/json", "X-Pen-Pal": "1"} if method == "PUT" else {}
        c.request(method, path, body, h)
        r = c.getresponse()
        out = (r.status, json.loads(r.read() or b"{}"))
        c.close()
        return out

    def test_check_endpoint(self):
        s, r = self.req("GET", "/api/update?force=1")
        self.assertEqual(s, 200)
        self.assertEqual((r["current"], r["latest"], r["newer"]), (server.APP_VERSION, "9.9.9", True))
        self.assertFalse(r["canInstall"])  # running from source
        self.assertNotIn("_asset", r)
        self.assertEqual(r["download"]["state"], "idle")

    def test_install_refused_from_source(self):
        s, r = self.req("PUT", "/api/update/download", "{}")
        self.assertEqual(s, 400)
        self.assertIn("releases page", r["error"])
        s, r = self.req("PUT", "/api/update/apply", "{}")
        self.assertEqual(s, 400)

    def test_install_needs_the_header(self):
        c = http.client.HTTPConnection("127.0.0.1", self.port)
        c.request("PUT", "/api/update/download", "{}", {"Content-Type": "application/json"})
        self.assertEqual(c.getresponse().status, 403)
        c.close()

    def test_title_bar_setting(self):
        s, r = self.req("PUT", "/api/settings", json.dumps({"titleBar": "windows"}))
        self.assertEqual((s, r["titleBar"]), (200, "windows"))
        self.assertEqual(server.load_settings()["titleBar"], "windows")
        s, _ = self.req("PUT", "/api/settings", json.dumps({"titleBar": "fancy"}))
        self.assertEqual(s, 400)
        # changing one setting keeps the other
        with tempfile.TemporaryDirectory() as other:
            self.req("PUT", "/api/settings", json.dumps({"backupFolder": other}))
            self.req("PUT", "/api/settings", json.dumps({"titleBar": "custom"}))
            st = server.load_settings()
            self.assertEqual((st["backupFolder"], st["titleBar"]), (other, "custom"))
            self.req("PUT", "/api/settings", json.dumps({"backupFolder": ""}))
        s, info = self.req("GET", "/api/info")
        self.assertEqual((info["titleBar"], info["frameless"], info["canInstall"]), ("custom", False, False))

    def test_reminder_setting(self):
        s, r = self.req("PUT", "/api/settings", json.dumps({"remindClosed": False}))
        self.assertEqual((s, r["remindClosed"], r["titleBar"]), (200, False, server.load_settings()["titleBar"]))
        s, _ = self.req("PUT", "/api/settings", json.dumps({"remindClosed": "no"}))
        self.assertEqual(s, 400)
        s, info = self.req("GET", "/api/info")
        self.assertEqual((info["remindClosed"], info["canRemindClosed"]), (False, False))
        self.req("PUT", "/api/settings", json.dumps({"remindClosed": True}))


if __name__ == "__main__":
    unittest.main()
