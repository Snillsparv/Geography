from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Sequence, Tuple

import cv2
import numpy as np
from PIL import Image, ImageDraw

from globe_partition_model import RegionPartition, adjacency_feature_keys, compute_partition_adjacency


@dataclass
class PartitionMesh:
    vertices: np.ndarray
    triangles: np.ndarray
    triangle_owners: np.ndarray
    border_edges: np.ndarray


@dataclass
class PartitionCropBox:
    left: int
    top: int
    width: int
    height: int


@dataclass
class PartitionRasterization:
    region_left: int
    region_top: int
    region_rgba: np.ndarray
    country_boxes: List[PartitionCropBox]
    target_boxes: List[PartitionCropBox]
    country_rgba: List[np.ndarray]


@dataclass
class BoundaryTargets:
    signature_points: Dict[Tuple[int, ...], np.ndarray]
    owner_points: Dict[int, np.ndarray]
    all_points: np.ndarray


def _sample_closed_polyline(points: np.ndarray, step_px: float) -> List[Tuple[float, float]]:
    pts = np.asarray(points, dtype=np.float64)
    if len(pts) < 2:
        return []
    out: List[Tuple[float, float]] = []
    for i in range(len(pts)):
        p0 = pts[i]
        p1 = pts[(i + 1) % len(pts)]
        seg = p1 - p0
        dist = float(np.linalg.norm(seg))
        steps = max(1, int(math.ceil(dist / max(step_px, 1.0))))
        for j in range(steps):
            t = float(j) / float(steps)
            p = p0 * (1.0 - t) + p1 * t
            out.append((float(p[0]), float(p[1])))
    return out


def _partition_contours(mask_u8: np.ndarray) -> List[np.ndarray]:
    contours, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out: List[np.ndarray] = []
    for c in contours:
        if len(c) < 3:
            continue
        out.append(c[:, 0, :].astype(np.float64))
    return out


def _dedupe_points(points: Iterable[Tuple[float, float]], width: int, height: int) -> np.ndarray:
    seen: Dict[Tuple[int, int], Tuple[float, float]] = {}
    for x, y in points:
        xi = int(round(min(max(x, 0.0), max(0, width - 1))))
        yi = int(round(min(max(y, 0.0), max(0, height - 1))))
        seen[(xi, yi)] = (float(xi), float(yi))
    if not seen:
        return np.zeros((0, 2), dtype=np.float64)
    pts = np.array(list(seen.values()), dtype=np.float64)
    return pts


