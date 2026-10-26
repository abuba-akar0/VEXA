# VEXA PowerShell Launcher
$Host.UI.RawUI.WindowTitle = "VEXA Desktop Launcher"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "      VEXA (Virtual Execution & X-Layer Architect)      " -ForegroundColor Cyan
Write-Host "                  v2.0 Production Launcher              " -ForegroundColor DarkCyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# Refresh PATH to include Rust / Cargo if installed
$CargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if ((Test-Path $CargoBin) -and ($env:Path -notlike "*$CargoBin*")) {
    $env:Path = "$CargoBin;$env:Path"
}

# 1. Check Python
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Python is not installed or not in PATH." -ForegroundColor Red
    pause
    exit 1
}

# 2. Check Node.js
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js / npm is not installed or not in PATH." -ForegroundColor Red
    pause
    exit 1
}

# 3. Prepare .env
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Write-Host "[INFO] Creating .env from .env.example..." -ForegroundColor Yellow
        Copy-Item ".env.example" ".env"
    }
}

# 4. Start Backend Server in a new window
Write-Host "[1/3] Starting VEXA Backend Engine on port 8765..." -ForegroundColor Green
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-Command", "python -m uvicorn backend.main:app --host 127.0.0.1 --port 8765 --reload"

Start-Sleep -Seconds 2

# 5. Prepare Overlay Dependencies
Set-Location (Join-Path $ScriptDir "overlay")
if (-not (Test-Path "node_modules")) {
    Write-Host "[2/3] Installing overlay frontend dependencies (npm install)..." -ForegroundColor Yellow
    npm install
}

# 6. Launch Overlay UI
Write-Host "[3/3] Launching VEXA Overlay..." -ForegroundColor Green
Write-Host "[INFO] Press Alt+Space at any time to toggle HUD interaction focus." -ForegroundColor Cyan
Write-Host ""

$NativeExe = Join-Path $ScriptDir "overlay\src-tauri\target\debug\vexa-overlay.exe"
if (Test-Path $NativeExe) {
    Write-Host "[INFO] Compiled native Tauri desktop binary detected: $NativeExe" -ForegroundColor Green
    Write-Host "[INFO] Starting HUD server on http://localhost:3000..." -ForegroundColor Cyan
    Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-Command", "npm run dev"
    Start-Sleep -Seconds 2
    Write-Host "[INFO] Launching native VEXA transparent overlay window..." -ForegroundColor Green
    Start-Process -FilePath $NativeExe
    exit 0
}

# Check if MSVC C++ Linker is installed for native Tauri compilation
if (Get-Command cl -ErrorAction SilentlyContinue) {
    Write-Host "[INFO] C++ Build Tools detected. Launching Tauri native overlay..." -ForegroundColor Green
    npm run tauri dev
} else {
    Write-Host "[INFO] Launching VEXA Web Overlay on http://localhost:3000..." -ForegroundColor Green
    Start-Process "http://localhost:3000"
    npm run dev
}
