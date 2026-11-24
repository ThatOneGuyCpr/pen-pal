"""Pen Pal: reading-period reminders as Windows notifications. Standard library only.

What to remind about is decided in public/logic.js (windowAlerts). This module only:
  - shows Windows notifications under Pen Pal's own name and icon,
  - remembers which reminders were already shown (reminders-sent.json, next to settings.json),
    so each one appears once even if the app and the daily check both see it,
  - adds or removes the Task Scheduler task that runs "PenPal.exe --remind" while Pen Pal is closed.

Notifications use the Windows notification API through Windows PowerShell 5.1 (it ships with
Windows 10 and 11), with Pen Pal registered under HKCU as an app that may send them. Nothing here
needs administrator rights. Reminder text holds journal names and dates only, never poem text.
"""
import datetime
import json
import os
import subprocess
import sys
import tempfile
import threading
from xml.sax.saxutils import escape, unescape

APP_ID = "ThatOneGuyCpr.PenPal"
TASK_NAME = "Pen Pal reminders"
PROTOCOL = "penpal"
SENT_NAME = "reminders-sent.json"
MAX_SEPARATE = 3  # more than this at once become one summary notification
NO_WINDOW = 0x08000000  # CREATE_NO_WINDOW: no console flashes up
LOCK = threading.Lock()

# Tests (and Linux) can point this at a file: each notification is appended as a JSON line instead of shown.
FAKE_ENV = "PENPAL_FAKE_NOTIFY"


def is_windows():
    return sys.platform.startswith("win")


def appdata_dir():
    base = os.environ.get("APPDATA") or os.path.expanduser("~")
    return os.path.join(base, "Pen Pal")


# ---------------------------------------------------------------- registration
def register_app(icon_src, exe=None):
    """Let Windows show notifications from Pen Pal, with its name and icon. Optionally make
    penpal: links open the app (so clicking a notification opens Pen Pal). Returns an error or None."""
    if not is_windows():
        return "not Windows"
    import winreg  # noqa: PLC0415

    try:
        os.makedirs(appdata_dir(), exist_ok=True)
        icon = os.path.join(appdata_dir(), "pen-pal-icon.png")
        if icon_src and os.path.isfile(icon_src):
            with open(icon_src, "rb") as f:
                data = f.read()
            old = b""
            if os.path.isfile(icon):
                with open(icon, "rb") as f:
                    old = f.read()
            if old != data:
                with open(icon, "wb") as f:
                    f.write(data)
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Classes\AppUserModelId\%s" % APP_ID) as k:
            winreg.SetValueEx(k, "DisplayName", 0, winreg.REG_EXPAND_SZ, "Pen Pal")
            if os.path.isfile(icon):
                winreg.SetValueEx(k, "IconUri", 0, winreg.REG_EXPAND_SZ, icon)
        if exe:
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Classes\%s" % PROTOCOL) as k:
                winreg.SetValueEx(k, "", 0, winreg.REG_SZ, "URL:Pen Pal")
                winreg.SetValueEx(k, "URL Protocol", 0, winreg.REG_SZ, "")
            with winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\Classes\%s\shell\open\command" % PROTOCOL) as k:
                # The link itself is ignored: it can only open Pen Pal.
                winreg.SetValueEx(k, "", 0, winreg.REG_SZ, '"%s"' % exe)
        return None
    except OSError as e:
        return str(e)


# ---------------------------------------------------------------- showing
TOAST_PS = r"""
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml($env:PENPAL_TOAST_XML)
$t = New-Object Windows.UI.Notifications.ToastNotification $x
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:PENPAL_APP_ID).Show($t)
"""


def toast_xml(title, body, clickable=True):
    launch = ' activationType="protocol" launch="%s:open"' % PROTOCOL if clickable else ""
    return ('<toast%s><visual><binding template="ToastGeneric"><text>%s</text><text>%s</text></binding></visual></toast>'
            % (launch, escape(str(title)[:200]), escape(str(body)[:600])))


