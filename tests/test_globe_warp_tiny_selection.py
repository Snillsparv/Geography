import sys
import unittest
from pathlib import Path

import numpy as np

TOOLS_DIR = Path(__file__).resolve().parents[1] / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from build_globe_global_warps import render_country_with_compact_tiny_fit, should_prefer_tiny_candidate


class DummyBBox:
    def __init__(self, left: int, top: int, width: int, height: int):
        self.left = left
        self.top = top
        self.width = width
        self.height = height


class DummyShape:
    def __init__(self, mask: np.ndarray):
        self.mask = mask
        self.bbox = DummyBBox(0, 0, mask.shape[1], mask.shape[0])


class DummyJob:
    def __init__(self, src_rgba: np.ndarray, mask: np.ndarray):
        self.render_rgba = src_rgba
        self.target_shape = DummyShape(mask)
        self.target_area = int(np.sum(mask > 0))
        self.source_region = "dummy"
        self.country = {"featureKey": "TINY"}


class GlobeWarpTinySelectionTests(unittest.TestCase):
    def test_prefers_candidate_when_score_gain_is_clear(self) -> None:
        self.assertTrue(
            should_prefer_tiny_candidate(
                base_iou=0.30,
                base_score=0.34,
                candidate_iou=0.322,
                candidate_score=0.352,
                target_area=220,
            )
        )

    def test_rejects_candidate_without_real_gain(self) -> None:
        self.assertFalse(
            should_prefer_tiny_candidate(
                base_iou=0.30,
                base_score=0.34,
                candidate_iou=0.3002,
                candidate_score=0.3403,
                target_area=220,
            )
        )

    def test_compact_tiny_fit_returns_nonempty_canvas(self) -> None:
        src = np.zeros((30, 40, 4), dtype=np.uint8)
        src[2:28, 5:35, :3] = 255
        src[2:28, 5:35, 3] = 255
        mask = np.zeros((18, 20), dtype=np.uint8)
        mask[2:16, 2:18] = 255
        job = DummyJob(src, mask)
        out = render_country_with_compact_tiny_fit(job)
        self.assertEqual(out.shape, (18, 20, 4))
        self.assertGreater(int(np.sum(out[:, :, 3] > 0)), 0)


if __name__ == "__main__":
    unittest.main()
