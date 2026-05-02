@echo off
setlocal
cd /d "%~dp0"

if not exist node_modules (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo npm install failed.
        pause
        exit /b 1
    )
)

if "%PORT%"=="" set PORT=8080

echo Starting Realm on port %PORT%...
node server.js

pause
