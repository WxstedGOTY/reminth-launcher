@echo off
rem The owner's LIVE preview of the newest Reminth code (see live-hook.js). Its data lives in
rem %USERPROFILE%\Downloads\reminth-live-preview - the real Reminth and its data are never touched.
rem The first time, it copies the small files Home's stats need (world stats, server stats, servers, settings).
setlocal
set "REPO=%~dp0..\.."
set "LIVE=%USERPROFILE%\Downloads\reminth-live-preview"
set "REAL=%APPDATA%\Reminth"
set "FAKE=%LIVE%\home\AppData\Roaming\Reminth"
if not exist "%FAKE%\instance\game" (
  mkdir "%FAKE%\instance\game" >nul 2>&1
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0live-copy.ps1" -Real "%REAL%" -Fake "%FAKE%"
)
set "USERPROFILE=%LIVE%\home"
set "PREVIEW_PROFILE=%LIVE%\profile"
cd /d "%REPO%"
start "" "%REPO%\node_modules\electron\dist\electron.exe" -r ./tools/preview/live-hook.js . --remote-debugging-port=9440
endlocal
