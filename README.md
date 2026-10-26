# VEXA (Virtual Execution & X-Layer Architect) — v2.0

> **Ultra-lightweight (<35MB RAM idle), always-on-top transparent screen overlay agent for Windows.**  
> Powered by the official Google AI Studio Free Tier (`gemini-2.5-flash`), local SQLite memory, Zero-API reflexes, and Tauri v2.

---

## 🚀 Key Architectural Pillars

### 1. Windows High-DPI Scaling Fix
- Integrated `ctypes.windll.shcore.SetProcessDpiAwareness(2)` at the very top of `backend/main.py` and `backend/tools/gui_control.py`.
- Solves coordinate drift on Windows 125%/150% scaled displays so `mss` screen captures and `pyautogui` clicks align 1:1 with 100% precision.

### 2. Click-Through HUD & Cursor Bounds (`overlay/src-tauri/`)
- **Tauri v2 Architecture:** Configured via `tauri.conf.json` and `capabilities/default.json` with strict security permissions.
- **Method A (Global Shortcut):** Press `Alt+Space` to toggle between click-through and interactive HUD focus anytime.
- **Method B (Rust Cursor Watcher):** A lightweight background thread polls the cursor position every 50ms (0% CPU). When the cursor enters the top-center HUD rectangle reported by `update_hud_bounds(x, y, w, h)`, `set_ignore_cursor_events(false)` is automatically called. When leaving, click-through mode is restored.

### 3. Google AI Studio Free Tier Resilience (`backend/config.py` & `orchestrator.py`)
- Official `google-genai` SDK (`from google import genai`).
- Enforces a 10 RPM token bucket rate limiter with a 6.0s minimum spacing between calls.
- Automatic graceful fallback from `gemini-2.5-flash` to `gemini-2.5-flash-lite` if `429 Quota Exceeded` persists after exponential backoff.
- Closed-loop `Observe -> Plan -> Execute -> Verify` cycle with up to 3 iterations for multi-step GUI and workspace tasks, stopping early the moment `goal_achieved == True` or `action_type == "done"`.

### 4. SQLite Local Memory (`backend/memory/db.py`)
- Automatically initializes `vexa_memory.db` on startup.
- Stores:
  - **Project Paths:** Register aliases for local folders (`register project myapp C:/path/to/code`).
  - **Reusable Macros:** Custom action sequences stored locally (`macro:git-status`, `macro:find-ports`).
  - **Task History:** Persistent record of recent tasks, steps, and execution results.
- **Zero-API Reflex Router (`backend/core/router.py`):** Instantly resolves deterministic tasks (`git status`, dev port scans, macro executions, project lookups) locally without burning API quota.

### 5. Pre-Click Overlay Ghosting
- Before any physical `pyautogui` click, the backend sends a `"pre_click_hide"` event over WebSocket `/ws/status`.
- The overlay instantly becomes transparent and click-through for 150ms, preventing the overlay from clicking on itself.

---

## 📁 Repository Structure

```text
VEXA/
├── .env                          # Local environment variables
├── .env.example                  # Environment configuration template
├── .gitignore                    # Git exclusions
├── README.md                     # Complete documentation
├── SPEC.md                       # v2.0 Production Specification
├── start_vexa.bat                # Windows CMD launcher
├── start_vexa.ps1                # Windows PowerShell launcher
├── start_vexa.sh                 # Linux/macOS launcher
├── tests/
│   └── test_backend.py           # Automated test suite (100% passing)
├── backend/                      # Python 3.11+ FastAPI Server (Port 8765)
│   ├── requirements.txt
│   ├── main.py                   # DPI fix, FastAPI app, WebSocket /ws/status, REST endpoints
│   ├── config.py                 # FreeTierRateLimiter (10 RPM), Gemini model fallback
│   ├── schemas.py                # Pydantic v2 structured output schemas (VexaAction, VexaPlan)
│   ├── memory/
│   │   └── db.py                 # SQLite vexa_memory.db manager
│   ├── core/
│   │   ├── router.py             # Zero-API local reflex router
│   │   └── orchestrator.py       # Closed-loop Observe -> Plan -> Execute -> Verify engine
│   ├── perception/
│   │   ├── vision.py             # Screen capture, WebP compression, 10x10 normalized grid
│   │   └── context.py            # Active window title, clipboard, workspace git status
│   └── tools/
│       ├── gui_control.py        # PyAutoGUI control, coordinate mapping, pre-click ghosting
│       ├── workspace_coder.py    # Safe file read/write/patch, diff generator, terminal runner
│       └── architect.py          # Mermaid.js diagram processor and code scaffolder
└── overlay/                      # Tauri v2 + Next.js 15 + Tailwind CSS + Lucide Icons
    ├── package.json
    ├── next.config.mjs           # Static export (output: 'export')
    ├── tailwind.config.ts        # Glassmorphism & neon palette
    ├── src/
    │   ├── app/
    │   │   ├── globals.css       # Transparent window base & HUD styling
    │   │   ├── layout.tsx        # Root transparent layout
    │   │   └── page.tsx          # Main HUD manager & WebSocket client
    │   └── components/
    │       ├── CommandBar.tsx    # Floating top-center pill, bounds reporter, shortcut handler
    │       ├── MermaidCanvas.tsx # Draggable Mermaid blueprint viewer & repo scaffolder
    │       └── ApprovalToast.tsx # Destructive action confirmation modal
    └── src-tauri/
        ├── Cargo.toml            # Tauri v2, device_query, global-shortcut plugin
        ├── build.rs
        ├── tauri.conf.json       # Transparent fullscreen overlay configuration
        ├── capabilities/
        │   └── default.json      # Tauri v2 security ACL
        └── src/
            ├── lib.rs            # Background cursor watcher loop & Alt+Space handler
            └── main.rs           # Tauri entrypoint calling vexa_overlay_lib::run()
```

