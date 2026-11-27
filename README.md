# Pen Pal

A private poetry submission tracker that runs on your own Windows PC, in its own window. It keeps track of:

- **Poems:** titles, status and notes. Never the poems themselves.
- **Journals:** reading periods (including ones that repeat every year or open twice a year), fees, poem limits, simultaneous submissions, pay, reprints.
- **Submissions:** which poems went where, when, and what happened.
- **Manuscripts:** a chapbook or book, the poems in it, and every press or contest you enter it in.
- **Rights:** what a journal took, when the poem is free to go out again, and the credit line to use.
- **Reminders:** ring the bell on a journal for a Windows notification a few days before its reading period opens and before it closes, even when Pen Pal is closed.
- **Fees:** a monthly budget, with a warning before a fee goes over it. Change the amount any time; earlier months keep what they had.

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

**Find journals** has a directory of 93 poetry journals, each checked by hand against its own guidelines or submission page (each entry shows the date). Blank means not confirmed. Focus tags (Black writers, the South, Florida, narrative, formal verse and so on) appear only where a journal says so itself. Filter by when it's open, fee, pay per poem, reply time, print or online, simultaneous submissions, reprints and focus; sort by closing date, reply time, pay or fee; save searches (they sync with your data). "For a poem" shows only journals that could take that poem. One click adds a journal with its reading windows set to repeat each year.

The directory updates itself: Pen Pal checks GitHub for a newer list once a day, or when you press **Check for new journals**. Your own journals are never changed without asking; when the directory has newer details for one, Find journals shows yours and theirs side by side.

For anything not in the directory, **Add from a link** reads a journal's guidelines page (or pasted text) and fills in the journal form for you to check. The buttons under the list open a search on Chill Subs or Poets & Writers. Always read a journal's guidelines before you send.

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

## Using Pen Pal on two computers

Keep your data in a folder your cloud service syncs, like iCloud Drive:

1. On the computer that has your data: Settings, Your data, **Keep it in iCloud Drive or another synced folder**. Pick (or type) a folder such as `iCloudDrive\Pen Pal` and choose **Move my data here**.
2. Wait for iCloud to upload it.
3. On the other computer: install Pen Pal, go to the same place, pick the same folder, and choose **Use that data**.

Both computers now read and write the same file. When one saves, the other picks it up within a few seconds. If both change things before iCloud catches up, Pen Pal tells you and lets you choose which version to keep; the other goes to that PC's backups folder. Settings, logs and daily backups stay on each computer.

Tip: in File Explorer, right-click the Pen Pal folder in iCloud Drive and choose **Always keep on this device**, so the file is there even when you're offline.

To stop syncing, choose **Move back to this PC**.

## Pen Pal for iPhone

The iPhone app uses the same file as your PCs, through iCloud Drive. Set up the PC side first (Using Pen Pal on two computers, above), so your data is in a folder like `iCloudDrive\Pen Pal`.

1. On your iPhone, open the latest "Pen Pal for iPhone" release on the GitHub releases page and download `PenPal.ipa`.
2. Open it in LiveContainer (share it to LiveContainer, or use its + button). SideStore works too, but counts against the free account's three apps.
3. In LiveContainer, long-press Pen Pal, open Settings, and turn on **Fix File Picker & Local Notification**. Leave the legacy file picker fix off: it copies files instead of opening them.
4. Open Pen Pal, choose the Pen Pal folder in iCloud Drive, and allow notifications.

It has the Desk, your journals with their reminder bells, the journal directory, poems, and what you've sent, with the same rules as the Windows app (it runs the same `logic.js`). Manuscripts, import and export, insights and the fee budget settings are on the Windows app only, for now. Widgets would need a paid Apple developer account.

## Settings

The last item in the sidebar. It has:

