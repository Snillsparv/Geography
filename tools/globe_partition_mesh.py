from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple

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
