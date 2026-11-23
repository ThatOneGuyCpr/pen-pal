"""Browser smoke test for Pen Pal. Optional: needs `pip install playwright` and Chrome or Chromium.

Run:  python tests/browser_smoke.py [path-to-chrome]
It copies the project to a scratch folder, seeds an OLD Poetry Tracker data file (none of the newer
fields), starts server.py there and drives every screen in a real browser. Your own data is never touched.
The desktop window (penpal.py) shows this same page, so this covers the app's screens too.
"""
import datetime
import json
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

    srv = subprocess.Popen([sys.executable, "server.py", "--no-browser", "--port", str(PORT)], cwd=app, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
            page.on("dialog", lambda dlg: dlg.accept())

            def saved():
                page.wait_for_function("document.querySelector('#saveState') && document.querySelector('#saveState').textContent === 'Saved on this PC'", timeout=8000)

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
            check(page.locator("#nav .navitem").count() == 11, "eleven sections in the sidebar")
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
            check("22 journals" in view().lower(), "directory loads 22 journals")
            check(page.locator(".toggle[aria-pressed=true]").count() == 1, "'open now or soon' starts on")
            page.fill("#findQuery", "miami")
            page.wait_for_timeout(100)
            check(page.locator(".result").count() == 0 and "No journals match" in view(), "Miami journals have no set window, so 'open now or soon' hides them")
            page.click('.toggle[data-key="openSoon"]')
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
            check("$7 left" in view(), "budget shows what is left ($3 spent of $10)")
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
            check("$13 over budget" in view(), "budget page shows the overspend")
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
            page.fill("#dlg [name=deadline]", d(15) if d(15)[:4] == str(TODAY.year) else d(0))
            page.fill("#dlg [name=fee]", "25")
            page.dispatch_event("#dlg [name=fee]", "change")
            check("fee budget" in page.inner_text("#warns"), "entry fee warns about the budget too")
            submit()
            saved()
            tab("budget")
            check("Planned entries: $25" in view(), "planned entry shows in the budget")

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

            # ---- text hygiene, dark mode, phone width
            tabs = ["desk", "find", "journals", "poems", "subs", "books", "budget", "insights", "calendar", "import", "export"]
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
    print("\nscreenshots in", work)
    print("FAILED: %d" % check.failed if check.failed else "ALL PASSED")
    sys.exit(1 if check.failed else 0)


if __name__ == "__main__":
    main()
