#!/usr/bin/env python3
"""
Build warped per-country mnemonic overlays for the globe.

This script morphs each country mnemonic image to better match the
target globe polygon in equirectangular UV space.

Outputs:
  - assets/globe/warped/<feature_key>.webp
  - Updated assets/globe/config.json with warp metadata
  - assets/globe/warp_report.json with quality metrics

Requires (use repo venv):
  .venv/bin/pip install opencv-contrib-python-headless pillow numpy
"""

from __future__ import annotations

import argparse
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np
from PIL import Image, ImageDraw

MIN_TARGET_AREA_FOR_WARP = 700
MIN_IOU_GAIN = 0.01
LOW_BASELINE_ALLOW = 0.5
LOW_BASELINE_TOLERANCE = -0.02
EDGE_SNAP_PASSES = 2
EDGE_SNAP_SAMPLES = 320
EDGE_SNAP_MIN_EDGE_GAIN = 0.003
EDGE_SNAP_MIN_IOU_GAIN = 0.0005
EDGE_SNAP_MAX_IOU_DROP = 0.0025
EDGE_SNAP_MAX_EDGE_LOSS = 0.15
EDGE_ACCEPT_MIN_GAIN = 2.0
EDGE_ACCEPT_MAX_IOU_DROP = 0.05
EDGE_ACCEPT_MIN_IOU = 0.80
FORCE_ACCEPT_FEATURE_KEYS = {"RUS", "BOL", "GRC", "NOR", "CAN", "SOM"}
POST_EDGE_REPAIR_MIN_AREA = 20000
POST_EDGE_REPAIR_MIN_EDGE_EXCESS = 4.0
POST_EDGE_REPAIR_MAX_IOU_DROP = 0.02
POST_EDGE_REPAIR_MAX_PASSES = 3
POST_EDGE_REPAIR_MIN_EDGE_GAIN = 2.0
POST_EDGE_REPAIR_FEATURE_KEYS = {"AUS", "BOL", "CAN"}
USE_BOUNDARY_PULL = False
USE_MASK_CLIP = False
SKIP_EDGE_REPAIR_FEATURE_KEYS = {"BOL", "CAN"}
FORCE_BASELINE_FEATURE_KEYS = {"BOL", "RUS"}
COUNTRY_COMPONENT_OVERRIDES = {
    # Archipelago-heavy countries: prioritize the main intended drawing mass,
    # not every tiny island polygon.
    "SLB": {"target_rel_min": 0.85, "target_keep_fraction": 1.0, "source_rel_min": 0.01},
    "FJI": {"target_rel_min": 0.50, "target_keep_fraction": 1.0, "source_rel_min": 0.01},
    "BHS": {"target_rel_min": 0.25, "target_keep_fraction": 1.0, "source_rel_min": 0.005},
    "GRC": {"target_rel_min": 0.07, "target_keep_fraction": 0.995, "source_rel_min": 0.004},
    "CHL": {"target_rel_min": 0.015, "target_keep_fraction": 0.995, "source_rel_min": 0.005},
    "JPN": {"target_rel_min": 0.08, "target_keep_fraction": 0.998, "source_rel_min": 0.01},
    "PHL": {"target_rel_min": 0.03, "target_keep_fraction": 0.997, "source_rel_min": 0.01},
    "NOR": {"target_rel_min": 0.02, "target_keep_fraction": 1.0, "source_rel_min": 0.003},
    "CUB": {"target_rel_min": 0.03, "target_keep_fraction": 1.0, "source_rel_min": 0.004},
    "BOL": {"target_rel_min": 0.015, "target_keep_fraction": 0.995, "source_rel_min": 0.012},
}
COUNTRY_EDGE_SNAP_PASSES = {
    # Without clipping, these countries look cleaner with gentler transforms.
    "RUS": 0,
    "SOM": 0,
    "BOL": 0,
    "CUB": 0,
    "SLB": 0,
    "FJI": 0,
    "BHS": 0,
    "GRC": 0,
    "CHL": 0,
    "JPN": 0,
    "PHL": 0,
    "NOR": 0,
    "CAN": 0,
}
DISABLE_COMPONENT_MODE_KEYS = {
    "GRC",
    "CHL",
    "BOL",
    "PHL",
    "NOR",
    "CUB",
    "CAN",
}
FINAL_CLIP_DILATE_BY_KEY = {
    "SLB": 8,
    "FJI": 8,
    "BHS": 6,
    "GRC": 3,
    "CHL": 2,
    "JPN": 3,
    "BOL": 2,
    "PHL": 3,
    "NOR": 2,
    "CUB": 2,
}
GAP_STRETCH_BAND_PX = 14
GAP_STRETCH_MIN_MISSING_PX = 80
GAP_STRETCH_MAX_ITERS = 18
GAP_STRETCH_ALPHA_THRESHOLD = 10
GAP_STRETCH_MAX_EDGE_LOSS = 4.5
GAP_STRETCH_MAX_IOU_DROP = 0.02
GAP_STRETCH_BAND_OPTIONS = (14, 18, 22, 26, 30, 36, 44)
GAP_STRETCH_MIN_HOLE_GAIN_FRACTION = 0.2
BOUNDARY_PULL_ALPHA_THRESHOLD = 10
BOUNDARY_PULL_MIN_MISSING_PX = 80
BOUNDARY_PULL_MAX_PASSES = 4
BOUNDARY_PULL_MAX_IOU_DROP = 0.025
BOUNDARY_PULL_MAX_EDGE_LOSS = 3.5
BOUNDARY_PULL_MIN_HOLE_GAIN_FRACTION = 0.15
CANDIDATE_IOU_EPS = 0.001
CANDIDATE_EDGE_SOFT_GAIN = 0.8
CANDIDATE_EDGE_HARD_GAIN = 2.5
CANDIDATE_SOFT_MAX_IOU_DROP = 0.003
CANDIDATE_HARD_MAX_IOU_DROP = 0.008
CLIP_DILATE_PX = 1
COMPONENT_MIN_PIXELS = 20
COMPONENT_KEEP_FRACTION = 0.998
COMPONENT_SOURCE_REL_MIN = 0.0025
COMPONENT_TARGET_REL_MIN = 0.0005


@dataclass
class BBox:
    left: int
    top: int
    width: int
    height: int


def project_lon_lat(lon: float, lat: float, atlas_w: int, atlas_h: int) -> Tuple[float, float]:
    x = ((lon + 180.0) / 360.0) * atlas_w
    y = ((90.0 - lat) / 180.0) * atlas_h
    return x, y


def project_ring_wrapped(
    ring: Sequence[Sequence[float]], atlas_w: int, atlas_h: int
) -> np.ndarray:
    pts = np.array([project_lon_lat(p[0], p[1], atlas_w, atlas_h) for p in ring], dtype=np.float32)
    if pts.size == 0:
        return pts
    min_x = float(np.min(pts[:, 0]))
    max_x = float(np.max(pts[:, 0]))
    if max_x - min_x > atlas_w * 0.5:
        pts[:, 0] = np.where(pts[:, 0] < atlas_w * 0.5, pts[:, 0] + atlas_w, pts[:, 0])
    return pts


def geometry_polygons(geometry: Dict) -> List[List[np.ndarray]]:
    if geometry["type"] == "Polygon":
        return [[np.asarray(r, dtype=np.float32) for r in geometry["coordinates"]]]
    if geometry["type"] == "MultiPolygon":
        return [
            [np.asarray(r, dtype=np.float32) for r in polygon]
            for polygon in geometry["coordinates"]
        ]
    raise ValueError(f"Unsupported geometry type: {geometry['type']}")


def ring_signed_area(ring: np.ndarray) -> float:
    if ring.size == 0 or len(ring) < 3:
        return 0.0
    x = ring[:, 0]
    y = ring[:, 1]
    return 0.5 * float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))


def polygon_outer_abs_area(polygon_rings: List[np.ndarray]) -> float:
    if not polygon_rings:
        return 0.0
    return abs(ring_signed_area(polygon_rings[0]))


def choose_polygon_branch_shifts(polygons_xy: List[List[np.ndarray]], atlas_w: int) -> List[float]:
    if len(polygons_xy) <= 1:
        return [0.0] * len(polygons_xy)

    areas = [polygon_outer_abs_area(poly) for poly in polygons_xy]
    centers = [float(np.mean(poly[0][:, 0])) if poly and poly[0].size > 0 else 0.0 for poly in polygons_xy]
    anchor = int(np.argmax(areas))

    shifts: List[Optional[float]] = [None] * len(polygons_xy)
    shifts[anchor] = 0.0
    chosen_centers = [centers[anchor]]

    order = [i for i in np.argsort(-np.array(areas)) if i != anchor]
    for idx in order:
        best_shift = 0.0
        best_score = float("inf")
        for mul in (-1.0, 0.0, 1.0):
            shift = mul * float(atlas_w)
            c = centers[idx] + shift
            cmin = min(chosen_centers + [c])
            cmax = max(chosen_centers + [c])
            span = cmax - cmin
            anchor_dist = abs(c - centers[anchor])
            score = span + 0.08 * anchor_dist
            if score < best_score:
                best_score = score
                best_shift = shift
        shifts[idx] = best_shift
        chosen_centers.append(centers[idx] + best_shift)

    return [float(s if s is not None else 0.0) for s in shifts]