def show(title, body, clickable=True):
    """Show one notification. Returns an error message, or None when Windows accepted it."""
    fake = os.environ.get(FAKE_ENV)
    if fake:
        with open(fake, "a", encoding="utf-8") as f:
            f.write(json.dumps({"title": title, "body": body}) + "\n")
        return None
    if not is_windows():
        return "Notifications are shown by the Windows app."
    env = dict(os.environ, PENPAL_TOAST_XML=toast_xml(title, body, clickable), PENPAL_APP_ID=APP_ID)
    exe = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), r"System32\WindowsPowerShell\v1.0\powershell.exe")
    try:
        r = subprocess.run([exe, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", TOAST_PS],  # noqa: S603
                           env=env, capture_output=True, text=True, timeout=30, creationflags=NO_WINDOW)
    except (OSError, subprocess.SubprocessError) as e:
        return str(e)
    if r.returncode != 0:
        return (r.stderr or r.stdout or "PowerShell exit %d" % r.returncode).strip()[:500]
    return None


# ---------------------------------------------------------------- what was already shown
def _load_sent(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            obj = json.load(f)
        return obj if isinstance(obj, dict) else {}
    except (OSError, ValueError):
        return {}


def _save_sent(path, sent):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(sent, f, indent=0, sort_keys=True)
    os.replace(tmp, path)


def _valid(a):
    return isinstance(a, dict) and all(isinstance(a.get(k), str) and a.get(k) for k in ("key", "title", "body", "date"))


def deliver(alerts, folder, today=None, show_fn=None):
    """Show the reminders not shown before, then remember them. More than MAX_SEPARATE at once
    become one summary. Returns {"shown": n, "errors": [...]}."""
    show_fn = show_fn or show
    today = today or datetime.date.today().isoformat()
    path = os.path.join(folder, SENT_NAME)
    alerts = [a for a in (alerts or []) if _valid(a)][:50]
    with LOCK:
        sent = _load_sent(path)
        new = [a for a in alerts if a["key"] not in sent]
        if not new:
            return {"shown": 0, "errors": []}
        if len(new) > MAX_SEPARATE:
            names = sorted({a.get("name") or a["title"] for a in new})
            batches = [("%d reading periods are coming up" % len(new), ", ".join(names[:8]) + (" and more" if len(names) > 8 else "") + ". Open Pen Pal to see the dates.")]
        else:
            batches = [(a["title"], a["body"]) for a in new]
        errors = [e for e in (show_fn(t, b) for t, b in batches) if e]
        if len(errors) < len(batches):  # at least one got through: count them all as shown
            for a in new:
                sent[a["key"]] = a["date"]
        # forget reminders for dates that have passed
        sent = {k: v for k, v in sent.items() if isinstance(v, str) and v >= today}
        try:
            os.makedirs(folder, exist_ok=True)
            _save_sent(path, sent)
        except OSError as e:
            errors.append("Could not remember shown reminders: %s" % e)
        return {"shown": len(new) if len(errors) < len(batches) else 0, "errors": errors}


# ---------------------------------------------------------------- the daily check while Pen Pal is closed
def task_xml(exe, user=None, hour=9):
    """Task Scheduler definition: run "PenPal.exe --remind" when you sign in and every day at 9 AM,
    as you, only while you are signed in, catching up if the PC was off at 9."""
    user = user or "%s\\%s" % (os.environ.get("USERDOMAIN", ""), os.environ.get("USERNAME", ""))
    start = datetime.date.today().isoformat() + "T%02d:00:00" % hour
    return """<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Pen Pal: reminders before your journals' reading periods open and close. Turn off in Pen Pal, Settings.</Description></RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>{user}</UserId><Delay>PT1M</Delay></LogonTrigger>
    <CalendarTrigger><StartBoundary>{start}</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>{user}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT5M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author"><Exec><Command>{exe}</Command><Arguments>--remind</Arguments></Exec></Actions>
</Task>
""".format(user=escape(user), start=start, exe=escape(exe))


def _schtasks(*args):
    exe = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), r"System32\schtasks.exe")
    return subprocess.run([exe, *args], capture_output=True, text=True, timeout=30, creationflags=NO_WINDOW)  # noqa: S603


def add_task(exe, name=TASK_NAME):
    """Create or replace the task. Returns an error message or None."""
    if not is_windows():
        return "not Windows"
    fd, path = tempfile.mkstemp(suffix=".xml")
    os.close(fd)
    try:
        with open(path, "w", encoding="utf-16") as f:
            f.write(task_xml(exe))
        r = _schtasks("/Create", "/TN", name, "/XML", path, "/F")
        return None if r.returncode == 0 else (r.stderr or r.stdout).strip()[:500]
    except (OSError, subprocess.SubprocessError) as e:
        return str(e)
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def task_command(name=TASK_NAME):
    """The program the task runs, or None when there is no such task."""
    if not is_windows():
        return None
    try:
        r = _schtasks("/Query", "/TN", name, "/XML")
    except (OSError, subprocess.SubprocessError):
        return None
    if r.returncode != 0:
        return None
    import re  # noqa: PLC0415

    m = re.search(r"<Command>(.*?)</Command>", r.stdout, re.S)
    return unescape(m.group(1).strip()) if m else ""


def remove_task(name=TASK_NAME):
    if not is_windows() or task_command(name) is None:
        return None
    try:
        r = _schtasks("/Delete", "/TN", name, "/F")
        return None if r.returncode == 0 else (r.stderr or r.stdout).strip()[:500]
    except (OSError, subprocess.SubprocessError) as e:
        return str(e)
