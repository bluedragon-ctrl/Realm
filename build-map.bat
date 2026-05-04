@echo off
setlocal
cd /d "%~dp0"
echo Building map...
node build-map.js
if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
)
echo Done. Opening map.html...
start map.html
