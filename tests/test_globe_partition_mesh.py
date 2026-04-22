import sys
import unittest
from pathlib import Path

import numpy as np

TOOLS_DIR = Path(__file__).resolve().parents[1] / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from globe_partition_mesh import build_partition_mesh
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


if __name__ == "__main__":
    unittest.main()