def target_mask_and_bbox(
    feature_geometry: Dict, atlas_w: int, atlas_h: int
) -> Optional[Tuple[np.ndarray, BBox, List[List[np.ndarray]]]]:
    polygons_lonlat = geometry_polygons(feature_geometry)
    polygons_xy: List[List[np.ndarray]] = []

    for polygon in polygons_lonlat:
        if not polygon:
            continue
        projected_outer = project_ring_wrapped(polygon[0], atlas_w, atlas_h)
        if projected_outer.size == 0:
            continue

        # Keep hole rings in the same wrap branch as the outer ring.
        rings = [projected_outer]
        for hole in polygon[1:]:
            h = project_ring_wrapped(hole, atlas_w, atlas_h)
            rings.append(h)
        polygons_xy.append(rings)

    if not polygons_xy:
        return None

    branch_shifts = choose_polygon_branch_shifts(polygons_xy, atlas_w)
    for i, poly in enumerate(polygons_xy):
        shift_x = branch_shifts[i]
        if shift_x == 0:
            continue
        for ring in poly:
            ring[:, 0] += shift_x

    all_outer = np.concatenate([p[0] for p in polygons_xy if len(p[0]) > 0], axis=0)
    if all_outer.size == 0:
        return None

    mean_x = float(np.mean(all_outer[:, 0]))
    global_shift_x = 0.0
    if mean_x > atlas_w:
        global_shift_x = -float(atlas_w)
    elif mean_x < 0:
        global_shift_x = float(atlas_w)
    if global_shift_x != 0:
        for poly in polygons_xy:
            for ring in poly:
                ring[:, 0] += global_shift_x

    all_pts = np.concatenate([ring for poly in polygons_xy for ring in poly if ring.size > 0], axis=0)
    min_x = float(np.min(all_pts[:, 0]))
    max_x = float(np.max(all_pts[:, 0]))
    min_y = float(np.min(all_pts[:, 1]))
    max_y = float(np.max(all_pts[:, 1]))

    # Keep a broad guard against pathological geometry while allowing dateline countries.
    if max_x - min_x > atlas_w * 0.95:
        return None

    left = math.floor(min_x)
    top = math.floor(min_y)
    right = math.ceil(max_x)
    bottom = math.ceil(max_y)
    width = max(2, right - left + 2)
    height = max(2, bottom - top + 2)

    local_polygons: List[List[np.ndarray]] = []
    for poly in polygons_xy:
        local_rings = []
        for ring in poly:
            lr = ring.copy()
            lr[:, 0] -= left
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
            hole_pts = [tuple(map(float, p)) for p in hole]
            if len(hole_pts) >= 3:
                draw.polygon(hole_pts, fill=0)

    mask = np.array(mask_img, dtype=np.uint8)
    bbox = BBox(left=left % atlas_w, top=top, width=width, height=height)
    return mask, bbox, local_polygons


def largest_contour(mask: np.ndarray) -> Optional[np.ndarray]:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    if len(contour) < 3:
        return None
    return contour[:, 0, :].astype(np.float32)


def sample_closed_contour(contour: np.ndarray, n_samples: int) -> np.ndarray:
    pts = np.vstack([contour, contour[0]])
    seg = np.linalg.norm(pts[1:] - pts[:-1], axis=1)
    total = float(np.sum(seg))
    if total <= 1e-6:
        return np.repeat(contour[:1], n_samples, axis=0)

    cum = np.concatenate([[0.0], np.cumsum(seg)])
    out = np.zeros((n_samples, 2), dtype=np.float32)
    for i in range(n_samples):
        t = (i * total) / n_samples
        idx = int(np.searchsorted(cum, t, side="right") - 1)
        idx = min(max(idx, 0), len(seg) - 1)
        denom = max(seg[idx], 1e-6)
        frac = (t - cum[idx]) / denom
        out[i] = pts[idx] + frac * (pts[idx + 1] - pts[idx])
    return out


def normalized_shape(points: np.ndarray) -> np.ndarray:
    c = np.mean(points, axis=0)
    d = points - c
    scale = float(np.sqrt(np.mean(np.sum(d * d, axis=1))))
    if scale < 1e-6:
        scale = 1.0
    return d / scale


