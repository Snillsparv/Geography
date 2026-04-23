from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Mapping, Tuple


VALID_SOLVERS = {"legacy", "partition-mesh-tps", "partition-mesh-arap"}


@dataclass(frozen=True)
class RegionSolverPromotion:
    solver: str
    status: str
    params: Dict[str, object]
    notes: str
    candidate_solver: str | None = None


def load_solver_promotions(path: Path) -> Dict[str, object]:
    if not path.exists():
        return {"version": 1, "defaultSolver": "legacy", "regions": {}}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"Invalid solver promotion manifest: {path}")
    default_solver = str(data.get("defaultSolver", "legacy"))
    if default_solver not in VALID_SOLVERS:
        raise ValueError(f"Invalid defaultSolver in {path}: {default_solver}")
    regions = data.get("regions", {})
    if not isinstance(regions, dict):
        raise ValueError(f"Invalid regions object in {path}")
    return data


def _normalize_region(region: str) -> str:
    return region.strip().lower()


def _region_entry(manifest: Mapping[str, object], region: str) -> RegionSolverPromotion:
    regions = manifest.get("regions", {})
    if not isinstance(regions, Mapping):
        regions = {}
    entry = regions.get(_normalize_region(region), {})
    if not isinstance(entry, Mapping):
        entry = {}
    solver = str(entry.get("solver", manifest.get("defaultSolver", "legacy")))
    if solver not in VALID_SOLVERS:
        raise ValueError(f"Invalid solver for region {region}: {solver}")
    params = entry.get("params", {})
    if not isinstance(params, Mapping):
        params = {}
    candidate_solver = entry.get("candidateSolver")
    if candidate_solver is not None:
        candidate_solver = str(candidate_solver)
        if candidate_solver not in VALID_SOLVERS:
            raise ValueError(f"Invalid candidateSolver for region {region}: {candidate_solver}")
    return RegionSolverPromotion(
        solver=solver,
        status=str(entry.get("status", "baseline")),
        params=dict(params),
        notes=str(entry.get("notes", "")),
        candidate_solver=candidate_solver,
    )


def resolve_region_solver(
    *,
    requested_solver: str,
    region: str,
    manifest: Mapping[str, object],
) -> Tuple[str, RegionSolverPromotion]:
    if requested_solver != "auto":
        if requested_solver not in VALID_SOLVERS:
            raise ValueError(f"Invalid requested solver: {requested_solver}")
        promotion = _region_entry(manifest, region)
        return requested_solver, RegionSolverPromotion(
            solver=requested_solver,
            status=promotion.status,
            params=promotion.params,
            notes=promotion.notes,
            candidate_solver=promotion.candidate_solver,
        )
    promotion = _region_entry(manifest, region)
    return promotion.solver, promotion