def _collect_seed_points(
    partition: RegionPartition,
    border_step_px: int,
    grid_step_px: int,
) -> np.ndarray:
    owner = partition.owner
    union = partition.union_mask > 0
    points: List[Tuple[float, float]] = []

    for owner_id in range(partition.country_count):
        mask = (owner == owner_id).astype(np.uint8)
        for contour in _partition_contours(mask):
            points.extend(_sample_closed_polyline(contour, step_px=float(border_step_px)))

    for contour in _partition_contours(partition.union_mask):
        points.extend(_sample_closed_polyline(contour, step_px=float(border_step_px)))

    half = max(1, grid_step_px // 2)
    for y in range(half, partition.height, max(grid_step_px, 1)):
        for x in range(half, partition.width, max(grid_step_px, 1)):
            if union[y, x]:
                points.append((float(x), float(y)))

    for x, y in [
        (0.0, 0.0),
        (float(partition.width - 1), 0.0),
        (float(partition.width - 1), float(partition.height - 1)),
        (0.0, float(partition.height - 1)),
    ]:
        points.append((x, y))

    return _dedupe_points(points, partition.width, partition.height)


def _triangle_sample_points(tri: np.ndarray) -> np.ndarray:
    a, b, c = tri
    return np.array(
        [
            (a + b + c) / 3.0,
            (a + b) / 2.0,
            (b + c) / 2.0,
            (c + a) / 2.0,
            0.8 * a + 0.1 * b + 0.1 * c,
            0.1 * a + 0.8 * b + 0.1 * c,
            0.1 * a + 0.1 * b + 0.8 * c,
        ],
        dtype=np.float64,
    )


def _lookup_owner(partition: RegionPartition, x: float, y: float) -> int:
    xi = int(round(x))
    yi = int(round(y))
    if xi < 0 or yi < 0 or xi >= partition.width or yi >= partition.height:
        return -1
    if partition.union_mask[yi, xi] <= 0:
        return -1
    return int(partition.owner[yi, xi])


def _triangle_owner(partition: RegionPartition, tri: np.ndarray) -> int:
    owners = set()
    for p in _triangle_sample_points(tri):
        owner = _lookup_owner(partition, float(p[0]), float(p[1]))
        if owner < 0:
            return -1
        owners.add(owner)
        if len(owners) > 1:
            return -1
    return next(iter(owners)) if owners else -1


def build_partition_mesh(
    partition: RegionPartition,
    *,
    border_step_px: int = 18,
    grid_step_px: int = 48,
) -> PartitionMesh:
    points = _collect_seed_points(
        partition,
        border_step_px=border_step_px,
        grid_step_px=grid_step_px,
    )
    if len(points) < 3:
        return PartitionMesh(
            vertices=np.zeros((0, 2), dtype=np.float64),
            triangles=np.zeros((0, 3), dtype=np.int32),
            triangle_owners=np.zeros((0,), dtype=np.int32),
            border_edges=np.zeros((0, 2), dtype=np.int32),
        )

    rect = (0, 0, max(1, partition.width), max(1, partition.height))
    subdiv = cv2.Subdiv2D(rect)
    for x, y in points:
        px = min(max(float(x), 0.0), max(0.0, float(partition.width - 1)))
        py = min(max(float(y), 0.0), max(0.0, float(partition.height - 1)))
        subdiv.insert((px, py))

    tri_list = subdiv.getTriangleList()
    vertex_index: Dict[Tuple[int, int], int] = {}
    vertices: List[Tuple[float, float]] = []
    triangles: List[Tuple[int, int, int]] = []
    triangle_owners: List[int] = []

    def intern_vertex(p: Tuple[float, float]) -> int:
        key = (int(round(p[0] * 1000.0)), int(round(p[1] * 1000.0)))
        idx = vertex_index.get(key)
        if idx is not None:
            return idx
        idx = len(vertices)
        vertex_index[key] = idx
        vertices.append((float(p[0]), float(p[1])))
        return idx

    for row in tri_list:
        tri = np.array([[row[0], row[1]], [row[2], row[3]], [row[4], row[5]]], dtype=np.float64)
        if not np.all(np.isfinite(tri)):
            continue
        if np.any(tri[:, 0] < -1e-6) or np.any(tri[:, 1] < -1e-6):
            continue
        if np.any(tri[:, 0] > partition.width - 1 + 1e-6) or np.any(tri[:, 1] > partition.height - 1 + 1e-6):
            continue
        owner = _triangle_owner(partition, tri)
        if owner < 0:
            continue
        area2 = (
            (tri[1, 0] - tri[0, 0]) * (tri[2, 1] - tri[0, 1])
            - (tri[1, 1] - tri[0, 1]) * (tri[2, 0] - tri[0, 0])
        )
        if abs(area2) < 1e-4:
            continue
        ids = [intern_vertex((float(p[0]), float(p[1]))) for p in tri]
        if len({ids[0], ids[1], ids[2]}) < 3:
            continue
        triangles.append((ids[0], ids[1], ids[2]))
        triangle_owners.append(owner)

    if not triangles:
        return PartitionMesh(
            vertices=np.asarray(vertices, dtype=np.float64),
            triangles=np.zeros((0, 3), dtype=np.int32),
            triangle_owners=np.zeros((0,), dtype=np.int32),
            border_edges=np.zeros((0, 2), dtype=np.int32),
        )

    edge_to_triangles: Dict[Tuple[int, int], List[int]] = {}
    for tri_idx, tri in enumerate(triangles):
        for a, b in [(tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])]:
            key = (a, b) if a < b else (b, a)
            edge_to_triangles.setdefault(key, []).append(tri_idx)

    border_edges: List[Tuple[int, int]] = []
    triangle_owner_np = np.asarray(triangle_owners, dtype=np.int32)
    for edge, tri_ids in edge_to_triangles.items():
        if len(tri_ids) == 1:
            border_edges.append(edge)
            continue
        owners = {int(triangle_owner_np[i]) for i in tri_ids}
        if len(owners) > 1:
            border_edges.append(edge)

    return PartitionMesh(
        vertices=np.asarray(vertices, dtype=np.float64),
        triangles=np.asarray(triangles, dtype=np.int32),
        triangle_owners=triangle_owner_np,
        border_edges=np.asarray(border_edges, dtype=np.int32) if border_edges else np.zeros((0, 2), dtype=np.int32),
    )