- **Theme:** match Windows, light, or dark.
- **Title bar:** Pen Pal's own bar (the default), or the standard Windows one. The standard one keeps Windows' Snap layouts (hover the maximize button) and Win+arrow snapping; a custom bar can't offer those. The change applies the next time you open Pen Pal. With Pen Pal's bar, drag the name area to move the window, double-click it to maximize, and drag any edge to resize.
- **Reminders:** how many days to wait before suggesting a follow-up (when Pen Pal doesn't know a journal's usual reply time), and how far ahead the Desk lists deadlines.
- **Updates:** see below.
- **Your data:** where it's saved, with a button to open the folder.

## Updates

Settings has **Check for updates**, and Pen Pal also checks on its own when it opens (turn that off in Settings). When a new version is out, the Desk says so. **Download and install** fetches the new `PenPal.exe` from this project's GitHub releases. It checks that the file is the published size and matches the sha256 fingerprint GitHub lists for it. Then **Restart and update** swaps it in and reopens Pen Pal. Your data isn't touched. Only the program file changes.

Pen Pal needs to be able to write to the folder `PenPal.exe` sits in (your Desktop or Documents is fine; Program Files is not). If it can't, it links you to the releases page instead.

## Undo

**Undo** and **Redo** (top right), or Ctrl+Z and Ctrl+Y when you're not typing in a box, step back through this session's changes.

## Calendar and exports

- **Calendar:** a `.ics` file with every future open and close date, entry deadlines and reprint dates, with reminders. Open it in Outlook, Google Calendar or Apple Calendar.
- **Export and backup:** submissions and manuscript entries as CSV, an acknowledgments list of accepted poems, backup files.

## Running from source (for tinkerers)

- With Python 3.8+ and `pip install pywebview`: `python penpal.py` opens the app window. Without pywebview it opens in your browser. `start.bat` does this for you, or runs `PenPal.exe` if it's in the folder.
- `python server.py` is the plain-library server on its own (browser only).
- `build-exe.bat` builds `PenPal.exe` locally. Pen Pal's own title bar needs pywebview 5 or newer (frameless windows with drag regions). Normally GitHub builds it: every push runs the tests, builds the exe and self-checks it on Windows. When `APP_VERSION` in server.py changes, that push also publishes a release (v2.0.0, v2.1.0, ...).
- Tests: `node --test tests/logic.test.js`, `python -m unittest discover -s tests -p "test_*.py"` (server and updater), and the optional browser test `python tests/browser_smoke.py` (needs Playwright and Chrome).

## Troubleshooting

- **The page says it could not load your data:** Pen Pal never overwrites a data file it can't read. Copy the newest file from the `backups` folder over `tracker.json`.
- **SmartScreen blocks it:** More info, then Run anyway. The app is unsigned.
- **The window is blank:** Windows 10 machines without the Edge WebView2 runtime need it from Microsoft (search "WebView2 Runtime"). Or run `PenPal.exe --browser` to use your browser.
- **Pen Pal says your data folder isn't available:** the synced folder (or its tracker.json) wasn't there when Pen Pal started. Make sure iCloud (or your cloud app) is running and signed in, wait for it to finish syncing, then open Pen Pal again. Pen Pal won't start an empty file there, so your data can't be split in two.
- **Pen Pal crashed or froze:** open the data folder (Settings, Your data) and look at `pen-pal-log.txt` (this run) and `pen-pal-log.prev.txt` (the run before). They hold start-up details and errors, never poem text. Send them along with a description of what happened.
- **Reminders don't show up:** Settings, Reading period reminders, Send a test notification. If nothing appears, open Windows Settings, System, Notifications, and make sure Pen Pal is allowed (and Do not disturb is off). The daily check while Pen Pal is closed is a Task Scheduler task called "Pen Pal reminders"; it is removed when you turn the option off or ring off every bell. If you delete Pen Pal, turn reminders off first, or delete that task in Task Scheduler.
- **The update says it can't install:** move `PenPal.exe` somewhere you can write to (Desktop, Documents), or download the new version from the releases page.
- **You'd rather have Windows' own title bar:** Settings, Title bar, Standard Windows title bar, then reopen Pen Pal. (Since 2.5, Pen Pal's title bar snaps and resizes like any Windows window too.)
- **The second folder says the last copy failed:** the drive may be unplugged or the folder renamed. Your data is still saved.
