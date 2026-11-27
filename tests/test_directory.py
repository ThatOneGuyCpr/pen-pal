"""2.5: the directory updates itself from GitHub, and quick add reads a guidelines page."""
import http.server
import json
import os
import sys
import tempfile
import threading
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import server  # noqa: E402


class FakeSite:
    """A local web server whose pages the test sets."""

    def __init__(self):
        self.pages = {}
        site = self

        class H(http.server.BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                page = site.pages.get(self.path)
                if page is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                kind, body = page
                self.send_response(200)
                self.send_header("Content-Type", kind)
                self.end_headers()
                self.wfile.write(body if isinstance(body, bytes) else body.encode("utf-8"))

            def log_message(self, *a):
                pass

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def url(self, path):
        return "http://127.0.0.1:%d%s" % (self.port, path)

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()


def bundled():
    with open(os.path.join(server.PUBLIC, "directory.json"), encoding="utf-8") as f:
        return json.load(f)


class DirectoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        server.set_data_dir(self.tmp.name)
        self.site = FakeSite()
        self.old_url = server.DIRECTORY_URL
        server.DIRECTORY_URL = self.site.url("/directory.json")

    def tearDown(self):
        server.DIRECTORY_URL = self.old_url
        self.site.close()
        self.tmp.cleanup()

    def newer(self, **extra):
        doc = dict(bundled())
        doc["rev"] = doc.get("rev", 0) + 1
        doc.update(extra)
        return doc

    def test_validation(self):
        self.assertTrue(server.valid_directory(bundled()))
        self.assertFalse(server.valid_directory({"journals": []}))
        self.assertFalse(server.valid_directory({"journals": [{"id": "x", "name": " "}]}))
        self.assertFalse(server.valid_directory({"rev": "2", "journals": [{"id": "x", "name": "X"}]}))
        self.assertFalse(server.valid_directory({"rev": True, "journals": [{"id": "x", "name": "X"}]}))
        self.assertFalse(server.valid_directory([1, 2]))

    def test_uses_the_app_copy_until_something_newer_arrives(self):
        v = server.directory_view()
        self.assertEqual(v["source"], "app")
        self.assertEqual(v["lastCheck"], "")
        self.site.pages["/directory.json"] = ("application/json", json.dumps(self.newer()))
        res = server.directory_check(force=True)
        self.assertTrue(res["updated"])
        self.assertEqual(res["source"], "update")
        self.assertEqual(res["error"], "")
        self.assertTrue(os.path.exists(os.path.join(self.tmp.name, server.DIRECTORY_CACHE)))
        # the next start uses the downloaded copy without going online
        self.assertEqual(server.directory_view()["source"], "update")

    def test_checks_at_most_every_20_hours_unless_asked(self):
        self.site.pages["/directory.json"] = ("application/json", json.dumps(bundled()))
        self.assertFalse(server.directory_check()["updated"])
        self.site.pages["/directory.json"] = ("application/json", json.dumps(self.newer()))
        self.assertFalse(server.directory_check()["updated"], "checked a moment ago")
        self.assertTrue(server.directory_check(force=True)["updated"])

    def test_same_or_older_directories_are_not_saved(self):
        self.site.pages["/directory.json"] = ("application/json", json.dumps(dict(bundled(), rev=0, checked="2000-01-01")))
        res = server.directory_check(force=True)
        self.assertFalse(res["updated"])
        self.assertEqual(res["source"], "app")
        self.assertFalse(os.path.exists(os.path.join(self.tmp.name, server.DIRECTORY_CACHE)))

    def test_bad_downloads_are_reported_and_ignored(self):
        for body in ("not json", json.dumps({"rev": 99, "journals": []}), json.dumps({"rev": 99, "journals": [{"id": "", "name": "x"}]})):
            self.site.pages["/directory.json"] = ("application/json", body)
            res = server.directory_check(force=True)
            self.assertFalse(res["updated"])
            self.assertEqual(res["source"], "app")
            self.assertIn("Could not check", res["error"])
        del self.site.pages["/directory.json"]
        self.assertIn("404", server.directory_check(force=True)["error"])

    def test_a_damaged_download_on_disk_falls_back_to_the_app_copy(self):
        with open(os.path.join(self.tmp.name, server.DIRECTORY_CACHE), "w", encoding="utf-8") as f:
            f.write("{broken")
        self.assertEqual(server.directory_view()["source"], "app")

    def test_html_to_text(self):
        title, text = server.html_to_text("<html><head><title> Submit | Gulf  Review </title><style>p{}</style></head>"
                                          "<body><script>var fee='$99 fee'</script><p>Reading period: Sept 1 &ndash; Nov 30.</p><div>No fee.</div></body></html>")
        self.assertEqual(title, "Submit | Gulf Review")
        self.assertIn("Reading period: Sept 1 – Nov 30.", text)
        self.assertIn("No fee.", text)
        self.assertNotIn("$99", text)

    def test_fetch_guidelines(self):
        self.site.pages["/guide"] = ("text/html; charset=utf-8", "<title>Guidelines - Moon</title><p>We read year-round.</p>")
        self.site.pages["/pic"] = ("image/png", b"\x89PNG")
        # the fake site is on this computer, which Pen Pal normally refuses
        res, err = server.fetch_guidelines(self.site.url("/guide"))
        self.assertIsNone(res)
        self.assertIn("public internet", err)
        with mock.patch.object(server, "public_host", return_value=True):
            res, err = server.fetch_guidelines(self.site.url("/guide"))
            self.assertIsNone(err)
            self.assertEqual(res["title"], "Guidelines - Moon")
            self.assertIn("We read year-round.", res["text"])
            res, err = server.fetch_guidelines(self.site.url("/pic"))
            self.assertIn("not a web page", err)
            res, err = server.fetch_guidelines(self.site.url("/missing"))
            self.assertIn("404", err)
        self.assertIn("web address", server.fetch_guidelines("ftp://example.com/x")[1])
        self.assertIn("web address", server.fetch_guidelines("")[1])

    def test_public_host(self):
        self.assertFalse(server.public_host("127.0.0.1"))
        self.assertFalse(server.public_host("localhost"))
        self.assertFalse(server.public_host("192.168.1.10"))
        self.assertFalse(server.public_host("169.254.169.254"))
        self.assertFalse(server.public_host("no-such-host.invalid"))


class DirectoryRoutes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        server.set_data_dir(cls.tmp.name)
        cls.httpd, cls.port = server.make_server(18865)
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.tmp.cleanup()

    def call(self, method, path, obj=None):
        import http.client
        c = http.client.HTTPConnection("127.0.0.1", self.port)
        h = {"Content-Type": "application/json", "X-Pen-Pal": "1"}
        c.request(method, path, body=None if obj is None else json.dumps(obj), headers=h)
        r = c.getresponse()
        out = (r.status, json.loads(r.read() or b"null"))
        c.close()
        return out

    def test_routes(self):
        s, v = self.call("GET", "/api/directory")
        self.assertEqual(s, 200)
        self.assertEqual(v["source"], "app")
        self.assertTrue(v["directory"]["journals"])
        with mock.patch.object(server, "directory_check", return_value={"updated": False, "source": "app"}) as dc:
            s, v = self.call("PUT", "/api/directory/check", {"force": True})
            self.assertEqual(s, 200)
            dc.assert_called_with(force=True)
        s, v = self.call("PUT", "/api/guidelines", {"url": "http://127.0.0.1/x"})
        self.assertEqual(s, 400)
        self.assertIn("public internet", v["error"])


if __name__ == "__main__":
    unittest.main()
