# Pen Pal: developer notes

Handoff notes for continuing development in a new chat. Read this first, then README.md.

## What this is
A private poetry submission tracker for one poet (Christian, Miami, Windows PC). Formerly "Poetry Tracker"; renamed Pen Pal and turned into a Windows program in v2.0.0 (Nov 2026). He has about 10 poems he's happy with and is working toward a chapbook.

Hard requirements he set:
- Runs on his Windows PC as a proper program (PenPal.exe), not a phone app.
- **Poem text is never stored.** Titles and notes only. Do not add a poem-text field.
- New rules go in `public/logic.js` with tests; check UI changes in a real browser (tests/browser_smoke.py); no em dashes in anything the tool displays (a test scans for them); hand back a zip and, once the repo exists, the GitHub release link.
- Keep dependencies minimal: Python standard library for the server, plain HTML/JS for the page. The only extra is pywebview (plus PyInstaller at build time), bundled inside the exe so he installs nothing.

## Architecture
- `penpal.py`: the desktop entry point. Starts `server.py` in a thread on 127.0.0.1 and shows the page in a pywebview window (Edge WebView2 on Windows). Exposes `save_file` (native Save dialog, used for every download) and `open_data_folder` to the page via `window.pywebview.api`. Waits for an in-flight save on close (`window.PenPal.busy()`). Falls back to the browser without pywebview, or with `--browser`. `--check FILE` is a self-test against a throwaway data folder; CI runs it on the built exe.
- `server.py`: standard library only. Serves `public/`, `/api/data` (GET, PUT whole document with `rev`), `/api/settings` (second backup folder), `/api/info` (version, data folder, desktop flag). Host must be 127.0.0.1/localhost; PUTs need header `X-Pen-Pal: 1` (the old `X-Poetry-Tracker` is still accepted). `resource_dir()` is `sys._MEIPASS` when frozen (public/ is bundled with `--add-data`); `default_data_dir()` is `./data` from source, else a `data` folder beside the exe if present, else `%APPDATA%\Pen Pal\data`.
- `public/logic.js`: all rules, pure functions, works in browser and Node. **Put new rules here, with tests.**
- `public/app.js`: rendering, dialogs, saving, undo. Template strings with `esc()`. Event delegation via `data-act` / `data-tab`. Sections: desk, find, journals, poems, subs, books, budget, insights, calendar, import, export.
- `public/style.css`: palette from the approved mockup (ink #16202B, airmail red #B8322A, blue #234E8C), light and dark. Fonts bundled in `public/fonts` (Young Serif, Public Sans, IBM Plex Mono; OFL, licenses in fonts/LICENSE.txt). No CDNs.
- `public/directory.json`: the starter journal directory (see below).
- `assets/penpal.ico`: app icon. `start.bat` (runs PenPal.exe if present, else `penpal.py`), `build-exe.bat` (local build). Both CRLF and ASCII.
- `.github/workflows/build.yml`: on push, tests + build + `--check` on windows-latest, uploads the exe as an artifact; when `APP_VERSION` in server.py has no release yet, publishes one (tag v{version}) with PenPal.exe and RELEASE_NOTES.md. Tag pushes from Claude sessions are refused, which is why releases key off the version instead. To ship an update: bump APP_VERSION, rewrite RELEASE_NOTES.md, push to main.

## Data model (normalize functions in logic.js)
- Document: `{ rev, poems[], journals[], submissions[], manuscripts[], entries[], settings }`. Older files load fine; new fields default.
- Poem: `id, title, status (draft|ready|published), publishedWhere, publishedDate, notes, rights{bought, issue, pubDate, exclusiveUntil, reprints yes|no|unknown, revert, credit}`.
- Journal: `id, name, url, opens, closes, repeat (none|yearly), extraWindows[{opens:'MM-DD', closes:'MM-DD'}], alwaysOpen, fee, maxPoems, simSubs, replyDays, pays, reprints, dirId, checked, notes`. Every date question goes through `windowsFrom` / `currentWindow`, which roll yearly templates forward (extra windows too) and treat `alwaysOpen` as open.
- Submission: `id, poemIds[], journalId, sentDate, status, acceptedPoemIds[], withdrawnPoemIds[], responseDate, feePaid, notes, queriedDate, snoozedUntil`.
- Manuscript and Entry: as before (entries: planned|pending|finalist|accepted|rejected|withdrawn).
- Settings (in the document): `lastBackupDownload, backupSnoozedUntil, budgets{YYYY: amount}, budgetWarnPct (80), countPlanned (true)`.

## Decisions worth knowing
- **Directory:** 22 poetry journals, checked 2026-11-23 against each journal's own guidelines, a few details from publisher-supplied Poets & Writers listings. Blank or "unknown" means not confirmed; never guess a value. Chill Subs, Duotrope and P&W are proprietary, so nothing is copied from them; "Search Chill Subs / Poets & Writers" buttons run a DuckDuckGo site search because neither site documents a search URL. `dirIsStale` warns after 180 days. To grow it: add entries to directory.json (a test validates every entry) and bump `checked`.
- **Follow-ups:** expected reply = median of his own answered submissions to that journal (2+), else the journal's `replyDays`, else 90. After "I followed up", the next reminder is 60 days later; snooze is 30 days.
- **Budget:** calendar year by sent date (planned entries by deadline). `budgetCheck` warns at `budgetWarnPct` and when over; it runs in the submission and entry dialogs and never blocks.
- **History import** (`buildSubImport`): duplicates match on journal name + sent date + set of titles, so re-importing is safe. "Never responded" style statuses import as withdrawn with a note. Unreadable dates stay in notes.
- **Saving:** whole-document PUT with revision counter (409 on stale); atomic writes; daily backups; optional second folder (`pen-pal-latest.json` + dated copies) that never blocks a save; never starts over an unreadable data file.
- Pre-send warnings never block. Plain wording, no em dashes.

## Tests
- Logic: `node --test tests/logic.test.js` (70 tests)
- Server: `python -m unittest tests/test_server.py` (25 tests)
- Browser: `python tests/browser_smoke.py` (70 checks; needs Playwright + Chrome). Seeds an old-format Poetry Tracker file and covers every section, the budget warning, follow-ups, rights, both importers, backups, the two-window conflict, dark mode, phone width and console errors.
- The one-file PyInstaller build was checked on Linux (bundled public/, `--check` passes, data folder choice correct). **Not yet confirmed on real Windows:** the exe window itself, the Save dialog bridge, SmartScreen behavior, start.bat and build-exe.bat. The GitHub workflow runs the build and self-check on Windows once the repo exists.

## Ideas not done
1. Grow the directory (target 100+), with a "last checked" per entry.
2. Poem order and a table of contents per manuscript.
3. Code signing to avoid the SmartScreen warning (costs money; ask first).
4. Auto-update check against GitHub releases.
5. Import a manuscript-entries CSV.

## Publishing background he was given (context, not app logic)
Chapbooks run roughly 20 to 40 pages; full-length collections 48 to 100. Many presses like 25 to 50 percent of a manuscript to have appeared in journals. Entry fees of $15 to $25 are typical. Simultaneous submissions are usually allowed. Avoid vanity presses.