def _signature_at(partition: RegionPartition, x: float, y: float, radius: int = 1) -> Tuple[int, ...]:
    xi = int(round(x))
    yi = int(round(y))
    owners = set()
    includes_outside = False
    for yy in range(yi - radius, yi + radius + 1):
        for xx in range(xi - radius, xi + radius + 1):
            if xx < 0 or yy < 0 or xx >= partition.width or yy >= partition.height:
                includes_outside = True
                continue
            if partition.union_mask[yy, xx] <= 0:
                includes_outside = True
                continue
            owner = int(partition.owner[yy, xx])
            if owner >= 0:
                owners.add(owner)
    sig = list(sorted(owners))
    if includes_outside:
        sig.append(-1)
    return tuple(sig)


def build_boundary_targets(partition: RegionPartition) -> BoundaryTargets:
    owner = partition.owner
    union = partition.union_mask > 0
    boundary = np.zeros((partition.height, partition.width), dtype=bool)
    boundary[:, :-1] |= ((owner[:, :-1] != owner[:, 1:]) & union[:, :-1] & union[:, 1:])
    boundary[:-1, :] |= ((owner[:-1, :] != owner[1:, :]) & union[:-1, :] & union[1:, :])
    boundary |= union & ~cv2.erode(union.astype(np.uint8), np.ones((3, 3), dtype=np.uint8), iterations=1).astype(bool)

    signature_points: Dict[Tuple[int, ...], List[Tuple[float, float]]] = {}
    owner_points: Dict[int, List[Tuple[float, float]]] = {}
    all_points: List[Tuple[float, float]] = []

    ys, xs = np.where(boundary)
    for x, y in zip(xs.tolist(), ys.tolist()):
        sig = _signature_at(partition, float(x), float(y), radius=1)
        if not sig:
            continue
        pt = (float(x), float(y))
        signature_points.setdefault(sig, []).append(pt)
        all_points.append(pt)
        for owner_id in sig:
            if owner_id >= 0:
                owner_points.setdefault(owner_id, []).append(pt)

    return BoundaryTargets(
        signature_points={k: np.asarray(v, dtype=np.float64) for k, v in signature_points.items()},
        owner_points={k: np.asarray(v, dtype=np.float64) for k, v in owner_points.items()},
        all_points=np.asarray(all_points, dtype=np.float64) if all_points else np.zeros((0, 2), dtype=np.float64),
    )


def _unique_edges(mesh: PartitionMesh) -> np.ndarray:
    if len(mesh.triangles) == 0:
        return np.zeros((0, 2), dtype=np.int32)
    edges = set()
    for tri in mesh.triangles.tolist():
        for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
            edges.add((a, b) if a < b else (b, a))
    return np.asarray(sorted(edges), dtype=np.int32) if edges else np.zeros((0, 2), dtype=np.int32)


def _neighbor_lists(mesh: PartitionMesh) -> List[np.ndarray]:
    n = len(mesh.vertices)
    neighbors: List[set] = [set() for _ in range(n)]
    for a, b in _unique_edges(mesh).tolist():
        neighbors[a].add(b)
        neighbors[b].add(a)
    return [np.asarray(sorted(v), dtype=np.int32) for v in neighbors]


def _border_vertex_mask(mesh: PartitionMesh) -> np.ndarray:
    mask = np.zeros(len(mesh.vertices), dtype=bool)
    for a, b in mesh.border_edges.tolist():
        mask[a] = True
        mask[b] = True
    return mask


def _nearest_point(points: np.ndarray, query: np.ndarray) -> Optional[np.ndarray]:
    if points.size == 0:
        return None
    d2 = np.sum((points - query[None, :]) ** 2, axis=1)
    idx = int(np.argmin(d2))
    return points[idx]


