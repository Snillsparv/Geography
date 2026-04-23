import sys
import unittest
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parents[1] / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from globe_solver_promotions import load_solver_promotions, resolve_region_solver


class GlobeSolverPromotionsTests(unittest.TestCase):
    def test_missing_manifest_defaults_to_legacy(self) -> None:
        manifest = load_solver_promotions(Path("/tmp/does-not-exist-solver-promotions.json"))
        solver, promotion = resolve_region_solver(
            requested_solver="auto",
            region="europa",
            manifest=manifest,
        )
        self.assertEqual(solver, "legacy")
        self.assertEqual(promotion.status, "baseline")

    def test_auto_resolves_from_manifest(self) -> None:
        manifest = load_solver_promotions(Path(__file__).resolve().parents[1] / "assets" / "globe" / "solver_promotions.json")
        solver, promotion = resolve_region_solver(
            requested_solver="auto",
            region="europa",
            manifest=manifest,
        )
        self.assertEqual(solver, "partition-mesh-arap")
        self.assertEqual(promotion.status, "promoted")

    def test_auto_resolves_asien_from_manifest(self) -> None:
        manifest = load_solver_promotions(Path(__file__).resolve().parents[1] / "assets" / "globe" / "solver_promotions.json")
        solver, promotion = resolve_region_solver(
            requested_solver="auto",
            region="asien",
            manifest=manifest,
        )
        self.assertEqual(solver, "partition-mesh-arap")
        self.assertEqual(promotion.status, "promoted")

    def test_auto_resolves_afrika_from_manifest(self) -> None:
        manifest = load_solver_promotions(Path(__file__).resolve().parents[1] / "assets" / "globe" / "solver_promotions.json")
        solver, promotion = resolve_region_solver(
            requested_solver="auto",
            region="afrika",
            manifest=manifest,
        )
        self.assertEqual(solver, "partition-mesh-arap")
        self.assertEqual(promotion.status, "promoted")

    def test_auto_resolves_nordamerika_from_manifest(self) -> None:
        manifest = load_solver_promotions(Path(__file__).resolve().parents[1] / "assets" / "globe" / "solver_promotions.json")
        solver, promotion = resolve_region_solver(
            requested_solver="auto",
            region="nordamerika",
            manifest=manifest,
        )
        self.assertEqual(solver, "partition-mesh-arap")
        self.assertEqual(promotion.status, "promoted")

    def test_auto_resolves_oceanien_from_manifest(self) -> None:
        manifest = load_solver_promotions(Path(__file__).resolve().parents[1] / "assets" / "globe" / "solver_promotions.json")
        solver, promotion = resolve_region_solver(
            requested_solver="auto",
            region="oceanien",
            manifest=manifest,
        )
        self.assertEqual(solver, "partition-mesh-arap")
        self.assertEqual(promotion.status, "promoted")

    def test_auto_resolves_vastindien_from_manifest(self) -> None:
        manifest = load_solver_promotions(Path(__file__).resolve().parents[1] / "assets" / "globe" / "solver_promotions.json")
        solver, promotion = resolve_region_solver(
            requested_solver="auto",
            region="vastindien",
            manifest=manifest,
        )
        self.assertEqual(solver, "partition-mesh-arap")
        self.assertEqual(promotion.status, "promoted")

    def test_auto_resolves_sydamerika_from_manifest(self) -> None:
        manifest = load_solver_promotions(Path(__file__).resolve().parents[1] / "assets" / "globe" / "solver_promotions.json")
        solver, promotion = resolve_region_solver(
            requested_solver="auto",
            region="sydamerika",
            manifest=manifest,
        )
        self.assertEqual(solver, "partition-mesh-arap")
        self.assertEqual(promotion.status, "promoted")

    def test_explicit_solver_overrides_manifest(self) -> None:
        manifest = load_solver_promotions(Path(__file__).resolve().parents[1] / "assets" / "globe" / "solver_promotions.json")
        solver, promotion = resolve_region_solver(
            requested_solver="legacy",
            region="europa",
            manifest=manifest,
        )
        self.assertEqual(solver, "legacy")
        self.assertEqual(promotion.status, "promoted")


if __name__ == "__main__":
    unittest.main()
