"""Browser smoke test for Pen Pal. Optional: needs `pip install playwright` and Chrome or Chromium.

Run:  python tests/browser_smoke.py [path-to-chrome]
It copies the project to a scratch folder, seeds an OLD Poetry Tracker data file (none of the newer
fields), starts server.py there and drives every screen in a real browser. Your own data is never touched.
The desktop window (penpal.py) shows this same page, so this covers the app's screens too.
"""
import datetime
import http.server
import json
import threading
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 18900
BASE = "http://127.0.0.1:%d/" % PORT
TODAY = datetime.date.today()


def d(n):
    return (TODAY + datetime.timedelta(days=n)).isoformat()


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond:
        check.failed += 1


check.failed = 0


def main():
    chrome = sys.argv[1] if len(sys.argv) > 1 else next((p for p in ("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser") if os.path.exists(p)), None)
    work = tempfile.mkdtemp(prefix="penpal-smoke-")
    app = os.path.join(work, "app")
    shutil.copytree(ROOT, app, ignore=shutil.ignore_patterns("data", "__pycache__", "*.zip", "dist", "build"))
    os.makedirs(os.path.join(app, "data"))
    second = os.path.join(work, "second-folder")
    os.makedirs(second)
    # An old-format file, as the Poetry Tracker wrote it before Pen Pal.
    seed = {
        "rev": 7,
        "poems": [{"id": "p%d" % i, "title": t, "status": "ready", "notes": "", "publishedWhere": "", "publishedDate": ""}
                  for i, t in enumerate(["Salt Line", "Wet Season", "Harbor Song", "Low Tide", "Mangrove", "Old Draft"], 1)],
        "journals": [
            {"id": "j1", "name": "Alpha Review", "url": "https://alpha.example", "opens": d(-60), "closes": d(10), "fee": 3, "maxPoems": 3, "simSubs": "yes", "notes": ""},
            {"id": "j2", "name": "Beta Quarterly", "url": "", "opens": "", "closes": "", "fee": None, "maxPoems": None, "simSubs": "yes", "notes": ""},
        ],
        "submissions": [
            {"id": "s1", "poemIds": ["p1"], "journalId": "j1", "sentDate": d(-40), "status": "rejected", "acceptedPoemIds": [], "withdrawnPoemIds": [], "responseDate": d(-30), "feePaid": 3, "notes": ""},
            {"id": "s2", "poemIds": ["p2", "p4"], "journalId": "j2", "sentDate": d(-120), "status": "pending", "acceptedPoemIds": [], "withdrawnPoemIds": [], "responseDate": "", "feePaid": None, "notes": ""},
            {"id": "s3", "poemIds": ["p3"], "journalId": "j1", "sentDate": d(-20), "status": "pending", "acceptedPoemIds": [], "withdrawnPoemIds": [], "responseDate": "", "feePaid": None, "notes": ""},
        ],
    }
    with open(os.path.join(app, "data", "tracker.json"), "w", encoding="utf-8") as f:
        json.dump(seed, f)
    journals_csv = os.path.join(work, "journals.csv")
    with open(journals_csv, "w", encoding="utf-8") as f:
        f.write("Name,Website,Opens,Closes,Fee,Max poems,Sim subs\nAlpha Review,alpha.example,,,,,\nGamma Review,www.gamma.example,Sep 1,Nov 30,$3,3-5,yes\nDelta Mag,,,rolling,Free,,no\n")
    history_csv = os.path.join(work, "history.csv")
    with open(history_csv, "w", encoding="utf-8") as f:
        f.write("Market,Piece,Date Sent,Status,Response Date,Fee\nFernhouse Review,Salt Line; New Poem,3/3/2026,Declined,4/18/2026,$3\n"
                "Fernhouse Review,Low Tide,spring 2025,Withdrawn,,\nGull and Pine,Mangrove,5/5/2026,Never responded,,\n")

    # A local stand-in for GitHub's "latest release" answer, so the update check runs without the network.
    class FakeGitHub(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            if self.path.startswith("/directory.json"):
                doc = FAKE_DIR.get("doc")
                if doc is None:
                    self.send_response(404)
                    self.end_headers()
                    return
                body = json.dumps(doc).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            body = json.dumps({"tag_name": "v9.9.9", "body": "Big new things.", "html_url": "https://github.com/ThatOneGuyCpr/pen-pal/releases/tag/v9.9.9",
                               "assets": [{"name": "PenPal.exe", "size": 1234, "digest": "sha256:" + "0" * 64,
                                           "browser_download_url": "https://github.com/ThatOneGuyCpr/pen-pal/releases/download/v9.9.9/PenPal.exe"}]}).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    FAKE_DIR = {"doc": None}  # what "GitHub" serves as the newer directory; nothing at first
    with open(os.path.join(ROOT, "public", "directory.json"), encoding="utf-8") as f:
        SHIPPED = json.load(f)
    gh = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeGitHub)
    threading.Thread(target=gh.serve_forever, daemon=True).start()
    env = dict(os.environ, PENPAL_UPDATE_API="http://127.0.0.1:%d/latest" % gh.server_address[1],
               PENPAL_DIRECTORY_URL="http://127.0.0.1:%d/directory.json" % gh.server_address[1])
    srv = subprocess.Popen([sys.executable, "server.py", "--no-browser", "--port", str(PORT)], cwd=app, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    errors = []
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(BASE + "api/data", timeout=1)
                break
            except Exception:
                time.sleep(0.1)
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=chrome, args=["--no-sandbox"]) if chrome else pw.chromium.launch()
            ctx = browser.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
            page = ctx.new_page()
            # 400s are the deliberate refusals tested below; the browser logs every failed fetch
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "status of 400" not in m.text else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            prompt_answer = {"text": ""}
            page.on("dialog", lambda dlg: dlg.accept(prompt_answer["text"]) if dlg.type == "prompt" else dlg.accept())

            def saved():
                page.wait_for_function("document.querySelector('#saveState') && /^Saved( |$)/.test(document.querySelector('#saveState').textContent)", timeout=8000)

            def tab(name):
                page.click('#nav [data-tab="%s"]' % name)

            def submit(value="save"):
                page.click('#dlg button[type=submit][value=%s]' % value)

            def api():
                return json.load(urllib.request.urlopen(BASE + "api/data"))

            def view():
                return page.inner_text("#view")

            page.goto(BASE)
            page.wait_for_selector(".pagehead")
            check(page.title() == "Pen Pal" and "Your desk" in view(), "opens on the Desk, named Pen Pal")
            check(page.locator("#nav .navitem").count() == 12, "twelve sections in the sidebar")
            check(page.locator("#titlebar").is_hidden(), "no custom title bar in a plain browser")
            page.wait_for_function("document.querySelector('#nav [data-tab=settings] .count')", timeout=8000)
            check(page.inner_text('#nav [data-tab="settings"] .count') == "update", "update found at start-up shows in the sidebar")
            check("Pen Pal 9.9.9 is out" in view(), "update notice on the Desk")
            tab("poems")
            check(page.locator("#view tbody tr").count() == 6, "old Poetry Tracker data loads: 6 poems")

            # ---- follow-up reminders (s2 has waited 120 days at a journal with no stated reply time)
            tab("desk")
            check("Beta Quarterly has had" in view() and "120 days" in view(), "follow-up reminder after 90 days")
            check("not saved a backup file" in view(), "backup reminder on the Desk")
            page.get_by_role("button", name="I followed up").click()
            saved()
            check("Beta Quarterly has had" not in view(), "marking a follow-up clears it")
            check(api()["submissions"][1]["queriedDate"] == d(0), "follow-up date saved")
            tab("subs")
            check("Followed up" in view(), "submissions list shows the follow-up")

            # ---- find journals
            tab("find")
            n_dir = len(SHIPPED["journals"])
            check(("%d journals" % n_dir) in view().lower(), "directory loads %d journals" % n_dir)
            check(page.locator(".toggle[aria-pressed=true]").count() == 1 and page.locator('.toggle[data-when="soon"][aria-pressed=true]').count() == 1, "'open or opening soon' starts on")
            page.fill("#findQuery", "miami")
            page.wait_for_timeout(100)
            res = page.locator(".result").all_inner_texts()
            check(not any("SWWIM" in r or "Gulf Stream" in r for r in res), "Miami journals with no set window are hidden by 'open or opening soon'")
            page.click('.toggle[data-when="any"]')
            res = page.locator(".result").all_inner_texts()
            check(any("SWWIM" in r for r in res) and any("Gulf Stream" in r for r in res), "Miami journals found: " + str(len(res)))
            href = page.get_attribute('a:has-text("Search Chill Subs")', "href")
            check(href.startswith("https://duckduckgo.com/?q=site%3Achillsubs.com") and "miami" in href, "Chill Subs search link carries the words")
            page.fill("#findQuery", "")
            page.click('.toggle[data-key="pays"]')
            page.locator(".result", has_text="Copper Nickel").click()
            check("Copper Nickel" in page.inner_text(".detail") and "Aug 15 to Dec 1; Jan 15 to Mar 1" in page.inner_text(".detail"), "detail shows both reading windows")
            page.click('.detail button:has-text("Add to my journals")')
            saved()
            check("In your journals" in page.inner_text(".detail .yourhist") or page.locator('.detail button:has-text("Send poems")').count() == 1, "added: detail now offers Send poems")
            page.screenshot(path=os.path.join(work, "find.png"), full_page=True)
            cn = [j for j in api()["journals"] if j["name"] == "Copper Nickel"][0]
            check(cn["repeat"] == "yearly" and cn["extraWindows"] == [{"opens": "01-15", "closes": "03-01"}] and cn["dirId"] == "copper-nickel", "directory journal saved with yearly windows")
            page.click("#undoBtn")
            saved()
            check(not any(j["name"] == "Copper Nickel" for j in api()["journals"]), "undo removes the added journal")
            page.click("#redoBtn")
            saved()
            tab("journals")
            check("From the directory" in page.locator("#view tbody tr", has_text="Copper Nickel").inner_text(), "My journals shows where it came from")

            # ---- reading-period reminders: the bell on a journal
            row = page.locator("#view tbody tr", has_text="Copper Nickel")
            check(row.locator("button.bell[aria-pressed=false]").count() == 1, "journal has a reminder bell, off to start")
            row.locator("button.bell").click()
            saved()
            check([j["notify"] for j in api()["journals"] if j["name"] == "Copper Nickel"] == [True], "ringing the bell turns reminders on")
            check(page.locator("#view tbody tr", has_text="Copper Nickel").locator("button.bell.on[aria-pressed=true]").count() == 1, "bell shows it is on")
            check(page.locator("#view tbody tr", has_text="Always Open Mag").locator("button.bell").count() == 0, "no bell for a journal open all year")
            page.locator("#view tbody tr", has_text="Copper Nickel").locator('button:has-text("Edit")').click()
            check(page.locator("#dlg [name=notify]").is_checked(), "journal form has the reminder option, matching the bell")
            page.uncheck("#dlg [name=notify]")
            submit()
            saved()
            check([j["notify"] for j in api()["journals"] if j["name"] == "Copper Nickel"] == [False], "and it can be turned off there")
            tab("settings")
            check("Reading period reminders" in view() and "None are on yet" in view(), "Settings has a reminders card")
            check(page.locator("#remindClosed").count() == 0 and "PenPal.exe app" in view(), "in a browser, it explains notifications come from the app")
            page.fill("#notifyDays", "7")
            page.click('[data-act="save-notify-days"]')
            saved()
            check(api()["settings"]["notifyDays"] == 7, "how many days ahead is saved")
            page.fill("#notifyDays", "3")
            page.click('[data-act="save-notify-days"]')
            saved()

            # ---- Find journals: the panel on the right follows you down a long list
            tab("find")
            if page.locator('.toggle[data-key="pays"][aria-pressed=true]').count():
                page.click('.toggle[data-key="pays"]')
            page.locator(".result").nth(1).click()
            n_res = page.locator(".result").count()
            page.evaluate("document.querySelector('.mainwrap').scrollTop = 1600")
            page.wait_for_timeout(150)
            box = page.locator(".detail").bounding_box()
            check(n_res > 12 and box and 0 <= box["y"] < 140, "detail panel stays in view after scrolling the list (%d results, panel at y=%s)" % (n_res, box and round(box["y"])))
            page.evaluate("document.querySelector('.mainwrap').scrollTop = 0")

            # ---- 2.5: filters, sort, saved searches
            page.click('.toggle[data-when="any"]')
            page.click(".morefilters summary")
            page.click('.toggle[data-act="find-focus"][data-key="florida"]')
            res = page.locator(".result").all_inner_texts()
            fl = [e for e in SHIPPED["journals"] if "florida" in (e.get("focus") or [])]
            check(len(res) == len(fl) and len(fl) > 0, "focus filter: Florida journals only (%d)" % len(res))
            check("1 on" in page.inner_text(".morefilters summary"), "More filters shows how many are on")
            page.select_option("#findSort", "name")
            names = [page.locator(".result .t > span:first-child").nth(i).inner_text() for i in range(page.locator(".result").count())]
            check(names == sorted(names, key=str.lower) or names == sorted(names), "A to Z sort")
            prompt_answer["text"] = "Florida, any time"
            page.click('[data-act="find-save"]')
            saved()
            sf = api()["settings"]["savedFinds"]
            check(len(sf) == 1 and sf[0]["name"] == "Florida, any time" and sf[0]["opts"]["focus"] == ["florida"] and sf[0]["opts"]["sort"] == "name", "search saved to settings")
            page.click('[data-act="find-clear"]')
            check(page.locator(".result").count() > len(fl), "Clear brings everything back")
            page.click('.savedchip [data-act="find-load"]')
            check(page.locator(".result").count() == len(fl) and page.locator('.toggle[data-key="florida"][aria-pressed=true]').count() == 1, "loading a saved search restores it")
            page.click('[data-act="find-clear"]')
            page.fill("#findMaxFee", "0")
            page.dispatch_event("#findMaxFee", "change")
            free = [e for e in SHIPPED["journals"] if e.get("fee") == 0]
            check(page.locator(".result").count() == len(free) and page.locator('.toggle[data-key="free"][aria-pressed=true]').count() == 1, "fee at most $0 is the same as No fee (%d)" % len(free))
            page.click('[data-act="find-clear"]')
            page.select_option("#findReply", "90")
            fast = [e for e in SHIPPED["journals"] if e.get("replyDays") and e["replyDays"] <= 90]
            check(page.locator(".result").count() == len(fast), "reply within 3 months (%d)" % len(fast))
            page.click('[data-act="find-clear"]')
            # for a poem: Harbor Song is out at Alpha Review, which takes simultaneous submissions
            page.select_option("#findPoem", "p3")
            nosim = [e for e in SHIPPED["journals"] if e.get("simSubs") == "no"]
            check(page.locator(".result").count() == n_dir - len(nosim) and "have not seen" in view(), "for a poem that is out: journals with no simultaneous submissions drop out")
            page.locator(".result").first.click()
            add_send = page.locator('.detail [data-act="find-add-send"]')
            if add_send.count():
                add_send.click()
                check(page.locator("#dlg [name=journalId]").count() == 1 and page.locator("#dlg input[value=p3]").is_checked(), "Add and send opens the submission form with the poem picked")
                page.click("#dlg button[data-close]")
                saved()
            page.click('[data-act="find-clear"]')
            page.evaluate("document.querySelector('#dlg').open && document.querySelector('#dlg').close()")
            prompt_answer["text"] = ""
            page.click('.savedchip [data-act="find-unsave"]')
            saved()
            check(api()["settings"]["savedFinds"] == [], "saved search removed")

            # ---- 2.5: quick add from guidelines text (a link to this computer is refused)
            page.click('[data-act="quick-add"]')
            page.fill("#dlg [name=url]", "http://127.0.0.1:%d/" % PORT)
            submit("read")
            page.wait_for_function("document.querySelector('#dlgErr').textContent.length > 0")
            check("public internet" in page.inner_text("#dlgErr") and page.locator("#dlg details[open]").count() == 1, "a link to this computer is refused, and the paste box opens")
            page.fill("#dlg [name=url]", "")
            page.fill("#dlg [name=text]", "The Saltmarsh Review reads poetry from March 1 to May 31. Send up to four poems. There is no submission fee. "
                      "Simultaneous submissions are welcome. We pay $25 per poem. We respond within 8 weeks.")
            submit("read")
            page.wait_for_selector("#dlg [name=name]")
            check("Found: reading period, fee, poems per submission" in view() + page.inner_text("#dlg"), "the journal form says what was found")
            check(page.input_value("#dlg [name=maxPoems]") == "4" and page.input_value("#dlg [name=fee]") == "0" and page.input_value("#dlg [name=simSubs]") == "yes"
                  and page.input_value("#dlg [name=replyDays]") == "56" and page.input_value("#dlg [name=pays]") == "yes" and page.is_checked("#dlg [name=repeat]"),
                  "the form is filled in from the guidelines")
            page.fill("#dlg [name=name]", "Saltmarsh Review")
            submit()
            saved()
            sm = [j for j in api()["journals"] if j["name"] == "Saltmarsh Review"]
            check(len(sm) == 1 and sm[0]["opens"][5:] == "03-01" and sm[0]["checked"] == d(0) and "Pays $25 per poem" in sm[0]["notes"], "quick-added journal saved")

            # ---- 2.5: where can this poem go?
            tab("poems")
            page.locator("#view tbody tr", has_text="Mangrove").locator('button:has-text("Where can it go?")').click()
            check("Where can it go?" in page.inner_text("#dlg") and page.locator("#dlg .matches li").count() > 0, "poem view lists journals it could go to")
            first_add = page.locator('#dlg [data-act="match-add-send"]').first
            if first_add.count():
                first_add.click()
                check(page.locator("#dlg input[value=p5]").is_checked(), "Add and send from the poem view picks the poem")
                page.click("#dlg button[data-close]")
                saved()
            page.evaluate("document.querySelector('#dlg').open && document.querySelector('#dlg').close()")

            # ---- 2.5: the directory updates itself, and your copy of a journal wins
            newer = json.loads(json.dumps(SHIPPED))
            newer["rev"] = SHIPPED.get("rev", 0) + 1
            newer["journals"].append({"id": "zeta-test", "name": "Zeta Test Review", "url": "https://zeta.example", "yearRound": True, "fee": 0, "simSubs": "yes", "note": "A test journal."})
            for e in newer["journals"]:
                if e["id"] == "copper-nickel":
                    e["fee"] = 9
                    e["checked"] = d(1)
            FAKE_DIR["doc"] = newer
            tab("find")
            page.click('[data-act="dir-check"]')
            page.wait_for_function("document.querySelector('.pagehead') && /%d journals/.test(document.querySelector('.pagehead').textContent)" % (n_dir + 1), timeout=8000)
            check(True, "Check for new journals downloads the newer directory (%d journals)" % (n_dir + 1))
            page.click('.toggle[data-when="any"]')
            page.fill("#findQuery", "copper")
            page.locator(".result", has_text="Copper Nickel").click()
            check("Newer details in the directory" in page.inner_text(".detail") and "$9" in page.inner_text(".detail .dirchanges"), "your saved journal shows the directory's newer fee")
            page.click('.detail [data-act="dir-keep"]')
            saved()
            check("Newer details" not in page.inner_text(".detail") and [j["fee"] for j in api()["journals"] if j["name"] == "Copper Nickel"] == [3], "Keep mine leaves your copy alone")
            page.fill("#findQuery", "")
            tab("journals")

            # ---- journal dialog: open all year, extra windows
            page.click("text=Add journal")
            page.fill("#dlg [name=name]", "Two Windows Review")
            page.fill("#dlg [name=opens]", d(-200))
            page.fill("#dlg [name=closes]", d(-150))
            page.check("#dlg [name=repeat]")
            page.fill("#dlg [name=extra]", "nonsense here")
            submit()
            check("Could not read" in page.inner_text("#dlgErr"), "bad extra window is explained")
            page.fill("#dlg [name=extra]", "Jan 15 to Mar 1")
            page.fill("#dlg [name=replyDays]", "45")
            submit()
            saved()
            tw = [j for j in api()["journals"] if j["name"] == "Two Windows Review"][0]
            check(tw["extraWindows"] == [{"opens": "01-15", "closes": "03-01"}] and tw["replyDays"] == 45, "extra window and reply time saved")
            page.click("text=Add journal")
            page.fill("#dlg [name=name]", "Always Open Mag")
            page.check("#dlg [name=alwaysOpen]")
            check(page.locator("#dlg [name=opens]").is_disabled(), "dates switch off for open-all-year")
            submit()
            saved()
            check("Open all year" in page.locator("#view tbody tr", has_text="Always Open Mag").inner_text(), "open-all-year chip")

            # ---- fee budget and the warning when logging a submission
            tab("budget")
            page.fill("#budgetAmount", "10")
            page.click("text=Save budget")
            saved()
            check("$10 left" in view(), "budget shows what is left (last month's $3 fee does not count)")
            check("Applies from" in view() and "Monthly budget" in view(), "budget is monthly")
            tab("desk")
            check("Set a monthly budget" not in view() and "$10 left" in view(), "Desk shows this month's budget")
            tab("budget")
            tab("subs")
            page.click("text=Log a submission")
            page.select_option("#dlg [name=journalId]", label="Alpha Review")
            page.check('#dlg [name=poem][value="p5"]')
            page.fill("#dlg [name=feePaid]", "20")
            page.dispatch_event("#dlg [name=feePaid]", "change")
            check("over your $10 fee budget" in page.inner_text("#warns"), "logging a fee warns about the budget")
            submit()
            saved()
            tab("budget")
            check("$10 over budget" in view(), "budget page shows the overspend")
            page.screenshot(path=os.path.join(work, "budget.png"), full_page=True)

            # ---- accept, rights, reprint reminder, calendar
            tab("subs")
            page.select_option("#subFilter", "all")
            page.locator("#view tbody tr", has_text="Harbor Song").get_by_role("button", name="Accepted").click()
            submit()
            saved()
            tab("poems")
            page.locator("#view tbody tr", has_text="Harbor Song").get_by_text("History").click()
            check("Accepted by Alpha Review" in page.inner_text("#dlg"), "poem page shows the acceptance")
            page.click('#dlg button:has-text("Edit")')
            page.fill("#dlg [name=bought]", "First North American serial")
            page.fill("#dlg [name=issue]", "Fall " + str(TODAY.year))
            page.fill("#dlg [name=exclusiveUntil]", d(10))
            page.select_option("#dlg [name=reprints]", "yes")
            submit()
            saved()
            page.wait_for_selector("#dlg >> text=Rights and reprints")
            txt = page.inner_text("#dlg")
            check("first appeared in Alpha Review, Fall %d" % TODAY.year in txt and "in 10 days" in txt, "credit line and exclusive date")
            page.screenshot(path=os.path.join(work, "poem.png"))
            page.click("#dlg >> text=Close")
            tab("desk")
            check("comes out of its exclusive period" in view(), "reprint reminder on the Desk")
            tab("calendar")
            with page.expect_download() as dl:
                page.click("text=Download calendar file")
            ics = open(dl.value.path(), encoding="utf-8").read().replace("\r\n ", "")
            check("Free for reprint: Harbor Song" in ics, "calendar has the reprint date")
            check("SUMMARY:Opens: Copper Nickel" in ics and "SUMMARY:Closes: Copper Nickel" in ics, "calendar has the directory journal's windows")

            # ---- importing history and journals
            tab("import")
            page.set_input_files("#importSubsFile", history_csv)
            page.wait_for_selector("#impPreview table")
            t = page.inner_text("#dlg")
            check("3 submissions will be added" in t and "2 new journals" in t and "1 new poem title" in t, "history import preview counts")
            check("spring 2025" in t, "unreadable date explained")
            submit("import")
            saved()
            data = api()
            check(sum(1 for s in data["submissions"] if s["notes"] and "never answered" in s["notes"]) == 1, "never-answered row noted")
            check(any(p["title"] == "New Poem" for p in data["poems"]) and any(j["name"] == "Gull and Pine" for j in data["journals"]), "new journals and poems created")
            tab("import")
            page.set_input_files("#importSubsFile", history_csv)
            page.wait_for_selector("#impPreview table")
            check("0 submissions will be added" in page.inner_text("#dlg"), "re-importing the same file adds nothing")
            page.click("#dlg [data-close]")
            page.set_input_files("#importFile", journals_csv)
            page.wait_for_selector("#impPreview table")
            check("Already have it" in page.inner_text("#dlg"), "journal import still flags duplicates")
            submit("import")
            saved()
            check(any(j["name"] == "Gamma Review" and j["repeat"] == "yearly" for j in api()["journals"]), "journal import works")

            # ---- manuscripts: a planned entry counts in the budget
            tab("books")
            page.click("text=Add manuscript")
            page.fill("#dlg [name=title]", "Salt Chapbook")
            page.fill("#dlg [name=pageCount]", "28")
            page.check('#dlg [name=poem][value="p1"]')
            submit()
            saved()
            page.click("text=Add entry")
            page.fill("#dlg [name=name]", "Fernhouse Chapbook Prize")
            due = d(15) if d(15)[:4] == str(TODAY.year) else d(0)
            page.fill("#dlg [name=deadline]", due)
            page.fill("#dlg [name=fee]", "25")
            page.dispatch_event("#dlg [name=fee]", "change")
            check("fee budget" in page.inner_text("#warns"), "entry fee warns about the budget too")
            submit()
            saved()
            tab("budget")
            if due[:7] != d(0)[:7]:
                check("Planned entries" not in view(), "next month's planned entry is not in this month")
                page.click('#view .mcol[data-month="%s"]' % due[:7])
            check("Planned entries: $25" in view(), "planned entry shows in its month")
            check(page.locator("#view .mcol .cap").count() >= 1, "chart marks the monthly budget")
            page.click("text=This month") if due[:7] != d(0)[:7] else None

            # ---- backups and the second folder
            tab("export")
            page.fill("#folderInput", "relative\\path")
            page.click("text=Start copying here")
            page.wait_for_function("document.querySelector('#folderErr').textContent.length > 0")
            check("full path" in page.inner_text("#folderErr"), "relative folder refused")
            page.fill("#folderInput", second)
            page.click("text=Start copying here")
            page.wait_for_selector("text=Working. Last copy")
            check(os.path.exists(os.path.join(second, "pen-pal-latest.json")), "second folder gets pen-pal-latest.json")
            check("second folder" in page.inner_text("#backupState"), "sidebar shows the second copy")
            shutil.rmtree(second)
            tab("poems")
            page.click("text=Add poem")
            page.fill("#dlg [name=title]", "Saved with the folder gone")
            submit()
            saved()
            check(any(p["title"] == "Saved with the folder gone" for p in api()["poems"]), "a missing second folder never blocks saving")
            tab("export")
            page.wait_for_selector("text=The last copy failed")
            page.click("text=Switch off")
            page.wait_for_selector("text=Not set.")
            with page.expect_download() as dl:
                page.click('button:has-text("Save a backup file")')
            b = json.load(open(dl.value.path(), encoding="utf-8"))
            check(dl.value.suggested_filename.startswith("pen-pal-backup-") and b["manuscripts"][0]["title"] == "Salt Chapbook", "backup file has everything")
            with page.expect_download() as dl:
                page.click("text=Download submissions.csv")
            check(dl.value.suggested_filename.startswith("pen-pal-submissions-"), "CSV export")

            # ---- persistence, old records intact, two-tab conflict
            page.reload()
            page.wait_for_selector(".pagehead")
            final = api()
            check({"p1", "p2", "p3", "p4", "p5", "p6"} <= {p["id"] for p in final["poems"]} and {"j1", "j2"} <= {j["id"] for j in final["journals"]} and {"s1", "s2", "s3"} <= {s["id"] for s in final["submissions"]}, "every seeded record is still there")
            page2 = ctx.new_page()
            page2.on("dialog", lambda dlg: dlg.accept())
            page2.goto(BASE)
            page2.wait_for_selector(".pagehead")
            tab("poems")
            page.click("text=Add poem")
            page.fill("#dlg [name=title]", "From tab one")
            submit()
            saved()
            page2.click('#nav [data-tab="poems"]')
            page2.click("text=Add poem")
            page2.fill("#dlg [name=title]", "From tab two")
            page2.click("#dlg button[type=submit][value=save]")
            page2.wait_for_selector("#banner >> text=changed in another window")
            check(not any(p["title"] == "From tab two" for p in api()["poems"]), "second window cannot overwrite the first")
            page2.close()

            # ---- settings: theme, reminders, title bar choice, updates
            tab("settings")
            check("Settings" in view() and "You have Pen Pal" in view(), "settings page")
            page.check('input[name=theme][value=dark]')
            saved()
            check(page.evaluate("document.documentElement.dataset.theme") == "dark" and api()["settings"]["theme"] == "dark", "dark theme applies and saves")
            page.check('input[name=theme][value=system]')
            saved()
            check(page.evaluate("document.documentElement.dataset.theme") is None, "back to matching Windows")
            page.fill("#followUpDays", "30")
            page.fill("#deskDays", "21")
            page.click('button:has-text("Save")')
            saved()
            check(api()["settings"]["followUpDays"] == 30 and api()["settings"]["deskDays"] == 21, "reminder settings save")
            tab("desk")
            check("next 21 days" in view(), "Desk uses the deadline window setting")
            tab("settings")
            page.check('input[name=titleBar][value=windows]')
            page.wait_for_selector("#toast.show")
            check(json.load(urllib.request.urlopen(BASE + "api/settings"))["titleBar"] == "windows", "title bar choice saved for next launch")
            page.check('input[name=titleBar][value=custom]')
            page.wait_for_timeout(300)
            page.click('button:has-text("Check for updates")')
            page.wait_for_selector("text=Pen Pal 9.9.9 is available")
            card = page.inner_text("#updateCard")
            check("Big new things." in card and "Open the releases page" in card, "update details, and a releases link when this copy cannot install")
            page.uncheck("#checkUpdates")
            saved()
            check(api()["settings"]["checkUpdates"] is False, "start-up check can be turned off")

            # ---- keep the data in a synced folder (iCloud Drive), and a second computer sharing it
            cloud = os.path.join(work, "iCloudDrive", "Pen Pal")
            os.makedirs(os.path.dirname(cloud))
            cloud_file = os.path.join(cloud, "tracker.json")
            page.reload()
            page.wait_for_selector(".pagehead")
            tab("settings")
            page.click('[data-act="data-folder"]')
            page.fill("#dlg [name=folder]", cloud)
            page.wait_for_selector('#folderBtns button[value=move]')
            check("Pen Pal will create this folder (iCloud Drive)" in page.inner_text("#folderInfo"), "checks the folder before moving: " + page.inner_text("#folderInfo")[:60])
            with page.expect_navigation():
                page.click('#folderBtns button[value=move]')
            page.wait_for_selector(".pagehead")
            tab("settings")
            check(cloud in page.inner_text("#dataCard") and "iCloud Drive" in page.inner_text("#dataCard"), "data now lives in the iCloud Drive folder")
            check(page.inner_text("#saveState") == "Saved to iCloud Drive", "sidebar says where it saved")
            check(os.path.exists(cloud_file) and not os.path.exists(os.path.join(app, "data", "tracker.json")), "file moved; this PC's old copy renamed, not deleted")
            check(any(f.startswith("moved-away-tracker-") for f in os.listdir(os.path.join(app, "data"))), "old copy kept under a new name")

            def laptop_saves(base, **changes):
                doc = json.loads(json.dumps(base))
                doc.update(changes)
                doc["lineage"] = (doc.get("lineage") or []) + ([base["saveId"]] if base.get("saveId") else [])
                doc["saveId"] = "laptop%d" % len(doc["lineage"])
                doc["savedOn"], doc["savedAt"], doc["rev"] = "LAPTOP", "2026-11-24T09:15:00", base["rev"] + 1
                with open(cloud_file, "w", encoding="utf-8") as f:
                    json.dump(doc, f)
                return doc

            def poke():  # what coming back to the window does (it also checks every few seconds)
                page.evaluate("window.dispatchEvent(new Event('focus'))")

            # the laptop saves on top of this PC's last save: picked up without asking
            base = api()
            laptop_saves(base, journals=base["journals"] + [{"id": "lap1", "name": "Laptop Review"}])
            poke()
            page.wait_for_selector("#toast:has-text('Updated with changes saved')")
            check("on LAPTOP" in page.inner_text("#toast"), "picks up the laptop's save and says so")
            tab("journals")
            check("Laptop Review" in view(), "laptop's journal shows here")
            # this PC saves, then the laptop's version (made without it) replaces the file
            base = api()
            page.locator("#view tbody tr", has_text="Laptop Review").locator("button.bell").click()
            saved()
            laptop_saves(base, journals=base["journals"] + [{"id": "lap2", "name": "Laptop Two"}])
            poke()
            page.wait_for_selector("#syncNote >> text=Changes made on this PC were replaced")
            check("LAPTOP" in page.inner_text("#syncNote"), "replaced work is caught, with where it came from")
            page.click('[data-act="sync-restore"]')
            page.wait_for_selector("#toast:has-text('version is back')")
            now = api()
            lap = [j for j in now["journals"] if j["id"] == "lap1"]
            check(lap and lap[0].get("notify") is True and "laptop%d" % len(base["lineage"] + [base["saveId"]]) in now["lineage"], "this PC's version is back, on top of the laptop's (so the laptop reloads it)")
            check(page.inner_text("#syncNote").strip() == "", "notice cleared")
            check(any(f.startswith("replaced-") for f in os.listdir(os.path.join(app, "data", "backups"))), "the laptop's version is kept in this PC's backups")
            # a conflict copy left by the cloud service
            with open(os.path.join(cloud, "tracker 2.json"), "w", encoding="utf-8") as f:
                json.dump(dict(now, journals=[], savedOn="LAPTOP"), f)
            poke()
            page.wait_for_selector("#syncNote >> text=second copy of your data")
            check("tracker 2.json" in page.inner_text("#syncNote") and "0 journals" in page.inner_text("#syncNote"), "second copy is flagged with what is in it")
            page.click('[data-act="conflict-keep"]')
            page.wait_for_function("document.querySelector('#syncNote').innerText.trim() === ''")
            check(not os.path.exists(os.path.join(cloud, "tracker 2.json")) and any(f.startswith("second-copy-") for f in os.listdir(os.path.join(app, "data", "backups"))), "keeping the one in use moves the copy to backups")
            check(len(api()["journals"]) == len(now["journals"]), "data untouched")
            # and back to this PC
            tab("settings")
            page.click('[data-act="data-folder-local"]')
            page.wait_for_selector('#folderBtns button[value=move]')
            with page.expect_navigation():
                page.click('#folderBtns button[value=move]')
            page.wait_for_selector(".pagehead")
            tab("settings")
            check("on this PC" in page.inner_text("#dataCard") and os.path.exists(os.path.join(app, "data", "tracker.json")), "moved back to this PC")
            check(len(api()["journals"]) == len(now["journals"]), "everything came back")

            # ---- the desktop window's own title bar, with a stand-in for the desktop bridge
            dpage = ctx.new_page()
            dpage.on("pageerror", lambda e: errors.append(str(e)))
            dpage.add_init_script("""
              window.__calls = [];
              let maxed = false;
              const rec = (n) => (...a) => { window.__calls.push([n, ...a]); return Promise.resolve(); };
              window.pywebview = { api: {
                win_minimize: rec('min'), win_close: rec('close'), open_data_folder: rec('open'), set_busy: rec('busy'),
                notify: (alerts) => { window.__calls.push(['notify', alerts.map((a) => a.title)]); return Promise.resolve({ shown: alerts.length, errors: [] }); },
                sync_reminders: (want) => { window.__calls.push(['sync', want]); return Promise.resolve({ supported: true, on: want, error: '' }); },
                test_notification: () => { window.__calls.push(['test']); return Promise.resolve(''); },
                win_bounds: () => Promise.resolve([100, 100, 1280, 900]),
                win_set_bounds: rec('bounds'),
                win_is_max: () => Promise.resolve(maxed),
                win_toggle_max: () => { maxed = !maxed; window.__calls.push(['max', maxed]); return Promise.resolve(maxed); },
                save_file: (name, text) => { window.__calls.push(['save', name, text.length]); return Promise.resolve('C:/Users/me/' + name); },
              } };
            """)

            def fake_info(route):
                r = route.fetch()
                body = r.json()
                body.update(desktop=True, frameless=True, canRemindClosed=True)
                route.fulfill(response=r, json=body)

            dpage.route("**/api/info", fake_info)
            dpage.goto(BASE)
            dpage.wait_for_selector(".pagehead")
            dpage.wait_for_selector("#titlebar:not([hidden])")
            check(dpage.locator(".brand").is_hidden(), "custom title bar shows, sidebar name hides")
            dpage.click("#tbMin")
            dpage.click("#tbMax")
            dpage.wait_for_function("document.body.classList.contains('maxed')")
            check(dpage.get_attribute("#tbMax", "aria-label") == "Restore" and dpage.locator("#resizers").is_hidden(), "maximize swaps to restore and hides the resize edges")
            check("pywebview-drag-region" not in dpage.get_attribute("#tbDrag", "class"), "no dragging while maximized")
            dpage.dblclick("#tbDrag")
            dpage.wait_for_function("!document.body.classList.contains('maxed')")
            dpage.mouse.move(1279, 450)
            dpage.mouse.down()
            dpage.mouse.move(1329, 450, steps=4)
            dpage.mouse.up()
            dpage.wait_for_timeout(200)
            dpage.mouse.move(640, 0)
            dpage.mouse.down()
            dpage.mouse.move(640, 40, steps=2)
            dpage.mouse.up()
            dpage.wait_for_timeout(200)
            calls = dpage.evaluate("window.__calls")
            bounds = [c for c in calls if c[0] == "bounds"]
            check(["min"] in calls and ["max", True] in calls and ["max", False] in calls, "minimize and maximize reach the window")
            check(any(c[3] == 1330 and c[1] == 100 for c in bounds), "dragging the right edge widens the window: " + str(bounds[-3:]))
            check(any(c[2] == 140 and c[4] == 860 for c in bounds), "dragging the top edge moves the window down and makes it shorter")
            dpage.click('#nav [data-tab="export"]')
            dpage.click('button:has-text("Save a backup file")')
            dpage.wait_for_selector("#toast:has-text('Saved to')")
            check(any(c[0] == "save" and c[1].startswith("pen-pal-backup-") for c in dpage.evaluate("window.__calls")), "downloads go through the Windows Save dialog")
            dpage.click('#nav [data-tab="settings"]')
            check(dpage.locator('button:has-text("Open the data folder")').count() == 1, "open-folder button in the app")
            # reminders through the desktop bridge
            calls = dpage.evaluate("window.__calls")
            any_bell = any(j.get("notify") for j in api()["journals"])
            check(["sync", any_bell] in calls, "at start-up, the daily check matches whether any bell is on (%s)" % any_bell)
            dpage.click('#nav [data-tab="journals"]')
            dpage.click('button:has-text("Add journal")')
            dpage.fill("#dlg [name=name]", "Soon Review")
            dpage.fill("#dlg [name=opens]", d(2))
            dpage.fill("#dlg [name=closes]", d(40))
            dpage.check("#dlg [name=notify]")
            dpage.click("#dlg button[type=submit][value=save]")
            dpage.wait_for_function("window.__calls.some(c => c[0] === 'notify')")
            calls = dpage.evaluate("window.__calls")
            check(["notify", ["Soon Review opens in 2 days"]] in calls, "a journal opening in 2 days sends a Windows notification")
            check(["sync", True] in calls, "and sets up the daily check while Pen Pal is closed")
            dpage.click('#nav [data-tab="settings"]')
            check(dpage.locator("#remindClosed").is_checked() and "every day at 9 AM" in dpage.inner_text("#remindCard"), "Settings shows the daily check is on")
            dpage.click('[data-act="test-notification"]')
            dpage.wait_for_function("window.__calls.some(c => c[0] === 'test')")
            check(True, "test notification button reaches Windows")
            dpage.uncheck("#remindClosed")
            dpage.wait_for_function("document.querySelector('#remindCard') && !document.querySelector('#remindCard').innerText.includes('9 AM')")
            check(urllib.request.urlopen(BASE + "api/settings").read().find(b'"remindClosed": false') >= 0, "turning it off is saved")
            dpage.check("#remindClosed")
            dpage.wait_for_timeout(300)
            dpage.check('input[name=theme][value=dark]')
            dpage.wait_for_function("window.__calls.filter(c => c[0] === 'busy').length >= 2")
            busy = [c[1] for c in dpage.evaluate("window.__calls") if c[0] == "busy"]
            check(busy[:2] == [True, False], "edits tell the window a save is pending, then that it finished")
            dpage.check('input[name=theme][value=system]')
            dpage.screenshot(path=os.path.join(work, "settings-desktop.png"))
            dpage.click("#tbClose")
            check(["close"] in dpage.evaluate("window.__calls"), "close button reaches the window")
            dpage.close()

            # ---- text hygiene, dark mode, phone width
            tabs = ["desk", "find", "journals", "poems", "subs", "books", "budget", "insights", "calendar", "import", "export", "settings"]
            for t in tabs:
                tab(t)
                check("\u2014" not in page.inner_text("body"), "no em dash on %s" % t)
            page.emulate_media(color_scheme="dark")
            tab("desk")
            page.screenshot(path=os.path.join(work, "desk-dark.png"))
            page.emulate_media(color_scheme="light")
            page.set_viewport_size({"width": 390, "height": 800})
            for t in tabs:
                page.click('#nav [data-tab="%s"]' % t)
                check(page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), "no sideways scroll at phone width on %s" % t)
            check(not errors, "no console errors" + ("" if not errors else ": " + "; ".join(errors[:3])))
            browser.close()
    finally:
        srv.terminate()
        srv.wait(timeout=5)
        gh.shutdown()
    print("\nscreenshots in", work)
    print("FAILED: %d" % check.failed if check.failed else "ALL PASSED")
    sys.exit(1 if check.failed else 0)


if __name__ == "__main__":
    main()
