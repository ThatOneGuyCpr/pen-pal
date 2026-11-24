"""Keeping the data in another folder (iCloud Drive and the like) and two computers sharing it."""
import http.client
import json
import os
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import server  # noqa: E402

DOC = {"rev": 3, "poems": [{"id": "p1", "title": "Salt"}], "journals": [{"id": "j1", "name": "Alpha"}], "submissions": [], "settings": {}}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "pc")  # this PC's own folder
        self.cloud = os.path.join(self.tmp.name, "iCloudDrive")
        os.makedirs(self.home)
        os.makedirs(self.cloud)
        self.old = server.DATA_DIR
        server.set_data_dir(self.home)
        server.save_data(dict(DOC), server.DATA_FILE)

    def tearDown(self):
        server.set_data_dir(self.old)
        self.tmp.cleanup()

    def other_pc_saves(self, base_doc, **changes):
        """What the other computer does: a save on top of base_doc, written into the shared folder."""
        doc = json.loads(json.dumps(base_doc))
        doc.update(changes)
        server.stamp_save(doc, base_doc)
        doc["savedOn"] = "LAPTOP"
        server.save_data(doc, os.path.join(self.cloud, "Pen Pal", "tracker.json"))
        return doc


class Location(Base):
    def test_move_to_a_new_folder_and_back(self):
        target = os.path.join(self.cloud, "Pen Pal")
        folder, info, err = server.check_target(target)
        self.assertIsNone(err)
        self.assertEqual((info["create"], info["hasData"], info["cloud"]), (True, False, "iCloud Drive"))
        res, err = server.change_location(target, "move")
        self.assertIsNone(err)
        self.assertEqual(server.DATA_FILE, os.path.join(target, "tracker.json"))
        self.assertEqual(server.load_data()["poems"][0]["title"], "Salt")
        self.assertTrue(server.custom_location())
        # the old copy is kept under another name, never deleted
        self.assertFalse(os.path.exists(os.path.join(self.home, "tracker.json")))
        self.assertEqual(len([f for f in os.listdir(self.home) if f.startswith("moved-away-tracker-")]), 1)
        # settings stay on this PC
        self.assertEqual(server.settings_path(), os.path.join(self.home, "settings.json"))
        # next start finds it again
        server.set_data_dir(self.home)
        self.assertEqual(server.apply_location(), target)
        self.assertEqual(server.DATA_FILE, os.path.join(target, "tracker.json"))
        # and back home
        res, err = server.change_location(self.home, "move")
        self.assertIsNone(err)
        self.assertFalse(server.custom_location())
        self.assertFalse(os.path.exists(server.location_path()))
        self.assertEqual(server.load_data()["journals"][0]["name"], "Alpha")

    def test_second_computer_uses_the_data_already_there(self):
        target = os.path.join(self.cloud, "Pen Pal")
        os.makedirs(target)
        theirs = dict(DOC, poems=[], journals=[{"id": "j9", "name": "From laptop"}], savedOn="LAPTOP", savedAt="2026-11-24T02:00:00")
        server.save_data(theirs, os.path.join(target, "tracker.json"))
        folder, info, err = server.check_target(target)
        self.assertTrue(info["hasData"])
        self.assertEqual(info["summary"]["journals"], 1)
        self.assertEqual(info["summary"]["savedOn"], "LAPTOP")
        _, err = server.change_location(target, "move")
        self.assertIn("already has Pen Pal data", err)
        _, err = server.change_location(target, "use")
        self.assertIsNone(err)
        self.assertEqual(server.load_data()["journals"][0]["name"], "From laptop")

    def test_replace_keeps_what_was_there_in_backups(self):
        target = os.path.join(self.cloud, "Pen Pal")
        os.makedirs(target)
        server.save_data(dict(DOC, journals=[], saveId="t1", rev=8), os.path.join(target, "tracker.json"))
        _, err = server.change_location(target, "replace")
        self.assertIsNone(err)
        now = server.load_data()
        self.assertEqual(now["journals"][0]["name"], "Alpha")
        self.assertEqual((now["rev"], now["lineage"][-1]), (9, "t1"))  # builds on theirs, so the laptop reloads it
        self.assertEqual(len([f for f in os.listdir(server.BACKUP_DIR) if f.startswith("replaced-")]), 1)

    def test_bad_targets(self):
        self.assertIn("full path", server.check_target("relative\\path")[2])
        self.assertIn("already in that folder", server.check_target(self.home)[2])
        self.assertIn("neither", server.check_target(os.path.join(self.tmp.name, "no", "such"))[2])
        bad = os.path.join(self.cloud, "Broken")
        os.makedirs(bad)
        with open(os.path.join(bad, "tracker.json"), "w") as f:
            f.write("{not json")
        self.assertIn("cannot read", server.check_target(bad)[2])
        self.assertIn("outside Pen Pal's own files", server.check_target(server.BACKUP_DIR)[2] or "outside Pen Pal's own files")
        self.assertIn("outside Pen Pal's own files", server.check_target(os.path.join(server.PUBLIC, "x"))[2])

    def test_missing_folder_or_file_is_a_problem_not_a_fresh_start(self):
        target = os.path.join(self.cloud, "Pen Pal")
        server.change_location(target, "move")
        os.rename(target, target + " (offline)")
        self.assertIn("not available", server.location_problem())
        os.makedirs(target)
        self.assertIn("tracker.json is not there", server.location_problem())
        server.set_data_dir(self.home)
        self.assertIsNone(server.location_problem())  # at home, an empty start is fine


