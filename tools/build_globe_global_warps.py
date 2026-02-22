#!/usr/bin/env python3
"""
Build globe warps by fitting one smooth warp field per 2D source region.

Compared to per-country geometric warps, this keeps a single continuous
transformation for all countries in a region, which improves border continuity.

Outputs:
  - assets/globe/warped/<feature_key>.webp
  - updates assets/globe/config.json with warp metadata
  - assets/globe/global_warp_report.json with diagnostics
  - optional preview PNGs in artifacts/global_warp_previews/

Requires:
  .venv/bin/pip install opencv-contrib-python-headless pillow numpy
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np
from PIL import Image, ImageDraw


# Raster/alpha handling
ALPHA_THRESHOLD = 8
OUTPUT_ALPHA_THRESHOLD = 10

# Export settings
WARP_WEBP_LOSSLESS = True
WARP_WEBP_QUALITY = 100
WARP_WEBP_METHOD = 6

# Keep this conservative to protect mnemonic art from aggressive bending.
DEFAULT_TPS_REG = 0.0010
DEFAULT_MAX_CTRL = 420
DEFAULT_DIRECTIONS = 12

# Region-specific tuning where one global default is not sufficient.
REGION_PARAM_OVERRIDES = {
    "afrika": {
        "tps_reg": 0.0010,
        "max_control_points": 650,
        "directions": 16,
    },
    "europa": {
        "tps_reg": 0.0010,
        "max_control_points": 650,
        "directions": 16,
    },
    "nordamerika": {
        "tps_reg": 0.00025,
        "max_control_points": 1200,
        "directions": 24,
    },
    "oceanien": {
        "tps_reg": 0.0002,
        "max_control_points": 700,
        "directions": 16,
    }
    ,
    "sydamerika": {
        "tps_reg": 0.0010,
        "max_control_points": 900,
        "directions": 20,
    },
    "vastindien": {
        "tps_reg": 0.0010,
        "max_control_points": 650,
        "directions": 16,
    },
}


@dataclass
class BBox:
    left: int
    top: int
    width: int
    height: int


@dataclass
class TargetShape:
    mask: np.ndarray
    bbox: BBox


@dataclass
class RegionCountryJob:
    country: Dict
    source_region: str
    source_path: Path
    source_rgba: np.ndarray
    source_left: int
    source_top: int
    target_shape: TargetShape
    target_area: int


RELAXED_CLIP_FEATURE_KEYS = {
    # Archipelagos / elongated island shapes where strict clipping can
    # erase too much mnemonic content after global warp.
    "BHS",
    "CUB",
    "FJI",
    "SLB",
    "KIR",
    "COM",
    "MUS",
    "MHL",
    "TON",
    "TUV",
    "NRU",
}


class AffineMap:
    def __init__(self, matrix: np.ndarray):
        self.matrix = matrix.astype(np.float64)

    def transform(self, points: np.ndarray) -> np.ndarray:
        p = np.asarray(points, dtype=np.float64)
        x = np.column_stack([p, np.ones(len(p), dtype=np.float64)])
        return x @ self.matrix


class ThinPlateSplineResidual:
    """2D TPS residual map with light Tikhonov regularization."""

    def __init__(self):
        self.ctrl = np.empty((0, 2), dtype=np.float64)
        self.ctrl_norm = np.empty((0, 2), dtype=np.float64)
        self.w = np.empty((0, 2), dtype=np.float64)
        self.a = np.zeros((3, 2), dtype=np.float64)
        self.center = np.zeros(2, dtype=np.float64)
        self.scale = 1.0
        self.fitted = False

    @staticmethod
    def _kernel(r2: np.ndarray) -> np.ndarray:
        # U(r) = r^2 * log(r^2), with U(0)=0.
        safe = np.maximum(r2, 1e-12)
        out = r2 * np.log(safe)
        out[r2 < 1e-12] = 0.0
        return out

    @staticmethod
    def _pairwise_sqdist(a: np.ndarray, b: np.ndarray) -> np.ndarray:
        aa = np.sum(a * a, axis=1, keepdims=True)
        bb = np.sum(b * b, axis=1, keepdims=True).T
        d = aa + bb - 2.0 * (a @ b.T)
        return np.maximum(d, 0.0)

    @staticmethod
    def _unique_rows(points: np.ndarray, values: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        if len(points) == 0:
            return points, values
        rounded = np.round(points, 3)
        uniq, inv = np.unique(rounded, axis=0, return_inverse=True)
        out_vals = np.zeros((len(uniq), values.shape[1]), dtype=np.float64)
        counts = np.zeros(len(uniq), dtype=np.float64)
        for i, idx in enumerate(inv):
            out_vals[idx] += values[i]
            counts[idx] += 1.0
        out_vals /= np.maximum(counts[:, None], 1.0)
        return uniq.astype(np.float64), out_vals

    @staticmethod
    def _select_controls(points: np.ndarray, values: np.ndarray, max_ctrl: int) -> Tuple[np.ndarray, np.ndarray]:
        n = len(points)
        if n <= max_ctrl:
            return points, values

        # Even angular sampling around centroid keeps coverage while capping solve cost.
        c = np.mean(points, axis=0)
        ang = np.arctan2(points[:, 1] - c[1], points[:, 0] - c[0])
        rad = np.linalg.norm(points - c, axis=1)
        order = np.lexsort((-rad, ang))
        picks = np.linspace(0, n - 1, max_ctrl, dtype=np.int32)
        idx = order[picks]
        return points[idx], values[idx]

    def fit(self, points: np.ndarray, residuals: np.ndarray, reg: float, max_ctrl: int) -> bool:
        p = np.asarray(points, dtype=np.float64)
        r = np.asarray(residuals, dtype=np.float64)
        if len(p) < 6:
            self.fitted = False
            return False

        p, r = self._unique_rows(p, r)
        p, r = self._select_controls(p, r, max_ctrl=max_ctrl)
        n = len(p)
        if n < 6:
            self.fitted = False
            return False

        self.center = np.mean(p, axis=0)
        span = np.ptp(p, axis=0)
        self.scale = float(max(span[0], span[1], 1.0))
        self.ctrl = p
        self.ctrl_norm = (p - self.center) / self.scale

        k = self._kernel(self._pairwise_sqdist(self.ctrl_norm, self.ctrl_norm))
        pmat = np.column_stack(
            [
                np.ones(n, dtype=np.float64),
                self.ctrl_norm[:, 0],
                self.ctrl_norm[:, 1],
            ]
        )

        # [K+regI  P] [w] = [r]
        # [P^T     0] [a]   [0]
        l_top = np.concatenate([k + reg * np.eye(n), pmat], axis=1)
        l_bot = np.concatenate([pmat.T, np.zeros((3, 3), dtype=np.float64)], axis=1)
        lhs = np.concatenate([l_top, l_bot], axis=0)
        rhs = np.concatenate([r, np.zeros((3, 2), dtype=np.float64)], axis=0)

        try:
            sol = np.linalg.solve(lhs, rhs)
        except np.linalg.LinAlgError:
            sol, *_ = np.linalg.lstsq(lhs, rhs, rcond=None)

        self.w = sol[:n]
        self.a = sol[n:]
        self.fitted = True
        return True

    def eval(self, points: np.ndarray, chunk_size: int = 65536) -> np.ndarray:
        p = np.asarray(points, dtype=np.float64)
        if not self.fitted or len(self.ctrl) == 0:
            return np.zeros((len(p), 2), dtype=np.float64)

        out = np.zeros((len(p), 2), dtype=np.float64)
        p_norm = (p - self.center) / self.scale

        start = 0
        while start < len(p):
            end = min(len(p), start + chunk_size)
            q = p_norm[start:end]
            dist2 = self._pairwise_sqdist(q, self.ctrl_norm)
            u = self._kernel(dist2)
            affine = np.column_stack(
                [
                    np.ones(len(q), dtype=np.float64),
                    q[:, 0],
                    q[:, 1],
                ]
            ) @ self.a
            out[start:end] = affine + u @ self.w
            start = end

        return out


class RegionWarpModel:
    def __init__(self, atlas_w: int, unwrap_center_x: float):
        self.atlas_w = float(atlas_w)
        self.unwrap_center_x = float(unwrap_center_x)
        self.affine_fwd = AffineMap(np.zeros((3, 2), dtype=np.float64))
        self.affine_inv = AffineMap(np.zeros((3, 2), dtype=np.float64))
        self.tps_fwd = ThinPlateSplineResidual()
        self.tps_inv = ThinPlateSplineResidual()

    def unwrap_x(self, x: np.ndarray) -> np.ndarray:
        period = self.atlas_w
        c = self.unwrap_center_x
        d = x - c
        out = x.copy()
        out[d > period * 0.5] -= period
        out[d < -period * 0.5] += period
        return out

    @staticmethod
    def _fit_affine(src: np.ndarray, dst: np.ndarray, weights: np.ndarray) -> AffineMap:
        s = np.asarray(src, dtype=np.float64)
        t = np.asarray(dst, dtype=np.float64)
        w = np.asarray(weights, dtype=np.float64).reshape(-1)
        x = np.column_stack([s, np.ones(len(s), dtype=np.float64)])
        sw = np.sqrt(np.maximum(w, 1e-6))[:, None]
        xw = x * sw
        tw = t * sw
        mat, *_ = np.linalg.lstsq(xw, tw, rcond=None)
        return AffineMap(mat)

    def fit(
        self,
        src_pts: np.ndarray,
        dst_pts_mod: np.ndarray,
        weights: np.ndarray,
        tps_reg: float,
        max_ctrl: int,
    ) -> Dict:
        src = np.asarray(src_pts, dtype=np.float64)
        dst = np.asarray(dst_pts_mod, dtype=np.float64)
        w = np.asarray(weights, dtype=np.float64)

        dst_unwrapped = dst.copy()
        dst_unwrapped[:, 0] = self.unwrap_x(dst_unwrapped[:, 0])

        self.affine_fwd = self._fit_affine(src, dst_unwrapped, w)
        fwd_aff = self.affine_fwd.transform(src)
        fwd_res = dst_unwrapped - fwd_aff
        self.tps_fwd.fit(src, fwd_res, reg=tps_reg, max_ctrl=max_ctrl)

        self.affine_inv = self._fit_affine(dst_unwrapped, src, w)
        inv_aff = self.affine_inv.transform(dst_unwrapped)
        inv_res = src - inv_aff
        self.tps_inv.fit(dst_unwrapped, inv_res, reg=tps_reg, max_ctrl=max_ctrl)

        pred = self.forward(src)
        err = np.linalg.norm(pred - dst_unwrapped, axis=1)
        rmse = float(np.sqrt(np.mean(err * err))) if len(err) else 0.0
        p95 = float(np.percentile(err, 95)) if len(err) else 0.0
        return {
            "anchorCount": int(len(src)),
            "anchorRmsePx": rmse,
            "anchorP95Px": p95,
        }

    def forward(self, src_pts: np.ndarray) -> np.ndarray:
        src = np.asarray(src_pts, dtype=np.float64)
        return self.affine_fwd.transform(src) + self.tps_fwd.eval(src)

    def inverse(self, dst_pts_mod: np.ndarray) -> np.ndarray:
        dst = np.asarray(dst_pts_mod, dtype=np.float64)
        dst_u = dst.copy()
        dst_u[:, 0] = self.unwrap_x(dst_u[:, 0])
        return self.affine_inv.transform(dst_u) + self.tps_inv.eval(dst_u)


def load_json(path: Path) -> Dict:
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, data: Dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def derive_filename(country: Dict) -> str:
    if country.get("filename"):
        return str(country["filename"])
    file_name = str(country.get("file", ""))
    return file_name.replace("countries/", "").replace(".webp", "")


def project_lon_lat(lon: float, lat: float, atlas_w: int, atlas_h: int) -> Tuple[float, float]:
    x = ((lon + 180.0) / 360.0) * atlas_w
    y = ((90.0 - lat) / 180.0) * atlas_h
    return x, y


def geometry_polygons(geometry: Dict) -> List[List[np.ndarray]]:
    if geometry["type"] == "Polygon":
        return [[np.asarray(r, dtype=np.float32) for r in geometry["coordinates"]]]
    if geometry["type"] == "MultiPolygon":
        return [[np.asarray(r, dtype=np.float32) for r in poly] for poly in geometry["coordinates"]]
    raise ValueError(f"Unsupported geometry type: {geometry['type']}")


def project_ring_wrapped(ring: Sequence[Sequence[float]], atlas_w: int, atlas_h: int) -> np.ndarray:
    pts = np.array([project_lon_lat(p[0], p[1], atlas_w, atlas_h) for p in ring], dtype=np.float32)
    if pts.size == 0:
        return pts
    min_x = float(np.min(pts[:, 0]))
    max_x = float(np.max(pts[:, 0]))
    if max_x - min_x > atlas_w * 0.5:
        pts[:, 0] = np.where(pts[:, 0] < atlas_w * 0.5, pts[:, 0] + atlas_w, pts[:, 0])
    return pts


def ring_signed_area(ring: np.ndarray) -> float:
    if len(ring) < 3:
        return 0.0
    x = ring[:, 0]
    y = ring[:, 1]
    return 0.5 * float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))


def choose_polygon_branch_shifts(polygons_xy: List[List[np.ndarray]], atlas_w: int) -> List[float]:
    if len(polygons_xy) <= 1:
        return [0.0] * len(polygons_xy)

    areas = [abs(ring_signed_area(poly[0])) if poly and len(poly[0]) >= 3 else 0.0 for poly in polygons_xy]
    centers = [float(np.mean(poly[0][:, 0])) if poly and len(poly[0]) else 0.0 for poly in polygons_xy]
    anchor = int(np.argmax(areas))

    shifts: List[Optional[float]] = [None] * len(polygons_xy)
    shifts[anchor] = 0.0
    chosen = [centers[anchor]]

    order = [i for i in np.argsort(-np.array(areas)) if i != anchor]
    for idx in order:
        best_shift = 0.0
        best_score = float("inf")
        for mul in (-1.0, 0.0, 1.0):
            shift = mul * float(atlas_w)
            c = centers[idx] + shift
            span = max(chosen + [c]) - min(chosen + [c])
            score = span + 0.08 * abs(c - centers[anchor])
            if score < best_score:
                best_score = score
                best_shift = shift
        shifts[idx] = best_shift
        chosen.append(centers[idx] + best_shift)

    return [float(s if s is not None else 0.0) for s in shifts]


def target_mask_and_bbox(feature_geometry: Dict, atlas_w: int, atlas_h: int) -> Optional[TargetShape]:
    polygons_lonlat = geometry_polygons(feature_geometry)
    polygons_xy: List[List[np.ndarray]] = []

    for polygon in polygons_lonlat:
        if not polygon:
            continue
        outer = project_ring_wrapped(polygon[0], atlas_w, atlas_h)
        if outer.size == 0:
            continue
        rings = [outer]
        for hole in polygon[1:]:
            rings.append(project_ring_wrapped(hole, atlas_w, atlas_h))
        polygons_xy.append(rings)

    if not polygons_xy:
        return None

    shifts = choose_polygon_branch_shifts(polygons_xy, atlas_w)
    for i, poly in enumerate(polygons_xy):
        if shifts[i] == 0:
            continue
        for ring in poly:
            ring[:, 0] += shifts[i]

    all_pts = np.concatenate(
        [ring for poly in polygons_xy for ring in poly if ring.size > 0], axis=0
    )
    if all_pts.size == 0:
        return None

    mean_x = float(np.mean(all_pts[:, 0]))
    global_shift_x = 0.0
    if mean_x > atlas_w:
        global_shift_x = -float(atlas_w)
    elif mean_x < 0:
        global_shift_x = float(atlas_w)
    if global_shift_x != 0:
        for poly in polygons_xy:
            for ring in poly:
                ring[:, 0] += global_shift_x

    all_pts = np.concatenate(
        [ring for poly in polygons_xy for ring in poly if ring.size > 0], axis=0
    )
    min_x = float(np.min(all_pts[:, 0]))
    max_x = float(np.max(all_pts[:, 0]))
    min_y = float(np.min(all_pts[:, 1]))
    max_y = float(np.max(all_pts[:, 1]))

    if max_x - min_x > atlas_w * 0.95:
        return None

    left_raw = int(math.floor(min_x))
    top = int(math.floor(min_y))
    right = int(math.ceil(max_x))
    bottom = int(math.ceil(max_y))
    width = max(2, right - left_raw + 2)
    height = max(2, bottom - top + 2)

    local_polygons = []
    for poly in polygons_xy:
        local_rings = []
        for ring in poly:
            lr = ring.copy()
            lr[:, 0] -= left_raw
            lr[:, 1] -= top
            local_rings.append(lr)
        local_polygons.append(local_rings)

    mask_img = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask_img)
    for poly in local_polygons:
        if not poly:
            continue
        outer = [tuple(map(float, p)) for p in poly[0]]
        if len(outer) >= 3:
            draw.polygon(outer, fill=255)
        for hole in poly[1:]:
            pts = [tuple(map(float, p)) for p in hole]
            if len(pts) >= 3:
                draw.polygon(pts, fill=0)

    mask = np.array(mask_img, dtype=np.uint8)
    if not np.any(mask):
        cx = int(round(float(np.mean(all_pts[:, 0])) - left_raw))
        cy = int(round(float(np.mean(all_pts[:, 1])) - top))
        cx = max(0, min(width - 1, cx))
        cy = max(0, min(height - 1, cy))
        mask[max(0, cy - 1) : min(height, cy + 2), max(0, cx - 1) : min(width, cx + 2)] = 255

    ys, xs = np.where(mask > 0)
    if len(xs) > 0 and len(ys) > 0:
        pad = 1
        x0 = max(0, int(xs.min()) - pad)
        y0 = max(0, int(ys.min()) - pad)
        x1 = min(mask.shape[1] - 1, int(xs.max()) + pad)
        y1 = min(mask.shape[0] - 1, int(ys.max()) + pad)
        if x0 > 0 or y0 > 0 or x1 < mask.shape[1] - 1 or y1 < mask.shape[0] - 1:
            mask = mask[y0 : y1 + 1, x0 : x1 + 1]
            left_raw += x0
            top += y0

    bbox = BBox(left=int(left_raw % atlas_w), top=int(top), width=int(mask.shape[1]), height=int(mask.shape[0]))
    return TargetShape(mask=mask, bbox=bbox)


def circular_mean_x(xs: np.ndarray, period: float) -> float:
    ang = (xs / period) * (2.0 * math.pi)
    s = float(np.mean(np.sin(ang)))
    c = float(np.mean(np.cos(ang)))
    theta = math.atan2(s, c)
    if theta < 0:
        theta += 2.0 * math.pi
    return (theta / (2.0 * math.pi)) * period


def keep_major_component(mask: np.ndarray) -> np.ndarray:
    binary = (mask > 0).astype(np.uint8)
    cc_count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    if cc_count <= 2:
        return binary

    areas = np.array([stats[i, cv2.CC_STAT_AREA] for i in range(1, cc_count)], dtype=np.int64)
    total = int(np.sum(areas))
    if total == 0:
        return binary

    largest_idx = int(np.argmax(areas)) + 1
    largest_area = int(areas[largest_idx - 1])
    dominant = largest_area / total

    # If one component dominates, use it for stable anchors.
    if dominant >= 0.7:
        out = (labels == largest_idx).astype(np.uint8)
        return out

    # Otherwise keep components that cover most area.
    order = np.argsort(-areas)
    keep = np.zeros_like(binary)
    covered = 0
    for rank in order:
        idx = int(rank) + 1
        area = int(areas[rank])
        keep[labels == idx] = 1
        covered += area
        if covered / total >= 0.9:
            break
    return keep


def directional_landmarks(mask: np.ndarray, n_dirs: int) -> Optional[np.ndarray]:
    ys, xs = np.where(mask > 0)
    if len(xs) < 6:
        return None

    pts = np.column_stack([xs.astype(np.float64), ys.astype(np.float64)])
    c = np.mean(pts, axis=0)

    out: List[np.ndarray] = [c]
    for i in range(n_dirs):
        ang = (2.0 * math.pi * i) / n_dirs
        v = np.array([math.cos(ang), math.sin(ang)], dtype=np.float64)
        proj = (pts - c) @ v
        idx = int(np.argmax(proj))
        out.append(pts[idx])

    # Add axis extrema to stabilize scale.
    left = pts[int(np.argmin(pts[:, 0]))]
    right = pts[int(np.argmax(pts[:, 0]))]
    top = pts[int(np.argmin(pts[:, 1]))]
    bottom = pts[int(np.argmax(pts[:, 1]))]
    out.extend([left, right, top, bottom])

    arr = np.array(out, dtype=np.float64)
    return arr


def build_country_anchors(
    src_mask: np.ndarray,
    src_left: int,
    src_top: int,
    target_shape: TargetShape,
    n_dirs: int,
) -> Optional[Tuple[np.ndarray, np.ndarray]]:
    src_major = keep_major_component(src_mask)
    tgt_major = keep_major_component(target_shape.mask)

    src_pts_local = directional_landmarks(src_major, n_dirs=n_dirs)
    tgt_pts_local = directional_landmarks(tgt_major, n_dirs=n_dirs)
    if src_pts_local is None or tgt_pts_local is None:
        return None

    # Landmarks are emitted in a consistent semantic order:
    # centroid, directional rays, then axis extrema.
    n = min(len(src_pts_local), len(tgt_pts_local))
    if n < 6:
        return None

    src_global = src_pts_local[:n].copy()
    src_global[:, 0] += float(src_left)
    src_global[:, 1] += float(src_top)

    tgt_global = tgt_pts_local[:n].copy()
    tgt_global[:, 0] += float(target_shape.bbox.left)
    tgt_global[:, 1] += float(target_shape.bbox.top)

    return src_global, tgt_global


def premultiply_rgba(rgba_u8: np.ndarray) -> np.ndarray:
    rgba = rgba_u8.astype(np.float32) / 255.0
    out = rgba.copy()
    out[:, :, :3] *= out[:, :, 3:4]
    return out


def unpremultiply_rgba(rgba_pm: np.ndarray) -> np.ndarray:
    a = np.clip(rgba_pm[:, :, 3:4], 0.0, 1.0)
    rgb = np.zeros_like(rgba_pm[:, :, :3])
    np.divide(
        rgba_pm[:, :, :3],
        np.maximum(a, 1e-6),
        out=rgb,
        where=a > 1e-6,
    )
    out = np.concatenate([np.clip(rgb, 0.0, 1.0), a], axis=2)
    return (np.clip(out, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)


def alpha_blit(dst: np.ndarray, src: np.ndarray, x: int, y: int) -> None:
    h, w = src.shape[:2]
    if h <= 0 or w <= 0:
        return
    x0 = max(0, x)
    y0 = max(0, y)
    x1 = min(dst.shape[1], x + w)
    y1 = min(dst.shape[0], y + h)
    if x0 >= x1 or y0 >= y1:
        return

    sx0 = x0 - x
    sy0 = y0 - y
    sx1 = sx0 + (x1 - x0)
    sy1 = sy0 + (y1 - y0)

    src_patch = src[sy0:sy1, sx0:sx1].astype(np.float32) / 255.0
    dst_patch = dst[y0:y1, x0:x1].astype(np.float32) / 255.0

    sa = src_patch[:, :, 3:4]
    da = dst_patch[:, :, 3:4]
    out_a = sa + da * (1.0 - sa)

    src_rgb_pm = src_patch[:, :, :3] * sa
    dst_rgb_pm = dst_patch[:, :, :3] * da
    out_rgb_pm = src_rgb_pm + dst_rgb_pm * (1.0 - sa)

    out_rgb = np.zeros_like(out_rgb_pm)
    np.divide(out_rgb_pm, np.maximum(out_a, 1e-6), out=out_rgb, where=out_a > 1e-6)

    out = np.concatenate([out_rgb, out_a], axis=2)
    dst[y0:y1, x0:x1] = (np.clip(out, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)


def render_country_with_inverse_map(
    job: RegionCountryJob,
    model: RegionWarpModel,
) -> np.ndarray:
    mask = job.target_shape.mask
    bbox = job.target_shape.bbox
    out_h, out_w = mask.shape

    x = np.arange(out_w, dtype=np.float64)
    y = np.arange(out_h, dtype=np.float64)
    grid_x, grid_y = np.meshgrid(x, y)

    target_x = grid_x + float(bbox.left)
    target_y = grid_y + float(bbox.top)

    query = np.column_stack([target_x.reshape(-1), target_y.reshape(-1)])
    src_global = model.inverse(query)

    map_x = (src_global[:, 0] - float(job.source_left)).reshape(out_h, out_w).astype(np.float32)
    map_y = (src_global[:, 1] - float(job.source_top)).reshape(out_h, out_w).astype(np.float32)

    src_pm = premultiply_rgba(job.source_rgba)
    warped_pm = cv2.remap(
        src_pm,
        map_x,
        map_y,
        interpolation=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0.0, 0.0, 0.0, 0.0),
    )
    warped = unpremultiply_rgba(warped_pm)

    warped_alpha = warped[:, :, 3].astype(np.uint16)
    strict_alpha = (warped_alpha * (mask.astype(np.uint16))) // 255

    # Adaptive clipping: retain mnemonic integrity for tiny/fragmented targets
    # where strict mask clipping often leaves only tiny scraps.
    cc_count, _, _, _ = cv2.connectedComponentsWithStats((mask > 0).astype(np.uint8), connectivity=8)
    comp_count = max(0, cc_count - 1)
    target_area = int(job.target_area)
    feature_key = str(job.country.get("featureKey", ""))

    strict_px = int(np.sum(strict_alpha > OUTPUT_ALPHA_THRESHOLD))
    warped_px = int(np.sum(warped_alpha > OUTPUT_ALPHA_THRESHOLD))
    retention = float(strict_px) / max(float(warped_px), 1.0)

    use_relaxed = (
        target_area >= 20
        and (
            feature_key in RELAXED_CLIP_FEATURE_KEYS
            or (retention < 0.45 and (comp_count >= 2 or target_area < 2500))
        )
    )

    final_alpha = strict_alpha
    if use_relaxed:
        radius = 0
        if comp_count >= 3:
            radius = max(radius, 2)
        if comp_count >= 8:
            radius = max(radius, 4)
        if target_area < 2500:
            radius = max(radius, 3)
        if target_area < 1200:
            radius = max(radius, 5)
        if target_area < 500:
            radius = max(radius, 7)
        if feature_key in RELAXED_CLIP_FEATURE_KEYS:
            radius = max(radius, 5 if target_area >= 500 else 7)
        radius = min(radius, 12)

        if radius > 0:
            k = 2 * radius + 1
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
            relaxed_mask = cv2.dilate(mask, kernel, iterations=1)
            relaxed_alpha = (warped_alpha * relaxed_mask.astype(np.uint16)) // 255
            relaxed_px = int(np.sum(relaxed_alpha > OUTPUT_ALPHA_THRESHOLD))
            if relaxed_px > int(strict_px * 1.25):
                final_alpha = relaxed_alpha

    warped[:, :, 3] = final_alpha.astype(np.uint8)
    warped[warped[:, :, 3] <= OUTPUT_ALPHA_THRESHOLD, :3] = 0
    return warped


def iou_from_alpha(alpha: np.ndarray, target_mask: np.ndarray) -> float:
    pred = alpha > OUTPUT_ALPHA_THRESHOLD
    tgt = target_mask > 0
    union = int(np.sum(pred | tgt))
    if union <= 0:
        return 0.0
    inter = int(np.sum(pred & tgt))
    return float(inter / union)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build globe warps using region-wide smooth transforms")
    parser.add_argument("--config", default="assets/globe/config.json")
    parser.add_argument("--geojson", default="assets/globe/world.geojson")
    parser.add_argument("--atlas-width", type=int, default=8192)
    parser.add_argument("--atlas-height", type=int, default=4096)
    parser.add_argument("--tps-reg", type=float, default=DEFAULT_TPS_REG)
    parser.add_argument("--max-control-points", type=int, default=DEFAULT_MAX_CTRL)
    parser.add_argument("--directions", type=int, default=DEFAULT_DIRECTIONS)
    parser.add_argument("--preview-dir", default="artifacts/global_warp_previews")
    parser.add_argument("--no-previews", action="store_true")
    parser.add_argument("--region", action="append", default=[])
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    project_dir = Path(__file__).resolve().parents[1]

    config_path = project_dir / args.config
    geo_path = project_dir / args.geojson
    warped_dir = project_dir / "assets/globe/warped"
    warped_dir.mkdir(parents=True, exist_ok=True)

    preview_dir = project_dir / args.preview_dir
    if not args.no_previews:
        preview_dir.mkdir(parents=True, exist_ok=True)

    config = load_json(config_path)
    geo = load_json(geo_path)

    feature_by_key = {
        (f.get("properties") or {}).get("key"): f
        for f in geo.get("features", [])
        if (f.get("properties") or {}).get("key")
    }

    countries = config.get("countries", [])
    if not countries:
        raise RuntimeError("No countries in globe config")

    selected_regions: Optional[set] = None
    if args.region:
        wanted = {r.strip().lower() for r in args.region if r.strip()}
        selected_regions = wanted
        countries = [c for c in countries if str(c.get("sourceRegion", "")).lower() in wanted]
        if not countries:
            raise RuntimeError("No countries matched --region filter")

    countries_by_region: Dict[str, List[Dict]] = {}
    for c in countries:
        region = str(c.get("sourceRegion", "")).strip()
        if not region:
            continue
        countries_by_region.setdefault(region, []).append(c)

    image_cache: Dict[Path, np.ndarray] = {}
    results_by_feature: Dict[str, Dict] = {}
    report_regions: List[Dict] = []
    report_countries: List[Dict] = []

    for region, region_countries in sorted(countries_by_region.items()):
        region_params = REGION_PARAM_OVERRIDES.get(region.lower(), {})
        region_tps_reg = float(region_params.get("tps_reg", args.tps_reg))
        region_max_ctrl = int(region_params.get("max_control_points", args.max_control_points))
        region_dirs = int(region_params.get("directions", args.directions))

        region_cfg_path = project_dir / "assets" / region / "config.json"
        if not region_cfg_path.exists():
            raise FileNotFoundError(f"Missing region config: {region_cfg_path}")

        region_cfg = load_json(region_cfg_path)
        region_map = {}
        for rc in region_cfg.get("countries", []):
            fname = derive_filename(rc)
            region_map[fname] = rc

        jobs: List[RegionCountryJob] = []
        all_dst_x = []

        for country in region_countries:
            feature_key = country.get("featureKey")
            if feature_key not in feature_by_key:
                raise KeyError(f"Missing geo feature for key {feature_key}")
            feature = feature_by_key[feature_key]
            target_shape = target_mask_and_bbox(feature.get("geometry", {}), args.atlas_width, args.atlas_height)
            if target_shape is None:
                raise RuntimeError(f"Failed target mask for {feature_key}")

            filename = country.get("filename")
            if filename not in region_map:
                raise KeyError(f"Region {region} missing country filename {filename}")
            src_meta = region_map[filename]

            source_path = project_dir / "assets" / region / str(src_meta.get("file", f"countries/{filename}.webp"))
            if not source_path.exists():
                # fallback to canonical globe image path if metadata path missing
                source_path = project_dir / str(country.get("imageFile", ""))
            if not source_path.exists():
                raise FileNotFoundError(f"Missing source image for {filename}: {source_path}")

            if source_path not in image_cache:
                image_cache[source_path] = np.array(Image.open(source_path).convert("RGBA"), dtype=np.uint8)
            src_img = image_cache[source_path]

            src_w = int(src_meta.get("width", src_img.shape[1]))
            src_h = int(src_meta.get("height", src_img.shape[0]))
            if src_img.shape[1] != src_w or src_img.shape[0] != src_h:
                src_img = np.array(
                    Image.fromarray(src_img, mode="RGBA").resize((src_w, src_h), resample=Image.Resampling.LANCZOS),
                    dtype=np.uint8,
                )

            src_left = int(src_meta.get("left", 0))
            src_top = int(src_meta.get("top", 0))

            area = int(np.sum(target_shape.mask > 0))
            jobs.append(
                RegionCountryJob(
                    country=country,
                    source_region=region,
                    source_path=source_path,
                    source_rgba=src_img,
                    source_left=src_left,
                    source_top=src_top,
                    target_shape=target_shape,
                    target_area=area,
                )
            )
            all_dst_x.append(target_shape.bbox.left + 0.5 * target_shape.bbox.width)

        if not jobs:
            continue

        unwrap_center = circular_mean_x(np.array(all_dst_x, dtype=np.float64), period=float(args.atlas_width))

        anchor_src = []
        anchor_dst = []
        anchor_w = []

        src_x_vals = []
        src_y_vals = []
        dst_x_vals = []
        dst_y_vals = []

        for job in jobs:
            src_mask = (job.source_rgba[:, :, 3] > ALPHA_THRESHOLD).astype(np.uint8)
            anchors = build_country_anchors(
                src_mask=src_mask,
                src_left=job.source_left,
                src_top=job.source_top,
                target_shape=job.target_shape,
                n_dirs=region_dirs,
            )
            if anchors is None:
                continue

            src_pts, dst_pts = anchors
            if len(src_pts) < 6:
                continue

            # Keep smaller countries influential so the regional warp does not
            # get dominated by a handful of very large polygons.
            raw_w = float((float(job.target_area) + 1.0) ** 0.22)
            area_w = float(min(8.0, max(2.0, raw_w)))
            anchor_src.append(src_pts)
            anchor_dst.append(dst_pts)
            anchor_w.append(np.full(len(src_pts), area_w, dtype=np.float64))

            src_x_vals.extend(src_pts[:, 0].tolist())
            src_y_vals.extend(src_pts[:, 1].tolist())
            dst_x_vals.extend(dst_pts[:, 0].tolist())
            dst_y_vals.extend(dst_pts[:, 1].tolist())

        if not anchor_src:
            raise RuntimeError(f"No anchors built for region {region}")

        # Soft frame anchors prevent extrapolation drift near map edges.
        src_min_x = float(min(src_x_vals))
        src_max_x = float(max(src_x_vals))
        src_min_y = float(min(src_y_vals))
        src_max_y = float(max(src_y_vals))

        dst_x_np = np.array(dst_x_vals, dtype=np.float64)
        dst_x_unwrap = dst_x_np.copy()
        d = dst_x_unwrap - unwrap_center
        dst_x_unwrap[d > args.atlas_width * 0.5] -= args.atlas_width
        dst_x_unwrap[d < -args.atlas_width * 0.5] += args.atlas_width

        dst_min_x = float(np.min(dst_x_unwrap))
        dst_max_x = float(np.max(dst_x_unwrap))
        dst_min_y = float(min(dst_y_vals))
        dst_max_y = float(max(dst_y_vals))

        src_frame = np.array(
            [
                [src_min_x, src_min_y],
                [src_max_x, src_min_y],
                [src_max_x, src_max_y],
                [src_min_x, src_max_y],
                [0.5 * (src_min_x + src_max_x), 0.5 * (src_min_y + src_max_y)],
            ],
            dtype=np.float64,
        )
        dst_frame = np.array(
            [
                [dst_min_x, dst_min_y],
                [dst_max_x, dst_min_y],
                [dst_max_x, dst_max_y],
                [dst_min_x, dst_max_y],
                [0.5 * (dst_min_x + dst_max_x), 0.5 * (dst_min_y + dst_max_y)],
            ],
            dtype=np.float64,
        )

        mean_w = float(np.mean(np.concatenate(anchor_w)))
        frame_w = np.full(len(src_frame), max(1.0, mean_w * 0.30), dtype=np.float64)

        src_all = np.concatenate(anchor_src + [src_frame], axis=0)
        dst_all = np.concatenate(anchor_dst + [dst_frame], axis=0)
        w_all = np.concatenate(anchor_w + [frame_w], axis=0)

        model = RegionWarpModel(atlas_w=args.atlas_width, unwrap_center_x=unwrap_center)
        fit_stats = model.fit(
            src_pts=src_all,
            dst_pts_mod=dst_all,
            weights=w_all,
            tps_reg=region_tps_reg,
            max_ctrl=region_max_ctrl,
        )

        region_iou_vals = []
        rendered_by_job: List[Tuple[RegionCountryJob, np.ndarray]] = []

        for job in jobs:
            warped_rgba = render_country_with_inverse_map(job, model)
            iou = iou_from_alpha(warped_rgba[:, :, 3], job.target_shape.mask)
            region_iou_vals.append(iou)

            feature_key = str(job.country.get("featureKey"))
            file_name = f"{feature_key}.webp"
            out_path = warped_dir / file_name
            Image.fromarray(warped_rgba, mode="RGBA").save(
                out_path,
                format="WEBP",
                lossless=WARP_WEBP_LOSSLESS,
                quality=WARP_WEBP_QUALITY,
                method=WARP_WEBP_METHOD,
            )

            results_by_feature[feature_key] = {
                "warpFile": f"assets/globe/warped/{file_name}",
                "warpLeft": int(job.target_shape.bbox.left),
                "warpTop": int(job.target_shape.bbox.top),
                "warpWidth": int(job.target_shape.bbox.width),
                "warpHeight": int(job.target_shape.bbox.height),
                "warpIoU": round(float(iou), 4),
                "warpStrategy": "region-global-affine+tps",
                "warpSourceRegion": region,
            }

            report_countries.append(
                {
                    "name": job.country.get("name"),
                    "featureKey": feature_key,
                    "sourceRegion": region,
                    "warpIoU": round(float(iou), 4),
                    "targetAreaPx": int(job.target_area),
                    "warpFile": f"assets/globe/warped/{file_name}",
                }
            )
            rendered_by_job.append((job, warped_rgba))

        if not args.no_previews:
            canvas = np.zeros((args.atlas_height, args.atlas_width, 4), dtype=np.uint8)
            for job, warped_rgba in rendered_by_job:
                alpha_blit(canvas, warped_rgba, job.target_shape.bbox.left, job.target_shape.bbox.top)

            # Draw country outlines for the region.
            for job in jobs:
                feature = feature_by_key[str(job.country.get("featureKey"))]
                polygons = geometry_polygons(feature.get("geometry", {}))
                for poly in polygons:
                    for ring in poly:
                        projected = project_ring_wrapped(ring, args.atlas_width, args.atlas_height)
                        if len(projected) < 2:
                            continue
                        pts = projected.copy()
                        pts[:, 0] = np.mod(pts[:, 0], args.atlas_width)
                        pts_i = np.round(pts).astype(np.int32)
                        cv2.polylines(canvas, [pts_i], isClosed=True, color=(90, 210, 255, 200), thickness=1)

            alpha_nonzero = np.where(canvas[:, :, 3] > 0)
            if len(alpha_nonzero[0]) > 0:
                y0 = max(0, int(np.min(alpha_nonzero[0])) - 24)
                y1 = min(args.atlas_height, int(np.max(alpha_nonzero[0])) + 25)
                x0 = max(0, int(np.min(alpha_nonzero[1])) - 24)
                x1 = min(args.atlas_width, int(np.max(alpha_nonzero[1])) + 25)
                crop = canvas[y0:y1, x0:x1]
            else:
                crop = canvas

            preview_path = preview_dir / f"{region}.png"
            Image.fromarray(crop, mode="RGBA").save(preview_path)

        region_mean_iou = float(np.mean(region_iou_vals)) if region_iou_vals else 0.0
        region_p10_iou = float(np.percentile(region_iou_vals, 10)) if region_iou_vals else 0.0
        report_regions.append(
            {
                "region": region,
                "countries": len(jobs),
                "meanIoU": round(region_mean_iou, 4),
                "p10IoU": round(region_p10_iou, 4),
                "unwrapCenterX": round(float(unwrap_center), 4),
                "tpsReg": region_tps_reg,
                "maxControlPoints": region_max_ctrl,
                "directionCount": region_dirs,
                **fit_stats,
            }
        )
        print(
            f"[{region}] countries={len(jobs)} meanIoU={region_mean_iou:.4f} "
            f"p10IoU={region_p10_iou:.4f} anchorRMSE={fit_stats['anchorRmsePx']:.2f}px"
        )

    # Update config metadata for all countries.
    stale_keys = {
        "warpFile",
        "warpLeft",
        "warpTop",
        "warpWidth",
        "warpHeight",
        "warpStrategy",
        "warpIoUBaseline",
        "warpIoUStage1",
        "warpIoU",
        "warpIoUGain",
        "triangleCount",
        "targetAreaPx",
        "edgeSnapPasses",
        "edgeErrorBaseline",
        "edgeErrorStage1",
        "edgeError",
        "edgeErrorGain",
        "gapStretchPasses",
        "gapStretchFillPx",
        "gapStretchRemainingPx",
        "warpSourceRegion",
    }

    updated = 0
    for c in config.get("countries", []):
        source_region = str(c.get("sourceRegion", "")).lower()
        if selected_regions is not None and source_region not in selected_regions:
            continue
        for key in stale_keys:
            c.pop(key, None)
        feature_key = str(c.get("featureKey", ""))
        if feature_key in results_by_feature:
            c.update(results_by_feature[feature_key])
            c["targetAreaPx"] = int(next((r["targetAreaPx"] for r in report_countries if r["featureKey"] == feature_key), 0))
            updated += 1

    config["warpAtlasWidth"] = int(args.atlas_width)
    config["warpAtlasHeight"] = int(args.atlas_height)
    config["warpMethod"] = "region-global-affine-tps-v1"

    save_json(config_path, config)

    report = {
        "method": "region-global-affine-tps-v1",
        "atlasWidth": int(args.atlas_width),
        "atlasHeight": int(args.atlas_height),
        "tpsReg": float(args.tps_reg),
        "maxControlPoints": int(args.max_control_points),
        "directionCount": int(args.directions),
        "regions": sorted(report_regions, key=lambda x: x["region"]),
        "countries": sorted(report_countries, key=lambda x: (x["sourceRegion"], x["name"])),
        "summary": {
            "updatedCountries": int(updated),
            "meanIoU": round(float(np.mean([c["warpIoU"] for c in report_countries])) if report_countries else 0.0, 4),
            "p10IoU": round(float(np.percentile([c["warpIoU"] for c in report_countries], 10)) if report_countries else 0.0, 4),
            "minIoU": round(float(np.min([c["warpIoU"] for c in report_countries])) if report_countries else 0.0, 4),
        },
    }
    report_path = project_dir / "assets/globe/global_warp_report.json"
    save_json(report_path, report)

    print(f"Updated countries: {updated}")
    print(f"Wrote {config_path.relative_to(project_dir)}")
    print(f"Wrote {report_path.relative_to(project_dir)}")
    if not args.no_previews:
        print(f"Preview dir: {preview_dir.relative_to(project_dir)}")


if __name__ == "__main__":
    main()
