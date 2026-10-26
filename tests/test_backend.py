import os
import sys
import asyncio
import tempfile
from pathlib import Path
from fastapi.testclient import TestClient

# Ensure workspace root is in sys.path
root_path = Path(__file__).resolve().parent.parent
if str(root_path) not in sys.path:
    sys.path.insert(0, str(root_path))

from backend.main import app
from backend.config import FreeTierRateLimiter
from backend.memory.db import (
    init_db,
    save_project_path,
    get_project_path,
    list_project_paths,
    delete_project_path,
    save_macro,
    get_macro_by_trigger,
    list_macros,
    save_task_history,
    get_recent_tasks
)
from backend.tools import gui_control, workspace_coder, architect
from backend.perception import vision, context
from backend.core.router import handle_local_reflex

def test_db_operations():
    init_db()
    # Test project paths
    save_project_path("vexa_test_project", str(root_path))
    p = get_project_path("vexa_test_project")
    assert p is not None, "Project path should not be None"
    assert Path(p).resolve() == root_path.resolve()
    
    # Test macros
    save_macro("Test Echo", "echo-test", [{"action_type": "run_command", "command": "echo 1"}], "Echo description")
    macro = get_macro_by_trigger("echo-test")
    assert macro is not None, "Macro should not be None"
    assert macro["name"] == "Test Echo"
    
    # Test task history
    tid = save_task_history("test prompt", "done", "Summary of test", 1, [{"step": 1}])
    assert tid > 0
    recent = get_recent_tasks(limit=5)
    assert len(recent) > 0
    assert any(t["task_prompt"] == "test prompt" for t in recent)
    print("[PASS] test_db_operations passed")

def test_gui_math():
    w, h = gui_control.get_screen_resolution()
    assert w > 0 and h > 0, "Resolution must be positive"
    px, py = gui_control.norm_to_pixel(500, 500)
    assert px == int(w * 0.5)
    assert py == int(h * 0.5)

    px_clamp, py_clamp = gui_control.norm_to_pixel(-100, 1500)
    assert px_clamp == 0
    assert py_clamp == h
    print("[PASS] test_gui_math passed")

def test_workspace_coder_and_diff():
    with tempfile.TemporaryDirectory() as tmp_dir:
        test_file = Path(tmp_dir) / "sample.txt"
        # Write
        w_res = workspace_coder.write_file(str(test_file), "line 1\nline 2\nline 3\n")
        assert w_res["success"] is True
        assert test_file.exists()

        # Read
        r_res = workspace_coder.read_file(str(test_file))
        assert r_res["success"] is True
        assert "line 2" in r_res["content"]

        # Patch
        p_res = workspace_coder.patch_file(str(test_file), "line 2", "line TWO")
        assert p_res["success"] is True
        assert "line TWO" in test_file.read_text()
        assert "+line TWO" in p_res["diff"]
    print("[PASS] test_workspace_coder_and_diff passed")

def test_architect_mermaid():
    raw = "```mermaid\ngraph TD;\nA-->B;\n```"
    cleaned = architect.clean_mermaid_code(raw)
    assert cleaned == "graph TD;\nA-->B;"

    extracted = architect.extract_mermaid_from_text("Here is the architecture:\n```mermaid\ngraph LR\nC-->D\n```")
    assert extracted == "graph LR\nC-->D"
    print("[PASS] test_architect_mermaid passed")

def test_vision_capture():
    res = vision.capture_screen(draw_grid=True, max_width=640, max_height=360)
    assert "image_bytes" in res
    assert len(res["image_bytes"]) > 0
    assert res["mime_type"] == "image/webp"
    assert res["screen_width"] > 0
    assert res["screen_height"] > 0
    print("[PASS] test_vision_capture passed")

def test_perception_context():
    ctx = context.gather_full_context(str(root_path))
    assert "active_window" in ctx
    assert "clipboard" in ctx
    assert "workspace" in ctx
    assert ctx["workspace"]["exists"] is True
    print("[PASS] test_perception_context passed")

async def test_zero_api_reflex():
    res = await handle_local_reflex("git status", workspace_path=str(root_path))
    assert res is not None
    assert res["handled"] is True
    assert res["type"] == "git_status"

    res_proj = await handle_local_reflex("list projects")
    assert res_proj is not None
    assert res_proj["handled"] is True
    assert res_proj["type"] == "project_list"
    print("[PASS] test_zero_api_reflex passed")

def test_fastapi_endpoints():
    with TestClient(app) as client:
        # Health check
        res = client.get("/api/health")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["port"] == 8765

        # Local reflex via /api/task
        task_res = client.post("/api/task", json={"task": "list projects"})
        assert task_res.status_code == 200
        task_data = task_res.json()
        assert task_data["success"] is True
        assert task_data["handled_by"] == "local_reflex"

        # Macros endpoint
        macro_res = client.get("/api/macros")
        assert macro_res.status_code == 200
        assert "macros" in macro_res.json()

        # Projects endpoint
        proj_res = client.get("/api/projects")
        assert proj_res.status_code == 200
        assert "projects" in proj_res.json()

        # History endpoint
        hist_res = client.get("/api/history")
        assert hist_res.status_code == 200
        assert "history" in hist_res.json()
        print("[PASS] test_fastapi_endpoints passed")

if __name__ == "__main__":
    print("==================================================")
    print("    RUNNING VEXA BACKEND PRODUCTION TEST SUITE   ")
    print("==================================================")
    test_db_operations()
    test_gui_math()
    test_workspace_coder_and_diff()
    test_architect_mermaid()
    test_vision_capture()
    test_perception_context()
    asyncio.run(test_zero_api_reflex())
    test_fastapi_endpoints()
    print("==================================================")
    print("   ALL TESTS PASSED WITH 100% SUCCESS! (0 ERRORS) ")
    print("==================================================")
