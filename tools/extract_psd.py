#!/usr/bin/env python3
"""
Geography Quiz — PSD Layer Extractor

Extracts layers from PSD files into optimized WebP images
ready for the geography quiz game.

Layer naming conventions:
  - "Overlay"                → extracted as overlay.webp (contour lines)
  - "bg" / "Background"     → skipped (solid background fill)
  - "Karta" or largest layer → extracted as map.webp (base map)
  - Everything else          → extracted as individual country/region images

The layer name becomes the display name in the game, so name
your layers in Swedish (e.g. "Argentina", "Brasilien", "Skåne").

Usage:
    pip install psd-tools Pillow
    python tools/extract_psd.py
"""

import os
import sys
import json
import time
from pathlib import Path

try:
    from psd_tools import PSDImage
    from PIL import Image
except ImportError:
    print("Missing dependencies! Run:")
    print("  pip install psd-tools Pillow")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
PSD_DIR = PROJECT_DIR / "psd"
ASSETS_DIR = PROJECT_DIR / "assets"

# Max pixels on longest side (keeps file sizes manageable for web)
MAX_DIMENSION = 4000

# WebP quality (80-90 is a good balance between quality and file size)
WEBP_QUALITY = 85

# Layer names to skip (case-insensitive)
SKIP_NAMES = {"bg", "background", "bakgrund"}

# Layer names recognized as overlay (case-insensitive)
OVERLAY_NAMES = {"overlay"}

# Layer names recognized as base map (case-insensitive)
MAP_NAMES = {"karta", "map"}

