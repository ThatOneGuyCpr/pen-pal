"""Desktop window code that can be tested without a window (penpal.py)."""
import logging
import os
import sys
import tempfile
import threading
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import penpal  # noqa: E402


class FakeWindow:
    def __init__(self, on_closing=None):
        self.closed = threading.Event()
        self.on_closing = on_closing
        self.destroy_calls = 0

    def destroy(self):
        # Like WinForms: destroy asks to close, and the closing handler may cancel.
        self.destroy_calls += 1
        if self.on_closing is None or self.on_closing():
            self.closed.set()


class ApiExposure(unittest.TestCase):
    def test_only_methods_are_public(self):
        # pywebview walks public attributes of js_api into nested objects. A public window here
        # would walk the native WinForms/WebView2 objects from a background thread.
        api = penpal.Api()
        api._window = FakeWindow()
        for name in dir(api):
            if name.startswith("_"):
                continue
            self.assertTrue(callable(getattr(api, name)), "%s is public but not a method" % name)
        self.assertIn("set_busy", dir(api))
        self.assertNotIn("window", dir(api))


class Closing(unittest.TestCase):
    def setup(self, timeout=5.0):
        api = penpal.Api()
        win = FakeWindow()
        api._window = win
        win.on_closing = penpal.closing_handler(api, win, timeout=timeout)
        return api, win

    def test_closes_at_once_when_nothing_is_pending(self):
        api, win = self.setup()
        start = time.monotonic()
        win.destroy()
        self.assertTrue(win.closed.is_set())
        self.assertLess(time.monotonic() - start, 0.2)

    def test_waits_for_a_pending_save_without_blocking(self):
        api, win = self.setup()
        api.set_busy(True)
        start = time.monotonic()
        win.destroy()
        self.assertLess(time.monotonic() - start, 0.2, "the handler must return at once (it runs on the UI thread)")
        self.assertFalse(win.closed.is_set())
        win.destroy()  # a second close while waiting does not start another wait
        threading.Timer(0.5, lambda: api.set_busy(False)).start()
        self.assertTrue(win.closed.wait(3))
        self.assertGreaterEqual(time.monotonic() - start, 0.45)

    def test_gives_up_waiting_and_closes(self):
        api, win = self.setup(timeout=0.4)
        api.set_busy(True)
        logging.disable(logging.WARNING)
        try:
            win.destroy()
            self.assertTrue(win.closed.wait(3))
        finally:
            logging.disable(logging.NOTSET)

    def test_close_button_goes_through_the_handler(self):
        api, win = self.setup()
        api.set_busy(True)
        api.win_close()
        self.assertFalse(win.closed.is_set())
        api.set_busy(False)
        self.assertTrue(win.closed.wait(3))


class Log(unittest.TestCase):
    def test_log_file_keeps_this_run_and_the_last(self):
        saved = sys.stdout, sys.stderr, sys.excepthook, threading.excepthook
        root = logging.getLogger()
        before = list(root.handlers), root.level
        with tempfile.TemporaryDirectory() as tmp:
            try:
                with open(os.path.join(tmp, penpal.LOG_NAME), "w", encoding="utf-8") as f:
                    f.write("last time\n")
                path = penpal.setup_logging(tmp)
                penpal.LOG.warning("hello from the test")
                with open(path, encoding="utf-8") as f:
                    self.assertIn("hello from the test", f.read())
                with open(os.path.join(tmp, "pen-pal-log.prev.txt"), encoding="utf-8") as f:
                    self.assertEqual(f.read(), "last time\n")
            finally:
                for h in list(root.handlers):
                    if getattr(h, "_penpal", False):
                        root.removeHandler(h)
                        h.stream.close()
                root.setLevel(before[1])
                import faulthandler
                faulthandler.disable()
                sys.stdout, sys.stderr, sys.excepthook, threading.excepthook = saved


if __name__ == "__main__":
    unittest.main()


class TitleBarMode(unittest.TestCase):
    """What the page is told about the title bar (2.5: a real Windows frame without its caption)."""

    def setUp(self):
        import nativeframe
        import server
        self.nf, self.server = nativeframe, server
        self.saved = (server.NATIVE_FRAME, server.FRAMELESS, dict(nativeframe.STATE))

    def tearDown(self):
        self.server.NATIVE_FRAME, self.server.FRAMELESS, st = self.saved
        self.nf.STATE.clear()
        self.nf.STATE.update(st)

    def test_modes(self):
        api = penpal.Api()
        api._window = FakeWindow()
        self.server.NATIVE_FRAME, self.server.FRAMELESS = False, False
        self.assertEqual(api.win_mode()["mode"], "standard")
        self.server.FRAMELESS = True
        self.assertEqual(api.win_mode()["mode"], "frameless")
        self.server.NATIVE_FRAME = True
        self.nf.STATE.update(installed=False, appRegion=False, error="boom")
        self.assertEqual(api.win_mode()["mode"], "standard", "if the caption could not be removed, Windows' own title bar shows")
        self.nf.STATE.update(installed=True, appRegion=True, error="")
        m = api.win_mode()
        self.assertEqual((m["mode"], m["appRegion"]), ("native", True))
        self.assertIn("win_begin_resize", dir(api))
        self.assertIn("win_snap_layouts", dir(api))

    def test_fails_soft_off_windows(self):
        if self.nf.is_windows():
            self.skipTest("Windows runs the real thing in the build's smoke test")
        self.assertFalse(self.nf.windows_11())
        self.nf.STATE["installed"] = False
        self.assertTrue(self.nf.install(FakeWindow()))  # an error message, not an exception
        self.assertFalse(self.nf.STATE["installed"])
        self.assertTrue(self.nf.enable_app_region())  # no WebView2 here