class TwoComputers(Base):
    def setUp(self):
        super().setUp()
        server.change_location(os.path.join(self.cloud, "Pen Pal"), "move")

    def this_pc_saves(self, **changes):
        cur = server.load_data()
        doc = json.loads(json.dumps(cur))
        doc.update(changes)
        server.stamp_save(doc, cur)
        server.save_data(doc)
        server.remember_my_save(doc)
        return doc

    def test_later_save_from_the_other_computer_is_not_a_loss(self):
        mine = self.this_pc_saves(journals=[{"id": "j1", "name": "Alpha"}, {"id": "j2", "name": "Beta"}])
        self.other_pc_saves(mine, poems=[])
        st = server.sync_state()
        self.assertIsNone(st["lost"])
        self.assertTrue(server.builds_on(server.load_data(), mine["saveId"]))

    def test_other_computer_replacing_my_save_is_caught_and_can_be_undone(self):
        base = server.load_data()
        mine = self.this_pc_saves(journals=[{"id": "j2", "name": "Only on desktop"}])
        theirs = self.other_pc_saves(base, poems=[])  # built on the old file: iCloud kept theirs
        st = server.sync_state()
        self.assertIsNotNone(st["lost"])
        self.assertEqual(st["lost"]["mine"]["journals"], 1)
        self.assertEqual(st["lost"]["theirs"]["savedOn"], "LAPTOP")
        res, err = server.resolve_sync("restore-mine")
        self.assertIsNone(err)
        now = server.load_data()
        self.assertEqual(now["journals"][0]["name"], "Only on desktop")
        self.assertIn(theirs["saveId"], now["lineage"])  # the laptop sees a later save and reloads
        self.assertIsNone(server.sync_state()["lost"])
        self.assertEqual(len([f for f in os.listdir(server.BACKUP_DIR) if f.startswith("replaced-")]), 1)

    def test_keeping_theirs_sets_mine_aside(self):
        base = server.load_data()
        self.this_pc_saves(journals=[])
        self.other_pc_saves(base, poems=[])
        server.resolve_sync("keep-theirs")
        self.assertIsNone(server.sync_state()["lost"])
        self.assertEqual(len([f for f in os.listdir(server.BACKUP_DIR) if f.startswith("set-aside-mine-")]), 1)

    def test_conflict_copies(self):
        folder = server.DATA_DIR
        server.save_data(dict(DOC, journals=[], savedOn="LAPTOP"), os.path.join(folder, "tracker 2.json"))
        server.save_data({"x": 1}, os.path.join(folder, "reminders-sent.json"))
        with open(os.path.join(folder, "tracker-LAPTOP.json"), "w") as f:
            f.write("oops")
        names = [c["name"] for c in server.sync_state()["conflicts"]]
        self.assertEqual(names, ["tracker 2.json", "tracker-LAPTOP.json"])
        self.assertIn("error", server.conflict_copies()[1])
        _, err = server.resolve_sync("keep-current", "../tracker.json")
        self.assertIsNotNone(err)
        server.resolve_sync("keep-current", "tracker-LAPTOP.json")
        server.resolve_sync("use-copy", "tracker 2.json")
        self.assertEqual(server.load_data()["journals"], [])
        self.assertEqual(server.conflict_copies(), [])
        self.assertTrue(os.path.exists(os.path.join(folder, "tracker.json")))