def build_boundary_vertex_constraints(
    *,
    source_partition: RegionPartition,
    target_partition: RegionPartition,
    mesh: PartitionMesh,
    init_vertices_global: np.ndarray,
) -> Tuple[np.ndarray, np.ndarray]:
    border_mask = _border_vertex_mask(mesh)
    target_boundary = build_boundary_targets(target_partition)
    constrained = np.zeros(len(mesh.vertices), dtype=bool)
    targets = np.asarray(init_vertices_global, dtype=np.float64).copy()

    for vidx, is_border in enumerate(border_mask.tolist()):
        if not is_border:
            continue
        src_local = mesh.vertices[vidx]
        sig = _signature_at(source_partition, float(src_local[0]), float(src_local[1]), radius=1)
        if not sig:
            continue
        query = init_vertices_global[vidx]
        candidate = target_boundary.signature_points.get(sig)
        if candidate is None:
            owners = tuple(v for v in sig if v >= 0)
            if owners:
                pooled = []
                for owner_id in owners:
                    arr = target_boundary.owner_points.get(owner_id)
                    if arr is not None and len(arr):
                        pooled.append(arr)
                if pooled:
                    candidate = np.concatenate(pooled, axis=0)
        if candidate is None:
            candidate = target_boundary.all_points
        hit = _nearest_point(candidate, query - np.array([target_partition.left, target_partition.top], dtype=np.float64))
        if hit is None:
            continue
        constrained[vidx] = True
        targets[vidx] = hit + np.array([target_partition.left, target_partition.top], dtype=np.float64)
    return constrained, targets


def _estimate_vertex_rotations(
    rest_vertices: np.ndarray,
    current_vertices: np.ndarray,
    neighbors: List[np.ndarray],
) -> np.ndarray:
    n = len(rest_vertices)
    rotations = np.repeat(np.eye(2, dtype=np.float64)[None, :, :], n, axis=0)
    for i in range(n):
        neigh = neighbors[i]
        if len(neigh) == 0:
            continue
        pi = rest_vertices[i]
        qi = current_vertices[i]
        cov = np.zeros((2, 2), dtype=np.float64)
        for j in neigh.tolist():
            p = rest_vertices[j] - pi
            q = current_vertices[j] - qi
            cov += np.outer(q, p)
        try:
            u, _, vt = np.linalg.svd(cov)
        except np.linalg.LinAlgError:
            continue
        r = u @ vt
        if np.linalg.det(r) < 0:
            u[:, -1] *= -1.0
            r = u @ vt
        rotations[i] = r
    return rotations


def _triangle_signed_areas(vertices: np.ndarray, triangles: np.ndarray) -> np.ndarray:
    if len(triangles) == 0:
        return np.zeros((0,), dtype=np.float64)
    a = vertices[triangles[:, 0]]
    b = vertices[triangles[:, 1]]
    c = vertices[triangles[:, 2]]
    return (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0])


def arap_refine_partition_mesh(
    *,
    source_partition: RegionPartition,
    target_partition: RegionPartition,
    mesh: PartitionMesh,
    init_vertices_global: np.ndarray,
    iterations: int = 12,
    init_weight: float = 0.15,
) -> np.ndarray:
    if len(mesh.vertices) == 0:
        return np.zeros((0, 2), dtype=np.float64)
    rest = mesh.vertices.astype(np.float64)
    current = np.asarray(init_vertices_global, dtype=np.float64).copy()
    current[:, 0] -= float(source_partition.left)
    current[:, 1] -= float(source_partition.top)
    init_local = current.copy()

    constrained, targets_global = build_boundary_vertex_constraints(
        source_partition=source_partition,
        target_partition=target_partition,
        mesh=mesh,
        init_vertices_global=np.asarray(init_vertices_global, dtype=np.float64),
    )
    target_local = targets_global.copy()
    target_local[:, 0] -= float(source_partition.left)
    target_local[:, 1] -= float(source_partition.top)
    current[constrained] = target_local[constrained]

    neighbors = _neighbor_lists(mesh)
    free = ~constrained
    for _ in range(max(1, int(iterations))):
        rotations = _estimate_vertex_rotations(rest, current, neighbors)
        proposal = current.copy()
        for i in np.where(free)[0].tolist():
            neigh = neighbors[i]
            if len(neigh) == 0:
                continue
            accum = np.zeros(2, dtype=np.float64)
            weight_sum = 0.0
            for j in neigh.tolist():
                rest_edge = rest[i] - rest[j]
                arap_term = 0.5 * (rotations[i] + rotations[j]) @ rest_edge
                accum += current[j] + arap_term
                weight_sum += 1.0
            if weight_sum <= 0:
                continue
            proposal[i] = (accum + init_weight * init_local[i]) / (weight_sum + init_weight)
        if np.any(constrained):
            proposal[constrained] = target_local[constrained]

        damp = 1.0
        while damp > 1e-3:
            candidate = current * (1.0 - damp) + proposal * damp
            areas = _triangle_signed_areas(candidate, mesh.triangles)
            if np.all(areas > 1e-6):
                current = candidate
                break
            damp *= 0.5
        else:
            current[free] = 0.5 * (current[free] + init_local[free])

    out = current.copy()
    out[:, 0] += float(source_partition.left)
    out[:, 1] += float(source_partition.top)
    return out


