#!/usr/bin/env bash
set -e

echo "========================================================"
echo "      VEXA (Virtual Execution & X-Layer Architect)"
echo "                  v2.0 Production Launcher"
echo "========================================================"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 1. Environment configuration
if [ ! -f .env ] && [ -f .env.example ]; then
    echo "[INFO] Creating .env from .env.example..."
    cp .env.example .env
fi

# 2. Start Backend Engine
echo "[1/3] Starting VEXA Backend Engine on port 8765..."
python3 -m uvicorn backend.main:app --host 127.0.0.1 --port 8765 &
BACKEND_PID=$!

trap "kill $BACKEND_PID 2>/dev/null || true" EXIT

sleep 2

# 3. Frontend Setup
cd overlay
if [ ! -d node_modules ]; then
    echo "[2/3] Installing overlay frontend dependencies (npm install)..."
    npm install
fi

# 4. Launch Overlay
echo "[3/3] Launching VEXA Transparent Overlay..."
if command -v cargo &> /dev/null; then
    npm run tauri dev
else
    echo "[WARN] Cargo not detected. Running web dev server on port 3000..."
    npm run dev
fi
