import sys
import unittest
from pathlib import Path

import numpy as np

TOOLS_DIR = Path(__file__).resolve().parents[1] / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from globe_partition_mesh import (
    arap_refine_partition_mesh,
    build_boundary_targets,
    build_country_guides,
    build_partition_mesh,
)
from globe_partition_mesh import (
    _border_vertex_mask,
    _vertex_owner_lists,
    map_partition_mesh_vertices,
    rasterize_partition_mesh,
)
from globe_partition_model import (
    RegionPartition,
    build_source_region_partition,
    compute_partition_adjacency,
)


class DummyBBox:
    def __init__(self, left: int, top: int, width: int, height: int):
        self.left = left
        self.top = top
        self.width = width
        self.height = height


class DummyTargetShape:
    def __init__(self):
        self.mask = np.zeros((1, 1), dtype=np.uint8)
        self.bbox = DummyBBox(0, 0, 1, 1)


class DummyJob:
    def __init__(self, feature_key: str, rgba: np.ndarray, source_left: int, source_top: int):
        self.country = {"featureKey": feature_key}
        self.source_region = "dummy"
        self.source_rgba = rgba
        self.render_rgba = rgba
        self.source_left = source_left
        self.source_top = source_top
        self.target_shape = DummyTargetShape()
        self.target_area = int(np.sum(rgba[:, :, 3] > 0))


