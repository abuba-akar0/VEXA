import re
import json
import time
import hashlib
from typing import Optional, Dict, Any
from .db import get_connection

REDIS_URL = "redis://127.0.0.1:6379/0"
DEFAULT_TTL_SECONDS = 86400  # 24 hours

_redis_client = None
_redis_available = None

async def _get_redis():
    global _redis_client, _redis_available
    if _redis_available is False:
        return None
    if _redis_client is not None:
        return _redis_client
    try:
        import redis.asyncio as aioredis
        client = aioredis.from_url(REDIS_URL, decode_responses=True, socket_connect_timeout=0.5)
        await client.ping()
        _redis_client = client
        _redis_available = True
        return _redis_client
    except Exception:
        _redis_available = False
        _redis_client = None
        return None

def normalize_prompt(prompt: str) -> str:
    """Normalizes prompt for deterministic semantic caching."""
    cleaned = prompt.strip().lower()
    cleaned = re.sub(r"[?!.,;:]+$", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned

def compute_cache_key(prompt: str) -> str:
    norm = normalize_prompt(prompt)
    sha = hashlib.sha256(norm.encode("utf-8")).hexdigest()
    return f"vexa:cache:{sha}"

def _init_sqlite_cache():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS query_cache (
            cache_key TEXT PRIMARY KEY,
            prompt TEXT NOT NULL,
            result_json TEXT NOT NULL,
            expires_at REAL NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    conn.commit()
    conn.close()

# Initialize cache table on module load
try:
    _init_sqlite_cache()
except Exception:
    pass

async def get_cached_query(prompt: str) -> Optional[Dict[str, Any]]:
    """
    Retrieves cached response from Redis, or falls back to SQLite cache.
    Returns None if cache miss or expired.
    """
    key = compute_cache_key(prompt)
    now = time.time()

    # 1. Try Redis
    r = await _get_redis()
    if r is not None:
        try:
            val = await r.get(key)
            if val:
                data = json.loads(val)
                data["cache_backend"] = "redis"
                data["cached"] = True
                return data
        except Exception:
            pass

    # 2. Fallback to SQLite cache
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT result_json, expires_at FROM query_cache WHERE cache_key = ?;", (key,))
        row = cursor.fetchone()
        conn.close()
        if row:
            if row["expires_at"] > now:
                data = json.loads(row["result_json"])
                data["cache_backend"] = "sqlite"
                data["cached"] = True
                return data
            else:
                # Expired: clean up
                conn = get_connection()
                conn.cursor().execute("DELETE FROM query_cache WHERE cache_key = ?;", (key,))
                conn.commit()
                conn.close()
    except Exception:
        pass

    return None

async def set_cached_query(prompt: str, result_dict: Dict[str, Any], ttl_seconds: int = DEFAULT_TTL_SECONDS) -> bool:
    """
    Caches the query result in Redis and SQLite.
    """
    key = compute_cache_key(prompt)
    now = time.time()
    expires_at = now + ttl_seconds
    clean_dict = {
        "status": result_dict.get("status", "done"),
        "summary": result_dict.get("summary", ""),
        "thought": result_dict.get("thought", ""),
        "actions": result_dict.get("actions", []),
        "diagram": result_dict.get("diagram"),
        "cached_at": time.strftime("%Y-%m-%d %H:%M:%S")
    }
    payload_str = json.dumps(clean_dict)

    # 1. Try Redis
    r = await _get_redis()
    if r is not None:
        try:
            await r.setex(key, ttl_seconds, payload_str)
        except Exception:
            pass

    # 2. SQLite cache backup
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO query_cache (cache_key, prompt, result_json, expires_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET
                result_json=excluded.result_json,
                expires_at=excluded.expires_at;
        """, (key, normalize_prompt(prompt), payload_str, expires_at))
        conn.commit()
        conn.close()
        return True
    except Exception:
        return False

async def clear_all_cache() -> bool:
    """Clears both Redis and SQLite caches."""
    r = await _get_redis()
    if r is not None:
        try:
            keys = await r.keys("vexa:cache:*")
            if keys:
                await r.delete(*keys)
        except Exception:
            pass

    try:
        conn = get_connection()
        conn.cursor().execute("DELETE FROM query_cache;")
        conn.commit()
        conn.close()
        return True
    except Exception:
        return False
