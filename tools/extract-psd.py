#!/usr/bin/env python3
"""Extract each country layer from the region PSDs into transparent PNGs.

The hand-drawn region masters live as Git-LFS PSDs (psd/Europa.psd, etc.) at
much higher resolution than the downscaled webp in the repo. This script
opens each PSD, walks its top-level layers, and writes the named country
layers as RGBA PNGs into a staging directory. The PNGs are then fed back
through tools/vectorize.mjs to produce sharper SVGs.

Layer-name → config filename mapping uses a normalising rule (lowercase,
replace ' ', '-' → '_', strip diacritics). Layers named Background, Karta,
Overlay, etc. are skipped.

Usage:
  python3 tools/extract-psd.py [--out DIR] [region [region ...]]
    out:    staging directory (default tools/psd-extracted)
    region: limit to one or more region slugs; default = all known regions
"""
import argparse
import json
import os
import sys
from pathlib import Path

import psd_tools


# region slug -> path to the master PSD
PSDS = {
    'europa':      'psd/Europa.psd',
    'afrika':      'psd/Afrika.psd',
    'asien':       'psd/Asien.psd',
    'nordamerika': 'psd/Nordamerika.psd',
    'oceanien':    'psd/Oceanien.psd',
    'sverige':     'psd/Sverige.psd',
    'usa':         'psd/USA.psd',
    'vastindien':  'psd/Västindien.psd',
    'sydamerika':  'Sydamerika 3.psd',
}

# Background / map / overlay layers — not countries.
SKIP_NORMALISED = {'background', 'bg', 'karta', 'overlay', 'kart', 'kartan'}


def norm(s: str) -> str:
    s = s.lower().replace(' ', '_').replace('-', '_').replace('/', '_')
    s = (s.replace('å', 'a').replace('ä', 'a').replace('ö', 'o')
          .replace('é', 'e').replace('è', 'e').replace('ü', 'u'))
    return ''.join(c for c in s if c.isalnum() or c == '_')


def extract_region(region: str, psd_path: str, out_root: Path) -> dict:
    cfg_path = Path('assets') / region / 'config.json'
    cfg = json.loads(cfg_path.read_text())
    cfg_names = {c['filename']: c for c in cfg['countries']}

    out_dir = out_root / region
    out_dir.mkdir(parents=True, exist_ok=True)

    psd = psd_tools.PSDImage.open(psd_path)
    extracted, unmatched_psd, errors = 0, [], []
    unmatched_cfg = set(cfg_names)

    for layer in psd:
        if not getattr(layer, 'visible', True):
            continue
        nm = norm(layer.name)
        if nm in SKIP_NORMALISED:
            continue
        if nm not in cfg_names:
            unmatched_psd.append(layer.name)
            continue
        try:
            img = layer.composite()
            if img is None:
                errors.append(f'{layer.name}: composite() returned None')
                continue
            img.save(out_dir / f'{nm}.png')
            unmatched_cfg.discard(nm)
            extracted += 1
        except Exception as e:
            errors.append(f'{layer.name}: {e}')

    return {
        'region': region,
        'extracted': extracted,
        'total': len(cfg_names),
        'unmatched_psd': unmatched_psd,
        'unmatched_cfg': sorted(unmatched_cfg),
        'errors': errors,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--out', default='tools/psd-extracted',
                    help='staging directory for extracted PNGs')
    ap.add_argument('regions', nargs='*', help='region slugs (default: all)')
    args = ap.parse_args()

    targets = args.regions or list(PSDS.keys())
    out_root = Path(args.out)
    out_root.mkdir(parents=True, exist_ok=True)

    summary = []
    for region in targets:
        if region not in PSDS:
            print(f'unknown region: {region}', file=sys.stderr)
            continue
        psd_path = PSDS[region]
        if not Path(psd_path).exists():
            print(f'{region}: PSD missing ({psd_path})', file=sys.stderr)
            continue
        print(f'{region}: extracting {psd_path} → {out_root / region}', file=sys.stderr)
        result = extract_region(region, psd_path, out_root)
        summary.append(result)
        print(f'  {result["extracted"]}/{result["total"]} extracted', file=sys.stderr)
        if result['unmatched_psd']:
            print(f'  layers without config match: {result["unmatched_psd"]}', file=sys.stderr)
        if result['unmatched_cfg']:
            print(f'  config countries missing in PSD: {result["unmatched_cfg"]}', file=sys.stderr)
        if result['errors']:
            for e in result['errors']:
                print(f'  ERROR {e}', file=sys.stderr)

    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
