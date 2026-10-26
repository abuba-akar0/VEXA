import sys
import ctypes
import os
import json
import asyncio
from typing import List, Dict, Any
from contextlib import asynccontextmanager

# CRITICAL REQUIREMENT 1: Windows High-DPI Scaling Fix
if sys.platform == "win32":
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        pass

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .config import HOST, PORT, PRIMARY_MODEL, FALLBACK_MODEL, DEFAULT_WORKSPACE_PATH
from .memory.db import (
    init_db,
    save_project_path,
    get_project_path,
    list_project_paths,
    delete_project_path,
    save_macro,
    list_macros,
    delete_macro,
    get_recent_tasks,
    save_task_history
)
from .schemas import TaskRequest, MacroRecord, ProjectPathRecord
from .core.router import handle_local_reflex
from .core.orchestrator import Orchestrator

# Active WebSocket manager for Tauri overlay clients
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: Dict[str, Any]):
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection)

manager = ConnectionManager()
orchestrator = Orchestrator(broadcast_callback=manager.broadcast)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize SQLite memory on startup
    init_db()
    print(f"[VEXA Engine] Initialized SQLite memory. Listening on http://{HOST}:{PORT}")
    yield

app = FastAPI(
    title="VEXA Engine",
    description="Virtual Execution & X-Layer Architect Backend",
    version="2.0.0",
    lifespan=lifespan
)

# Configure CORS for Tauri and Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- WebSocket Status Channel ---
@app.websocket("/ws/status")
async def websocket_status_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    # Send initial connected status
    await websocket.send_json({
        "status": "idle",
        "message": "Connected to VEXA Engine v2.0",
        "step": 0,
        "max_steps": 3
    })
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                cmd = msg.get("command")
                if cmd == "abort":
                    orchestrator.abort_current_task()
                elif cmd == "approve":
                    orchestrator.resolve_approval(approved=True)
                elif cmd == "reject":
                    orchestrator.resolve_approval(approved=False)
                elif cmd == "ping":
                    await websocket.send_json({"type": "pong"})
            except Exception:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# --- Health Check ---
@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "name": "VEXA Engine",
        "version": "2.0.0",
        "port": PORT,
        "primary_model": PRIMARY_MODEL,
        "fallback_model": FALLBACK_MODEL,
        "default_workspace": DEFAULT_WORKSPACE_PATH
    }

# --- Task Execution Endpoint ---
@app.post("/api/task")
async def execute_task(req: TaskRequest):
    prompt = req.task.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Task prompt cannot be empty.")

    # 1. Zero-API Local Reflex Check (save 10 RPM quota)
    reflex_result = await handle_local_reflex(prompt, workspace_path=req.workspace_path)
    if reflex_result:
        reflex_action = {
            "id": "reflex-1",
            "step_num": 1,
            "action_type": reflex_result.get("type", "local_reflex"),
            "description": reflex_result.get("message", "Completed via local reflex"),
            "status": "completed",
            "params": reflex_result,
            "result": reflex_result,
            "duration_ms": 5
        }
        # Save reflex execution to SQLite history
        save_task_history(
            task_prompt=prompt,
            status="done",
            summary=reflex_result.get("message", "Local reflex executed"),
            iterations=1,
            executed_actions=[reflex_result]
        )
        await manager.broadcast({
            "status": "done",
            "message": reflex_result.get("message", "Completed via local reflex"),
            "step": 1,
            "max_steps": 1,
            "actions": [reflex_action],
            "reflex": reflex_result,
            "summary": reflex_result.get("message", "Completed via local reflex"),
            "thought": "Executed zero-latency local reflex without LLM overhead."
        })
        return {
            "success": True,
            "handled_by": "local_reflex",
            "summary": reflex_result.get("message", "Completed via local reflex"),
            "thought": "Executed zero-latency local reflex without LLM overhead.",
            "actions": [reflex_action],
            "result": reflex_result
        }

    # 2. Multimodal LLM Execution via Orchestrator Loop
    result = await orchestrator.run_task(prompt, workspace_path=req.workspace_path)
    return {
        "success": result["status"] == "done",
        "handled_by": "orchestrator",
        "summary": result.get("summary", ""),
        "thought": result.get("thought", ""),
        "actions": result.get("actions", []),
        "result": result
    }

# --- Abort & Approval Endpoints ---
@app.post("/api/abort")
async def abort_task():
    orchestrator.abort_current_task()
    await manager.broadcast({
        "status": "done",
        "message": "Task aborted by user request.",
        "step": 0
    })
    return {"success": True, "message": "Task aborted."}

class ApprovalBody(BaseModel):
    approved: bool

@app.post("/api/approve")
async def approve_action(body: ApprovalBody):
    orchestrator.resolve_approval(body.approved)
    return {"success": True, "approved": body.approved}

# --- Project Paths Endpoints ---
@app.get("/api/projects")
async def get_projects():
    return {"projects": list_project_paths()}

class ProjectCreateBody(BaseModel):
    name: str
    path: str

@app.post("/api/projects")
async def create_project(body: ProjectCreateBody):
    save_project_path(body.name, body.path)
    return {"success": True, "message": f"Saved project '{body.name}'"}

@app.delete("/api/projects/{name}")
async def remove_project(name: str):
    deleted = delete_project_path(name)
    if not deleted:
        raise HTTPException(status_code=404, detail="Project not found.")
    return {"success": True}

# --- Macros Endpoints ---
@app.get("/api/macros")
async def get_macros():
    return {"macros": list_macros()}

@app.post("/api/macros")
async def create_macro(macro: MacroRecord):
    save_macro(macro.name, macro.trigger_keyword, macro.action_sequence, macro.description)
    return {"success": True, "message": f"Saved macro '{macro.name}'"}

@app.delete("/api/macros/{macro_id}")
async def remove_macro(macro_id: int):
    deleted = delete_macro(macro_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Macro not found.")
    return {"success": True}

# --- Task History Endpoint ---
@app.get("/api/history")
async def get_history(limit: int = 10):
    return {"history": get_recent_tasks(limit=limit)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host=HOST, port=PORT, reload=False)
