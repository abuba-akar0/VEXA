import sqlite3
import json
from pathlib import Path
from typing import List, Optional, Dict, Any

DB_PATH = Path(__file__).resolve().parent.parent / "vexa_memory.db"

def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initializes the SQLite database with required tables."""
    conn = get_connection()
    cursor = conn.cursor()
    
    # 1. Project paths mapping
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS project_paths (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            path TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)

    # 2. Reusable user macros
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS macros (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            trigger_keyword TEXT UNIQUE NOT NULL,
            description TEXT DEFAULT '',
            action_sequence TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)

    # 3. Task history (stores last N tasks)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS task_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_prompt TEXT NOT NULL,
            status TEXT NOT NULL,
            summary TEXT DEFAULT '',
            iterations INTEGER DEFAULT 1,
            executed_actions TEXT DEFAULT '[]',
            is_bookmarked INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    try:
        cursor.execute("ALTER TABLE task_history ADD COLUMN is_bookmarked INTEGER DEFAULT 0;")
    except Exception:
        pass

    # Seed default sample macros if empty
    cursor.execute("SELECT COUNT(*) FROM macros;")
    if cursor.fetchone()[0] == 0:
        default_macros = [
            (
                "Git Status & Branch",
                "git-status",
                "Checks current git status and recent branch history",
                json.dumps([{"action_type": "run_command", "command": "git status -s"}])
            ),
            (
                "Find Active Dev Ports",
                "find-ports",
                "Lists currently listening dev ports (3000, 5173, 8000, 8765)",
                json.dumps([{"action_type": "run_command", "command": "netstat -ano | findstr LISTENING"}])
            )
        ]
        cursor.executemany(
            "INSERT INTO macros (name, trigger_keyword, description, action_sequence) VALUES (?, ?, ?, ?);",
            default_macros
        )

    conn.commit()
    conn.close()

# --- Project Paths Functions ---
def save_project_path(name: str, path: str):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO project_paths (name, path) VALUES (?, ?)
        ON CONFLICT(name) DO UPDATE SET path=excluded.path;
    """, (name.strip().lower(), str(Path(path).resolve())))
    conn.commit()
    conn.close()

def get_project_path(name: str) -> Optional[str]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT path FROM project_paths WHERE name = ?;", (name.strip().lower(),))
    row = cursor.fetchone()
    conn.close()
    return row["path"] if row else None

def list_project_paths() -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, path, created_at FROM project_paths ORDER BY name ASC;")
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def delete_project_path(name: str) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM project_paths WHERE name = ?;", (name.strip().lower(),))
    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return deleted

# --- Macro Functions ---
def save_macro(name: str, trigger_keyword: str, action_sequence: List[Dict[str, Any]], description: str = ""):
    conn = get_connection()
    cursor = conn.cursor()
    seq_json = json.dumps(action_sequence)
    cursor.execute("""
        INSERT INTO macros (name, trigger_keyword, description, action_sequence) VALUES (?, ?, ?, ?)
        ON CONFLICT(trigger_keyword) DO UPDATE SET
            name=excluded.name,
            description=excluded.description,
            action_sequence=excluded.action_sequence;
    """, (name, trigger_keyword.strip().lower(), description, seq_json))
    conn.commit()
    conn.close()

def get_macro_by_trigger(trigger: str) -> Optional[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, trigger_keyword, description, action_sequence, created_at FROM macros WHERE trigger_keyword = ?;", (trigger.strip().lower(),))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    data = dict(row)
    data["action_sequence"] = json.loads(data["action_sequence"])
    return data

def list_macros() -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, trigger_keyword, description, action_sequence, created_at FROM macros ORDER BY name ASC;")
    rows = cursor.fetchall()
    conn.close()
    results = []
    for row in rows:
        d = dict(row)
        try:
            d["action_sequence"] = json.loads(d["action_sequence"])
        except Exception:
            d["action_sequence"] = []
        results.append(d)
    return results

def delete_macro(macro_id: int) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM macros WHERE id = ?;", (macro_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return deleted

# --- Task History Functions ---
def save_task_history(task_prompt: str, status: str, summary: str = "", iterations: int = 1, executed_actions: List[Any] = None) -> int:
    conn = get_connection()
    cursor = conn.cursor()
    actions_json = json.dumps(executed_actions or [])
    cursor.execute("""
        INSERT INTO task_history (task_prompt, status, summary, iterations, executed_actions)
        VALUES (?, ?, ?, ?, ?);
    """, (task_prompt, status, summary, iterations, actions_json))
    task_id = cursor.lastrowid
    
    # Prune older tasks beyond the latest 100
    cursor.execute("""
        DELETE FROM task_history WHERE id NOT IN (
            SELECT id FROM task_history ORDER BY id DESC LIMIT 100
        );
    """)
    conn.commit()
    conn.close()
    return task_id

def get_recent_tasks(limit: int = 10) -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, task_prompt, status, summary, iterations, executed_actions, created_at
        FROM task_history
        ORDER BY id DESC
        LIMIT ?;
    """, (limit,))
    rows = cursor.fetchall()
    conn.close()
    results = []
    for row in rows:
        d = dict(row)
        try:
            d["executed_actions"] = json.loads(d["executed_actions"])
        except Exception:
            d["executed_actions"] = []
        results.append(d)
    return results

def toggle_bookmark(task_id: int) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE task_history
        SET is_bookmarked = CASE WHEN is_bookmarked = 1 THEN 0 ELSE 1 END
        WHERE id = ?;
    """, (task_id,))
    cursor.execute("SELECT is_bookmarked FROM task_history WHERE id = ?;", (task_id,))
    row = cursor.fetchone()
    conn.commit()
    conn.close()
    return bool(row["is_bookmarked"]) if row else False

def get_bookmarked_tasks() -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, task_prompt, status, summary, iterations, executed_actions, is_bookmarked, created_at
        FROM task_history
        WHERE is_bookmarked = 1
        ORDER BY id DESC;
    """)
    rows = cursor.fetchall()
    conn.close()
    results = []
    for row in rows:
        d = dict(row)
        try:
            d["executed_actions"] = json.loads(d["executed_actions"])
        except Exception:
            d["executed_actions"] = []
        results.append(d)
    return results

def delete_task_history_item(task_id: int) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM task_history WHERE id = ?;", (task_id,))
    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return deleted

def clear_task_history() -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM task_history WHERE is_bookmarked = 0;")
    conn.commit()
    conn.close()
    return True

