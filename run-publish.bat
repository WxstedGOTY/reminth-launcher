@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "publish.ps1" > publish-log.txt 2>&1
exit
