import re
import os
import sys
import math
import ast
import socket
import shutil
import platform
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional
from ..memory.db import (
    get_macro_by_trigger,
    list_macros,
    save_project_path,
    get_project_path,
    list_project_paths,
    get_recent_tasks,
    clear_task_history
)
from ..tools.workspace_coder import run_terminal_command

def _safe_eval_math(expr_str: str) -> Optional[float]:
    """Safely evaluates a basic math expression using AST without arbitrary code execution."""
    expr_str = expr_str.replace("^", "**").strip()
    try:
        node = ast.parse(expr_str, mode='eval')
        allowed_nodes = (
            ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant,
            ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow,
            ast.USub, ast.UAdd
        )
        for subnode in ast.walk(node):
            if not isinstance(subnode, allowed_nodes):
                return None
        code = compile(node, "<math>", "eval")
        return eval(code, {"__builtins__": {}}, {})
    except Exception:
        return None

async def handle_local_reflex(user_prompt: str, workspace_path: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Zero-API local reflex router.
    Evaluates instant deterministic commands (macros, port inspect, git status, system specs,
    math, app launchers, hardware queries, time, files) locally in <10ms to avoid burning
    Google AI Studio Free Tier rate limits (10 RPM).
    Returns a result dict if handled, or None if multimodal LLM reasoning is required.
    """
    prompt = user_prompt.strip()
    if not prompt:
        return None
    lower = prompt.lower().rstrip("?!.").strip()

    # 1. Registered SQLite macros (e.g., "macro:git-status" or "run macro find-ports")
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

    # 2. Friendly Greetings & Identity Reflexes (0 API Cost)
    greetings = [
        "hi", "hello", "hey", "yo", "sup", "howdy", "hola",
        "good morning", "good afternoon", "good evening",
        "hello vexa", "hey vexa", "hi vexa", "yo vexa"
    ]
    if lower in greetings:
        return {
            "handled": True,
            "type": "greeting",
            "result": "ready",
            "message": "Hello! I am VEXA, your autonomous desktop overlay agent. Ready for commands, code automation, system queries, or architecture blueprints."
        }

    if lower in ["how are you", "how are you doing", "what's up", "whats up"]:
        return {
            "handled": True,
            "type": "status_check",
            "result": "operational",
            "message": "All VEXA sub-systems operational: Local Reflex Engine online, Desktop Overlay active, SQLite Memory connected."
        }

    if lower in ["who are you", "what are you", "what is vexa", "who made you"]:
        return {
            "handled": True,
            "type": "identity",
            "result": "vexa_v2",
            "message": "I am VEXA (Virtual Execution & X-Layer Architect) v2.0 — a zero-lag transparent desktop overlay agent capable of autonomous code authoring, desktop automation, and interactive Mermaid architecture diagrams."
        }

    if lower in ["thanks", "thank you", "thx", "appreciate it", "thank you vexa"]:
        return {
            "handled": True,
            "type": "acknowledgement",
            "result": "welcome",
            "message": "You're very welcome! Let me know if you need anything else automated or designed."
        }

    if lower in ["ping", "pong", "test", "testing", "echo"]:
        return {
            "handled": True,
            "type": "ping",
            "result": "pong",
            "message": "Pong! VEXA engine latency: <2ms. Connection active."
        }

    # 3. Instant Time, Date & Epoch Reflexes
    if lower in ["time", "clock", "now"] or any(q in lower for q in ["what is time", "what time", "current time", "time today", "what is the time", "time now", "tell me time"]):
        now_str = datetime.now().strftime("%I:%M:%S %p")
        return {
            "handled": True,
            "type": "time_info",
            "result": now_str,
            "message": f"Current Time: {now_str}"
        }

    if lower in ["date", "today", "day", "calendar"] or any(q in lower for q in ["what is date", "what date", "today date", "date today", "current date", "today's date", "day today", "what day is it"]):
        now_str = datetime.now().strftime("%A, %B %d, %Y")
        return {
            "handled": True,
            "type": "date_info",
            "result": now_str,
            "message": f"Today is {now_str}"
        }

    if lower in ["timestamp", "epoch", "unix time", "unix timestamp"]:
        import time
        ts = int(time.time())
        return {
            "handled": True,
            "type": "timestamp",
            "result": str(ts),
            "message": f"Unix Epoch Timestamp: {ts}"
        }

    # 4. Instant Safe Math Calculator Reflex (e.g., "calc 25 * 40", "what is 100 / 4", "500 + 350")
    math_match = re.search(r"^(?:calc|calculate|math|eval|what\s+is\s+)?([0-9\.\s\+\-\*\/\(\)\^\%]+)$", lower)
    if math_match:
        raw_expr = math_match.group(1).strip()
        # Avoid matching pure numbers (e.g. "123") unless preceded by calc/math
        is_calc_keyword = lower.startswith(("calc", "calculate", "math", "eval", "what is"))
        has_operator = any(op in raw_expr for op in ["+", "-", "*", "/", "^", "%"])
        if (is_calc_keyword and has_operator) or (has_operator and len(raw_expr) > 2 and re.search(r"\d+\s*[\+\-\*\/]\s*\d+", raw_expr)):
            val = _safe_eval_math(raw_expr)
            if val is not None:
                formatted = f"{val:g}" if isinstance(val, (int, float)) else str(val)
                return {
                    "handled": True,
                    "type": "math_calc",
                    "result": formatted,
                    "message": f"Result: {raw_expr} = {formatted}"
                }

    # 4b. Percentage calculation: e.g. "15% of 200"
    pct_match = re.search(r"^(\d+(?:\.\d+)?)\s*%\s*(?:of)\s*(\d+(?:\.\d+)?)$", lower)
    if pct_match:
        pct = float(pct_match.group(1))
        base = float(pct_match.group(2))
        res = (pct / 100.0) * base
        return {
            "handled": True,
            "type": "math_calc",
            "result": f"{res:g}",
            "message": f"{pct:g}% of {base:g} = {res:g}"
        }

    # 5. Quick Application Launchers & Web Actions (0 API Cost)
    app_launchers = {
        ("open notepad", "notepad"): "notepad.exe",
        ("open calc", "open calculator", "calc", "calculator"): "calc.exe",
        ("open cmd", "open terminal", "cmd", "terminal", "command prompt"): "cmd.exe",
        ("open powershell", "powershell", "pwsh"): "powershell.exe",
        ("open explorer", "open files", "open file explorer", "explorer"): "explorer.exe",
        ("open task manager", "task manager", "taskmgr"): "taskmgr.exe",
        ("open chrome", "chrome"): "chrome",
        ("open edge", "edge", "msedge"): "msedge",
        ("open mspaint", "open paint", "paint"): "mspaint.exe",
        ("open snipping tool", "snipping tool"): "snippingtool.exe",
    }
    for triggers, exe in app_launchers.items():
        if lower in triggers:
            try:
                if exe in ["chrome", "msedge"]:
                    subprocess.Popen(f"start {exe}", shell=True)
                else:
                    subprocess.Popen([exe])
                return {
                    "handled": True,
                    "type": "app_launched",
                    "result": exe,
                    "message": f"Launched application: {exe}"
                }
            except Exception as e:
                return {
                    "handled": True,
                    "type": "app_launch_error",
                    "result": str(e),
                    "message": f"Failed to launch {exe}: {e}"
                }

    # WhatsApp Launch Reflex (Native App with Web Fallback)
    if lower in ["open whatsapp", "whatsapp", "launch whatsapp", "start whatsapp"]:
        try:
            # First attempt to launch via Windows app protocol URI
            p = subprocess.Popen("start whatsapp:", shell=True)
            return {
                "handled": True,
                "type": "app_launched",
                "result": "whatsapp",
                "message": "Opened WhatsApp. If desktop app is not installed, access at https://web.whatsapp.com"
            }
        except Exception:
            subprocess.Popen("start https://web.whatsapp.com", shell=True)
            return {
                "handled": True,
                "type": "app_launched",
                "result": "whatsapp_web",
                "message": "Opened WhatsApp Web in your default browser."
            }

    # Spotify Launch Reflex
    if lower in ["open spotify", "spotify", "launch spotify", "start spotify"]:
        try:
            subprocess.Popen("start spotify:", shell=True)
            return {
                "handled": True,
                "type": "app_launched",
                "result": "spotify",
                "message": "Opened Spotify."
            }
        except Exception:
            subprocess.Popen("start https://open.spotify.com", shell=True)
            return {
                "handled": True,
                "type": "app_launched",
                "result": "spotify_web",
                "message": "Opened Spotify Web in browser."
            }

    # Discord Launch Reflex
    if lower in ["open discord", "discord", "launch discord"]:
        try:
            subprocess.Popen("start discord:", shell=True)
            return {
                "handled": True,
                "type": "app_launched",
                "result": "discord",
                "message": "Opened Discord."
            }
        except Exception:
            subprocess.Popen("start https://discord.com/app", shell=True)
            return {
                "handled": True,
                "type": "app_launched",
                "result": "discord_web",
                "message": "Opened Discord in browser."
            }

    # Telegram Launch Reflex
    if lower in ["open telegram", "telegram", "launch telegram"]:
        try:
            subprocess.Popen("start tg:", shell=True)
            return {
                "handled": True,
                "type": "app_launched",
                "result": "telegram",
                "message": "Opened Telegram."
            }
        except Exception:
            subprocess.Popen("start https://web.telegram.org", shell=True)
            return {
                "handled": True,
                "type": "app_launched",
                "result": "telegram_web",
                "message": "Opened Telegram Web."
            }

    # YouTube / Google / GitHub Direct Launchers
    if lower in ["open youtube", "youtube"]:
        subprocess.Popen("start https://www.youtube.com", shell=True)
        return {"handled": True, "type": "web_launched", "result": "youtube", "message": "Opened YouTube."}

    if lower in ["open google", "google"]:
        subprocess.Popen("start https://www.google.com", shell=True)
        return {"handled": True, "type": "web_launched", "result": "google", "message": "Opened Google."}

    if lower in ["open github", "github"]:
        subprocess.Popen("start https://www.github.com", shell=True)
        return {"handled": True, "type": "web_launched", "result": "github", "message": "Opened GitHub."}

    if lower in ["open settings", "settings", "windows settings"]:
        subprocess.Popen("start ms-settings:", shell=True)
        return {"handled": True, "type": "app_launched", "result": "ms-settings", "message": "Opened Windows Settings."}

    # Search on Google reflex (e.g. "search for python 3.12", "search google for weather")
    search_match = re.search(r"^(?:search(?:\s+for|\s+on\s+google|\s+google\s+for)?|google)\s+(.+)$", lower)
    if search_match and not any(k in lower for k in ["file", "directory", "code", "repo"]):
        query = search_match.group(1).strip()
        import urllib.parse
        encoded = urllib.parse.quote_plus(query)
        subprocess.Popen(f"start https://www.google.com/search?q={encoded}", shell=True)
        return {
            "handled": True,
            "type": "web_search",
            "result": query,
            "message": f"Searching Google for: '{query}'"
        }

    # Play on YouTube reflex (e.g. "play lofi on youtube", "youtube lofi hip hop")
    yt_match = re.search(r"^(?:play\s+(.+)\s+on\s+youtube|search\s+youtube\s+for\s+(.+)|youtube\s+(.+))$", lower)
    if yt_match:
        yt_query = (yt_match.group(1) or yt_match.group(2) or yt_match.group(3)).strip()
        import urllib.parse
        encoded = urllib.parse.quote_plus(yt_query)
        subprocess.Popen(f"start https://www.youtube.com/results?search_query={encoded}", shell=True)
        return {
            "handled": True,
            "type": "youtube_search",
            "result": yt_query,
            "message": f"Playing on YouTube: '{yt_query}'"
        }

    if lower in ["open vscode", "open code", "vscode", "code"]:
        try:
            target = workspace_path or "."
            subprocess.Popen(f'code "{target}"', shell=True)
            return {
                "handled": True,
                "type": "app_launched",
                "result": "code",
                "message": f"Opened Visual Studio Code in workspace: {target}"
            }
        except Exception as e:
            return {
                "handled": True,
                "type": "app_launch_error",
                "result": str(e),
                "message": f"Failed to launch VS Code: {e}"
            }

    # 6. Lock Workstation / Screen Security
    if lower in ["lock screen", "lock pc", "lock computer", "lock workstation", "lock windows"]:
        try:
            import ctypes
            ctypes.windll.user32.LockWorkStation()
            return {
                "handled": True,
                "type": "system_action",
                "result": "locked",
                "message": "Desktop workstation locked."
            }
        except Exception as e:
            return {
                "handled": True,
                "type": "system_action_error",
                "result": str(e),
                "message": f"Error locking screen: {e}"
            }

    # 7. Storage / Disk Space Reflex
    if lower in ["disk space", "storage", "disk", "free space", "drive c", "hard drive"]:
        try:
            total, used, free = shutil.disk_usage("C:\\")
            gb = 1024 ** 3
            info = f"Drive C: Total: {total / gb:.1f} GB | Used: {used / gb:.1f} GB | Free: {free / gb:.1f} GB ({free / total * 100:.1f}% free)"
            return {
                "handled": True,
                "type": "disk_info",
                "result": info,
                "message": f"Storage Status:\n{info}"
            }
        except Exception as e:
            return {
                "handled": True,
                "type": "disk_info",
                "result": str(e),
                "message": f"Error checking disk space: {e}"
            }

    # 8. Memory / RAM Usage Reflex
    if lower in ["ram", "memory", "ram usage", "memory usage", "free ram", "ram info"]:
        try:
            import ctypes
            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]
            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
            gb = 1024 ** 3
            total_ram = stat.ullTotalPhys / gb
            avail_ram = stat.ullAvailPhys / gb
            used_ram = total_ram - avail_ram
            load = stat.dwMemoryLoad
            info = f"RAM: {used_ram:.2f} GB used / {total_ram:.2f} GB total ({load}% load, {avail_ram:.2f} GB free)"
            return {
                "handled": True,
                "type": "memory_info",
                "result": info,
                "message": f"Memory Status:\n{info}"
            }
        except Exception as e:
            return {
                "handled": True,
                "type": "memory_info",
                "result": str(e),
                "message": f"RAM check: {e}"
            }

    # 9. Network IP & Hostname Reflex
    if lower in ["my ip", "ip address", "ip", "local ip", "hostname", "network info"]:
        try:
            h_name = socket.gethostname()
            ip_addr = socket.gethostbyname(h_name)
            info = f"Host: {h_name} | Local IPv4: {ip_addr}"
            return {
                "handled": True,
                "type": "network_info",
                "result": info,
                "message": f"Network Adapter:\n{info}"
            }
        except Exception as e:
            return {
                "handled": True,
                "type": "network_info",
                "result": str(e),
                "message": f"Error resolving IP: {e}"
            }

    # 10. System Specs & Hardware Reflex
    if lower in ["system info", "system", "specs", "pc info", "computer info", "hardware", "cpu info", "os info", "os version", "os"]:
        cpu_count = os.cpu_count() or "Unknown"
        arch = platform.machine()
        os_name = f"{platform.system()} {platform.release()} (Build {platform.version()})"
        py_ver = platform.python_version()
        info = f"Operating System: {os_name}\nArchitecture: {arch}\nLogical CPU Cores: {cpu_count}\nPython Environment: {py_ver}"
        return {
            "handled": True,
            "type": "system_info",
            "result": info,
            "message": f"System Specifications:\n{info}"
        }

    # 11. Current Directory & Workspace Reflex
    if lower in ["pwd", "where am i", "current directory", "active directory", "workspace path", "working dir", "workspace"]:
        target = workspace_path or str(Path(__file__).resolve().parent.parent.parent)
        return {
            "handled": True,
            "type": "workspace_info",
            "result": target,
            "message": f"Active Workspace:\n{target}"
        }

    # 12. Workspace File Listing Reflex (ls / dir)
    if lower in ["ls", "dir", "list files", "show files", "files"]:
        target = Path(workspace_path or str(Path(__file__).resolve().parent.parent.parent))
        try:
            items = sorted(os.listdir(target))[:30]
            listing = "\n".join([f"📁 {i}" if (target / i).is_dir() else f"📄 {i}" for i in items])
            return {
                "handled": True,
                "type": "file_listing",
                "result": listing,
                "message": f"Files in {target.name}:\n{listing}"
            }
        except Exception as e:
            return {
                "handled": True,
                "type": "file_listing",
                "result": str(e),
                "message": f"Error listing files: {e}"
            }

    # 13. Instant Git Status reflex: "git status"
    if lower in ["git status", "git st"]:
        res = await run_terminal_command("git status -s", cwd=workspace_path)
        output = res.get("stdout") or res.get("stderr") or "Working tree clean"
        return {
            "handled": True,
            "type": "git_status",
            "result": output,
            "message": f"Git Status:\n{output.strip()}"
        }

    # 13b. Git Branch & Git Log & Git Diff reflexes
    if lower in ["git branch", "git branches", "branch"]:
        res = await run_terminal_command("git branch", cwd=workspace_path)
        output = res.get("stdout") or res.get("stderr") or "No git branch detected"
        return {
            "handled": True,
            "type": "git_branch",
            "result": output,
            "message": f"Active Branch:\n{output.strip()}"
        }

    if lower in ["git log", "git history", "recent commits"]:
        res = await run_terminal_command("git log -n 5 --oneline", cwd=workspace_path)
        output = res.get("stdout") or res.get("stderr") or "No git commits found"
        return {
            "handled": True,
            "type": "git_log",
            "result": output,
            "message": f"Recent Commits:\n{output.strip()}"
        }

    if lower in ["git diff", "git changes", "show diff"]:
        res = await run_terminal_command("git diff --stat", cwd=workspace_path)
        output = res.get("stdout") or res.get("stderr") or "No uncommitted diffs"
        return {
            "handled": True,
            "type": "git_diff",
            "result": output,
            "message": f"Git Diff Summary:\n{output.strip()}"
        }

    # 14. Instant Port Inspection: "ports", "list ports", "active ports"
    if lower in ["ports", "list ports", "active ports", "find ports", "find-ports"]:
        cmd = "netstat -ano | findstr LISTENING"
        res = await run_terminal_command(cmd, cwd=workspace_path)
        output = res.get("stdout") or "No active listening ports detected"
        lines = [line.strip() for line in output.splitlines() if any(p in line for p in [":3000", ":5173", ":8000", ":8765", ":8080", ":4200", ":5000"])]
        display = "\n".join(lines[:15]) if lines else output[:500]
        return {
            "handled": True,
            "type": "active_ports",
            "result": display,
            "message": f"Active dev ports:\n{display}"
        }

    # 15. Runtime Environment Tool Versions (Python / Node / Git / Cargo)
    if lower in ["versions", "runtime versions", "tools", "tool versions"]:
        results = [f"Python: {sys.version.split()[0]}"]
        for tool, cmd in [("Node", "node -v"), ("NPM", "npm -v"), ("Git", "git --version"), ("Cargo", "cargo -V")]:
            try:
                res = await run_terminal_command(cmd)
                v = (res.get("stdout") or "").strip()
                if v:
                    results.append(f"{tool}: {v}")
            except Exception:
                pass
        return {
            "handled": True,
            "type": "runtime_versions",
            "result": "\n".join(results),
            "message": "Installed Tool Versions:\n" + "\n".join(results)
        }

    # 16. Register project path: "register project <name> <path>"
    reg_match = re.search(r"^(?:register|add)\s+project\s+([\w\-]+)\s+(.+)$", prompt, re.IGNORECASE)
    if reg_match:
        p_name = reg_match.group(1)
        p_path = reg_match.group(2).strip().strip('"').strip("'")
        save_project_path(p_name, p_path)
        return {
            "handled": True,
            "type": "project_registered",
            "message": f"Successfully registered project '{p_name}' at: {p_path}"
        }

    # 17. List registered projects: "list projects", "projects"
    if lower in ["list projects", "projects", "show projects", "get projects"]:
        projects = list_project_paths()
        return {
            "handled": True,
            "type": "project_list",
            "projects": projects,
            "message": f"Found {len(projects)} registered projects."
        }

    # 18. Task History & Memory Management
    if lower in ["task history", "recent tasks", "history", "show history"]:
        tasks = get_recent_tasks(limit=10)
        return {
            "handled": True,
            "type": "task_history",
            "tasks": tasks,
            "message": f"Retrieved {len(tasks)} recent tasks from SQLite memory."
        }

    if lower in ["clear history", "clear tasks", "reset history", "clear memory"]:
        clear_task_history()
        return {
            "handled": True,
            "type": "history_cleared",
            "message": "Cleared task history from SQLite memory."
        }

    # 19. List saved macros: "list macros", "macros"
    if lower in ["list macros", "macros", "show macros"]:
        macros = list_macros()
        return {
            "handled": True,
            "type": "macro_list",
            "macros": macros,
            "message": f"Retrieved {len(macros)} saved macros."
        }

    # 20. Instant Help / Capabilities reflex
    if lower in ["help", "help me", "what can you do", "what you can do", "features", "commands"]:
        features = (
            "VEXA (Virtual Execution & X-Layer Architect) v2.0\n\n"
            "1. Architecture Blueprints: Type 'draw architecture of <system>' to render interactive, draggable Mermaid diagrams with one-click repo scaffolding.\n"
            "2. Autonomous Workspace Coding: Inspect, write, test, and patch any file in your project.\n"
            "3. Multimodal Desktop Automation: Observe UI, click buttons, type text, and automate desktop applications.\n"
            "4. Zero-API Instant Reflexes (0 Cost, <5ms):\n"
            "   • Greetings: 'hi', 'hello', 'who are you', 'how are you'\n"
            "   • System & Hardware: 'specs', 'ram', 'disk space', 'my ip'\n"
            "   • Instant Math: 'calc 25*40', '15% of 200', 'math 2^10'\n"
            "   • App Launchers: 'open notepad', 'open calc', 'open cmd', 'open vscode'\n"
            "   • Dev & Git: 'git status', 'git branch', 'git log', 'git diff', 'ports', 'ls'\n"
            "   • Time & Date: 'time', 'date', 'epoch'\n"
            "   • Controls: 'lock screen', 'clear history', 'list projects', 'list macros'"
        )
        return {
            "handled": True,
            "type": "capabilities",
            "result": features,
            "message": features
        }

    return None

