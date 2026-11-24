"""Reminders: notify.py (what was shown, the task definition) and the server's reminder setting."""
import json
import os
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import notify  # noqa: E402
import penpal  # noqa: E402
import server  # noqa: E402


def alert(key, date="2026-11-26", name="Alpha"):
    return {"key": key, "title": name + " opens soon", "body": "Reading period.", "date": date, "name": name}


class Deliver(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.shown = []

    def tearDown(self):
        self.tmp.cleanup()

    def show(self, title, body):
        self.shown.append(title)
        return None

    def test_each_reminder_is_shown_once(self):
        r = notify.deliver([alert("a:opens:2026-11-26")], self.tmp.name, today="2026-11-24", show_fn=self.show)
        self.assertEqual(r, {"shown": 1, "errors": []})
        r = notify.deliver([alert("a:opens:2026-11-26"), alert("b:closes:2026-11-25", "2026-11-25", "Beta")], self.tmp.name, today="2026-11-24", show_fn=self.show)
        self.assertEqual(r["shown"], 1)
        self.assertEqual(self.shown, ["Alpha opens soon", "Beta opens soon"])

    def test_past_dates_are_forgotten(self):
        notify.deliver([alert("a:opens:2026-11-26")], self.tmp.name, today="2026-11-24", show_fn=self.show)
        notify.deliver([], self.tmp.name, today="2026-11-24", show_fn=self.show)
        notify.deliver([alert("x:opens:2026-12-30", "2026-12-30")], self.tmp.name, today="2026-12-01", show_fn=self.show)
        with open(os.path.join(self.tmp.name, notify.SENT_NAME), encoding="utf-8") as f:
            self.assertEqual(json.load(f), {"x:opens:2026-12-30": "2026-12-30"})

    def test_many_at_once_become_one_summary(self):
        many = [alert("j%d:opens:2026-11-26" % i, name="Journal %d" % i) for i in range(5)]
        r = notify.deliver(many, self.tmp.name, today="2026-11-24", show_fn=self.show)
        self.assertEqual(r["shown"], 5)
        self.assertEqual(self.shown, ["5 reading periods are coming up"])

    def test_a_failed_notification_is_tried_again_later(self):
        r = notify.deliver([alert("a:opens:2026-11-26")], self.tmp.name, today="2026-11-24", show_fn=lambda t, b: "blocked")
        self.assertEqual(r, {"shown": 0, "errors": ["blocked"]})
        r = notify.deliver([alert("a:opens:2026-11-26")], self.tmp.name, today="2026-11-24", show_fn=self.show)
        self.assertEqual(r["shown"], 1)

    def test_bad_input_is_ignored(self):
        r = notify.deliver([{"key": "x"}, "nope", None, alert("")], self.tmp.name, today="2026-11-24", show_fn=self.show)
        self.assertEqual(r["shown"], 0)
        self.assertEqual(self.shown, [])

    def test_fake_notifier_for_tests(self):
        out = os.path.join(self.tmp.name, "shown.jsonl")
        os.environ[notify.FAKE_ENV] = out
        try:
            self.assertIsNone(notify.show("T", "B"))
        finally:
            del os.environ[notify.FAKE_ENV]
        with open(out, encoding="utf-8") as f:
            self.assertEqual(json.loads(f.readline()), {"title": "T", "body": "B"})


class Definitions(unittest.TestCase):
    def test_notification_text_is_escaped(self):
        x = notify.toast_xml("A & B <Review>", 'Says "hi"')
        root = ET.fromstring(x)
        self.assertEqual([t.text for t in root.iter("text")], ["A & B <Review>", 'Says "hi"'])
        self.assertEqual(root.get("launch"), "penpal:open")

    def test_task_runs_the_exe_at_sign_in_and_daily(self):
        xml = notify.task_xml(r"C:\Users\me\Desktop\Pen & Pal\PenPal.exe", user="PC\\me")
        root = ET.fromstring(xml.replace('encoding="UTF-16"', ""))
        ns = {"t": "http://schemas.microsoft.com/windows/2004/02/mit/task"}
        self.assertEqual(root.find(".//t:Exec/t:Command", ns).text, r"C:\Users\me\Desktop\Pen & Pal\PenPal.exe")
        self.assertEqual(root.find(".//t:Exec/t:Arguments", ns).text, "--remind")
        self.assertIsNotNone(root.find(".//t:LogonTrigger", ns))
        self.assertIsNotNone(root.find(".//t:CalendarTrigger/t:ScheduleByDay", ns))
        self.assertEqual(root.find(".//t:StartWhenAvailable", ns).text, "true")
        self.assertEqual(root.find(".//t:RunLevel", ns).text, "LeastPrivilege")

    def test_only_runs_when_a_journal_wants_it(self):
        self.assertTrue(penpal.wants_reminders({"journals": [{"notify": False}, {"notify": True}]}))
        self.assertFalse(penpal.wants_reminders({"journals": [{"notify": "true"}]}))
        self.assertFalse(penpal.wants_reminders({}))

    def test_no_task_from_source(self):
        self.assertEqual(penpal.sync_task(True), {"supported": False, "on": False, "error": ""})


class Setting(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old = server.DATA_FILE
        server.set_data_dir(self.tmp.name)

    def tearDown(self):
        server.set_data_dir(os.path.dirname(self.old))
        self.tmp.cleanup()

    def test_remind_closed_defaults_on_and_saves(self):
        self.assertTrue(server.load_settings()["remindClosed"])
        server.save_data({"backupFolder": "", "titleBar": "custom", "remindClosed": False}, server.settings_path())
        self.assertFalse(server.load_settings()["remindClosed"])
        self.assertFalse(server.settings_view()["remindClosed"])


if __name__ == "__main__":
    unittest.main()
