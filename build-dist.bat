@echo off
cd /d "%~dp0"
echo Building Reminth installer (npm run dist)...
npm run dist
echo.
echo ============================================
echo BUILD FINISHED - check output above for errors.
echo Installer (if successful) is in the dist\ folder.
echo ============================================
pause