# PSD filename → asset folder name
REGION_FOLDERS = {
    "Afrika": "afrika",
    "Asien": "asien",
    "Europa": "europa",
    "Nordamerika": "nordamerika",
    "Oceanien": "oceanien",
    "Sverige": "sverige",
    "USA": "usa",
    "Västindien": "vastindien",
    "Sydamerika 3": "sydamerika",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def safe_filename(name):
    """Convert a layer name to a safe, lowercase filename (no extension)."""
    s = name.strip().lower()
    replacements = {
        "å": "a", "ä": "a", "ö": "o",
        "é": "e", "è": "e", "ë": "e",
        "ü": "u", "ñ": "n",
        " ": "_", "-": "_",
    }
    for old, new in replacements.items():
        s = s.replace(old, new)
    return "".join(c for c in s if c.isalnum() or c == "_")


def classify_layer(layer):
    """Return one of: 'skip', 'overlay', 'map', 'country'."""
    name = layer.name.strip().lower()
    if name in SKIP_NAMES:
        return "skip"
    if name in OVERLAY_NAMES:
        return "overlay"
    if name in MAP_NAMES:
        return "map"
    return "country"


def export_layer(layer, output_path, scale=1.0):
    """Composite a single layer and save as WebP. Returns (width, height)."""
    img = layer.composite()
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    if scale < 1.0:
        new_w = max(1, round(img.width * scale))
        new_h = max(1, round(img.height * scale))
        img = img.resize((new_w, new_h), Image.LANCZOS)
    img.save(str(output_path), "WEBP", quality=WEBP_QUALITY)
    return img.width, img.height


def format_size(path):
    """Return human-readable file size."""
    size = path.stat().st_size
    if size < 1024:
        return f"{size} B"
    elif size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    else:
        return f"{size / (1024 * 1024):.1f} MB"


# ---------------------------------------------------------------------------
# Main extraction
# ---------------------------------------------------------------------------

def extract_psd(psd_path, output_dir):
    """Extract all usable layers from a PSD file into output_dir."""
    print(f"\n{'=' * 60}")
    print(f"  {psd_path.name}")
    print(f"{'=' * 60}")

    psd = PSDImage.open(str(psd_path))
    print(f"  Canvas: {psd.width} x {psd.height}")

    # Scale factor
    max_dim = max(psd.width, psd.height)
    scale = min(1.0, MAX_DIMENSION / max_dim)
    if scale < 1.0:
        print(f"  Scaling to {scale:.0%} (max {MAX_DIMENSION}px)")

    # Output dirs
    countries_dir = output_dir / "countries"
    countries_dir.mkdir(parents=True, exist_ok=True)

    # Classify layers (top-level only; groups are flattened)
    map_layer = None
    overlay_layer = None
    country_layers = []

    def walk_layers(layers):
        """Recursively walk layer tree, yielding leaf layers."""
        for layer in layers:
            if layer.is_group():
                yield from walk_layers(layer)
            else:
                yield layer

    for layer in walk_layers(psd):
        role = classify_layer(layer)
        tag = f"[{role.upper()}]"
        print(f"    {tag:10s} '{layer.name}' ({layer.width}x{layer.height})")

        if role == "skip":
            continue
        elif role == "overlay":
            overlay_layer = layer
        elif role == "map":
            map_layer = layer
        else:
            country_layers.append(layer)

    # Auto-detect map if not explicitly named
    if map_layer is None and country_layers:
        canvas_area = psd.width * psd.height
        candidates = sorted(country_layers, key=lambda l: l.width * l.height, reverse=True)
        biggest = candidates[0]
        if biggest.width * biggest.height > canvas_area * 0.4:
            map_layer = biggest
            country_layers.remove(biggest)
            print(f"\n  Auto-detected base map: '{map_layer.name}'")
        else:
            print(f"\n  WARNING: Could not identify a base map layer!")
            print(f"           Name your base map layer 'Karta' and re-run.")

    # --- Extract map ---
    config = {
        "name": psd_path.stem,
        "canvasWidth": round(psd.width * scale),
        "canvasHeight": round(psd.height * scale),
        "countries": [],
    }

    if map_layer:
        out_path = output_dir / "map.webp"
        w, h = export_layer(map_layer, out_path, scale)
        config["mapWidth"] = w
        config["mapHeight"] = h
        config["mapOffset"] = {
            "left": round(map_layer.left * scale),
            "top": round(map_layer.top * scale),
        }
        print(f"\n  Saved map.webp ({w}x{h}, {format_size(out_path)})")

    # --- Extract overlay ---
    if overlay_layer:
        out_path = output_dir / "overlay.webp"
        w, h = export_layer(overlay_layer, out_path, scale)
        print(f"  Saved overlay.webp ({w}x{h}, {format_size(out_path)})")
    else:
        print(f"\n  WARNING: No 'Overlay' layer found!")

    # --- Extract countries/regions ---
    print(f"\n  Extracting {len(country_layers)} regions...")
    total_size = 0

    for layer in country_layers:
        fname = safe_filename(layer.name)
        out_path = countries_dir / f"{fname}.webp"
        w, h = export_layer(layer, out_path, scale)
        fsize = out_path.stat().st_size
        total_size += fsize

        config["countries"].append({
            "name": layer.name.strip(),
            "file": f"countries/{fname}.webp",
            "left": round(layer.left * scale),
            "top": round(layer.top * scale),
            "width": w,
            "height": h,
        })
        print(f"    {fname}.webp ({w}x{h}, {format_size(out_path)})")

    # --- Save config ---
    config_path = output_dir / "config.json"
    with open(str(config_path), "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)

    # --- Summary ---
    all_files = list(output_dir.rglob("*.webp"))
    total_all = sum(f.stat().st_size for f in all_files)
    print(f"\n  Summary for {psd_path.stem}:")
    print(f"    Regions:    {len(config['countries'])}")
    print(f"    Total size: {total_all / (1024 * 1024):.1f} MB")

    return config


def main():
    print()
    print("  Geography Quiz — PSD Layer Extractor")
    print("  =====================================")
    print()

    # Collect PSD files
    psd_files = []

    if PSD_DIR.exists():
        psd_files.extend(sorted(PSD_DIR.glob("*.psd")))

    # Also look for Sydamerika PSDs in project root
    psd_files.extend(sorted(PROJECT_DIR.glob("Sydamerika*.psd")))

    if not psd_files:
        print("  No PSD files found!")
        print(f"  Looked in: {PSD_DIR}")
        print(f"         and: {PROJECT_DIR}")
        sys.exit(1)

    # Filter out LFS pointer files (< 1 KB)
    real_files = []
    lfs_files = []
    for p in psd_files:
        if p.stat().st_size < 1024:
            lfs_files.append(p)
        else:
            real_files.append(p)

    if lfs_files:
        print(f"  Skipping {len(lfs_files)} Git LFS pointer(s):")
        for p in lfs_files:
            print(f"    - {p.name} (only {p.stat().st_size} bytes — not downloaded)")
        print()
        print("  If these should be real files, run: git lfs pull")
        print()

    if not real_files:
        print("  No real PSD files found (all are LFS pointers).")
        print("  Make sure the actual PSD files are in the 'psd/' folder.")
        sys.exit(1)

    print(f"  Found {len(real_files)} PSD file(s) to process")

    start = time.time()
    results = {}

    for psd_path in real_files:
        stem = psd_path.stem
        folder = REGION_FOLDERS.get(stem, safe_filename(stem))
        output_dir = ASSETS_DIR / folder

        try:
            config = extract_psd(psd_path, output_dir)
            results[stem] = config
        except Exception as e:
            print(f"\n  ERROR processing {psd_path.name}: {e}")
            import traceback
            traceback.print_exc()
            continue

    elapsed = time.time() - start

    # Final summary
    print(f"\n{'=' * 60}")
    print(f"  All done! ({elapsed:.1f}s)")
    print(f"{'=' * 60}")
    print()
    for name, config in results.items():
        folder = REGION_FOLDERS.get(name, safe_filename(name))
        print(f"  {name}: {len(config['countries'])} regions → assets/{folder}/")
    print()
    print("  Next steps:")
    print("    1. Check that the images look correct")
    print("    2. git add assets/")
    print("    3. git commit -m 'Add extracted region assets'")
    print("    4. git push")
    print()


if __name__ == "__main__":
    main()
