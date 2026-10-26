# Project Specification: VEXA (Virtual Execution & X-Layer Architect) — v2.0 Production Spec

## 1. System Overview
VEXA is an ultra-lightweight (<35MB RAM idle) always-on-top transparent screen overlay agent. It sees the user's screen, controls the OS mouse/keyboard, renders interactive system architecture diagrams (Mermaid.js), remembers user workflows in SQLite, and executes multi-file coding tasks in local repositories. It runs strictly on the **Google AI Studio Free Tier API (`gemini-2.5-flash`)** using the official `google-genai` SDK.

## 2. Hard Engineering Rules (CRITICAL — DO NOT VIOLATE)
1. **Windows High-DPI Scaling Fix:**
   - At the very top of `backend/main.py` and `backend/tools/gui_control.py`, execute:
     ```python
     import sys, ctypes
     if sys.platform == "win32":
         try: ctypes.windll.shcore.SetProcessDpiAwareness(2)
         except Exception: pass
     ```
   - This guarantees `mss` screen capture dimensions and `pyautogui` click coordinates map 1:1 on 125%/150% scaled displays.
2. **Solving the Click-Through "Mouse Trap":**
   - When `window.set_ignore_cursor_events(true)` is active, the WebView cannot detect DOM `onMouseEnter` events.
   - Solve this in TWO ways inside `src-tauri/src/main.rs`:
     - **Method A (Global Shortcut):** Pressing `Alt+Space` toggles interactive mode (`set_ignore_cursor_events(false)` + focuses window) and emits a `"vexa-toggle-focus"` event to the frontend.
     - **Method B (Rust Cursor Bounding-Box Watcher):** Spawn a lightweight background thread in Rust (sleeping 50ms per tick = 0% CPU) that checks the physical cursor position against the HUD interactive rectangle updated by the frontend (`update_hud_bounds(x, y, width, height)`). If the cursor enters the HUD box, automatically call `set_ignore_cursor_events(false)`; when it leaves (and the command input is not actively focused), call `set_ignore_cursor_events(true)`.
3. **Tauri v2 Capabilities Security Model:**
   - Do NOT use Tauri v1 `allowlist` in `tauri.conf.json`.
   - Create `overlay/src-tauri/capabilities/default.json` granting `core:default`, `core:window:default`, `core:window:allow-set-ignore-cursor-events`, `core:event:default`, and `global-shortcut:default`.
4. **Google AI Studio Free Tier Compliance:**
   - Use `google-genai` SDK (`from google import genai`).
   - Support primary model `gemini-2.5-flash` with automatic fallback to `gemini-2.5-flash-lite` if daily quota (`429`) is exhausted.
   - Enforce a strict async `FreeTierRateLimiter` (`10 RPM`, 6.0s minimum spacing between calls).
   - Use **Action Batching** (1 to 5 steps per response) + **Closed-Loop Verification** (max 3 perception-action cycles per user goal; stop early as soon as `action_type == "done"`).

## 3. Monorepo Directory Structure
```text
vexa-os/
├── .env.example                  # GEMINI_API_KEY="your_key_here", DEFAULT_WORKSPACE_PATH="C:/projects"
├── start_vexa.bat                # Windows launcher (starts FastAPI sidecar + Tauri dev/build)
├── start_vexa.sh                 # Linux/macOS launcher
├── backend/                      # Python 3.11+ FastAPI Engine (Port 8765)
│   ├── requirements.txt
│   ├── main.py                   # DPI awareness init, FastAPI app, CORS, WebSocket `/ws/status`, REST endpoints
│   ├── config.py                 # Env loader, model fallback config, FreeTierRateLimiter
│   ├── schemas.py                # Pydantic v2 structured output schemas (`VexaAction`, `VexaPlan`)
│   ├── memory/
│   │   └── db.py                 # SQLite (`vexa_memory.db`) storing saved project paths, custom macros, & last 10 tasks
│   ├── core/
│   │   ├── router.py             # Zero-API local reflex router (ports, apps, git status, saved SQLite macros)
│   │   └── orchestrator.py       # Closed-loop Observe -> Plan -> Act -> Verify engine (max 3 loops)
│   ├── perception/
│   │   ├── vision.py             # mss screen grabber -> 1280x720 WebP compressor + optional Set-of-Marks grid overlay
│   │   └── context.py            # Active window title, selected/clipboard text, and current workspace git tree
│   └── tools/
│       ├── gui_control.py        # PyAutoGUI human-like movement, normalized 0-1000 scaling, FailSafe
│       ├── workspace_coder.py    # Safe file read/write/patch, diff generator, async subprocess terminal runner
│       └── architect.py          # Mermaid.js diagram generator + boilerplate code scaffolder
└── overlay/                      # Tauri v2 + Next.js 15 (Static Export) + Tailwind CSS + Lucide Icons
    ├── package.json
    ├── next.config.mjs           # output: 'export', images: { unoptimized: true }
    ├── src/
    │   ├── app/
    │   │   ├── layout.tsx        # Transparent body/html (`bg-transparent overflow-hidden select-none`)
    │   │   └── page.tsx          # Main HUD manager, WebSocket client, bounding-box reporter
    │   └── components/
    │       ├── CommandBar.tsx    # Floating top-center pill, input box, live step badge, Abort button
    │       ├── MermaidCanvas.tsx # Draggable/collapsible system architecture viewer + "Scaffold to Repo" button
    │       └── ApprovalToast.tsx # High-priority confirmation modal for destructive actions
    └── src-tauri/
        ├── Cargo.toml            # tauri v2, tauri-plugin-global-shortcut, device_query (or winapi cursor pos)
        ├── tauri.conf.json       # Tauri v2 schema: transparent, decorations: false, alwaysOnTop: true, fullscreen: true
        ├── capabilities/
        │   └── default.json      # Tauri v2 ACL permissions
        └── src/
            └── main.rs           # Global shortcut (`Alt+Space`), `set_ignore_cursor`, `update_hud_bounds` watcher