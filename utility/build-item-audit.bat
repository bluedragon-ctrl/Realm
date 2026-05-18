@echo off
setlocal
cd /d "%~dp0\.."
echo Building item audit...
node utility\build-item-audit.js
if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
)
echo Done. Opening item-audit.html...
start item-audit.html