def align_boundary_correspondence(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    src_n = normalized_shape(src)
    dst_n = normalized_shape(dst)
    n = len(src)
    best_err = float("inf")
    best = dst

    for reverse in (False, True):
        cand = dst_n[::-1] if reverse else dst_n
        cand_raw = dst[::-1] if reverse else dst
        for shift in range(n):
            rolled = np.roll(cand, -shift, axis=0)
            err = float(np.mean(np.sum((src_n - rolled) ** 2, axis=1)))
            if err < best_err:
                best_err = err
                best = np.roll(cand_raw, -shift, axis=0)
    return best


def build_landmarks(src_boundary: np.ndarray, dst_boundary: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    src_c = np.mean(src_boundary, axis=0)
    dst_c = np.mean(dst_boundary, axis=0)
    src_pts = [*src_boundary, src_c]
    dst_pts = [*dst_boundary, dst_c]

    n = len(src_boundary)
    step = max(1, n // 24)
    for i in range(0, n, step):
        sb = src_boundary[i]
        db = dst_boundary[i]
        for t in (0.72, 0.45, 0.22):
            src_pts.append(src_c + t * (sb - src_c))
            dst_pts.append(dst_c + t * (db - dst_c))

    src_arr = np.array(src_pts, dtype=np.float32)
    dst_arr = np.array(dst_pts, dtype=np.float32)
    return dedupe_landmarks(src_arr, dst_arr)


def dedupe_landmarks(src_pts: np.ndarray, dst_pts: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    kept_src = []
    kept_dst = []
    seen = set()
    for s, d in zip(src_pts, dst_pts):
        key = (round(float(d[0]), 2), round(float(d[1]), 2))
        if key in seen:
            continue
        seen.add(key)
        kept_src.append(s)
        kept_dst.append(d)
    return np.array(kept_src, dtype=np.float32), np.array(kept_dst, dtype=np.float32)


def delaunay_triangles(points: np.ndarray, width: int, height: int) -> List[Tuple[int, int, int]]:
    if len(points) < 3:
        return []
    pts = points.copy()
    pts[:, 0] = np.clip(pts[:, 0], 0, max(0, width - 1))
    pts[:, 1] = np.clip(pts[:, 1], 0, max(0, height - 1))

    subdiv = cv2.Subdiv2D((0, 0, width, height))
    for p in pts:
        subdiv.insert((float(p[0]), float(p[1])))

    tri_list = subdiv.getTriangleList()
    if tri_list is None or len(tri_list) == 0:
        return []

    triangles: List[Tuple[int, int, int]] = []
    seen = set()
    for t in tri_list:
        tri = np.array([[t[0], t[1]], [t[2], t[3]], [t[4], t[5]]], dtype=np.float32)
        if (
            np.any(tri[:, 0] < -1)
            or np.any(tri[:, 1] < -1)
            or np.any(tri[:, 0] > width + 1)
            or np.any(tri[:, 1] > height + 1)
        ):
            continue

        idx = []
        ok = True
        for p in tri:
            d = np.sum((pts - p) ** 2, axis=1)
            i = int(np.argmin(d))
            if float(d[i]) > 4.0:
                ok = False
                break
            idx.append(i)
        if not ok or len(set(idx)) != 3:
            continue

        key = tuple(sorted(idx))
        if key in seen:
            continue
        seen.add(key)
        triangles.append((idx[0], idx[1], idx[2]))
    return triangles


def warp_piecewise_affine(
    src_rgba: np.ndarray,
    src_pts: np.ndarray,
    dst_pts: np.ndarray,
    out_w: int,
    out_h: int,
    triangles: Sequence[Tuple[int, int, int]],
) -> np.ndarray:
    src = src_rgba.astype(np.float32)
    out = np.zeros((out_h, out_w, 4), dtype=np.float32)

    for tri in triangles:
        src_tri = np.float32([src_pts[tri[0]], src_pts[tri[1]], src_pts[tri[2]]])
        dst_tri = np.float32([dst_pts[tri[0]], dst_pts[tri[1]], dst_pts[tri[2]]])

        r1 = cv2.boundingRect(src_tri)
        r2 = cv2.boundingRect(dst_tri)
        if r1[2] <= 0 or r1[3] <= 0 or r2[2] <= 0 or r2[3] <= 0:
            continue

        x1, y1, w1, h1 = r1
        x2, y2, w2, h2 = r2
        if x1 < 0 or y1 < 0 or x1 + w1 > src.shape[1] or y1 + h1 > src.shape[0]:
            continue
        if x2 < 0 or y2 < 0 or x2 + w2 > out_w or y2 + h2 > out_h:
            continue

        src_crop = src[y1 : y1 + h1, x1 : x1 + w1]
        src_rect = np.float32([[p[0] - x1, p[1] - y1] for p in src_tri])
        dst_rect = np.float32([[p[0] - x2, p[1] - y2] for p in dst_tri])
        matrix = cv2.getAffineTransform(src_rect, dst_rect)
        warped = cv2.warpAffine(
            src_crop,
            matrix,
            (w2, h2),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=(0, 0, 0, 0),
        )

        mask = np.zeros((h2, w2), dtype=np.float32)
        cv2.fillConvexPoly(mask, np.int32(np.round(dst_rect)), 1.0, lineType=cv2.LINE_AA)
        mask4 = mask[:, :, None]

        patch = out[y2 : y2 + h2, x2 : x2 + w2]
        patch[:] = patch * (1.0 - mask4) + warped * mask4

    return np.clip(out, 0, 255).astype(np.uint8)


def shape_iou(alpha_mask: np.ndarray, target_mask: np.ndarray) -> float:
    a = alpha_mask > 10
    b = target_mask > 0
    inter = int(np.sum(a & b))
    union = int(np.sum(a | b))
    if union == 0:
        return 0.0
    return inter / union


def clip_rgba_to_mask(
    rgba: np.ndarray,
    target_mask: np.ndarray,
    dilate_px: int = CLIP_DILATE_PX,
) -> np.ndarray:
    if not USE_MASK_CLIP:
        return rgba.copy()
    out = rgba.copy()
    clip_mask = target_mask
    if dilate_px > 0:
        kernel_size = dilate_px * 2 + 1
        kernel = np.ones((kernel_size, kernel_size), dtype=np.uint8)
        clip_mask = cv2.dilate(target_mask, kernel, iterations=1)
    out[:, :, 3] = np.minimum(out[:, :, 3], clip_mask)
    out[out[:, :, 3] == 0, :3] = 0
    return out


def _shift_no_wrap_bool(mask: np.ndarray, dy: int, dx: int) -> np.ndarray:
    shifted = np.roll(mask, shift=(dy, dx), axis=(0, 1))
    if dy > 0:
        shifted[:dy, :] = False
    elif dy < 0:
        shifted[dy:, :] = False
    if dx > 0:
        shifted[:, :dx] = False
    elif dx < 0:
        shifted[:, dx:] = False
    return shifted


def _shift_no_wrap_rgba(rgba: np.ndarray, dy: int, dx: int) -> np.ndarray:
    shifted = np.roll(rgba, shift=(dy, dx), axis=(0, 1))
    if dy > 0:
        shifted[:dy, :, :] = 0
    elif dy < 0:
        shifted[dy:, :, :] = 0
    if dx > 0:
        shifted[:, :dx, :] = 0
    elif dx < 0:
        shifted[:, dx:, :] = 0
    return shifted


def stretch_alpha_gaps_to_edge(
    rgba: np.ndarray,
    target_mask: np.ndarray,
    band_px: int = GAP_STRETCH_BAND_PX,
    alpha_threshold: int = GAP_STRETCH_ALPHA_THRESHOLD,
    max_iters: int = GAP_STRETCH_MAX_ITERS,
) -> Tuple[np.ndarray, Dict[str, int]]:
    out = rgba.copy()
    target = target_mask > 0
    known = out[:, :, 3] > alpha_threshold
    known_start = known.copy()
    missing = target & (~known)
    missing_count = int(np.sum(missing))
    if missing_count <= 0:
        return out, {"missingBefore": 0, "filled": 0, "remaining": 0, "passes": 0}

    dist_to_target_edge = cv2.distanceTransform(target.astype(np.uint8), cv2.DIST_L2, 5)
    work = missing & (dist_to_target_edge <= float(max(1, band_px)))
    if not np.any(work):
        return out, {
            "missingBefore": missing_count,
            "filled": 0,
            "remaining": missing_count,
            "passes": 0,
        }

    directions = [
        (-1, 0),
        (1, 0),
        (0, -1),
        (0, 1),
        (-1, -1),
        (-1, 1),
        (1, -1),
        (1, 1),
    ]

    passes = 0
    filled_total = 0
    filled_mask = np.zeros_like(target, dtype=bool)

    def donor_score(rgba_val: np.ndarray) -> np.ndarray:
        rgb = rgba_val[:, :, :3].astype(np.float32)
        alpha_v = rgba_val[:, :, 3].astype(np.float32) / 255.0
        lum = np.mean(rgb, axis=2)
        ch = np.max(rgb, axis=2) - np.min(rgb, axis=2)
        score = alpha_v * (0.30 + (lum / 255.0) * 0.85 + (ch / 255.0) * 0.25)
        dark_neutral = (lum < 28.0) & (ch < 18.0)
        score[dark_neutral] *= 0.25
        return score

    for _ in range(max_iters):
        if not np.any(work):
            break
        dilated_known = cv2.dilate(known.astype(np.uint8), np.ones((3, 3), np.uint8), iterations=1) > 0
        frontier = work & dilated_known & (~known)
        if not np.any(frontier):
            break

        best_score = np.full(frontier.shape, -1e9, dtype=np.float32)
        best_rgba = np.zeros_like(out)
        for dy, dx in directions:
            has_1 = _shift_no_wrap_bool(known, dy, dx)
            neigh_1 = _shift_no_wrap_rgba(out, dy, dx)
            score_1 = donor_score(neigh_1)
            valid_1 = frontier & has_1
            better_1 = valid_1 & (score_1 > best_score)
            if np.any(better_1):
                best_score[better_1] = score_1[better_1]
                best_rgba[better_1] = neigh_1[better_1]

            has_2 = _shift_no_wrap_bool(known, 2 * dy, 2 * dx)
            neigh_2 = _shift_no_wrap_rgba(out, 2 * dy, 2 * dx)
            score_2 = donor_score(neigh_2) + 0.05
            valid_2 = frontier & has_2
            better_2 = valid_2 & (score_2 > best_score)
            if np.any(better_2):
                best_score[better_2] = score_2[better_2]
                best_rgba[better_2] = neigh_2[better_2]

        assigned = frontier & (best_score > -1e8)
        if not np.any(assigned):
            break

        out[assigned] = best_rgba[assigned]
        out_alpha = out[:, :, 3].copy()
        out_alpha[assigned] = np.maximum(out_alpha[assigned], target_mask[assigned])
        out[:, :, 3] = out_alpha
        known |= assigned
        filled_mask |= assigned
        work &= ~assigned
        filled_now = int(np.sum(assigned))
        filled_total += filled_now
        passes += 1

    if np.any(filled_mask):
        rgb = out[:, :, :3].astype(np.float32)
        alpha = out[:, :, 3:4].astype(np.float32) / 255.0
        rgb_pm = rgb * alpha
        rgb_pm_blur = cv2.GaussianBlur(rgb_pm, (0, 0), 1.6)
        alpha_blur = cv2.GaussianBlur(alpha, (0, 0), 1.6)
        if alpha_blur.ndim == 2:
            alpha_blur = alpha_blur[:, :, None]
        rgb_blur = np.zeros_like(rgb_pm_blur)
        np.divide(
            rgb_pm_blur,
            np.maximum(alpha_blur, 1e-6),
            out=rgb_blur,
            where=alpha_blur > 1e-6,
        )

        dist_from_known = cv2.distanceTransform((~known_start).astype(np.uint8), cv2.DIST_L2, 5)
        blend = np.clip((dist_from_known - 1.0) / 7.0, 0.0, 0.68).astype(np.float32)
        blend_mask = filled_mask & target
        if np.any(blend_mask):
            b = blend[blend_mask][:, None]
            rgb_sel = rgb[blend_mask]
            rgb_blur_sel = rgb_blur[blend_mask]
            rgb[blend_mask] = rgb_sel * (1.0 - b) + rgb_blur_sel * b

            lum = np.mean(rgb[blend_mask], axis=1)
            dark_idx = lum < 24.0
            if np.any(dark_idx):
                idx = np.where(blend_mask)
                rgb[idx[0][dark_idx], idx[1][dark_idx], :] = rgb_blur[
                    idx[0][dark_idx], idx[1][dark_idx], :
                ]
            out[:, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)

    out = clip_rgba_to_mask(out, target_mask)
    remaining = int(np.sum(target & (out[:, :, 3] <= alpha_threshold)))
    return out, {
        "missingBefore": missing_count,
        "filled": filled_total,
        "remaining": remaining,
        "passes": passes,
    }


def best_gap_stretch_candidate(
    rgba: np.ndarray,
    target_mask: np.ndarray,
    base_iou: float,
    base_edge: Optional[float],
    min_missing_px: int,
) -> Optional[Dict]:
    missing_before = int(np.sum((target_mask > 0) & (rgba[:, :, 3] <= GAP_STRETCH_ALPHA_THRESHOLD)))
    if missing_before < min_missing_px:
        return None

    min_hole_gain = max(32, int(missing_before * GAP_STRETCH_MIN_HOLE_GAIN_FRACTION))
    best: Optional[Dict] = None

    for band in GAP_STRETCH_BAND_OPTIONS:
        stretched, stats = stretch_alpha_gaps_to_edge(
            rgba,
            target_mask,
            band_px=int(band),
            alpha_threshold=GAP_STRETCH_ALPHA_THRESHOLD,
            max_iters=max(GAP_STRETCH_MAX_ITERS, int(band) + 4),
        )
        filled = int(stats.get("filled", 0))
        remaining = int(stats.get("remaining", missing_before))
        hole_gain = missing_before - remaining
        if filled <= 0 or hole_gain < min_hole_gain:
            continue

        iou = shape_iou(stretched[:, :, 3], target_mask)
        edge = boundary_mean_error(stretched[:, :, 3], target_mask)
        iou_drop = float(base_iou - iou)
        edge_loss = float(edge - base_edge) if edge is not None and base_edge is not None else 0.0
        if iou_drop > GAP_STRETCH_MAX_IOU_DROP:
            continue
        if edge_loss > GAP_STRETCH_MAX_EDGE_LOSS:
            continue

        candidate = {
            "rgba": stretched,
            "iou": float(iou),
            "edge": edge,
            "stats": stats,
            "band": int(band),
        }
        if best is None:
            best = candidate
            continue

        if candidate_is_better(candidate, best):
            best = candidate
            continue

        # Tie-break: when geometric quality is close, prefer bigger hole reduction.
        best_remaining = int(best["stats"].get("remaining", missing_before))
        if abs(float(candidate["iou"]) - float(best["iou"])) <= 0.0008 and edge is not None and best["edge"] is not None:
            if abs(float(edge) - float(best["edge"])) <= 1.2 and remaining < best_remaining:
                best = candidate

    return best


def boundary_mean_error(
    alpha_mask: np.ndarray, target_mask: np.ndarray, samples: int = EDGE_SNAP_SAMPLES
) -> Optional[float]:
    src_contour = largest_contour(alpha_mask)
    dst_contour = largest_contour(target_mask)
    if src_contour is None or dst_contour is None:
        return None

    src_boundary = sample_closed_contour(src_contour, samples)
    dst_boundary = sample_closed_contour(dst_contour, samples)
    dst_boundary = align_boundary_correspondence(src_boundary, dst_boundary)
    dist = np.linalg.norm(src_boundary - dst_boundary, axis=1)
    return float(np.mean(dist))


def gaussian_kernel_size(sigma: float) -> int:
    k = max(3, int(math.ceil(sigma * 6.0)))
    if k % 2 == 0:
        k += 1
    return k


def edge_snap_refine_once(
    src_rgba: np.ndarray, target_mask: np.ndarray, samples: int = EDGE_SNAP_SAMPLES
) -> Optional[np.ndarray]:
    src_alpha = src_rgba[:, :, 3]
    src_contour = largest_contour(src_alpha)
    dst_contour = largest_contour(target_mask)
    if src_contour is None or dst_contour is None:
        return None

    src_boundary = sample_closed_contour(src_contour, samples)
    dst_boundary = sample_closed_contour(dst_contour, samples)
    dst_boundary = align_boundary_correspondence(src_boundary, dst_boundary)
    displacement = dst_boundary - src_boundary

    h, w = src_alpha.shape
    min_dim = float(max(2, min(h, w)))
    max_disp = float(np.clip(min_dim * 0.03, 2.0, 14.0))
    blur_sigma = float(np.clip(min_dim * 0.045, 3.0, 28.0))
    falloff_px = float(np.clip(min_dim * 0.05, 4.0, 30.0))

    mag = np.linalg.norm(displacement, axis=1, keepdims=True)
    scale = np.minimum(1.0, max_disp / np.maximum(mag, 1e-6))
    displacement = displacement * scale

    dx_seed = np.zeros((h, w), dtype=np.float32)
    dy_seed = np.zeros((h, w), dtype=np.float32)
    w_seed = np.zeros((h, w), dtype=np.float32)

    coords = np.round(src_boundary).astype(np.int32)
    for (x, y), vec in zip(coords, displacement):
        if x < 0 or y < 0 or x >= w or y >= h:
            continue
        dx_seed[y, x] += float(vec[0])
        dy_seed[y, x] += float(vec[1])
        w_seed[y, x] += 1.0

    if float(np.sum(w_seed)) <= 0.0:
        return None

    kernel_size = gaussian_kernel_size(blur_sigma)
    dx_blur = cv2.GaussianBlur(dx_seed, (kernel_size, kernel_size), blur_sigma)
    dy_blur = cv2.GaussianBlur(dy_seed, (kernel_size, kernel_size), blur_sigma)
    w_blur = cv2.GaussianBlur(w_seed, (kernel_size, kernel_size), blur_sigma)

    dx_field = dx_blur / np.maximum(w_blur, 1e-6)
    dy_field = dy_blur / np.maximum(w_blur, 1e-6)

    inside = (target_mask > 0).astype(np.uint8)
    dist_to_edge = cv2.distanceTransform(inside, cv2.DIST_L2, 5)
    edge_falloff = np.exp(
        -(dist_to_edge * dist_to_edge) / max(1e-6, 2.0 * falloff_px * falloff_px)
    ).astype(np.float32)
    dx_field *= edge_falloff
    dy_field *= edge_falloff
    dx_field[inside == 0] = 0.0
    dy_field[inside == 0] = 0.0

    dmag = np.sqrt(dx_field * dx_field + dy_field * dy_field)
    dscale = np.minimum(1.0, max_disp / np.maximum(dmag, 1e-6))
    dx_field *= dscale
    dy_field *= dscale

    grid_x, grid_y = np.meshgrid(
        np.arange(w, dtype=np.float32),
        np.arange(h, dtype=np.float32),
    )
    map_x = grid_x - dx_field.astype(np.float32)
    map_y = grid_y - dy_field.astype(np.float32)

    refined = cv2.remap(
        src_rgba,
        map_x,
        map_y,
        interpolation=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0),
    )
    return refined


def edge_snap_refine(
    stage1_rgba: np.ndarray, target_mask: np.ndarray
) -> Tuple[np.ndarray, int, Optional[float], Optional[float]]:
    current = stage1_rgba
    current_iou = shape_iou(current[:, :, 3], target_mask)
    current_edge = boundary_mean_error(current[:, :, 3], target_mask)
    passes = 0

    for _ in range(EDGE_SNAP_PASSES):
        candidate = edge_snap_refine_once(current, target_mask)
        if candidate is None:
            break
        candidate = clip_rgba_to_mask(candidate, target_mask)

        candidate_iou = shape_iou(candidate[:, :, 3], target_mask)
        candidate_edge = boundary_mean_error(candidate[:, :, 3], target_mask)
        if candidate_edge is None or current_edge is None:
            break

        edge_gain = current_edge - candidate_edge
        iou_gain = candidate_iou - current_iou
        if candidate_iou + EDGE_SNAP_MAX_IOU_DROP < current_iou:
            break
        if edge_gain < -EDGE_SNAP_MAX_EDGE_LOSS:
            break
        if edge_gain < EDGE_SNAP_MIN_EDGE_GAIN and iou_gain < EDGE_SNAP_MIN_IOU_GAIN:
            break

        current = candidate
        current_iou = candidate_iou
        current_edge = candidate_edge
        passes += 1

    return current, passes, current_edge, current_iou


def post_edge_repair(
    rgba: np.ndarray,
    target_mask: np.ndarray,
    max_passes: int = POST_EDGE_REPAIR_MAX_PASSES,
    max_iou_drop: float = POST_EDGE_REPAIR_MAX_IOU_DROP,
) -> Tuple[np.ndarray, int, Optional[float], Optional[float]]:
    current_iou = shape_iou(rgba[:, :, 3], target_mask)
    current_edge = boundary_mean_error(rgba[:, :, 3], target_mask)
    if current_edge is None:
        return rgba, 0, current_edge, current_iou

    floor_iou = current_iou - max_iou_drop
    best_rgba = rgba
    best_iou = current_iou
    best_edge = current_edge

    probe = rgba
    used_passes = 0
    for idx in range(max_passes):
        candidate = edge_snap_refine_once(probe, target_mask)
        if candidate is None:
            break
        candidate = clip_rgba_to_mask(candidate, target_mask)
        cand_iou = shape_iou(candidate[:, :, 3], target_mask)
        cand_edge = boundary_mean_error(candidate[:, :, 3], target_mask)
        if cand_edge is None:
            break

        probe = candidate
        if cand_iou < floor_iou:
            continue
        if cand_edge + 1e-6 < best_edge:
            best_rgba = candidate
            best_iou = cand_iou
            best_edge = cand_edge
            used_passes = idx + 1

    return best_rgba, used_passes, best_edge, best_iou


def remap_premultiplied_rgba(src_rgba: np.ndarray, map_x: np.ndarray, map_y: np.ndarray) -> np.ndarray:
    src = src_rgba.astype(np.float32) / 255.0
    alpha = src[:, :, 3:4]
    src_pm = np.concatenate([src[:, :, :3] * alpha, alpha], axis=2)
    warped_pm = cv2.remap(
        src_pm,
        map_x,
        map_y,
        interpolation=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0.0, 0.0, 0.0, 0.0),
    )

    out_alpha = np.clip(warped_pm[:, :, 3:4], 0.0, 1.0)
    out_rgb = np.zeros_like(warped_pm[:, :, :3], dtype=np.float32)
    np.divide(
        warped_pm[:, :, :3],
        np.maximum(out_alpha, 1e-6),
        out=out_rgb,
        where=out_alpha > 1e-6,
    )
    out = np.concatenate([out_rgb, out_alpha], axis=2)
    return np.clip(out * 255.0, 0, 255).astype(np.uint8)


def boundary_pull_refine_once(
    src_rgba: np.ndarray,
    target_mask: np.ndarray,
    alpha_threshold: int = BOUNDARY_PULL_ALPHA_THRESHOLD,
    samples: int = EDGE_SNAP_SAMPLES + 120,
    disp_scale: float = 1.0,
    blur_scale: float = 1.0,
) -> Optional[np.ndarray]:
    src_alpha = src_rgba[:, :, 3]
    src_mask = (src_alpha > alpha_threshold).astype(np.uint8)
    dst_mask = (target_mask > 0).astype(np.uint8)
    if int(np.sum(src_mask)) <= 0 or int(np.sum(dst_mask)) <= 0:
        return None

    src_contour = largest_contour(src_mask * 255)
    dst_contour = largest_contour(dst_mask * 255)
    if src_contour is None or dst_contour is None:
        return None

    src_boundary = sample_closed_contour(src_contour, samples)
    dst_boundary = sample_closed_contour(dst_contour, samples)
    dst_boundary = align_boundary_correspondence(src_boundary, dst_boundary)

    displacement = dst_boundary - src_boundary
    h, w = src_mask.shape
    min_dim = float(max(2, min(h, w)))
    max_disp = float(np.clip(min_dim * 0.055 * disp_scale, 2.0, 26.0))
    blur_sigma = float(np.clip(min_dim * 0.055 * blur_scale, 3.0, 44.0))
    falloff_src = float(np.clip(min_dim * 0.11, 10.0, 90.0))
    falloff_target = float(np.clip(min_dim * 0.07, 6.0, 46.0))

    mag = np.linalg.norm(displacement, axis=1, keepdims=True)
    scale = np.minimum(1.0, max_disp / np.maximum(mag, 1e-6))
    displacement = displacement * scale

    dx_seed = np.zeros((h, w), dtype=np.float32)
    dy_seed = np.zeros((h, w), dtype=np.float32)
    w_seed = np.zeros((h, w), dtype=np.float32)
    coords = np.round(src_boundary).astype(np.int32)
    for (x, y), vec in zip(coords, displacement):
        if x < 0 or y < 0 or x >= w or y >= h:
            continue
        dx_seed[y, x] += float(vec[0])
        dy_seed[y, x] += float(vec[1])
        w_seed[y, x] += 1.0

    if float(np.sum(w_seed)) <= 0.0:
        return None

    kernel_size = gaussian_kernel_size(blur_sigma)
    dx_blur = cv2.GaussianBlur(dx_seed, (kernel_size, kernel_size), blur_sigma)
    dy_blur = cv2.GaussianBlur(dy_seed, (kernel_size, kernel_size), blur_sigma)
    w_blur = cv2.GaussianBlur(w_seed, (kernel_size, kernel_size), blur_sigma)
    dx_field = dx_blur / np.maximum(w_blur, 1e-6)
    dy_field = dy_blur / np.maximum(w_blur, 1e-6)

    dist_src = cv2.distanceTransform(src_mask, cv2.DIST_L2, 5)
    dist_target = cv2.distanceTransform(dst_mask, cv2.DIST_L2, 5)
    taper_src = np.exp(-(dist_src * dist_src) / max(1e-6, 2.0 * falloff_src * falloff_src)).astype(
        np.float32
    )
    taper_target = np.exp(
        -(dist_target * dist_target) / max(1e-6, 2.0 * falloff_target * falloff_target)
    ).astype(np.float32)
    influence = np.maximum(taper_target, taper_src * 0.85)
    influence[dst_mask == 0] = 0.0
    dx_field *= influence
    dy_field *= influence

    dmag = np.sqrt(dx_field * dx_field + dy_field * dy_field)
    dscale = np.minimum(1.0, max_disp / np.maximum(dmag, 1e-6))
    dx_field *= dscale
    dy_field *= dscale

    grid_x, grid_y = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    map_x = grid_x - dx_field.astype(np.float32)
    map_y = grid_y - dy_field.astype(np.float32)

    return remap_premultiplied_rgba(src_rgba, map_x, map_y)


def boundary_pull_warp(
    rgba: np.ndarray,
    target_mask: np.ndarray,
    alpha_threshold: int = BOUNDARY_PULL_ALPHA_THRESHOLD,
    max_passes: int = BOUNDARY_PULL_MAX_PASSES,
) -> Tuple[np.ndarray, Dict[str, float]]:
    del max_passes
    target = target_mask > 0
    missing_before = int(np.sum(target & (rgba[:, :, 3] <= alpha_threshold)))
    base_iou = shape_iou(rgba[:, :, 3], target_mask)
    base_edge = boundary_mean_error(rgba[:, :, 3], target_mask)
    if missing_before < BOUNDARY_PULL_MIN_MISSING_PX:
        return rgba, {
            "passes": 0,
            "filled": 0,
            "remaining": missing_before,
            "iou": float(base_iou),
            "edge": float(base_edge) if base_edge is not None else None,
        }

    gap_candidate = best_gap_stretch_candidate(
        rgba,
        target_mask,
        base_iou=base_iou,
        base_edge=base_edge,
        min_missing_px=BOUNDARY_PULL_MIN_MISSING_PX,
    )

    if gap_candidate is None:
        return rgba, {
            "passes": 0,
            "filled": 0,
            "remaining": missing_before,
            "iou": float(base_iou),
            "edge": float(base_edge) if base_edge is not None else None,
        }

    gap_stats = dict(gap_candidate["stats"])
    remaining = int(gap_stats.get("remaining", missing_before))
    total_gain = max(0, missing_before - remaining)
    min_total_gain = max(24, int(missing_before * BOUNDARY_PULL_MIN_HOLE_GAIN_FRACTION))
    if total_gain < min_total_gain:
        return rgba, {
            "passes": 0,
            "filled": 0,
            "remaining": missing_before,
            "iou": float(base_iou),
            "edge": float(base_edge) if base_edge is not None else None,
        }

    return gap_candidate["rgba"], {
        "passes": int(gap_stats.get("passes", 0)),
        "filled": int(total_gain),
        "remaining": int(remaining),
        "iou": float(gap_candidate["iou"]),
        "edge": float(gap_candidate["edge"]) if gap_candidate["edge"] is not None else None,
    }


def make_candidate(
    name: str,
    rgba: np.ndarray,
    target_mask: np.ndarray,
    edge_snap_passes: int = 0,
) -> Dict:
    return {
        "name": name,
        "rgba": rgba,
        "iou": shape_iou(rgba[:, :, 3], target_mask),
        "edge": boundary_mean_error(rgba[:, :, 3], target_mask),
        "edgeSnapPasses": int(edge_snap_passes),
    }


def candidate_is_better(candidate: Dict, current: Dict) -> bool:
    c_iou = float(candidate["iou"])
    b_iou = float(current["iou"])
    d_iou = c_iou - b_iou
    c_edge = candidate.get("edge")
    b_edge = current.get("edge")

    if d_iou >= CANDIDATE_IOU_EPS:
        return True
    if c_edge is None or b_edge is None:
        return False

    edge_gain = float(b_edge - c_edge)
    if d_iou >= -CANDIDATE_SOFT_MAX_IOU_DROP and edge_gain >= CANDIDATE_EDGE_SOFT_GAIN:
        return True
    if d_iou >= -CANDIDATE_HARD_MAX_IOU_DROP and edge_gain >= CANDIDATE_EDGE_HARD_GAIN:
        return True
    return False


def extract_components(binary_mask: np.ndarray, min_pixels: int = COMPONENT_MIN_PIXELS) -> List[Dict]:
    if binary_mask.size == 0:
        return []
    mask = (binary_mask > 0).astype(np.uint8)
    n_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
    comps: List[Dict] = []
    for idx in range(1, n_labels):
        area = int(stats[idx, cv2.CC_STAT_AREA])
        if area < min_pixels:
            continue
        x = int(stats[idx, cv2.CC_STAT_LEFT])
        y = int(stats[idx, cv2.CC_STAT_TOP])
        w = int(stats[idx, cv2.CC_STAT_WIDTH])
        h = int(stats[idx, cv2.CC_STAT_HEIGHT])
        if w <= 0 or h <= 0:
            continue
        crop_labels = labels[y : y + h, x : x + w]
        crop_mask = np.where(crop_labels == idx, 255, 0).astype(np.uint8)
        comps.append(
            {
                "x": x,
                "y": y,
                "w": w,
                "h": h,
                "area": area,
                "cx": float(centroids[idx][0]),
                "cy": float(centroids[idx][1]),
                "mask_crop": crop_mask,
            }
        )
    comps.sort(key=lambda c: c["area"], reverse=True)
    return comps


def select_significant_components(
    components: List[Dict],
    rel_min: float,
    keep_fraction: float = COMPONENT_KEEP_FRACTION,
    min_pixels: int = COMPONENT_MIN_PIXELS,
) -> List[Dict]:
    if not components:
        return []
    total_area = int(sum(c["area"] for c in components))
    largest = int(components[0]["area"])
    abs_threshold = max(min_pixels, int(largest * rel_min))
    keep: List[Dict] = []
    cum_area = 0
    for comp in components:
        must_keep_for_coverage = total_area > 0 and (cum_area / total_area) < keep_fraction
        if comp["area"] >= abs_threshold or must_keep_for_coverage:
            keep.append(comp)
            cum_area += int(comp["area"])
    return keep if keep else [components[0]]


def match_components_by_position(
    source_components: List[Dict],
    target_components: List[Dict],
    src_shape: Tuple[int, int],
    tgt_shape: Tuple[int, int],
) -> List[Tuple[int, int]]:
    if not source_components or not target_components:
        return []

    src_h, src_w = src_shape
    tgt_h, tgt_w = tgt_shape
    src_total = float(max(1, sum(c["area"] for c in source_components)))
    tgt_total = float(max(1, sum(c["area"] for c in target_components)))

    matches: List[Tuple[int, int]] = []
    used_source = set()
    target_order = sorted(range(len(target_components)), key=lambda i: target_components[i]["area"], reverse=True)

    for ti in target_order:
        t = target_components[ti]
        tx = float(t["cx"]) / max(1.0, float(tgt_w))
        ty = float(t["cy"]) / max(1.0, float(tgt_h))
        t_area_rel = float(t["area"]) / tgt_total

        best_si = None
        best_cost = float("inf")
        for si, s in enumerate(source_components):
            if si in used_source:
                continue
            sx = float(s["cx"]) / max(1.0, float(src_w))
            sy = float(s["cy"]) / max(1.0, float(src_h))
            s_area_rel = float(s["area"]) / src_total

            pos_dist = math.hypot(sx - tx, sy - ty)
            area_pen = abs(math.log((s_area_rel + 1e-6) / (t_area_rel + 1e-6)))
            cost = pos_dist + 0.35 * area_pen
            if cost < best_cost:
                best_cost = cost
                best_si = si

        if best_si is not None:
            used_source.add(best_si)
            matches.append((best_si, ti))
        if len(used_source) >= len(source_components):
            break

    return matches


def alpha_blit(dst: np.ndarray, src: np.ndarray, x: int, y: int) -> None:
    h, w = src.shape[:2]
    if h <= 0 or w <= 0:
        return
    if x < 0 or y < 0 or x + w > dst.shape[1] or y + h > dst.shape[0]:
        return
    patch = dst[y : y + h, x : x + w].astype(np.float32)
    srcf = src.astype(np.float32)
    alpha = srcf[:, :, 3:4] / 255.0
    patch[:] = patch * (1.0 - alpha) + srcf * alpha
    dst[y : y + h, x : x + w] = np.clip(patch, 0, 255).astype(np.uint8)


def build_best_warp_for_target(source_rgba: np.ndarray, target_mask: np.ndarray) -> Optional[Dict]:
    out_h, out_w = target_mask.shape
    source_alpha = source_rgba[:, :, 3]
    src_contour = largest_contour(source_alpha)
    dst_contour = largest_contour(target_mask)
    if src_contour is None or dst_contour is None:
        return None

    samples = 180
    src_boundary = sample_closed_contour(src_contour, samples)
    dst_boundary = sample_closed_contour(dst_contour, samples)
    dst_boundary = align_boundary_correspondence(src_boundary, dst_boundary)
    src_pts, dst_pts = build_landmarks(src_boundary, dst_boundary)

    triangles = delaunay_triangles(dst_pts, out_w, out_h)
    if len(triangles) < 8:
        return None

    baseline = cv2.resize(source_rgba, (out_w, out_h), interpolation=cv2.INTER_LINEAR)
    baseline = clip_rgba_to_mask(baseline, target_mask)
    baseline_candidate = make_candidate("baseline", baseline, target_mask, edge_snap_passes=0)

    baseline_refined, baseline_snap_passes, baseline_refined_edge, baseline_refined_iou = edge_snap_refine(
        baseline,
        target_mask,
    )
    if baseline_refined_iou is None:
        baseline_refined_iou = baseline_candidate["iou"]
    if baseline_refined_edge is None:
        baseline_refined_edge = baseline_candidate["edge"]
    baseline_refined_candidate = {
        "name": "baseline-edge-snap",
        "rgba": baseline_refined,
        "iou": float(baseline_refined_iou),
        "edge": baseline_refined_edge,
        "edgeSnapPasses": int(baseline_snap_passes),
    }

    stage1 = warp_piecewise_affine(source_rgba, src_pts, dst_pts, out_w, out_h, triangles)
    stage1 = clip_rgba_to_mask(stage1, target_mask)
    stage1_candidate = make_candidate("stage1", stage1, target_mask, edge_snap_passes=0)

    stage1_refined, stage1_snap_passes, stage1_refined_edge, stage1_refined_iou = edge_snap_refine(
        stage1,
        target_mask,
    )
    if stage1_refined_iou is None:
        stage1_refined_iou = stage1_candidate["iou"]
    if stage1_refined_edge is None:
        stage1_refined_edge = stage1_candidate["edge"]
    stage1_refined_candidate = {
        "name": "stage1-edge-snap",
        "rgba": stage1_refined,
        "iou": float(stage1_refined_iou),
        "edge": stage1_refined_edge,
        "edgeSnapPasses": int(stage1_snap_passes),
    }

    best = baseline_candidate
    for candidate in (baseline_refined_candidate, stage1_candidate, stage1_refined_candidate):
        if candidate_is_better(candidate, best):
            best = candidate

    return {
        "baseline": baseline,
        "stage1": stage1,
        "warped": best["rgba"],
        "strategy": str(best["name"]),
        "iouBaseline": float(baseline_candidate["iou"]),
        "iouStage1": float(stage1_candidate["iou"]),
        "iouWarped": float(best["iou"]),
        "edgeBaseline": baseline_candidate.get("edge"),
        "edgeStage1": stage1_candidate.get("edge"),
        "edgeWarped": best.get("edge"),
        "edgeSnapPasses": int(best.get("edgeSnapPasses", 0)),
        "triangleCount": int(len(triangles)),
    }


def safe_key(key: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]+", "_", key)


def process_country(
    country: Dict,
    feature: Dict,
    atlas_w: int,
    atlas_h: int,
    output_dir: Path,
) -> Optional[Dict]:
    source_path = Path(country["imageFile"])
    if not source_path.exists():
        return None

    target = target_mask_and_bbox(feature["geometry"], atlas_w, atlas_h)
    if target is None:
        return None
    target_mask, bbox, _ = target
    out_h, out_w = target_mask.shape

    source_rgba = np.array(Image.open(source_path).convert("RGBA"), dtype=np.uint8)
    feature_key = country.get("featureKey")
    edge_snap_override = COUNTRY_EDGE_SNAP_PASSES.get(feature_key)
    original_edge_snap_passes = EDGE_SNAP_PASSES
    if edge_snap_override is not None:
        globals()["EDGE_SNAP_PASSES"] = int(max(0, edge_snap_override))

    baseline = cv2.resize(source_rgba, (out_w, out_h), interpolation=cv2.INTER_LINEAR)
    baseline = clip_rgba_to_mask(baseline, target_mask)
    single_result = build_best_warp_for_target(source_rgba, target_mask)
    if single_result is None:
        globals()["EDGE_SNAP_PASSES"] = original_edge_snap_passes
        return None

    stage1: np.ndarray = single_result["stage1"]
    warped: np.ndarray = single_result["warped"]
    strategy = str(single_result["strategy"])
    edge_snap_passes = int(single_result["edgeSnapPasses"])
    triangle_count = int(single_result["triangleCount"])
    best_candidate = {
        "iou": shape_iou(warped[:, :, 3], target_mask),
        "edge": boundary_mean_error(warped[:, :, 3], target_mask),
    }
    force_baseline = feature_key in FORCE_BASELINE_FEATURE_KEYS
    if force_baseline:
        stage1 = baseline
        warped = baseline
        strategy = "baseline-forced"
        edge_snap_passes = 0
        triangle_count = 0
        best_candidate = {
            "iou": shape_iou(warped[:, :, 3], target_mask),
            "edge": boundary_mean_error(warped[:, :, 3], target_mask),
        }

    comp_override = COUNTRY_COMPONENT_OVERRIDES.get(feature_key, {})
    source_rel_min = float(comp_override.get("source_rel_min", COMPONENT_SOURCE_REL_MIN))
    target_rel_min = float(comp_override.get("target_rel_min", COMPONENT_TARGET_REL_MIN))
    target_keep_fraction = float(comp_override.get("target_keep_fraction", 0.9995))

    source_components = select_significant_components(
        extract_components((source_rgba[:, :, 3] > 10).astype(np.uint8) * 255),
        rel_min=source_rel_min,
        keep_fraction=COMPONENT_KEEP_FRACTION,
        min_pixels=COMPONENT_MIN_PIXELS,
    )
    target_components = select_significant_components(
        extract_components((target_mask > 0).astype(np.uint8) * 255, min_pixels=12),
        rel_min=target_rel_min,
        keep_fraction=target_keep_fraction,
        min_pixels=12,
    )

    use_component_mode = (
        (not force_baseline)
        and feature_key not in DISABLE_COMPONENT_MODE_KEYS
        and len(source_components) >= 2
        and len(target_components) >= 2
    )
    if use_component_mode:
        matches = match_components_by_position(
            source_components,
            target_components,
            src_shape=source_rgba.shape[:2],
            tgt_shape=target_mask.shape,
        )
        if matches:
            stage1_canvas = np.zeros((out_h, out_w, 4), dtype=np.uint8)
            warped_canvas = np.zeros((out_h, out_w, 4), dtype=np.uint8)
            matched_targets = set()
            strategy_hist: Dict[str, int] = {}
            component_edge_snap_passes = 0
            component_triangle_count = 0

            for src_idx, tgt_idx in matches:
                src_comp = source_components[src_idx]
                tgt_comp = target_components[tgt_idx]
                matched_targets.add(tgt_idx)

                sx, sy, sw, sh = src_comp["x"], src_comp["y"], src_comp["w"], src_comp["h"]
                tx, ty, tw, th = tgt_comp["x"], tgt_comp["y"], tgt_comp["w"], tgt_comp["h"]
                if sw <= 0 or sh <= 0 or tw <= 0 or th <= 0:
                    continue

                src_crop = source_rgba[sy : sy + sh, sx : sx + sw].copy()
                src_crop[:, :, 3] = np.minimum(src_crop[:, :, 3], src_comp["mask_crop"])
                src_crop[src_crop[:, :, 3] == 0, :3] = 0
                tgt_crop_mask = tgt_comp["mask_crop"]

                comp_result = build_best_warp_for_target(src_crop, tgt_crop_mask)
                if comp_result is None:
                    local_stage1 = cv2.resize(src_crop, (tw, th), interpolation=cv2.INTER_LINEAR)
                    local_stage1 = clip_rgba_to_mask(local_stage1, tgt_crop_mask)
                    local_warped = local_stage1
                    local_strategy = "component-fallback-baseline"
                    local_passes = 0
                    local_triangles = 0
                else:
                    local_stage1 = comp_result["stage1"]
                    local_warped = comp_result["warped"]
                    local_strategy = str(comp_result["strategy"])
                    local_passes = int(comp_result["edgeSnapPasses"])
                    local_triangles = int(comp_result["triangleCount"])

                alpha_blit(stage1_canvas, local_stage1, tx, ty)
                alpha_blit(warped_canvas, local_warped, tx, ty)
                component_edge_snap_passes += local_passes
                component_triangle_count += local_triangles
                strategy_hist[local_strategy] = strategy_hist.get(local_strategy, 0) + 1

            for ti, tgt_comp in enumerate(target_components):
                if ti in matched_targets:
                    continue
                tx, ty, tw, th = tgt_comp["x"], tgt_comp["y"], tgt_comp["w"], tgt_comp["h"]
                fallback = baseline[ty : ty + th, tx : tx + tw].copy()
                fallback = clip_rgba_to_mask(fallback, tgt_comp["mask_crop"])
                alpha_blit(stage1_canvas, fallback, tx, ty)
                alpha_blit(warped_canvas, fallback, tx, ty)

            stage1 = clip_rgba_to_mask(stage1_canvas, target_mask)
            warped = clip_rgba_to_mask(warped_canvas, target_mask)
            top_strategies = ",".join(
                f"{k}x{v}"
                for k, v in sorted(strategy_hist.items(), key=lambda kv: kv[1], reverse=True)[:2]
            )
            component_strategy = (
                f"component-matched-v1[{top_strategies}]"
                if top_strategies
                else "component-matched-v1"
            )
            component_candidate = {
                "iou": shape_iou(warped[:, :, 3], target_mask),
                "edge": boundary_mean_error(warped[:, :, 3], target_mask),
            }
            if candidate_is_better(component_candidate, best_candidate):
                strategy = component_strategy
                edge_snap_passes = int(component_edge_snap_passes)
                triangle_count = int(component_triangle_count)
                best_candidate = component_candidate
            else:
                stage1 = single_result["stage1"]
                warped = single_result["warped"]

    iou_baseline = shape_iou(baseline[:, :, 3], target_mask)
    stage1_iou = shape_iou(stage1[:, :, 3], target_mask)
    baseline_edge = boundary_mean_error(baseline[:, :, 3], target_mask)
    stage1_edge = boundary_mean_error(stage1[:, :, 3], target_mask)
    target_area = int(np.sum(target_mask > 0))

    iou_warped = shape_iou(warped[:, :, 3], target_mask)
    final_edge = boundary_mean_error(warped[:, :, 3], target_mask)
    if (
        country.get("featureKey") in POST_EDGE_REPAIR_FEATURE_KEYS
        and country.get("featureKey") not in FORCE_ACCEPT_FEATURE_KEYS
        and country.get("featureKey") not in SKIP_EDGE_REPAIR_FEATURE_KEYS
        and
        target_area >= POST_EDGE_REPAIR_MIN_AREA
        and baseline_edge is not None
        and final_edge is not None
        and (final_edge - baseline_edge) >= POST_EDGE_REPAIR_MIN_EDGE_EXCESS
    ):
        repaired, repair_passes, repaired_edge, repaired_iou = post_edge_repair(
            warped,
            target_mask,
            max_passes=POST_EDGE_REPAIR_MAX_PASSES,
            max_iou_drop=POST_EDGE_REPAIR_MAX_IOU_DROP,
        )
        if (
            repair_passes > 0
            and repaired_edge is not None
            and repaired_iou is not None
            and final_edge - repaired_edge >= POST_EDGE_REPAIR_MIN_EDGE_GAIN
        ):
            warped = repaired
            edge_snap_passes += int(repair_passes)
            strategy = f"{strategy}+edge-repair"
            iou_warped = float(repaired_iou)
            final_edge = float(repaired_edge)

    pull_passes = 0
    pull_fill_px = 0
    pull_remaining_px = int(np.sum((target_mask > 0) & (warped[:, :, 3] <= BOUNDARY_PULL_ALPHA_THRESHOLD)))
    min_pull_trigger = max(BOUNDARY_PULL_MIN_MISSING_PX, int(target_area * 0.01))
    if USE_BOUNDARY_PULL and pull_remaining_px >= min_pull_trigger:
        pulled, pull_stats = boundary_pull_warp(
            warped,
            target_mask,
            alpha_threshold=BOUNDARY_PULL_ALPHA_THRESHOLD,
            max_passes=BOUNDARY_PULL_MAX_PASSES,
        )
        if int(pull_stats.get("filled", 0)) > 0:
            warped = pulled
            iou_warped = float(pull_stats.get("iou", iou_warped))
            if pull_stats.get("edge") is not None:
                final_edge = float(pull_stats["edge"])
            strategy = f"{strategy}+boundary-pull"
            pull_passes = int(pull_stats.get("passes", 0))
            pull_fill_px = int(pull_stats.get("filled", 0))
            pull_remaining_px = int(pull_stats.get("remaining", pull_remaining_px))

    # Final per-country soft clip: keep hand-drawn borders from being cut too harshly.
    final_clip_dilate = int(FINAL_CLIP_DILATE_BY_KEY.get(country.get("featureKey"), CLIP_DILATE_PX))
    warped = clip_rgba_to_mask(warped, target_mask, dilate_px=final_clip_dilate)
    iou_warped = shape_iou(warped[:, :, 3], target_mask)
    final_edge = boundary_mean_error(warped[:, :, 3], target_mask)
    pull_remaining_px = int(np.sum((target_mask > 0) & (warped[:, :, 3] <= BOUNDARY_PULL_ALPHA_THRESHOLD)))

    key = country.get("featureKey", country["filename"])
    file_name = f"{safe_key(key)}.webp"
    out_path = output_dir / file_name
    Image.fromarray(warped, mode="RGBA").save(out_path, format="WEBP", quality=95)

    result = {
        "warpFile": f"assets/globe/warped/{file_name}",
        "warpLeft": int(bbox.left),
        "warpTop": int(bbox.top),
        "warpWidth": int(bbox.width),
        "warpHeight": int(bbox.height),
        "warpStrategy": strategy,
        "warpIoUBaseline": round(float(iou_baseline), 4),
        "warpIoUStage1": round(float(stage1_iou), 4),
        "warpIoU": round(float(iou_warped), 4),
        "warpIoUGain": round(float(iou_warped - iou_baseline), 4),
        "triangleCount": int(triangle_count),
        "targetAreaPx": target_area,
        "edgeSnapPasses": int(edge_snap_passes),
        "edgeErrorBaseline": round(float(baseline_edge), 4) if baseline_edge is not None else None,
        "edgeErrorStage1": round(float(stage1_edge), 4) if stage1_edge is not None else None,
        "edgeError": round(float(final_edge), 4) if final_edge is not None else None,
        "edgeErrorGain": (
            round(float(baseline_edge - final_edge), 4)
            if baseline_edge is not None and final_edge is not None
            else None
        ),
        "gapStretchPasses": int(pull_passes),
        "gapStretchFillPx": int(pull_fill_px),
        "gapStretchRemainingPx": int(pull_remaining_px),
    }
    globals()["EDGE_SNAP_PASSES"] = original_edge_snap_passes
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="assets/globe/config.json")
    parser.add_argument("--geojson", default="assets/globe/world.geojson")
    parser.add_argument("--atlas-width", type=int, default=8192)
    parser.add_argument("--atlas-height", type=int, default=4096)
    parser.add_argument(
        "--feature-keys",
        default="",
        help="Comma-separated feature keys to process (empty = all countries).",
    )
    args = parser.parse_args()

    project_dir = Path(__file__).resolve().parent.parent
    config_path = project_dir / args.config
    geo_path = project_dir / args.geojson
    warped_dir = project_dir / "assets/globe/warped"
    warped_dir.mkdir(parents=True, exist_ok=True)

    config = json.loads(config_path.read_text(encoding="utf-8"))
    geo = json.loads(geo_path.read_text(encoding="utf-8"))
    features_by_key = {f["properties"]["key"]: f for f in geo["features"]}

    report = {
        "atlasWidth": args.atlas_width,
        "atlasHeight": args.atlas_height,
        "countries": [],
        "summary": {},
    }

    ok = 0
    skipped = 0
    rejected = 0
    accepted_by_edge = 0
    gains = []
    selected_keys = {
        k.strip()
        for k in str(args.feature_keys).split(",")
        if k.strip()
    }

    for country in config.get("countries", []):
        key = country.get("featureKey")
        if selected_keys and key not in selected_keys:
            continue

        # Clear previous warp metadata first; accepted warps are written below.
        for k in [
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
        ]:
            country.pop(k, None)

        feature = features_by_key.get(key)
        if feature is None:
            skipped += 1
            continue

        result = process_country(country, feature, args.atlas_width, args.atlas_height, warped_dir)
        if result is None:
            skipped += 1
            continue

        gain = result["warpIoUGain"]
        baseline = result["warpIoUBaseline"]
        warped_iou = result["warpIoU"]
        edge_gain = result["edgeErrorGain"]
        target_area = result["targetAreaPx"]
        accept_by_iou = (
            target_area >= MIN_TARGET_AREA_FOR_WARP
            and (
                gain >= MIN_IOU_GAIN
                or (baseline <= LOW_BASELINE_ALLOW and gain >= LOW_BASELINE_TOLERANCE)
            )
        )
        iou_drop = baseline - warped_iou
        accept_by_edge = (
            target_area >= MIN_TARGET_AREA_FOR_WARP
            and edge_gain is not None
            and edge_gain >= EDGE_ACCEPT_MIN_GAIN
            and iou_drop <= EDGE_ACCEPT_MAX_IOU_DROP
            and warped_iou >= EDGE_ACCEPT_MIN_IOU
        )
        force_accept = key in FORCE_ACCEPT_FEATURE_KEYS
        accept = accept_by_iou or accept_by_edge or force_accept

        if accept:
            country.update(result)
            ok += 1
            gains.append(gain)
            if accept_by_edge and not accept_by_iou:
                accepted_by_edge += 1
        else:
            rejected += 1

        report["countries"].append(
            {
                "name": country.get("name"),
                "featureKey": key,
                "accepted": accept,
                "warpIoU": result["warpIoU"],
                "warpIoUBaseline": result["warpIoUBaseline"],
                "warpIoUGain": result["warpIoUGain"],
                "triangleCount": result["triangleCount"],
                "targetAreaPx": result["targetAreaPx"],
                "warpStrategy": result["warpStrategy"],
                "warpIoUStage1": result["warpIoUStage1"],
                "edgeSnapPasses": result["edgeSnapPasses"],
                "edgeErrorBaseline": result["edgeErrorBaseline"],
                "edgeErrorStage1": result["edgeErrorStage1"],
                "edgeError": result["edgeError"],
                "edgeErrorGain": result["edgeErrorGain"],
                "gapStretchPasses": result["gapStretchPasses"],
                "gapStretchFillPx": result["gapStretchFillPx"],
                "gapStretchRemainingPx": result["gapStretchRemainingPx"],
                "acceptedByIoU": accept_by_iou,
                "acceptedByEdge": accept_by_edge and not accept_by_iou,
                "forcedAccept": force_accept,
            }
        )

    config["warpAtlasWidth"] = args.atlas_width
    config["warpAtlasHeight"] = args.atlas_height
    config["warpMethod"] = "piecewise-affine-boundary-v2-edge-snap"
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    report["countries"].sort(key=lambda x: x["warpIoUGain"], reverse=True)
    mean_gain = float(np.mean(gains)) if gains else 0.0
    edge_snap_countries = sum(1 for c in report["countries"] if c.get("edgeSnapPasses", 0) > 0)
    edge_snap_passes = int(sum(c.get("edgeSnapPasses", 0) for c in report["countries"]))
    edge_gains = [
        float(c["edgeErrorGain"])
        for c in report["countries"]
        if c.get("edgeErrorGain") is not None and c.get("edgeSnapPasses", 0) > 0
    ]
    report["summary"] = {
        "warpedCountries": ok,
        "skippedCountries": skipped,
        "rejectedCountries": rejected,
        "acceptedByEdgeRule": accepted_by_edge,
        "meanIoUGain": round(mean_gain, 4),
        "maxIoUGain": round(max(gains), 4) if gains else 0.0,
        "minIoUGain": round(min(gains), 4) if gains else 0.0,
        "edgeSnapCountries": edge_snap_countries,
        "edgeSnapPasses": edge_snap_passes,
        "meanEdgeGainPx": round(float(np.mean(edge_gains)), 4) if edge_gains else 0.0,
    }

    report_path = project_dir / "assets/globe/warp_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Warped countries: {ok}")
    print(f"Skipped countries: {skipped}")
    print(f"Mean IoU gain: {report['summary']['meanIoUGain']}")
    print(f"Updated: {config_path.relative_to(project_dir)}")
    print(f"Report: {report_path.relative_to(project_dir)}")


if __name__ == "__main__":
    main()
