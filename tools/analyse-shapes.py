#!/usr/bin/env python3
"""Compute shape statistics for each country illustration via PCA on the alpha
mask of its source raster. Writes a JSON map keyed by "region/basename":

    {
      "europa/tyskland": {
        "w": 985, "h": 2130,
        "cx": 480, "cy": 1060,         # centroid in image pixels
        "angle": 92.3,                 # principal-axis angle, degrees, y-down
        "len_p": 2050,                 # extent along principal axis
        "len_s": 940                   #   "         secondary  "
      }, ...
    }

The principal-axis orientation is disambiguated by picking the direction in
which the farthest pixel from the centroid lies — same rule is applied on the
polygon side at render time, so flips cancel.
"""
import json
import os
import sys
import numpy as np
from PIL import Image

REGIONS = ['europa', 'afrika', 'asien', 'nordamerika',
           'sydamerika', 'oceanien', 'vastindien', 'usa', 'sverige']


def analyse(path):
    im = Image.open(path).convert('RGBA')
    alpha = np.asarray(im.split()[-1])
    ys, xs = np.where(alpha > 64)
    if len(xs) < 50:
        return None
    pts = np.column_stack([xs, ys]).astype(np.float64)
    cx, cy = pts.mean(axis=0)
    centered = pts - [cx, cy]
    cov = np.cov(centered.T)
    eigvals, eigvecs = np.linalg.eigh(cov)
    v = eigvecs[:, 1]  # largest eigenvalue → principal axis
    # disambiguate: orient so that the farthest pixel lies in +v direction
    proj = centered @ v
    if proj[np.argmax(np.abs(proj))] < 0:
        v = -v
    angle_deg = float(np.degrees(np.arctan2(v[1], v[0])))  # y-down
    perp = np.array([-v[1], v[0]])
    proj_p = centered @ v
    proj_s = centered @ perp
    return {
        'w': im.width, 'h': im.height,
        'cx': float(cx), 'cy': float(cy),
        'angle': angle_deg,
        'len_p': float(proj_p.max() - proj_p.min()),
        'len_s': float(proj_s.max() - proj_s.min()),
    }


def main():
    out = {}
    for region in REGIONS:
        d = os.path.join('assets', region, 'countries')
        if not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            if not fn.lower().endswith(('.webp', '.png')):
                continue
            if '_shape' in fn:
                continue
            base = fn.rsplit('.', 1)[0]
            try:
                stats = analyse(os.path.join(d, fn))
            except Exception as e:
                print(f'fail {region}/{base}: {e}', file=sys.stderr)
                continue
            if stats:
                out[f'{region}/{base}'] = stats
    print(f'Analysed {len(out)} illustrations.', file=sys.stderr)
    json.dump(out, sys.stdout)


if __name__ == '__main__':
    main()
