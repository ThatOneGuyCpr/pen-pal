@echo off
cd /d "%~dp0"
title Build PenPal.exe
echo This builds PenPal.exe into this folder. It needs Python on this computer once.
echo (You usually do not need this: each release on GitHub already has PenPal.exe.)
echo.

set PY=
where py >nul 2>nul
if %errorlevel%==0 set PY=py -3
if "%PY%"=="" (
  where python >nul 2>nul
  if %errorlevel%==0 set PY=python
)
if "%PY%"=="" goto :nopython

%PY% -m pip install --user --upgrade pywebview pyinstaller
if errorlevel 1 goto :fail
%PY% -m PyInstaller --noconfirm --onefile --windowed --name PenPal --icon "%CD%\assets\penpal.ico" --add-data "%CD%\public;public" --distpath . --workpath build --specpath build penpal.py
if errorlevel 1 goto :fail
if exist build rmdir /s /q build

PenPal.exe --check check.txt
type check.txt
del check.txt

echo.
echo Done. PenPal.exe is in this folder. Because there is a data folder next to it, it uses that folder for your data.
echo If Windows SmartScreen warns about it, choose More info, then Run anyway. That is normal for a program you built yourself.
pause
exit /b 0

:nopython
echo Python was not found. Install it from https://www.python.org/downloads/ and run this again.
pause
exit /b 1

:fail
echo Something went wrong while building. The messages above say what.
pause
exit /b 1
