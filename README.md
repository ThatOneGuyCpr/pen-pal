# Pen Pal

A private poetry submission tracker that runs on your own Windows PC, in its own window. It keeps track of:

- **Poems:** titles, status and notes. Never the poems themselves.
- **Journals:** reading periods (including ones that repeat every year or open twice a year), fees, poem limits, simultaneous submissions, pay, reprints.
- **Submissions:** which poems went where, when, and what happened.
- **Manuscripts:** a chapbook or book, the poems in it, and every press or contest you enter it in.
- **Rights:** what a journal took, when the poem is free to go out again, and the credit line to use.
- **Fees:** a yearly budget, with a warning before a fee goes over it.

The **Desk** shows what needs you: poems to withdraw because they were taken elsewhere, journals to follow up with, poems coming out of their exclusive period, deadlines in the next 60 days, and a backup reminder.

## Install

1. Download **PenPal.exe** from the latest release on GitHub.
2. Put it anywhere (your Desktop, or a folder in Documents) and double-click it.
3. Windows may show a blue SmartScreen box the first time, because the app isn't signed. Click **More info**, then **Run anyway**.

It needs Windows 10 or 11 (they include the Edge WebView2 engine the window uses). Nothing is sent anywhere: Pen Pal only answers to your own computer.

### Bringing over your Poetry Tracker data

Open Pen Pal, go to **Export and backup**, choose **Restore from a backup file**, and pick `data\tracker.json` from your old Poetry Tracker folder. Everything comes across, and the new parts (rights, budget) start empty.

Or put `PenPal.exe` inside the old folder, next to its `data` folder. Pen Pal uses a `data` folder that sits beside it.

## Where your data lives

- Normally: `%APPDATA%\Pen Pal\data\tracker.json` (the **Export and backup** page shows the exact folder and has a button to open it).
- If there is a `data` folder next to `PenPal.exe`, that one is used instead.
- A copy is saved to `backups` in the same folder once a day (the last 14 are kept).
- **Second backup folder (Export and backup):** give a folder on another drive, a USB stick, or inside OneDrive or Dropbox. After every save Pen Pal copies your data there. If that folder is ever missing, saving still works and the app tells you.

## Finding journals

**Find journals** has a starter directory of 22 poetry journals, checked by hand on November 23, 2026 against each journal's own guidelines (a few details come from the publisher-supplied listings on Poets & Writers). Blank means not confirmed. Filter by open now, simultaneous submissions, no fee, pays, and reprints; one click adds a journal to yours with its reading windows already set to repeat each year.

For anything not in the directory, the buttons under the list open a search on Chill Subs or Poets & Writers. Add what you find with **Add one by hand**. The directory says when it was last checked; after six months it warns you that details may have changed. Always read a journal's guidelines before you send.

## Everyday use

1. **Poems, "Add several":** paste your titles, one per line.
2. **Find journals** or **My journals:** add places you plan to send to.
3. **Log a submission:** pick the journal and the poems. The form warns you about a closed reading period, too many poems, a journal that bans simultaneous submissions, or a fee that would go over your budget. Warnings never block you.
4. When you hear back, click **Accepted** or **Rejected**. If a poem is accepted, the Desk lists every other journal still holding it, with a note to copy and a "Mark withdrawn" button. Then open the poem's **History** and add the rights from the acceptance email.

## Follow-ups

When a submission has waited longer than usual, the Desk suggests a short status query. "Usual" means your own past answers from that journal (once there are two), otherwise the reply time you noted for the journal, otherwise 90 days. "I followed up" records the date and reminds you again 60 days later; "Snooze" hides it for 30 days.

## Import

The **Import** page takes two kinds of CSV file (save from Excel as "CSV UTF-8", or from Google Sheets with File, Download, Comma-separated values):

- **Your submission history:** one row per submission with the journal, poem titles, date sent, and what happened. Journals and titles you don't have yet are created. Rows you already have are skipped, so importing the same file twice is safe.
- **A list of journals:** name, website, reading dates, fee, poem limit, simultaneous submissions.

You match each column to a field and see every row before anything is added. Dates like 3/4/2026 are read month first. Several titles in one cell can be split with semicolons.

## Undo

**Undo** and **Redo** (top right), or Ctrl+Z and Ctrl+Y when you're not typing in a box, step back through this session's changes.

## Calendar and exports

- **Calendar:** a `.ics` file with every future open and close date, entry deadlines and reprint dates, with reminders. Open it in Outlook, Google Calendar or Apple Calendar.
- **Export and backup:** submissions and manuscript entries as CSV, an acknowledgments list of accepted poems, backup files.

## Running from source (for tinkerers)

- With Python 3.8+ and `pip install pywebview`: `python penpal.py` opens the app window. Without pywebview it opens in your browser. `start.bat` does this for you, or runs `PenPal.exe` if it's in the folder.
- `python server.py` is the plain-library server on its own (browser only).
- `build-exe.bat` builds `PenPal.exe` locally. Normally GitHub builds it: every push runs the tests, builds the exe and self-checks it on Windows. When `APP_VERSION` in server.py changes, that push also publishes a release (v2.0.0, v2.1.0, ...).
- Tests: `node --test tests/logic.test.js`, `python -m unittest tests/test_server.py`, and the optional browser test `python tests/browser_smoke.py` (needs Playwright and Chrome).

## Troubleshooting

- **The page says it could not load your data:** Pen Pal never overwrites a data file it can't read. Copy the newest file from the `backups` folder over `tracker.json`.
- **SmartScreen blocks it:** More info, then Run anyway. The app is unsigned.
- **The window is blank:** Windows 10 machines without the Edge WebView2 runtime need it from Microsoft (search "WebView2 Runtime"). Or run `PenPal.exe --browser` to use your browser.
- **The second folder says the last copy failed:** the drive may be unplugged or the folder renamed. Your data is still saved.
