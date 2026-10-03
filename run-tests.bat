@echo off
cd /d "%~dp0"
call npm test > npm-test-latest.txt 2>&1
echo exit code %errorlevel% >> npm-test-latest.txt
exit
