from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, List, Sequence, Set, Tuple

import numpy as np


@dataclass
class RegionPartition:
    region_name: str
    space_name: str
    left: int
    top: int
    width: int
    height: int
    owner: np.ndarray
    union_mask: np.ndarray
    feature_keys: List[str]

    @property
    def country_count(self) -> int:
        return len(self.feature_keys)


def _job_feature_key(job: object) -> str:
    country = getattr(job, "country")
    return str(country.get("featureKey", ""))


def _unwrap_x(values: np.ndarray, unwrap_center_x: float, atlas_width: int) -> np.ndarray:
    out = values.astype(np.float64).copy()
    d = out - float(unwrap_center_x)
    out[d > atlas_width * 0.5] -= float(atlas_width)
    out[d < -atlas_width * 0.5] += float(atlas_width)
    return out


def build_source_region_partition(jobs: Sequence[object], alpha_threshold: int = 8) -> RegionPartition:
    if not jobs:
        raise ValueError("jobs must not be empty")

    left = min(int(getattr(job, "source_left")) for job in jobs)
    top = min(int(getattr(job, "source_top")) for job in jobs)
    right = max(int(getattr(job, "source_left")) + int(getattr(job, "source_rgba").shape[1]) for job in jobs)
    bottom = max(int(getattr(job, "source_top")) + int(getattr(job, "source_rgba").shape[0]) for job in jobs)
    width = max(1, right - left)
    height = max(1, bottom - top)

    owner = np.full((height, width), -1, dtype=np.int32)
    union_mask = np.zeros((height, width), dtype=np.uint8)
    feature_keys: List[str] = []

    for idx, job in enumerate(jobs):
        feature_keys.append(_job_feature_key(job))
        rgba = np.asarray(getattr(job, "source_rgba"), dtype=np.uint8)
        mask = rgba[:, :, 3] > alpha_threshold
        h, w = mask.shape
        x0 = int(getattr(job, "source_left")) - left
        y0 = int(getattr(job, "source_top")) - top
        x1 = x0 + w
        y1 = y0 + h
        patch = owner[y0:y1, x0:x1]
        union_patch = union_mask[y0:y1, x0:x1]
        write = mask & (patch < 0)
        patch[write] = idx
        union_patch[mask] = 255

    return RegionPartition(
        region_name=str(getattr(jobs[0], "source_region")),
        space_name="source",
        left=left,
        top=top,
        width=width,
        height=height,
        owner=owner,
        union_mask=union_mask,
        feature_keys=feature_keys,
    )


def build_target_region_partition(
    jobs: Sequence[object],
    unwrap_center_x: float,
    atlas_width: int,
) -> RegionPartition:
    if not jobs:
        raise ValueError("jobs must not be empty")

    left_vals: List[float] = []
    right_vals: List[float] = []
    top = min(int(getattr(getattr(job, "target_shape"), "bbox").top) for job in jobs)
    bottom = max(
        int(getattr(getattr(job, "target_shape"), "bbox").top) + int(getattr(getattr(job, "target_shape"), "bbox").height)
        for job in jobs
    )

    unwrapped_lefts: List[float] = []
    for job in jobs:
        bbox = getattr(getattr(job, "target_shape"), "bbox")
        lr = np.array([float(bbox.left), float(bbox.left + bbox.width)], dtype=np.float64)
        lr_u = _unwrap_x(lr, unwrap_center_x=unwrap_center_x, atlas_width=atlas_width)
        left_u = float(lr_u[0])
        right_u = float(lr_u[1])
        if right_u < left_u:
            right_u += float(atlas_width)
        unwrapped_lefts.append(left_u)
        left_vals.append(left_u)
        right_vals.append(right_u)

    region_left = int(math.floor(min(left_vals)))
    region_right = int(math.ceil(max(right_vals)))
    width = max(1, region_right - region_left)
    height = max(1, bottom - top)
    owner = np.full((height, width), -1, dtype=np.int32)
    union_mask = np.zeros((height, width), dtype=np.uint8)
    feature_keys: List[str] = []

    for idx, job in enumerate(jobs):
        feature_keys.append(_job_feature_key(job))
        shape = getattr(job, "target_shape")
        bbox = getattr(shape, "bbox")
        mask = np.asarray(getattr(shape, "mask"), dtype=np.uint8) > 0
        h, w = mask.shape
        x0 = int(math.floor(unwrapped_lefts[idx])) - region_left
        y0 = int(bbox.top) - top
        x1 = x0 + w
        y1 = y0 + h
        if x1 <= 0 or y1 <= 0 or x0 >= width or y0 >= height:
            continue
        rx0 = max(0, x0)
        ry0 = max(0, y0)
        rx1 = min(width, x1)
        ry1 = min(height, y1)
        mx0 = rx0 - x0
        my0 = ry0 - y0
        mx1 = mx0 + (rx1 - rx0)
        my1 = my0 + (ry1 - ry0)
        patch = owner[ry0:ry1, rx0:rx1]
        union_patch = union_mask[ry0:ry1, rx0:rx1]
        mask_patch = mask[my0:my1, mx0:mx1]
        write = mask_patch & (patch < 0)
        patch[write] = idx
        union_patch[mask_patch] = 255

    return RegionPartition(
        region_name=str(getattr(jobs[0], "source_region")),
        space_name="target",
        left=region_left,
        top=top,
        width=width,
        height=height,
        owner=owner,
        union_mask=union_mask,
        feature_keys=feature_keys,
    )


def compute_partition_adjacency(partition: RegionPartition) -> Set[Tuple[int, int]]:
    owner = partition.owner
    pairs: Set[Tuple[int, int]] = set()

    def _accumulate(a: np.ndarray, b: np.ndarray) -> None:
        valid = (a >= 0) & (b >= 0) & (a != b)
        if not np.any(valid):
            return
        av = a[valid].astype(np.int32)
        bv = b[valid].astype(np.int32)
        lo = np.minimum(av, bv)
        hi = np.maximum(av, bv)
        pairs.update((int(x), int(y)) for x, y in zip(lo, hi))

    _accumulate(owner[:, :-1], owner[:, 1:])
    _accumulate(owner[:-1, :], owner[1:, :])
    return pairs


def adjacency_feature_keys(partition: RegionPartition) -> List[Tuple[str, str]]:
    out: List[Tuple[str, str]] = []
    for a, b in sorted(compute_partition_adjacency(partition)):
        out.append((partition.feature_keys[a], partition.feature_keys[b]))
    return out
