#!/usr/bin/env python3
"""Generate a 1024x1024 placeholder PNG for Cardhub:
white "C" centred on indigo→fuchsia diagonal gradient with a subtle
inner shadow. Output to apps/cardhub/native/src-tauri/icons/source.png.
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import os

SIZE = 1024
OUT = Path(__file__).resolve().parent / "source.png"

# Indigo to fuchsia diagonal gradient.
top_left = (99, 102, 241)   # indigo-500
bottom_right = (217, 70, 239)  # fuchsia-500

img = Image.new("RGB", (SIZE, SIZE), top_left)
pixels = img.load()
diag_max = (SIZE - 1) * 2
for y in range(SIZE):
    for x in range(SIZE):
        t = (x + y) / diag_max
        r = int(top_left[0] + (bottom_right[0] - top_left[0]) * t)
        g = int(top_left[1] + (bottom_right[1] - top_left[1]) * t)
        b = int(top_left[2] + (bottom_right[2] - top_left[2]) * t)
        pixels[x, y] = (r, g, b)

draw = ImageDraw.Draw(img)
font = None
candidates = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/SFNS.ttf",
]
for path in candidates:
    if os.path.exists(path):
        try:
            font = ImageFont.truetype(path, 720)
            break
        except Exception:
            continue
if font is None:
    font = ImageFont.load_default()

text = "C"
bbox = draw.textbbox((0, 0), text, font=font)
text_w = bbox[2] - bbox[0]
text_h = bbox[3] - bbox[1]
text_x = (SIZE - text_w) // 2 - bbox[0]
text_y = (SIZE - text_h) // 2 - bbox[1] - 30

draw.text((text_x + 8, text_y + 8), text, font=font, fill=(0, 0, 0, 80))
draw.text((text_x, text_y), text, font=font, fill=(255, 255, 255))

img.save(OUT, "PNG", optimize=True)
print(f"wrote {OUT}")
