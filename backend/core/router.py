import re
import shlex
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional
from ..memory.db import (
    get_macro_by_trigger,
    list_macros,
    save_project_path,
    get_project_path,
    list_project_paths,
    get_recent_tasks
)
from ..tools.workspace_coder import run_terminal_command

async def handle_local_reflex(user_prompt: str, workspace_path: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Zero-API local reflex router.
    Evaluates instant deterministic commands (macros, port inspect, git status, project registration)
    locally to avoid burning Google AI Studio Free Tier rate limits (10 RPM).
    Returns a result dict if handled, or None if LLM reasoning is required.
    """
    prompt = user_prompt.strip()
    lower = prompt.lower()

    # 1. Check for registered SQLite macros
    # e.g. "macro:git-status" or "run macro find-ports" or exact trigger keyword match
    macro_match = re.search(r"^(?:run\s+)?(?:macro[:\s]+)?([\w\-]+)$", lower)
    if macro_match:
        trigger = macro_match.group(1)
        macro = get_macro_by_trigger(trigger)
        if macro:
            return {
                "handled": True,
                "type": "macro_execution",
                "macro": macro,
                "message": f"Executing saved macro: '{macro['name']}'"
            }

    # 2. Register project path: "register project <name> <path>" or "add project <name> <path>"
    reg_match = re.search(r"^(?:register|add)\s+project\s+([\w\-]+)\s+(.+)$", prompt, re.IGNORECASE)
    if reg_match:
        p_name = reg_match.group(1)
        p_path = reg_match.group(2).strip().strip('"').strip("'")
        save_project_path(p_name, p_path)
        return {
            "handled": True,
            "type": "project_registered",
            "message": f"Successfully registered project '{p_name}' at path: {p_path}"
        }

    # 3. List registered projects: "list projects", "projects", "get projects"
    if lower in ["list projects", "projects", "show projects", "get projects"]:
        projects = list_project_paths()
        return {
            "handled": True,
            "type": "project_list",
            "projects": projects,
            "message": f"Found {len(projects)} registered projects."
        }

    # 4. Show recent task history: "task history", "recent tasks", "history"
    if lower in ["task history", "recent tasks", "history", "show history"]:
        tasks = get_recent_tasks(limit=10)
        return {
            "handled": True,
            "type": "task_history",
            "tasks": tasks,
            "message": f"Retrieved {len(tasks)} recent tasks from SQLite memory."
        }

    # 5. List saved macros: "list macros", "macros", "show macros"
    if lower in ["list macros", "macros", "show macros"]:
        macros = list_macros()
        return {
            "handled": True,
            "type": "macro_list",
            "macros": macros,
            "message": f"Retrieved {len(macros)} saved macros."
        }

    # 6. Instant Git Status reflex: "git status"
    if lower in ["git status", "git st"]:
        res = await run_terminal_command("git status -s", cwd=workspace_path)
        output = res.get("stdout") or res.get("stderr") or "Working tree clean"
        return {
            "handled": True,
            "type": "git_status",
            "result": output,
            "message": f"Git Status:\n{output}"
        }

    # 7. Instant Port Inspection: "ports", "list ports", "active ports"
    if lower in ["ports", "list ports", "active ports", "find ports"]:
        cmd = "netstat -ano | findstr LISTENING"
        res = await run_terminal_command(cmd, cwd=workspace_path)
        output = res.get("stdout") or "No active listening ports detected"
        lines = [line.strip() for line in output.splitlines() if any(p in line for p in [":3000", ":5173", ":8000", ":8765", ":8080", ":4200"])]
        display = "\n".join(lines[:15]) if lines else output[:500]
        return {
            "handled": True,
            "type": "active_ports",
            "result": display,
            "message": f"Active dev ports:\n{display}"
        }

    return None
