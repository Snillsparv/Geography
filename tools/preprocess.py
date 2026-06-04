#!/usr/bin/env python3
"""Clean up raster country images before vectorization.

Lossy WebP/JPEG scans carry compression speckle. This step:

  1. keeps the alpha channel (the country cut-out shape) and hard-thresholds it
     so edges stay crisp with no semi-transparent halo,
  2. applies a light median filter to remove speckle,
  3. (optional) quantizes to a clean adaptive palette.

Colour quantization is OFF by default: an aggressive palette drops the colour
of small regions (e.g. a pink nose snapping to the nearest cream), so we let
VTracer's own colour clustering handle colour instead. Set VEC_COLORS > 0 to
opt back in for smaller files when an image's palette is simple.

Reads a JSON manifest on stdin: [{"src": "...", "prepped": "..."}, ...]
"""
import sys
import json
import os
from PIL import Image, ImageFilter

# Tunables (kept generous so we never sacrifice colour/detail richness).
COLORS = int(os.environ.get("VEC_COLORS", "0"))  # 0 = no quantization
MEDIAN = int(os.environ.get("VEC_MEDIAN", "3"))
ALPHA_THRESHOLD = int(os.environ.get("VEC_ALPHA", "128"))


def prep(src, dst):
    im = Image.open(src).convert("RGBA")
    r, g, b, a = im.split()
    rgb = Image.merge("RGB", (r, g, b))
    if MEDIAN > 1:
        rgb = rgb.filter(ImageFilter.MedianFilter(size=MEDIAN))
    if COLORS > 0:
        rgb = rgb.quantize(colors=COLORS, method=Image.MEDIANCUT, dither=Image.NONE).convert("RGB")
    out = Image.merge("RGBA", (*rgb.split(), a))
    out.putalpha(a.point(lambda v: 255 if v >= ALPHA_THRESHOLD else 0))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    out.save(dst)


def main():
    manifest = json.load(sys.stdin)
    for i, item in enumerate(manifest):
        prep(item["src"], item["prepped"])
        if (i + 1) % 25 == 0 or i + 1 == len(manifest):
            print(f"  preprocessed {i + 1}/{len(manifest)}", file=sys.stderr)


if __name__ == "__main__":
    main()
