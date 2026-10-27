@echo off
setlocal

title VEXA Desktop Launcher
echo ========================================================
echo       VEXA - Virtual Execution and X-Layer Architect
echo                   v2.0 Production Launcher
echo ========================================================
echo.

if exist "%USERPROFILE%\.cargo\bin" (
    set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
)
cd /d "%~dp0"

:: 1. Check Python
where python >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Python is not installed or not in PATH.
    pause
    exit /b 1
)

:: 2. Check Node.js
where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    pause
    exit /b 1
)

:: 3. Prepare Environment
if not exist ".env" (
    if exist ".env.example" (
        echo [INFO] Creating .env from .env.example
        copy ".env.example" ".env" >nul
    )
)

:: 4. Start Backend Server (runs minimized in background)
netstat -ano | findstr :8765 >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [1/3] Starting VEXA Backend Engine on port 8765...
    start /min "VEXA Backend" python -m uvicorn backend.main:app --host 127.0.0.1 --port 8765
    powershell -NoProfile -Command "Start-Sleep -Seconds 2"
) else (
    echo [1/3] VEXA Backend Engine is already active on port 8765.
)

:: 5. Prepare Overlay Dependencies
cd overlay
if not exist "node_modules" (
    echo [2/3] Installing overlay frontend dependencies...
    call npm install
)

:: 6. Launch Overlay UI
echo [3/3] Launching VEXA Desktop Overlay...
echo [INFO] Press Alt+Space at any time to toggle HUD interaction focus.
echo.

if exist "src-tauri\target\debug\vexa-overlay.exe" (
    echo [INFO] Compiled native Tauri desktop binary detected!
    netstat -ano | findstr :3000 >nul 2>nul
    if %ERRORLEVEL% neq 0 (
        echo [INFO] Starting HUD server on http://localhost:3000...
        start /min "VEXA HUD Server" cmd /c "npm run dev"
        powershell -NoProfile -Command "Start-Sleep -Seconds 2"
    )
    echo [INFO] Launching native transparent desktop overlay...
    start "" "src-tauri\target\debug\vexa-overlay.exe"
    exit /b 0
)

where cl >nul 2>nul
if %ERRORLEVEL% equ 0 goto :launch_tauri

:launch_web
echo [INFO] Launching VEXA Web Overlay on http://localhost:3000...
start http://localhost:3000
call npm run dev
goto :end

:launch_tauri
echo [INFO] C++ Build Tools detected. Launching Tauri native overlay...
call npm run tauri dev
goto :end

:end
pause