---

## ⚡ Quickstart Guide

### 1. Configure Your API Key
Get your free API key from [Google AI Studio](https://aistudio.google.com/).
Open `.env` (or copy `.env.example` to `.env`) and add your key:
```env
GEMINI_API_KEY="AIzaSy..."
DEFAULT_WORKSPACE_PATH="d:/Projects/VEXA"
```

### 2. Run with One Click

#### Option A: PowerShell (Recommended)
```powershell
.\start_vexa.ps1
```

#### Option B: Windows CMD / Batch
```cmd
start_vexa.bat
```

#### Option C: Manual Run (Two Terminals)
**Terminal 1 (Backend):**
```powershell
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8765 --reload
```

**Terminal 2 (Overlay Frontend):**
```powershell
cd overlay
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🦀 Native Tauri Desktop Overlay & Rust Compilation

The overlay can run in two modes:
1. **Web Dev HUD Mode (`npm run dev`):** Runs instantly on `http://localhost:3000` with WebSocket connection to the backend.
2. **Native Transparent Desktop Window (`npm run tauri dev`):**
   - Rust and Cargo are installed on this machine (`cargo 1.99.1`).
   - For compiling native Windows Tauri binaries, Tauri requires Microsoft Visual Studio C++ Build Tools (`link.exe` / MSVC).
   - If not already installed, install the MSVC build tools with:
     ```cmd
     winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
     ```
   - Once installed, run:
     ```powershell
     cd overlay
     npm run tauri dev
     ```

---

## 🕹️ Using VEXA

- **Toggle HUD Focus:** Press `Alt+Space` anytime.
- **Quick Local Reflexes (Zero API cost):**
  - Type `git status` -> Instant local branch & working tree report.
  - Type `active ports` -> Scans active dev ports (3000, 5173, 8000, 8765).
  - Type `register project <name> <path>` -> Maps a project folder alias in SQLite.
  - Type `list projects` -> Lists all saved projects.
  - Type `macro:<trigger>` -> Executes stored macro sequence.
- **Architecture Blueprints:**
  - Ask: *"Draw an architecture diagram of VEXA"* -> Renders an interactive, draggable Mermaid.js canvas with zoom controls and a **"Scaffold to Repo"** button.
- **Autonomous GUI & Code Tasks:**
  - Type: *"Inspect the workspace and create a hello world script"* -> VEXA observes, plans, writes the file, tests execution, and verifies the outcome.

---

## 🧪 Automated Backend Tests

Run the complete backend test suite:
```powershell
python tests/test_backend.py
```
Output:
```text
==================================================
    RUNNING VEXA BACKEND PRODUCTION TEST SUITE   
==================================================
[PASS] test_db_operations passed
[PASS] test_gui_math passed
[PASS] test_workspace_coder_and_diff passed
[PASS] test_architect_mermaid passed
[PASS] test_vision_capture passed
[PASS] test_perception_context passed
[PASS] test_zero_api_reflex passed
[PASS] test_fastapi_endpoints passed
==================================================
   ALL TESTS PASSED WITH 100% SUCCESS! (0 ERRORS) 
==================================================
```
