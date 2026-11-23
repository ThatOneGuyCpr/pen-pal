@echo off
cd /d "%~dp0"
title Pen Pal

rem Runs Pen Pal from this folder. If PenPal.exe is here, it uses that (no Python needed).
if exist "PenPal.exe" (
  start "" "PenPal.exe"
  exit /b 0
)

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 penpal.py
  goto :done
)
where python >nul 2>nul
if %errorlevel%==0 (
  python penpal.py
  goto :done
)

echo Python was not found on this computer.
echo The easiest fix is to download PenPal.exe from the Releases page and put it in this folder.
where winget >nul 2>nul
if not %errorlevel%==0 goto :manual
echo.
choice /c YN /m "Or install Python now using the Windows Package Manager, about 30 MB"
if errorlevel 2 goto :manual
winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
echo.
echo When the install has finished, close this window and double-click start.bat again.
pause
exit /b 0

:manual
echo Or install Python from https://www.python.org/downloads/ ^(tick "Add python.exe to PATH"^), then double-click start.bat again.
pause
exit /b 1

:done
if errorlevel 1 pause
