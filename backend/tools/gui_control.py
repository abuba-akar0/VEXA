import sys
import ctypes
import time
import asyncio
from typing import Tuple, List, Optional, Callable

# CRITICAL REQUIREMENT 1: Windows High-DPI Scaling Fix
if sys.platform == "win32":
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        pass

import pyautogui

# Set PyAutoGUI safety rails
pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.05

def get_screen_resolution() -> Tuple[int, int]:
    """Returns the physical primary screen width and height."""
    return pyautogui.size()

def norm_to_pixel(norm_x: int, norm_y: int) -> Tuple[int, int]:
    """
    Translates normalized coordinates (0 to 1000) to physical pixel coordinates.
    Guarantees 1:1 mapping on High-DPI scaled displays.
    """
    screen_w, screen_h = pyautogui.size()
    # Clamp within 0-1000
    clamped_x = max(0, min(1000, norm_x))
    clamped_y = max(0, min(1000, norm_y))
    px = int((clamped_x / 1000.0) * screen_w)
    py = int((clamped_y / 1000.0) * screen_h)
    return px, py

async def execute_pre_click_ghosting(pre_click_hook: Optional[Callable] = None):
    """
    CRITICAL REQUIREMENT 5: Pre-Click Overlay Ghosting.
    Triggers the pre-click hook (which broadcasts 'pre_click_hide' via WebSocket)
    and waits 150ms so the Tauri overlay becomes click-through and translucent,
    preventing accidental self-clicks.
    """
    if pre_click_hook:
        try:
            if asyncio.iscoroutinefunction(pre_click_hook):
                await pre_click_hook()
            else:
                pre_click_hook()
            await asyncio.sleep(0.15)
        except Exception as e:
            print(f"[VEXA GUI] Pre-click ghosting hook warning: {e}")
            await asyncio.sleep(0.15)
    else:
        await asyncio.sleep(0.15)

async def click(
    norm_x: int,
    norm_y: int,
    pre_click_hook: Optional[Callable] = None
) -> Tuple[int, int]:
    """Performs pre-click ghosting, smooth human-like movement, and a primary mouse click."""
    px, py = norm_to_pixel(norm_x, norm_y)
    await execute_pre_click_ghosting(pre_click_hook)
    pyautogui.moveTo(px, py, duration=0.2, tween=pyautogui.easeInOutQuad)
    pyautogui.click(px, py)
    return px, py

async def double_click(
    norm_x: int,
    norm_y: int,
    pre_click_hook: Optional[Callable] = None
) -> Tuple[int, int]:
    """Performs pre-click ghosting and double clicks at the target coordinates."""
    px, py = norm_to_pixel(norm_x, norm_y)
    await execute_pre_click_ghosting(pre_click_hook)
    pyautogui.moveTo(px, py, duration=0.2, tween=pyautogui.easeInOutQuad)
    pyautogui.doubleClick(px, py)
    return px, py

async def right_click(
    norm_x: int,
    norm_y: int,
    pre_click_hook: Optional[Callable] = None
) -> Tuple[int, int]:
    """Performs pre-click ghosting and right clicks at the target coordinates."""
    px, py = norm_to_pixel(norm_x, norm_y)
    await execute_pre_click_ghosting(pre_click_hook)
    pyautogui.moveTo(px, py, duration=0.2, tween=pyautogui.easeInOutQuad)
    pyautogui.rightClick(px, py)
    return px, py

async def drag(
    from_x: int,
    from_y: int,
    to_x: int,
    to_y: int,
    pre_click_hook: Optional[Callable] = None
):
    """Drags mouse from start to end coordinates."""
    start_px, start_py = norm_to_pixel(from_x, from_y)
    end_px, end_py = norm_to_pixel(to_x, to_y)
    await execute_pre_click_ghosting(pre_click_hook)
    pyautogui.moveTo(start_px, start_py, duration=0.2)
    pyautogui.dragTo(end_px, end_py, duration=0.4, button="left")

def type_text(text: str, interval: float = 0.01):
    """
    Types text. Handles both ASCII strings and special clipboard-pasted strings
    for unicode safety.
    """
    if any(ord(char) > 127 for char in text):
        import pyperclip
        pyperclip.copy(text)
        pyautogui.hotkey("ctrl", "v")
    else:
        pyautogui.write(text, interval=interval)

def press_key(key: str):
    """Presses a single key or shortcut (e.g. 'enter', 'tab', 'esc', 'backspace')."""
    sanitized = key.strip().lower()
    pyautogui.press(sanitized)

def hotkey(keys: List[str]):
    """Presses a combination of keys simultaneously (e.g. ['ctrl', 'c'])."""
    sanitized = [k.strip().lower() for k in keys]
    pyautogui.hotkey(*sanitized)

def scroll(amount: int):
    """Scrolls vertically (positive=up, negative=down)."""
    pyautogui.scroll(amount)

async def wait_seconds(seconds: float):
    """Pauses execution for specified seconds."""
    await asyncio.sleep(max(0.05, seconds))
