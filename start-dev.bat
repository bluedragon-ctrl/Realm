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

if "%PORT%"=="" set PORT=8081

for /f "tokens=*" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set BRANCH=%%b
if "%BRANCH%"=="" set BRANCH=(no git)

echo ============================================
echo   Realm DEV server
echo   Branch: %BRANCH%
echo   Port:   %PORT%
echo   URL:    http://localhost:%PORT%
echo ============================================

node server.js

pause