class SaveChainOverHttp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.old = server.DATA_DIR
        server.set_data_dir(cls.tmp.name)
        cls.httpd, cls.port = server.make_server(18865)
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        server.set_data_dir(cls.old)
        cls.tmp.cleanup()

    def req(self, method, path, body=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port)
        h = {"Content-Type": "application/json", "X-Pen-Pal": "1"} if body is not None else {}
        c.request(method, path, body=None if body is None else json.dumps(body), headers=h)
        r = c.getresponse()
        out = (r.status, json.loads(r.read() or b"{}"))
        c.close()
        return out

    def test_saves_chain_and_a_replaced_file_is_refused(self):
        s, d = self.req("GET", "/api/data")
        s, r1 = self.req("PUT", "/api/data", dict(d, journals=[{"id": "a", "name": "A"}]))
        self.assertEqual(s, 200)
        self.assertEqual((r1["rev"], r1["lineage"]), (d["rev"] + 1, []))
        s, r2 = self.req("PUT", "/api/data", dict(d, rev=r1["rev"], saveId=r1["saveId"]))
        self.assertEqual(r2["lineage"], [r1["saveId"]])
        # another computer's file arrives with the same rev but a different save: refuse, do not overwrite
        other = server.load_data()
        other["saveId"] = "elsewhere"
        server.save_data(other)
        s, _ = self.req("PUT", "/api/data", dict(d, rev=r2["rev"], saveId=r2["saveId"]))
        self.assertEqual(s, 409)
        s, st = self.req("GET", "/api/data/stat")
        self.assertEqual((s, st["saveId"], st["custom"], st["lost"], st["conflicts"]), (200, "elsewhere", False, None, []))

    def test_location_endpoints(self):
        s, loc = self.req("GET", "/api/location")
        self.assertEqual((s, loc["custom"]), (200, False))
        s, chk = self.req("GET", "/api/location/check?folder=" + "relative")
        self.assertEqual(chk["ok"], False)
        with tempfile.TemporaryDirectory() as other:
            s, chk = self.req("GET", "/api/location/check?folder=" + other.replace(" ", "%20"))
            self.assertTrue(chk["ok"] and not chk["hasData"])
            s, res = self.req("PUT", "/api/location", {"folder": other, "mode": "use"})
            self.assertEqual(s, 400)
            s, res = self.req("PUT", "/api/location", {"folder": other, "mode": "move"})
            self.assertEqual(s, 200)
            s, info = self.req("GET", "/api/info")
            self.assertEqual((info["dataFolder"], info["dataCustom"]), (other, True))
            s, res = self.req("PUT", "/api/location", {"folder": self.tmp.name, "mode": "move"})
            self.assertEqual(s, 200)


if __name__ == "__main__":
    unittest.main()
