@echo off
setlocal
cd /d "%~dp0\.."

if "%PORT%"=="" set PORT=8081

if not exist node_modules (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo npm install failed.
        pause
        exit /b 1
    )
)

echo ============================================
echo   Realm NPC Editor
echo   Server port: %PORT%
echo   Editor URL:  http://localhost:%PORT%/admin/npc-editor
echo ============================================
echo.
echo Starting dev server in a new window...
start "Realm dev server" cmd /k "cd /d %CD% && set PORT=%PORT% && node server.js"

echo Waiting for server to come up...
timeout /t 3 /nobreak >nul

echo Opening editor in default browser...
start http://localhost:%PORT%/admin/npc-editor

endlocal
