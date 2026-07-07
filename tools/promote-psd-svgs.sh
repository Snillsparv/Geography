#!/usr/bin/env bash
# Copy the PSD-derived SVGs from tools/psd-extracted/<region>/ on top of the
# existing assets/<region>/countries/<name>.svg. Source webp/png are kept
# untouched. Run from the repo root.
set -euo pipefail

REGIONS=(europa afrika asien nordamerika oceanien sverige usa vastindien sydamerika)
moved=0
skipped=0
for r in "${REGIONS[@]}"; do
  src="tools/psd-extracted/$r"
  dst="assets/$r/countries"
  [ -d "$src" ] || { echo "skip $r (no staging)"; continue; }
  [ -d "$dst" ] || { echo "skip $r (no asset dir)"; continue; }
  for svg in "$src"/*.svg; do
    [ -e "$svg" ] || continue
    name=$(basename "$svg")
    cp "$svg" "$dst/$name"
    moved=$((moved+1))
  done
  echo "  $r: copied $(ls "$src"/*.svg 2>/dev/null | wc -l) svgs"
done
echo "total moved: $moved"
