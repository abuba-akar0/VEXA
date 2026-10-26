import sys
import ctypes
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional
import pyperclip

def get_active_window_title() -> str:
    """Gets the title of the currently focused window using native Windows user32 API."""
    if sys.platform != "win32":
        return "Non-Windows System"
    try:
        user32 = ctypes.windll.user32
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return "Desktop / None"
        length = user32.GetWindowTextLengthW(hwnd)
        if length > 0:
            buff = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buff, length + 1)
            return buff.value
        return "Unknown Window"
    except Exception as e:
        return f"Error retrieving window: {e}"

def get_clipboard_text(max_chars: int = 2000) -> str:
    """Reads current clipboard text safely, truncated to max_chars."""
    try:
        text = pyperclip.paste()
        if text:
            return text[:max_chars]
        return ""
    except Exception:
        return ""

def get_workspace_info(workspace_dir: Optional[str] = None) -> Dict[str, Any]:
    """Inspects the specified workspace or current project directory."""
    target_dir = Path(workspace_dir).resolve() if workspace_dir else Path.cwd()
    if not target_dir.exists():
        return {"exists": False, "path": str(target_dir)}

    info: Dict[str, Any] = {
        "exists": True,
        "path": str(target_dir),
        "is_git": (target_dir / ".git").exists(),
        "git_branch": None,
        "git_status": None,
        "top_level_files": []
    }

    # Inspect top-level directory items
    try:
        items = list(target_dir.iterdir())[:30]
        info["top_level_files"] = [
            {"name": item.name, "is_dir": item.is_dir()}
            for item in items
            if not item.name.startswith(".") or item.name in [".env", ".gitignore"]
        ]
    except Exception as e:
        info["top_level_files"] = [{"error": str(e)}]

    # Check Git details if repository
    if info["is_git"]:
        try:
            branch = subprocess.check_output(
                ["git", "branch", "--show-current"],
                cwd=str(target_dir),
                text=True,
                stderr=subprocess.DEVNULL,
                timeout=2
            ).strip()
            info["git_branch"] = branch
        except Exception:
            info["git_branch"] = "unknown"

        try:
            status = subprocess.check_output(
                ["git", "status", "-s"],
                cwd=str(target_dir),
                text=True,
                stderr=subprocess.DEVNULL,
                timeout=2
            ).strip()
            info["git_status"] = status[:1000] if status else "Clean"
        except Exception:
            info["git_status"] = "Unavailable"

    return info

def gather_full_context(workspace_dir: Optional[str] = None) -> Dict[str, Any]:
    """Combines active window, clipboard, and workspace context into a single context dict."""
    return {
        "active_window": get_active_window_title(),
        "clipboard": get_clipboard_text(),
        "workspace": get_workspace_info(workspace_dir)
    }
