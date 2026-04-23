import sys
import unittest
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parents[1] / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from build_globe_global_warps import should_prefer_tiny_candidate


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


if __name__ == "__main__":
    unittest.main()