def render_partition_preview(partition: RegionPartition) -> Image.Image:
    img = np.zeros((partition.height, partition.width, 3), dtype=np.uint8)
    for owner_id in range(partition.country_count):
        mask = partition.owner == owner_id
        hue = int((owner_id * 47) % 180)
        bgr = cv2.cvtColor(np.uint8([[[hue, 170, 220]]]), cv2.COLOR_HSV2BGR)[0, 0]
        img[mask] = bgr

    boundary = np.zeros((partition.height, partition.width), dtype=np.uint8)
    owner = partition.owner
    boundary[:, :-1] |= ((owner[:, :-1] != owner[:, 1:]) & (owner[:, :-1] >= 0) & (owner[:, 1:] >= 0)).astype(np.uint8) * 255
    boundary[:-1, :] |= ((owner[:-1, :] != owner[1:, :]) & (owner[:-1, :] >= 0) & (owner[1:, :] >= 0)).astype(np.uint8) * 255
    boundary |= cv2.Canny(partition.union_mask, 20, 60)
    img[boundary > 0] = np.array([255, 255, 255], dtype=np.uint8)
    return Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB), mode="RGB")


def render_mesh_preview(partition: RegionPartition, mesh: PartitionMesh) -> Image.Image:
    base = np.array(render_partition_preview(partition), dtype=np.uint8)
    draw = ImageDraw.Draw(Image.fromarray(base))
    for tri in mesh.triangles:
        pts = [(float(mesh.vertices[i, 0]), float(mesh.vertices[i, 1])) for i in tri]
        draw.line([pts[0], pts[1], pts[2], pts[0]], fill=(0, 0, 0), width=1)
    for edge in mesh.border_edges:
        a = (float(mesh.vertices[int(edge[0]), 0]), float(mesh.vertices[int(edge[0]), 1]))
        b = (float(mesh.vertices[int(edge[1]), 0]), float(mesh.vertices[int(edge[1]), 1]))
        draw.line([a, b], fill=(255, 0, 0), width=2)
    return draw._image


def mesh_summary(partition: RegionPartition, mesh: PartitionMesh) -> Dict[str, object]:
    return {
        "region": partition.region_name,
        "space": partition.space_name,
        "width": partition.width,
        "height": partition.height,
        "countries": partition.country_count,
        "adjacencyPairs": adjacency_feature_keys(partition),
        "vertexCount": int(len(mesh.vertices)),
        "triangleCount": int(len(mesh.triangles)),
        "borderEdgeCount": int(len(mesh.border_edges)),
    }


def map_partition_mesh_vertices(
    partition: RegionPartition,
    mesh: PartitionMesh,
    forward_map: Callable[[np.ndarray], np.ndarray],
) -> np.ndarray:
    if len(mesh.vertices) == 0:
        return np.zeros((0, 2), dtype=np.float64)
    src_global = mesh.vertices.astype(np.float64).copy()
    src_global[:, 0] += float(partition.left)
    src_global[:, 1] += float(partition.top)
    return np.asarray(forward_map(src_global), dtype=np.float64)


def _alpha_blit(dst: np.ndarray, src: np.ndarray, x: int, y: int) -> None:
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


def _crop_box_union(box: PartitionCropBox, left: int, top: int, right: int, bottom: int) -> PartitionCropBox:
    x0 = min(box.left, left)
    y0 = min(box.top, top)
    x1 = max(box.left + box.width, right)
    y1 = max(box.top + box.height, bottom)
    return PartitionCropBox(left=int(x0), top=int(y0), width=max(1, int(x1 - x0)), height=max(1, int(y1 - y0)))


