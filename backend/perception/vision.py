import io
import base64
from typing import Tuple, Optional, Dict, Any
from PIL import Image, ImageDraw, ImageFont
import mss

def capture_screen(
    draw_grid: bool = False,
    max_width: int = 1280,
    max_height: int = 720,
    quality: int = 80
) -> Dict[str, Any]:
    """
    Captures primary screen with mss, optionally adds a normalized 0-1000 reference grid,
    resizes to max 1280x720, and encodes to WebP format for high-speed, low-bandwidth Gemini reasoning.
    """
    img = None
    try:
        with mss.mss() as sct:
            # Monitor 1 is usually the primary display
            monitor = sct.monitors[1] if len(sct.monitors) > 1 else sct.monitors[0]
            sct_img = sct.grab(monitor)
            # Convert raw BGRA to PIL Image (RGB)
            img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
    except Exception as e:
        try:
            from PIL import ImageGrab
            img = ImageGrab.grab()
        except Exception:
            pass

    if img is None:
        # Fallback for headless CI or locked desktop
        img = Image.new("RGB", (1920, 1080), color=(15, 23, 42))
        draw = ImageDraw.Draw(img)
        draw.text((50, 50), "VEXA Virtual Screen Session", fill=(0, 240, 255))

    raw_width, raw_height = img.size

    if draw_grid:
        img = draw_normalized_grid(img)

    # Scale down while maintaining aspect ratio
    img_resized = img.copy()
    img_resized.thumbnail((max_width, max_height), Image.Resampling.LANCZOS)

    # Save to WebP in memory
    buffer = io.BytesIO()
    img_resized.save(buffer, format="WEBP", quality=quality, method=4)
    webp_bytes = buffer.getvalue()
    b64_str = base64.b64encode(webp_bytes).decode("utf-8")

    return {
        "image_bytes": webp_bytes,
        "base64": b64_str,
        "mime_type": "image/webp",
        "screen_width": raw_width,
        "screen_height": raw_height,
        "preview_width": img_resized.width,
        "preview_height": img_resized.height
    }

def draw_normalized_grid(img: Image.Image) -> Image.Image:
    """
    Draws a 10x10 normalized grid (0 to 1000) over the screenshot.
    Helps Vision LLM accurately locate UI buttons, inputs, and links.
    """
    overlay = img.copy()
    draw = ImageDraw.Draw(overlay, "RGBA")
    w, h = overlay.size

    # Grid step: 100 units on 0-1000 scale = 10 columns and 10 rows
    grid_color = (255, 0, 80, 70)      # Translucent magenta
    axis_color = (0, 220, 255, 120)    # Cyan for major axes
    text_color = (255, 255, 255, 230)

    # Horizontal lines
    for i in range(1, 10):
        norm_val = i * 100
        y = int(h * (norm_val / 1000.0))
        draw.line([(0, y), (w, y)], fill=axis_color if i == 5 else grid_color, width=1)
        draw.text((8, max(2, y - 12)), f"y={norm_val}", fill=text_color)

    # Vertical lines
    for i in range(1, 10):
        norm_val = i * 100
        x = int(w * (norm_val / 1000.0))
        draw.line([(x, 0), (x, h)], fill=axis_color if i == 5 else grid_color, width=1)
        draw.text((max(2, x + 4), 6), f"x={norm_val}", fill=text_color)

    return overlay
