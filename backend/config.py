import os
import sys
import time
import asyncio
from typing import Optional, Any, List, Dict
from collections import deque
from pathlib import Path
from dotenv import load_dotenv

# Search for .env in current directory or workspace root
env_path = Path(__file__).resolve().parent.parent / ".env"
if env_path.exists():
    load_dotenv(dotenv_path=env_path)
else:
    load_dotenv()

GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
DEFAULT_WORKSPACE_PATH: str = os.getenv("DEFAULT_WORKSPACE_PATH", str(Path(__file__).resolve().parent.parent))
HOST: str = os.getenv("VEXA_HOST", "127.0.0.1")
PORT: int = int(os.getenv("VEXA_PORT", "8765"))

PRIMARY_MODEL: str = os.getenv("VEXA_PRIMARY_MODEL", "gemini-3.5-flash")
FALLBACK_MODEL: str = os.getenv("VEXA_FALLBACK_MODEL", "gemini-3.5-flash-lite")

class FreeTierRateLimiter:
    """
    Enforces Google AI Studio Free Tier constraints:
    - 10 Requests Per Minute (RPM) max
    - Minimum 6.0 seconds interval between requests
    Thread-safe and async-safe token bucket implementation.
    """
    def __init__(self, rpm: int = 10, min_interval_seconds: float = 6.0):
        self.rpm = rpm
        self.min_interval = min_interval_seconds
        self.request_timestamps: deque = deque()
        self.last_request_time: float = 0.0
        self._lock = asyncio.Lock()

    async def acquire(self):
        async with self._lock:
            now = time.monotonic()
            
            # Check minimum interval between requests
            time_since_last = now - self.last_request_time
            if time_since_last < self.min_interval:
                sleep_needed = self.min_interval - time_since_last
                await asyncio.sleep(sleep_needed)
                now = time.monotonic()

            # Clean timestamps older than 60 seconds
            while self.request_timestamps and now - self.request_timestamps[0] > 60.0:
                self.request_timestamps.popleft()

            # If 10 requests were made within the last 60 seconds, wait for the oldest to expire
            if len(self.request_timestamps) >= self.rpm:
                oldest = self.request_timestamps[0]
                sleep_needed = 60.0 - (now - oldest) + 0.1
                if sleep_needed > 0:
                    await asyncio.sleep(sleep_needed)
                    now = time.monotonic()
                    while self.request_timestamps and now - self.request_timestamps[0] > 60.0:
                        self.request_timestamps.popleft()

            self.last_request_time = now
            self.request_timestamps.append(now)

rate_limiter = FreeTierRateLimiter(rpm=10, min_interval_seconds=6.0)

def clean_schema_for_gemini(obj: Any) -> Any:
    """
    Recursively removes 'additionalProperties' from JSON schema.
    Google AI Studio Developer API rejects additionalProperties:
    'additionalProperties is only supported in Gemini Enterprise Agent Platform mode'
    """
    if hasattr(obj, "model_json_schema"):
        obj = obj.model_json_schema()
    if isinstance(obj, dict):
        clean = {}
        for k, v in obj.items():
            if k == "additionalProperties":
                continue
            clean[k] = clean_schema_for_gemini(v)
        return clean
    elif isinstance(obj, list):
        return [clean_schema_for_gemini(item) for item in obj]
    return obj

def get_genai_client():
    """Returns the official google-genai Client initialized with API key."""
    from google import genai
    key = os.getenv("GEMINI_API_KEY", GEMINI_API_KEY)
    if not key:
        raise ValueError("GEMINI_API_KEY is not set. Please set it in your .env or environment variables.")
    return genai.Client(api_key=key)

async def call_gemini_with_resilience(
    contents: Any,
    system_instruction: Optional[str] = None,
    response_schema: Optional[Any] = None,
    temperature: float = 0.2,
    max_output_tokens: Optional[int] = None
) -> str:
    """
    Resilient caller for Gemini models:
    - Waits on FreeTierRateLimiter (10 RPM, 6s spacing)
    - Strips additionalProperties from response_schema
    - Retries with exponential backoff on 429 Quota Exceeded and 503 high demand
    - Automatically falls back across active models (gemini-3.5-flash, gemini-3.5-flash-lite, etc.)
    """
    from google import genai
    from google.genai import types

    client = get_genai_client()
    models_to_try = [
        PRIMARY_MODEL,
        FALLBACK_MODEL,
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.8-flash",
        "gemini-flash-latest"
    ]
    # Deduplicate while preserving order
    seen = set()
    unique_models = []
    for m in models_to_try:
        if m and m not in seen:
            seen.add(m)
            unique_models.append(m)

    sanitized_schema = clean_schema_for_gemini(response_schema) if response_schema else None

    for model_name in unique_models:
        backoff_delays = [6.0, 12.0]
        for attempt in range(len(backoff_delays) + 1):
            await rate_limiter.acquire()
            try:
                config_kwargs = {}
                if system_instruction:
                    config_kwargs["system_instruction"] = system_instruction
                if temperature is not None:
                    config_kwargs["temperature"] = temperature
                if max_output_tokens is not None:
                    config_kwargs["max_output_tokens"] = max_output_tokens
                if sanitized_schema:
                    config_kwargs["response_mime_type"] = "application/json"
                    config_kwargs["response_schema"] = sanitized_schema

                config = types.GenerateContentConfig(**config_kwargs) if config_kwargs else None

                # Execute synchronously in thread pool to prevent blocking async loop
                loop = asyncio.get_running_loop()
                response = await loop.run_in_executor(
                    None,
                    lambda: client.models.generate_content(
                        model=model_name,
                        contents=contents,
                        config=config
                    )
                )
                if response and response.text:
                    return response.text
                return ""
            except Exception as e:
                err_msg = str(e).lower()
                is_transient = "429" in err_msg or "resource_exhausted" in err_msg or "quota" in err_msg or "503" in err_msg
                is_not_found = "404" in err_msg or "not_found" in err_msg

                if is_not_found:
                    print(f"[VEXA Fallback] Model {model_name} not found. Trying next available model...")
                    break  # Move to next model immediately

                if is_transient:
                    if attempt < len(backoff_delays):
                        delay = backoff_delays[attempt]
                        print(f"[VEXA RateLimit] Transient error on {model_name}. Backing off {delay}s...")
                        await asyncio.sleep(delay)
                        continue
                    else:
                        print(f"[VEXA Fallback] Model {model_name} busy. Trying next available model...")
                        break  # Move to next model
                else:
                    raise e

    raise RuntimeError("All configured Gemini models failed. Please verify your GEMINI_API_KEY in .env.")
