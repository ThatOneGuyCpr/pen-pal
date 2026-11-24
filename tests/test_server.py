import http.client
import json
import os
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import server  # noqa: E402


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        server.DATA_DIR = cls.tmp.name
        server.DATA_FILE = os.path.join(cls.tmp.name, "tracker.json")
        server.BACKUP_DIR = os.path.join(cls.tmp.name, "backups")
        cls.httpd, cls.port = server.make_server(18765)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.tmp.cleanup()

    def setUp(self):
        for f in (server.DATA_FILE, server.settings_path()):
            if os.path.exists(f):
                os.remove(f)
        server.MIRROR.update(ok=None, when="", error="")

    def req(self, method, path, body=None, headers=None, host=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port)
        h = dict(headers or {})
        if host:
            h["Host"] = host
        c.request(method, path, body=body, headers=h)
        r = c.getresponse()
        raw = r.read()
        c.close()
        return r.status, raw

    def put(self, obj, headers=None, **kw):
        h = {"Content-Type": "application/json", "X-Poetry-Tracker": "1"}
        h.update(headers or {})
        return self.req("PUT", "/api/data", json.dumps(obj), h, **kw)

    def test_empty_get(self):
        s, raw = self.req("GET", "/api/data")
        self.assertEqual(s, 200)
        d = json.loads(raw)
        self.assertEqual(d["rev"], 0)
        self.assertEqual(d["poems"], [])

    def test_save_and_reload_with_unicode(self):
        data = {"rev": 0, "poems": [{"id": "a", "title": "Mañana, mi vida"}], "journals": [], "submissions": []}
        s, raw = self.put(data)
        self.assertEqual(s, 200)
        self.assertEqual(json.loads(raw)["rev"], 1)
        s, raw = self.req("GET", "/api/data")
        d = json.loads(raw)
        self.assertEqual(d["rev"], 1)
        self.assertEqual(d["poems"][0]["title"], "Mañana, mi vida")
        # file on disk is readable UTF-8 and not escaped to \u sequences
        with open(server.DATA_FILE, encoding="utf-8") as f:
            self.assertIn("Mañana", f.read())

    def test_stale_revision_is_rejected_with_current_data(self):
        base = {"rev": 0, "poems": [], "journals": [], "submissions": []}
        self.assertEqual(self.put(base)[0], 200)  # rev becomes 1
        s, raw = self.put(base)  # second tab still thinks rev 0
        self.assertEqual(s, 409)
        self.assertEqual(json.loads(raw)["data"]["rev"], 1)

    def test_requires_custom_header_and_json(self):
        data = {"rev": 0, "poems": [], "journals": [], "submissions": []}
        s, _ = self.req("PUT", "/api/data", json.dumps(data), {"Content-Type": "application/json"})
        self.assertEqual(s, 403)
        s, _ = self.req("PUT", "/api/data", json.dumps(data), {"X-Poetry-Tracker": "1", "Content-Type": "text/plain"})
        self.assertEqual(s, 415)

    def test_rejects_foreign_host(self):
        s, _ = self.req("GET", "/api/data", host="evil.example.com")
        self.assertEqual(s, 403)
        s, _ = self.req("GET", "/", host="evil.example.com")
        self.assertEqual(s, 403)

    def test_rejects_bad_payloads(self):
        self.assertEqual(self.put([1, 2])[0], 400)
        self.assertEqual(self.put({"rev": 0, "poems": "nope", "journals": [], "submissions": []})[0], 400)
        self.assertEqual(self.put({"rev": 0, "poems": [1], "journals": [], "submissions": []})[0], 400)
        s, _ = self.req("PUT", "/api/data", "{not json", {"X-Poetry-Tracker": "1", "Content-Type": "application/json"})
        self.assertEqual(s, 400)

    def test_rejects_oversized_body(self):
        big = {"rev": 0, "poems": [{"title": "x" * 3_000_000}], "journals": [], "submissions": []}
        try:
            s, _ = self.put(big)
            self.assertEqual(s, 413)
        except (BrokenPipeError, ConnectionResetError):
            pass  # server refused and hung up before we finished sending: also a rejection
        # and nothing was written
        self.assertFalse(os.path.exists(server.DATA_FILE))

    def test_corrupt_file_is_not_overwritten(self):
        with open(server.DATA_FILE, "w", encoding="utf-8") as f:
            f.write("{broken")
        s, _ = self.req("GET", "/api/data")
        self.assertEqual(s, 500)
        s, _ = self.put({"rev": 0, "poems": [], "journals": [], "submissions": []})
        self.assertEqual(s, 500)
        with open(server.DATA_FILE, encoding="utf-8") as f:
            self.assertEqual(f.read(), "{broken")

    def test_daily_backup_created(self):
        d = {"rev": 0, "poems": [], "journals": [], "submissions": []}
        self.put(d)
        d["rev"] = 1
        self.put(d)  # second save triggers a backup of the first
        self.assertTrue(os.path.isdir(server.BACKUP_DIR))
        self.assertEqual(len(os.listdir(server.BACKUP_DIR)), 1)

    def test_static_files_and_no_path_traversal(self):
        s, raw = self.req("GET", "/")
        self.assertEqual(s, 200)
        self.assertIn(b"Pen Pal", raw)
        s, _ = self.req("GET", "/logic.js")
        self.assertEqual(s, 200)
        s, raw = self.req("GET", "/../server.py")
        self.assertNotIn(b"ThreadingHTTPServer", raw)
        s, raw = self.req("GET", "/%2e%2e/server.py")
        self.assertNotIn(b"ThreadingHTTPServer", raw)
        s, raw = self.req("GET", "/..%2fdata/tracker.json")
        self.assertNotEqual(s, 200)

    def test_other_methods(self):
        self.assertEqual(self.req("POST", "/api/data", "{}")[0], 405)
        self.assertEqual(self.req("DELETE", "/api/data")[0], 405)

    # ---- newer data parts and settings ----
    def test_old_file_without_new_parts_loads_with_defaults(self):
        with open(server.DATA_FILE, "w", encoding="utf-8") as f:
            json.dump({"rev": 3, "poems": [{"id": "a", "title": "Keep me"}], "journals": [], "submissions": []}, f)
        s, raw = self.req("GET", "/api/data")
        d = json.loads(raw)
        self.assertEqual(s, 200)
        self.assertEqual(d["poems"][0]["title"], "Keep me")
        self.assertEqual((d["manuscripts"], d["entries"], d["settings"]), ([], [], {}))

    def test_manuscripts_entries_and_settings_round_trip(self):
        data = {"rev": 0, "poems": [], "journals": [], "submissions": [],
                "manuscripts": [{"id": "m", "title": "Book"}], "entries": [{"id": "e", "name": "Press"}],
                "settings": {"lastBackupDownload": "2026-11-01"}}
        self.assertEqual(self.put(data)[0], 200)
        d = json.loads(self.req("GET", "/api/data")[1])
        self.assertEqual(d["manuscripts"][0]["title"], "Book")
        self.assertEqual(d["entries"][0]["name"], "Press")
        self.assertEqual(d["settings"]["lastBackupDownload"], "2026-11-01")

    def test_bad_new_parts_are_rejected(self):
        base = {"rev": 0, "poems": [], "journals": [], "submissions": []}
        self.assertEqual(self.put(dict(base, manuscripts="x"))[0], 400)
        self.assertEqual(self.put(dict(base, entries=[1]))[0], 400)
        self.assertEqual(self.put(dict(base, settings=[]))[0], 400)

    def put_settings(self, obj, headers=None):
        h = {"Content-Type": "application/json", "X-Poetry-Tracker": "1"}
        h.update(headers or {})
        return self.req("PUT", "/api/settings", json.dumps(obj), h)

    def test_settings_default_and_protection(self):
        s, raw = self.req("GET", "/api/settings")
        self.assertEqual(s, 200)
        self.assertEqual(json.loads(raw)["backupFolder"], "")
        s, _ = self.req("PUT", "/api/settings", json.dumps({"backupFolder": ""}), {"Content-Type": "application/json"})
        self.assertEqual(s, 403)  # no custom header
        s, _ = self.req("GET", "/api/settings", host="evil.example.com")
        self.assertEqual(s, 403)
        s, _ = self.req("PUT", "/api/settings", json.dumps({"backupFolder": ""}),
                        {"Content-Type": "application/json", "X-Poetry-Tracker": "1"}, host="evil.example.com")
        self.assertEqual(s, 403)

    def test_settings_validation(self):
        self.assertEqual(self.put_settings({"backupFolder": "relative/path"})[0], 400)
        self.assertEqual(self.put_settings({"backupFolder": os.path.join(self.tmp.name, "nope")})[0], 400)
        self.assertEqual(self.put_settings({"backupFolder": self.tmp.name})[0], 400)  # its own data folder
        self.assertEqual(self.put_settings({"backupFolder": 5})[0], 400)
        self.assertEqual(self.put_settings([1])[0], 400)
        self.assertEqual(json.loads(self.req("GET", "/api/settings")[1])["backupFolder"], "")

    def test_second_folder_gets_a_copy_after_each_save(self):
        with tempfile.TemporaryDirectory() as other:
            keep = os.path.join(other, "my-own-file.txt")
            with open(keep, "w") as f:
                f.write("hands off")
            s, raw = self.put_settings({"backupFolder": '  "%s"  ' % other})  # quotes and spaces are tolerated
            self.assertEqual(s, 200)
            self.assertEqual(json.loads(raw)["backupFolder"], other)
            data = {"rev": 0, "poems": [{"id": "a", "title": "First"}], "journals": [], "submissions": []}
            self.assertEqual(self.put(data)[0], 200)
            latest = os.path.join(other, "pen-pal-latest.json")
            with open(latest, encoding="utf-8") as f:
                self.assertEqual(json.load(f)["poems"][0]["title"], "First")
            data["rev"] = 1
            data["poems"][0]["title"] = "Second"
            self.put(data)
            with open(latest, encoding="utf-8") as f:
                self.assertEqual(json.load(f)["poems"][0]["title"], "Second")
            self.assertTrue(json.loads(self.req("GET", "/api/settings")[1])["mirror"]["ok"])
            dated = [f for f in os.listdir(other) if f.startswith("pen-pal-2")]
            self.assertEqual(len(dated), 1)
            with open(keep) as f:
                self.assertEqual(f.read(), "hands off")

    def test_second_folder_keeps_only_recent_dated_copies(self):
        with tempfile.TemporaryDirectory() as other:
            for day in range(1, 21):
                with open(os.path.join(other, "pen-pal-202001%02d.json" % day), "w") as f:
                    f.write("{}")
            self.put_settings({"backupFolder": other})
            self.put({"rev": 0, "poems": [], "journals": [], "submissions": []})
            dated = sorted(f for f in os.listdir(other) if f.startswith("pen-pal-2"))
            self.assertEqual(len(dated), server.KEEP_BACKUPS)
            self.assertIn("pen-pal-latest.json", os.listdir(other))
            self.assertNotIn("pen-pal-20200101.json", dated)

    def test_a_missing_second_folder_never_blocks_a_save(self):
        other = tempfile.mkdtemp()
        self.assertEqual(self.put_settings({"backupFolder": other})[0], 200)
        os.rmdir(other)  # the drive was unplugged, say
        s, _ = self.put({"rev": 0, "poems": [{"id": "a", "title": "Safe"}], "journals": [], "submissions": []})
        self.assertEqual(s, 200)
        with open(server.DATA_FILE, encoding="utf-8") as f:
            self.assertEqual(json.load(f)["poems"][0]["title"], "Safe")
        m = json.loads(self.req("GET", "/api/settings")[1])["mirror"]
        self.assertIs(m["ok"], False)
        self.assertIn("not there", m["error"])

    def test_switching_the_second_folder_off(self):
        with tempfile.TemporaryDirectory() as other:
            self.put_settings({"backupFolder": other})
            s, raw = self.put_settings({"backupFolder": ""})
            self.assertEqual(s, 200)
            self.assertEqual(json.loads(raw)["backupFolder"], "")
            self.put({"rev": 0, "poems": [], "journals": [], "submissions": []})
            self.assertEqual(os.listdir(other), [])

    def test_corrupt_settings_file_falls_back_to_off(self):
        with open(server.settings_path(), "w") as f:
            f.write("{nope")
        self.assertEqual(server.load_settings()["backupFolder"], "")
        self.assertEqual(self.put({"rev": 0, "poems": [], "journals": [], "submissions": []})[0], 200)

    def test_folders_from_source_and_when_built(self):
        here = os.path.dirname(os.path.abspath(server.__file__))
        self.assertEqual(server.app_dir(), here)
        self.assertEqual(server.resource_dir(), here)
        self.assertEqual(server.default_data_dir(), os.path.join(here, "data"))
        saved = {k: getattr(sys, k, None) for k in ("frozen", "_MEIPASS")}
        old_exe, old_appdata = sys.executable, os.environ.get("APPDATA")
        try:
            exe_dir = os.path.join(self.tmp.name, "app")
            os.makedirs(exe_dir, exist_ok=True)
            sys.frozen = True
            sys._MEIPASS = os.path.join(self.tmp.name, "bundle")
            sys.executable = os.path.join(exe_dir, "PenPal.exe")
            os.environ["APPDATA"] = os.path.join(self.tmp.name, "roaming")
            self.assertEqual(server.app_dir(), exe_dir)
            self.assertEqual(server.resource_dir(), sys._MEIPASS)
            # no data folder beside the exe: use the user's app-data folder
            self.assertEqual(server.default_data_dir(), os.path.join(self.tmp.name, "roaming", "Pen Pal", "data"))
            # a data folder beside the exe wins (portable use, or an old tracker folder)
            os.makedirs(os.path.join(exe_dir, "data"))
            self.assertEqual(server.default_data_dir(), os.path.join(exe_dir, "data"))
        finally:
            sys.executable = old_exe
            if old_appdata is None:
                os.environ.pop("APPDATA", None)
            else:
                os.environ["APPDATA"] = old_appdata
            for k, v in saved.items():
                if v is None:
                    if hasattr(sys, k):
                        delattr(sys, k)
                else:
                    setattr(sys, k, v)

    def test_set_data_dir(self):
        old = server.DATA_DIR
        try:
            server.set_data_dir("/x/y")
            self.assertEqual((server.DATA_FILE, server.BACKUP_DIR), (os.path.join("/x/y", "tracker.json"), os.path.join("/x/y", "backups")))
        finally:
            server.set_data_dir(old)

    def test_info_endpoint(self):
        s, raw = self.req("GET", "/api/info")
        self.assertEqual(s, 200)
        info = json.loads(raw)
        self.assertEqual(info["app"], "Pen Pal")
        self.assertEqual(info["dataFolder"], self.tmp.name)
        self.assertIs(info["desktop"], False)
        self.assertEqual(self.req("GET", "/api/info", host="evil.example.com")[0], 403)

    def test_new_header_name_and_fonts(self):
        data = {"rev": 0, "poems": [], "journals": [], "submissions": []}
        s, _ = self.req("PUT", "/api/data", json.dumps(data), {"Content-Type": "application/json", "X-Pen-Pal": "1"})
        self.assertEqual(s, 200)
        c = http.client.HTTPConnection("127.0.0.1", self.port)
        c.request("GET", "/fonts/young-serif-400.woff2")
        r = c.getresponse()
        r.read()
        c.close()
        self.assertEqual(r.status, 200)
        self.assertEqual(r.getheader("Content-Type"), "font/woff2")


    def test_works_without_a_console(self):
        # A windowed exe has sys.stderr = None; API requests used to crash while logging.
        old = sys.stderr
        sys.stderr = None
        try:
            s, raw = self.req("GET", "/api/info")
            self.assertEqual(s, 200)
            s, _ = self.put({"rev": 0, "poems": [], "journals": [], "submissions": []})
            self.assertEqual(s, 200)
        finally:
            sys.stderr = old


if __name__ == "__main__":
    unittest.main()
