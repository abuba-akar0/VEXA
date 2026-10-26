import os
import sys
import difflib
import asyncio
from pathlib import Path
from typing import Dict, Any, Optional, List

def resolve_safe_path(file_path: str, base_dir: Optional[str] = None) -> Path:
    """Resolves path against base directory or system."""
    base = Path(base_dir).resolve() if base_dir else Path.cwd()
    p = Path(file_path)
    if not p.is_absolute():
        p = base / p
    return p.resolve()

def read_file(file_path: str, base_dir: Optional[str] = None, max_lines: int = 1000) -> Dict[str, Any]:
    """Reads a file and returns its content along with line count metadata."""
    target = resolve_safe_path(file_path, base_dir)
    if not target.exists():
        return {"success": False, "error": f"File not found: {target}", "path": str(target)}
    if target.is_dir():
        return {"success": False, "error": f"Path is a directory: {target}", "path": str(target)}

    try:
        content = target.read_text(encoding="utf-8", errors="replace")
        lines = content.splitlines()
        truncated = len(lines) > max_lines
        display_lines = lines[:max_lines]

        return {
            "success": True,
            "path": str(target),
            "total_lines": len(lines),
            "truncated": truncated,
            "content": "\n".join(display_lines)
        }
    except Exception as e:
        return {"success": False, "error": str(e), "path": str(target)}

def write_file(file_path: str, content: str, base_dir: Optional[str] = None) -> Dict[str, Any]:
    """Writes content to a file, creating parent directories automatically."""
    target = resolve_safe_path(file_path, base_dir)
    old_content = ""
    had_previous = target.exists()

    if had_previous:
        try:
            old_content = target.read_text(encoding="utf-8", errors="replace")
        except Exception:
            old_content = ""

    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")

        # Generate readable unified diff
        diff = list(difflib.unified_diff(
            old_content.splitlines(keepends=True),
            content.splitlines(keepends=True),
            fromfile=f"a/{target.name}",
            tofile=f"b/{target.name}",
            n=3
        ))
        diff_str = "".join(diff)

        return {
            "success": True,
            "path": str(target),
            "bytes_written": len(content.encode("utf-8")),
            "created": not had_previous,
            "diff": diff_str
        }
    except Exception as e:
        return {"success": False, "error": str(e), "path": str(target)}

def patch_file(file_path: str, search_text: str, replace_text: str, base_dir: Optional[str] = None) -> Dict[str, Any]:
    """Replaces target text within a file and provides a unified diff."""
    target = resolve_safe_path(file_path, base_dir)
    if not target.exists():
        return {"success": False, "error": f"File not found: {target}", "path": str(target)}

    try:
        content = target.read_text(encoding="utf-8", errors="replace")
        if search_text not in content:
            return {
                "success": False,
                "error": "Target search_text was not found in the file content.",
                "path": str(target)
            }

        new_content = content.replace(search_text, replace_text, 1)
        target.write_text(new_content, encoding="utf-8")

        diff = list(difflib.unified_diff(
            content.splitlines(keepends=True),
            new_content.splitlines(keepends=True),
            fromfile=f"a/{target.name}",
            tofile=f"b/{target.name}",
            n=3
        ))

        return {
            "success": True,
            "path": str(target),
            "diff": "".join(diff)
        }
    except Exception as e:
        return {"success": False, "error": str(e), "path": str(target)}

def list_directory(dir_path: str = ".", base_dir: Optional[str] = None, max_items: int = 50) -> Dict[str, Any]:
    """Lists files and folders inside directory."""
    target = resolve_safe_path(dir_path, base_dir)
    if not target.exists():
        return {"success": False, "error": f"Directory not found: {target}", "path": str(target)}
    if not target.is_dir():
        return {"success": False, "error": f"Path is not a directory: {target}", "path": str(target)}

    try:
        entries = []
        for item in target.iterdir():
            # Skip hidden git and heavy node_modules for cleaner overview
            if item.name in [".git", "node_modules", ".next", "__pycache__"]:
                continue
            entries.append({
                "name": item.name,
                "is_dir": item.is_dir(),
                "size_bytes": item.stat().st_size if item.is_file() else None
            })
            if len(entries) >= max_items:
                break

        return {
            "success": True,
            "path": str(target),
            "entries": entries,
            "count": len(entries)
        }
    except Exception as e:
        return {"success": False, "error": str(e), "path": str(target)}

async def run_terminal_command(command: str, cwd: Optional[str] = None, timeout: int = 60) -> Dict[str, Any]:
    """Runs a shell command asynchronously and returns exit code, stdout, and stderr."""
    working_dir = resolve_safe_path(cwd) if cwd else Path.cwd()
    
    try:
        # On Windows, use cmd /c or powershell
        process = await asyncio.create_subprocess_shell(
            command,
            cwd=str(working_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        try:
            stdout_data, stderr_data = await asyncio.wait_for(process.communicate(), timeout=timeout)
            stdout_str = stdout_data.decode("utf-8", errors="replace")
            stderr_str = stderr_data.decode("utf-8", errors="replace")
            return {
                "success": process.returncode == 0,
                "returncode": process.returncode,
                "stdout": stdout_str,
                "stderr": stderr_str,
                "command": command,
                "cwd": str(working_dir)
            }
        except asyncio.TimeoutError:
            try:
                process.kill()
            except Exception:
                pass
            return {
                "success": False,
                "returncode": -1,
                "stdout": "",
                "stderr": f"Command timed out after {timeout} seconds",
                "command": command,
                "cwd": str(working_dir)
            }
    except Exception as e:
        return {
            "success": False,
            "returncode": -1,
            "stdout": "",
            "stderr": str(e),
            "command": command,
            "cwd": str(working_dir)
        }