def _boxes_from_triangles(
    triangle_owners: np.ndarray,
    triangles: np.ndarray,
    target_vertices_local: np.ndarray,
    job_target_boxes_local: List[PartitionCropBox],
    pad: int = 2,
) -> List[PartitionCropBox]:
    boxes: List[PartitionCropBox] = [PartitionCropBox(b.left, b.top, b.width, b.height) for b in job_target_boxes_local]
    for tri, owner_id in zip(triangles, triangle_owners):
        pts = target_vertices_local[tri]
        left = int(math.floor(np.min(pts[:, 0]))) - pad
        top = int(math.floor(np.min(pts[:, 1]))) - pad
        right = int(math.ceil(np.max(pts[:, 0]))) + pad + 1
        bottom = int(math.ceil(np.max(pts[:, 1]))) + pad + 1
        boxes[int(owner_id)] = _crop_box_union(boxes[int(owner_id)], left, top, right, bottom)
    return boxes


def rasterize_partition_mesh(
    *,
    source_partition: RegionPartition,
    source_mesh: PartitionMesh,
    target_vertices_global: np.ndarray,
    source_sheet_rgba: np.ndarray,
    jobs: Sequence[object],
    unwrap_x: Callable[[np.ndarray], np.ndarray],
) -> PartitionRasterization:
    if len(source_mesh.vertices) == 0 or len(source_mesh.triangles) == 0:
        raise ValueError("source mesh is empty")

    target_vertices = np.asarray(target_vertices_global, dtype=np.float64).copy()
    if len(target_vertices) != len(source_mesh.vertices):
        raise ValueError("target_vertices must match source mesh vertex count")
    target_vertices[:, 0] = unwrap_x(target_vertices[:, 0])

    job_boxes_u: List[PartitionCropBox] = []
    for job in jobs:
        bbox = getattr(getattr(job, "target_shape"), "bbox")
        lr = np.array([float(bbox.left), float(bbox.left + bbox.width)], dtype=np.float64)
        lr_u = unwrap_x(lr)
        left_u = float(lr_u[0])
        right_u = float(lr_u[1])
        if right_u < left_u:
            right_u = left_u + float(bbox.width)
        job_boxes_u.append(
            PartitionCropBox(
                left=int(math.floor(left_u)),
                top=int(bbox.top),
                width=int(bbox.width),
                height=int(bbox.height),
            )
        )

    min_x = min([float(np.min(target_vertices[:, 0]))] + [float(b.left) for b in job_boxes_u])
    max_x = max([float(np.max(target_vertices[:, 0]))] + [float(b.left + b.width) for b in job_boxes_u])
    min_y = min([float(np.min(target_vertices[:, 1]))] + [float(b.top) for b in job_boxes_u])
    max_y = max([float(np.max(target_vertices[:, 1]))] + [float(b.top + b.height) for b in job_boxes_u])

    region_left = int(math.floor(min_x)) - 2
    region_top = int(math.floor(min_y)) - 2
    region_right = int(math.ceil(max_x)) + 2
    region_bottom = int(math.ceil(max_y)) + 2
    region_w = max(1, region_right - region_left)
    region_h = max(1, region_bottom - region_top)

    target_vertices_local = target_vertices.copy()
    target_vertices_local[:, 0] -= float(region_left)
    target_vertices_local[:, 1] -= float(region_top)

    job_target_boxes_local = [
        PartitionCropBox(
            left=b.left - region_left,
            top=b.top - region_top,
            width=b.width,
            height=b.height,
        )
        for b in job_boxes_u
    ]
    country_boxes = _boxes_from_triangles(
        source_mesh.triangle_owners,
        source_mesh.triangles,
        target_vertices_local,
        job_target_boxes_local,
        pad=2,
    )
    country_rgba = [np.zeros((box.height, box.width, 4), dtype=np.uint8) for box in country_boxes]
    region_rgba = np.zeros((region_h, region_w, 4), dtype=np.uint8)

    source_vertices = source_mesh.vertices.astype(np.float64)
    for tri, owner_id in zip(source_mesh.triangles, source_mesh.triangle_owners):
        src_tri = source_vertices[tri]
        dst_tri = target_vertices_local[tri]
        src_x0 = int(math.floor(np.min(src_tri[:, 0])))
        src_y0 = int(math.floor(np.min(src_tri[:, 1])))
        src_x1 = int(math.ceil(np.max(src_tri[:, 0]))) + 1
        src_y1 = int(math.ceil(np.max(src_tri[:, 1]))) + 1
        dst_x0 = int(math.floor(np.min(dst_tri[:, 0])))
        dst_y0 = int(math.floor(np.min(dst_tri[:, 1])))
        dst_x1 = int(math.ceil(np.max(dst_tri[:, 0]))) + 1
        dst_y1 = int(math.ceil(np.max(dst_tri[:, 1]))) + 1
        if src_x1 <= src_x0 or src_y1 <= src_y0 or dst_x1 <= dst_x0 or dst_y1 <= dst_y0:
            continue
        src_patch = source_sheet_rgba[src_y0:src_y1, src_x0:src_x1]
        if src_patch.size == 0:
            continue

        src_tri_local = (src_tri - np.array([src_x0, src_y0], dtype=np.float64)).astype(np.float32)
        dst_tri_local = (dst_tri - np.array([dst_x0, dst_y0], dtype=np.float64)).astype(np.float32)
        affine = cv2.getAffineTransform(src_tri_local, dst_tri_local)
        dst_w = max(1, dst_x1 - dst_x0)
        dst_h = max(1, dst_y1 - dst_y0)
        warped_patch = cv2.warpAffine(
            src_patch,
            affine,
            (dst_w, dst_h),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=(0, 0, 0, 0),
        )
        mask = np.zeros((dst_h, dst_w), dtype=np.uint8)
        cv2.fillConvexPoly(mask, np.round(dst_tri_local).astype(np.int32), 255, lineType=cv2.LINE_8)
        warped_patch[mask <= 0] = 0
        warped_patch[:, :, 3] = ((warped_patch[:, :, 3].astype(np.uint16) * mask.astype(np.uint16)) // 255).astype(np.uint8)
        warped_patch[warped_patch[:, :, 3] == 0, :3] = 0

        _alpha_blit(region_rgba, warped_patch, dst_x0, dst_y0)
        box = country_boxes[int(owner_id)]
        _alpha_blit(country_rgba[int(owner_id)], warped_patch, dst_x0 - box.left, dst_y0 - box.top)

    return PartitionRasterization(
        region_left=region_left,
        region_top=region_top,
        region_rgba=region_rgba,
        country_boxes=country_boxes,
        target_boxes=job_target_boxes_local,
        country_rgba=country_rgba,
    )


def write_partition_canary_artifacts(
    output_dir: Path,
    *,
    source_partition: RegionPartition,
    target_partition: RegionPartition,
    source_mesh: PartitionMesh,
    target_mesh: PartitionMesh,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    region = source_partition.region_name
    render_partition_preview(source_partition).save(output_dir / f"{region}-source-partition.png")
    render_partition_preview(target_partition).save(output_dir / f"{region}-target-partition.png")
    render_mesh_preview(source_partition, source_mesh).save(output_dir / f"{region}-source-mesh.png")
    render_mesh_preview(target_partition, target_mesh).save(output_dir / f"{region}-target-mesh.png")

    data = {
        "region": region,
        "source": mesh_summary(source_partition, source_mesh),
        "target": mesh_summary(target_partition, target_mesh),
    }
    (output_dir / f"{region}-partition-summary.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def write_partition_rasterization_artifacts(
    output_dir: Path,
    *,
    region: str,
    rasterization: PartitionRasterization,
    feature_keys: Sequence[str],
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rasterization.region_rgba, mode="RGBA").save(output_dir / f"{region}-partition-raster-region.png")
    summary = {
        "region": region,
        "regionLeft": rasterization.region_left,
        "regionTop": rasterization.region_top,
        "countries": [],
    }
    for feature_key, box, rgba in zip(feature_keys, rasterization.country_boxes, rasterization.country_rgba):
        Image.fromarray(rgba, mode="RGBA").save(output_dir / f"{feature_key}.png")
        summary["countries"].append(
            {
                "featureKey": feature_key,
                "left": box.left + rasterization.region_left,
                "top": box.top + rasterization.region_top,
                "width": box.width,
                "height": box.height,
                "targetLeft": rasterization.target_boxes[len(summary["countries"])].left + rasterization.region_left,
                "targetTop": rasterization.target_boxes[len(summary["countries"])].top + rasterization.region_top,
                "targetWidth": rasterization.target_boxes[len(summary["countries"])].width,
                "targetHeight": rasterization.target_boxes[len(summary["countries"])].height,
            }
        )
    (output_dir / f"{region}-partition-raster-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