class GlobePartitionMeshTests(unittest.TestCase):
    def test_build_country_guides_detects_disconnected_components(self) -> None:
        owner = np.full((30, 30), -1, dtype=np.int32)
        owner[2:10, 2:10] = 0
        owner[18:26, 18:26] = 0
        union = np.where(owner >= 0, 255, 0).astype(np.uint8)
        partition = RegionPartition(
            region_name="dummy",
            space_name="source",
            left=0,
            top=0,
            width=30,
            height=30,
            owner=owner,
            union_mask=union,
            feature_keys=["A"],
        )
        guides = build_country_guides(partition)
        self.assertIn(0, guides)
        self.assertGreaterEqual(len(guides[0].component_guides), 2)

    def test_build_source_partition_tracks_adjacency(self) -> None:
        rgba_a = np.zeros((20, 20, 4), dtype=np.uint8)
        rgba_b = np.zeros((20, 20, 4), dtype=np.uint8)
        rgba_a[:, :, 3] = 255
        rgba_b[:, :, 3] = 255
        jobs = [
            DummyJob("A", rgba_a, 0, 0),
            DummyJob("B", rgba_b, 20, 0),
        ]
        partition = build_source_region_partition(jobs, alpha_threshold=8)
        self.assertEqual(partition.width, 40)
        self.assertEqual(partition.height, 20)
        self.assertEqual(partition.country_count, 2)
        self.assertEqual(compute_partition_adjacency(partition), {(0, 1)})

    def test_build_partition_mesh_keeps_triangles_inside_single_owner(self) -> None:
        owner = np.full((40, 80), -1, dtype=np.int32)
        owner[:, :40] = 0
        owner[:, 40:] = 1
        union = np.where(owner >= 0, 255, 0).astype(np.uint8)
        partition = RegionPartition(
            region_name="dummy",
            space_name="source",
            left=0,
            top=0,
            width=80,
            height=40,
            owner=owner,
            union_mask=union,
            feature_keys=["A", "B"],
        )
        mesh = build_partition_mesh(partition, border_step_px=8, grid_step_px=16)
        self.assertGreater(len(mesh.vertices), 0)
        self.assertGreater(len(mesh.triangles), 0)
        self.assertEqual(len(mesh.triangles), len(mesh.triangle_owners))
        for tri, owner_id in zip(mesh.triangles, mesh.triangle_owners):
            pts = mesh.vertices[tri]
            centroid = np.mean(pts, axis=0)
            x = int(round(float(centroid[0])))
            y = int(round(float(centroid[1])))
            self.assertEqual(int(partition.owner[y, x]), int(owner_id))

    def test_partition_rasterization_returns_country_crops(self) -> None:
        owner = np.full((20, 40), -1, dtype=np.int32)
        owner[:, :20] = 0
        owner[:, 20:] = 1
        union = np.where(owner >= 0, 255, 0).astype(np.uint8)
        partition = RegionPartition(
            region_name="dummy",
            space_name="source",
            left=0,
            top=0,
            width=40,
            height=20,
            owner=owner,
            union_mask=union,
            feature_keys=["A", "B"],
        )
        mesh = build_partition_mesh(partition, border_step_px=6, grid_step_px=10)
        source_sheet = np.zeros((20, 40, 4), dtype=np.uint8)
        source_sheet[:, :20, 0] = 255
        source_sheet[:, 20:, 2] = 255
        source_sheet[:, :, 3] = 255

        class DummyBBox2:
            def __init__(self, left, top, width, height):
                self.left = left
                self.top = top
                self.width = width
                self.height = height

        class DummyShape2:
            def __init__(self, left, top, width, height):
                self.bbox = DummyBBox2(left, top, width, height)
                self.mask = np.ones((height, width), dtype=np.uint8) * 255

        class DummyJob2:
            def __init__(self, feature_key, left, top, width, height):
                self.country = {"featureKey": feature_key}
                self.target_shape = DummyShape2(left, top, width, height)

        jobs = [
            DummyJob2("A", 0, 0, 20, 20),
            DummyJob2("B", 20, 0, 20, 20),
        ]
        target_vertices = map_partition_mesh_vertices(
            partition,
            mesh,
            forward_map=lambda pts: pts,
        )
        raster = rasterize_partition_mesh(
            source_partition=partition,
            source_mesh=mesh,
            target_vertices_global=target_vertices,
            source_sheet_rgba=source_sheet,
            jobs=jobs,
            unwrap_x=lambda xs: xs,
        )
        self.assertEqual(len(raster.country_rgba), 2)
        self.assertGreater(int(np.sum(raster.country_rgba[0][:, :, 3] > 0)), 0)
        self.assertGreater(int(np.sum(raster.country_rgba[1][:, :, 3] > 0)), 0)
        self.assertGreater(
            float(np.mean(raster.country_rgba[0][:, :, 0])),
            float(np.mean(raster.country_rgba[0][:, :, 2])),
        )
        self.assertGreater(
            float(np.mean(raster.country_rgba[1][:, :, 2])),
            float(np.mean(raster.country_rgba[1][:, :, 0])),
        )

    def test_arap_refinement_reduces_boundary_error_on_identity_target(self) -> None:
        owner = np.full((20, 40), -1, dtype=np.int32)
        owner[:, :20] = 0
        owner[:, 20:] = 1
        union = np.where(owner >= 0, 255, 0).astype(np.uint8)
        partition = RegionPartition(
            region_name="dummy",
            space_name="source",
            left=0,
            top=0,
            width=40,
            height=20,
            owner=owner,
            union_mask=union,
            feature_keys=["A", "B"],
        )
        mesh = build_partition_mesh(partition, border_step_px=6, grid_step_px=12)
        init = mesh.vertices.copy()
        init[:, 0] += 4.0 * (mesh.vertices[:, 1] / max(1.0, np.max(mesh.vertices[:, 1])))
        refined = arap_refine_partition_mesh(
            source_partition=partition,
            target_partition=partition,
            mesh=mesh,
            init_vertices_global=init,
            iterations=8,
            init_weight=0.1,
        )
        boundary_targets = build_boundary_targets(partition)
        border_vertices = set()
        for a, b in mesh.border_edges.tolist():
            border_vertices.add(int(a))
            border_vertices.add(int(b))
        border_vertices = sorted(border_vertices)
        boundary_points = boundary_targets.all_points
        def mean_boundary_dist(points: np.ndarray) -> float:
            vals = []
            for p in points:
                d2 = np.sum((boundary_points - p[None, :]) ** 2, axis=1)
                vals.append(float(np.sqrt(np.min(d2))))
            return float(np.mean(vals))
        init_err = mean_boundary_dist(init[border_vertices])
        refined_err = mean_boundary_dist(refined[border_vertices])
        self.assertLess(refined_err, init_err)

    def test_build_country_guides_detects_axis_guides_for_long_country(self) -> None:
        owner = np.full((20, 80), -1, dtype=np.int32)
        owner[7:13, 5:75] = 0
        union = np.where(owner >= 0, 255, 0).astype(np.uint8)
        partition = RegionPartition(
            region_name="dummy",
            space_name="source",
            left=0,
            top=0,
            width=80,
            height=20,
            owner=owner,
            union_mask=union,
            feature_keys=["LONG"],
        )
        guides = build_country_guides(partition)
        self.assertIn(0, guides)
        self.assertGreaterEqual(len(guides[0].axis_guides), 3)

    def test_build_country_guides_adds_chain_guides_for_island_chain(self) -> None:
        owner = np.full((60, 120), -1, dtype=np.int32)
        owner[10:20, 10:20] = 0
        owner[24:34, 38:50] = 0
        owner[38:48, 74:88] = 0
        union = np.where(owner >= 0, 255, 0).astype(np.uint8)
        partition = RegionPartition(
            region_name="dummy",
            space_name="source",
            left=0,
            top=0,
            width=120,
            height=60,
            owner=owner,
            union_mask=union,
            feature_keys=["CHAIN"],
        )
        guides = build_country_guides(partition)
        self.assertIn(0, guides)
        self.assertGreaterEqual(len(guides[0].chain_guides), 4)

    def test_build_country_guides_adds_micro_guides_for_tiny_country(self) -> None:
        owner = np.full((24, 24), -1, dtype=np.int32)
        owner[8:14, 9:16] = 0
        union = np.where(owner >= 0, 255, 0).astype(np.uint8)
        partition = RegionPartition(
            region_name="dummy",
            space_name="source",
            left=0,
            top=0,
            width=24,
            height=24,
            owner=owner,
            union_mask=union,
            feature_keys=["TINY"],
        )
        guides = build_country_guides(partition)
        self.assertIn(0, guides)
        self.assertGreaterEqual(len(guides[0].micro_guides), 3)

    def test_tiny_country_mesh_is_locally_densified(self) -> None:
        owner = np.full((120, 120), -1, dtype=np.int32)
        owner[10:100, 10:100] = 0
        owner[48:56, 92:101] = 1
        union = np.where(owner >= 0, 255, 0).astype(np.uint8)
        partition = RegionPartition(
            region_name="dummy",
            space_name="source",
            left=0,
            top=0,
            width=120,
            height=120,
            owner=owner,
            union_mask=union,
            feature_keys=["BIG", "TINY"],
        )
        mesh = build_partition_mesh(partition, border_step_px=54, grid_step_px=144)
        vertex_owners = _vertex_owner_lists(mesh)
        border = _border_vertex_mask(mesh)
        tiny_owner = 1
        tiny_all = [vidx for vidx, owners in enumerate(vertex_owners) if tiny_owner in owners.tolist()]
        tiny_interior = [
            vidx
            for vidx, owners in enumerate(vertex_owners)
            if (not border[vidx]) and len(owners) == 1 and int(owners[0]) == tiny_owner
        ]
        tiny_tris = int(np.sum(mesh.triangle_owners == tiny_owner))
        self.assertGreaterEqual(len(tiny_all), 18)
        self.assertGreaterEqual(len(tiny_interior), 4)
        self.assertGreaterEqual(tiny_tris, 18)


if __name__ == "__main__":
    unittest.main()
