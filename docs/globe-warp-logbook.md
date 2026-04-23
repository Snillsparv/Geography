# Globe Warp Logbook

## 2026-04-22

### Goal

Investigate why the globe warp pipeline needs repeated manual fixes and start
replacing it with a stronger partition-preserving solver.

### Baseline findings

- Existing non-Africa globe assets were a mix of older
  `region-global-sheet+labels` outputs and newer `country-inverse` outputs.
- Rebuilding non-Africa with the current per-country inverse path removed the
  obvious cross-country bleed, but it did not solve the deeper structural issue.
- The remaining issue is that the current build still uses one region-wide TPS
  warp as the deformation model, with sparse silhouette-only anchors.

### Commands run

Rebuild non-Africa globe warps with the current per-country path:

```bash
cd /data/workspace/Geography
.venv/bin/python tools/build_globe_global_warps.py \
  --no-previews \
  --region asien \
  --region europa \
  --region nordamerika \
  --region oceanien \
  --region sydamerika \
  --region vastindien
```

### Key observations

- After rebuild, all live regions were on `country-inverse` except one
  `country-rigid-bbox` case.
- Representative bad cases still remained after the rebuild:
  - `KIR`
  - `CUB`
  - `ITA`
  - `USA`
  - `JPN`
  - `IDN`
- This confirmed that the shared-sheet split was only one failure mode, not the
  whole problem.

### Design documents added

- `docs/globe-warp-replacement-design.md`
- `docs/globe-warp-implementation-plan.md`

### Implementation step 1: partition extraction + mesh canary

Files added:

- `tools/globe_partition_model.py`
- `tools/globe_partition_mesh.py`
- `tests/test_globe_partition_mesh.py`

Builder integration:

- added `--partition-canary`
- writes partition/mesh previews into `artifacts/globe_partition_debug*`

Validation command:

```bash
cd /data/workspace/Geography
.venv/bin/python tools/build_globe_global_warps.py \
  --region asien \
  --partition-canary \
  --partition-debug-dir artifacts/globe_partition_debug_canary \
  --no-previews
```

Result:

- `asien` source partition mesh:
  - `46696` vertices
  - `50552` triangles
- `asien` target partition mesh:
  - `37157` vertices
  - `38167` triangles

Commit:

- `68e8194` `Add globe partition extraction and mesh canary`

### Implementation step 2: triangle-owner rasterization with TPS init

Builder integration:

- added `--solver partition-mesh-tps`

This path:

- builds the shared partition mesh
- maps it through the current TPS fit
- rasterizes by triangle ownership
- exports per-country crops without post-hoc owner guessing

Validation command:

```bash
cd /data/workspace/Geography
.venv/bin/python tools/build_globe_global_warps.py \
  --region asien \
  --solver partition-mesh-tps \
  --partition-canary \
  --partition-debug-dir artifacts/globe_partition_debug_canary \
  --partition-raster-dir artifacts/globe_partition_raster_canary \
  --no-previews
```

Result for `asien`:

- mean IoU: `0.7079`
- p10 IoU: `0.5492`

Interpretation:

- partition semantics improved
- lower tail improved versus baseline
- but TPS-only mesh init was not enough to raise total quality consistently

Commit:

- `b55605c` `Add partition mesh TPS rasterization path`

### Implementation step 3: ARAP refinement on the partition mesh

Builder integration:

- added `--solver partition-mesh-arap`
- added coarse solver mesh controls:
  - `--partition-solver-border-step`
  - `--partition-solver-grid-step`
- added ARAP controls:
  - `--partition-arap-iterations`
  - `--partition-arap-init-weight`

This path:

- uses TPS as initialization only
- constrains boundary vertices toward the target partition
- refines free vertices with an iterative ARAP-like update
- rejects flips with triangle signed-area checks and damping

Validation command:

```bash
cd /data/workspace/Geography
.venv/bin/python tools/build_globe_global_warps.py \
  --region asien \
  --solver partition-mesh-arap \
  --partition-canary \
  --partition-debug-dir artifacts/globe_partition_debug_canary \
  --partition-raster-dir artifacts/globe_partition_raster_canary \
  --partition-solver-border-step 54 \
  --partition-solver-grid-step 144 \
  --partition-arap-iterations 10 \
  --no-previews
```

Result for `asien`:

- mean IoU: `0.8420`
- p10 IoU: `0.7118`

Selected countries:

- `KAZ`: `0.951`
- `RUS`: `0.8518`
- `IDN`: `0.7072`
- `TLS`: `0.7123`
- still weak:
  - `JPN`: `0.345`
  - `BRN`: `0.2915`

Interpretation:

- the shared partition mesh + ARAP step is a real improvement over TPS-only
- remaining weak countries are mostly the expected disconnected/tiny/elongated
  cases

Commit:

- `ce78dc2` `Add ARAP refinement for partition mesh solver`

### Implementation step 4: internal guides + island-group handling

Files updated:

- `tools/globe_partition_mesh.py`
- `tests/test_globe_partition_mesh.py`

New behavior:

- component-centroid guides are derived per country
- disconnected countries now get explicit multi-component guide points
- elongated countries get interior axis guide points
- these guides are used both:
  - as extra solver mesh seed points
  - as soft interior targets in the ARAP solve

This is the first explicit handling of:

- archipelagos
- small disconnected countries
- long thin countries

Validation:

```bash
cd /data/workspace/Geography
.venv/bin/python -m unittest tests/test_globe_partition_mesh.py
```

Result:

- `6` tests passed

Additional test coverage added for:

- disconnected-country component guide detection
- elongated-country axis guide detection

### Guide-aware canaries

Commands run:

```bash
cd /data/workspace/Geography
.venv/bin/python tools/build_globe_global_warps.py \
  --region asien \
  --solver partition-mesh-arap \
  --partition-canary \
  --partition-debug-dir artifacts/globe_partition_debug_canary_guides \
  --partition-raster-dir artifacts/globe_partition_raster_canary_guides \
  --partition-solver-border-step 54 \
  --partition-solver-grid-step 144 \
  --partition-arap-iterations 10 \
  --no-previews

.venv/bin/python tools/build_globe_global_warps.py \
  --region europa \
  --solver partition-mesh-arap \
  --partition-canary \
  --partition-debug-dir artifacts/globe_partition_debug_canary_guides \
  --partition-raster-dir artifacts/globe_partition_raster_canary_guides \
  --partition-solver-border-step 54 \
  --partition-solver-grid-step 144 \
  --partition-arap-iterations 10 \
  --no-previews

.venv/bin/python tools/build_globe_global_warps.py \
  --region nordamerika \
  --solver partition-mesh-arap \
  --partition-canary \
  --partition-debug-dir artifacts/globe_partition_debug_canary_guides \
  --partition-raster-dir artifacts/globe_partition_raster_canary_guides \
  --partition-solver-border-step 54 \
  --partition-solver-grid-step 144 \
  --partition-arap-iterations 10 \
  --no-previews
```

Results:

- `asien`: mean IoU `0.8423`, p10 `0.7119`
- `europa`: mean IoU `0.8822`, p10 `0.7580`
- `nordamerika`: mean IoU `0.7971`, p10 `0.6571`

Selected `asien` countries after guide step:

- `KAZ`: `0.9509`
- `RUS`: `0.8518`
- `IDN`: `0.7079`
- `TLS`: `0.7123`
- `BRN`: `0.3119`
- `JPN`: `0.3424`

Interpretation:

- the guide layer is compatible with the shared partition solver
- `europa` looks clearly strong already on this path
- `nordamerika` is workable but still weaker than `europa`
- `asien` stays broadly strong, but `JPN` and `BRN` remain obvious guide-case
  outliers

Next likely work after this step:

- stronger guide placement for multi-island chains like `JPN`
- more explicit island-group guide pairing for small disconnected countries
- compare `partition-mesh-arap` against legacy on a curated country set rather
  than mean IoU alone

### Implementation step 5: stronger chain pairing + tiny-country guide path

Files updated:

- `tools/globe_partition_mesh.py`
- `tests/test_globe_partition_mesh.py`

Changes:

- chain guides now use a more inclusive component set than ordinary component
  guides, so island chains can keep smaller but still structurally important
  components in the guide path
- added fixed-count polyline chain guides sampled along ordered component
  centroids
- added tiny-country micro guides based on canonical interior targets
- chain and micro guide families can now bind against all owner vertices, not
  only strictly interior vertices, when that is necessary
- interior guide pairing is now family-aware instead of one flat list

Validation:

```bash
cd /data/workspace/Geography
.venv/bin/python -m unittest tests/test_globe_partition_mesh.py

.venv/bin/python tools/build_globe_global_warps.py \
  --region asien \
  --solver partition-mesh-arap \
  --partition-canary \
  --partition-debug-dir artifacts/globe_partition_debug_canary_guides_v3 \
  --partition-raster-dir artifacts/globe_partition_raster_canary_guides_v3 \
  --partition-solver-border-step 54 \
  --partition-solver-grid-step 144 \
  --partition-arap-iterations 10 \
  --no-previews
```

Result for `asien`:

- mean IoU: `0.8444`
- p10 IoU: `0.7119`
- selected countries:
  - `JPN`: `0.3448`
  - `BRN`: `0.3121`

Interpretation:

- the stronger chain path moved `JPN` slightly in the right direction
- `BRN` remains effectively flat, so tiny-country behavior is still a separate
  remaining weak spot
- this is enough to keep the guide layer moving forward, but not enough to call
  the outliers solved

### Implementation step 6: controlled region-by-region solver promotion

Files added:

- `tools/globe_solver_promotions.py`
- `assets/globe/solver_promotions.json`
- `tests/test_globe_solver_promotions.py`

Files updated:

- `tools/build_globe_global_warps.py`

New behavior:

- `--solver auto` now resolves per region from the promotion manifest instead of
  forcing one global solver for every region
- explicit `--solver legacy|partition-mesh-tps|partition-mesh-arap` still
  overrides the manifest
- builder reports now record:
  - `solverUsed`
  - promotion status / notes
  - manifest path
- output config/report metadata now reflect mixed-solver builds instead of
  always claiming pure legacy TPS

Initial promotion state:

- `europa`: promoted to `partition-mesh-arap`
- `asien`: stays on `legacy`, candidate is `partition-mesh-arap`
- `nordamerika`: stays on `legacy`, candidate is `partition-mesh-arap`
- remaining regions: still `legacy`

Validation:

```bash
cd /data/workspace/Geography
.venv/bin/python -m unittest \
  tests/test_globe_partition_mesh.py \
  tests/test_globe_solver_promotions.py

.venv/bin/python tools/build_globe_global_warps.py \
  --region europa \
  --solver auto \
  --partition-canary \
  --partition-debug-dir artifacts/globe_partition_debug_canary_auto \
  --partition-raster-dir artifacts/globe_partition_raster_canary_auto \
  --no-previews
```

Result:

- `europa` resolved automatically to `partition-mesh-arap`
- `europa`: mean IoU `0.8822`, p10 `0.7580`

Interpretation:

- the builder now has a real promotion path instead of a manual “remember to
  pass this solver for this region” workflow
- we can promote one region at a time without switching the whole globe build

### Implementation step 7: tiny-country mesh densification + candidate rescue

Files updated:

- `tools/globe_partition_mesh.py`
- `tools/build_globe_global_warps.py`
- `tests/test_globe_partition_mesh.py`
- `tests/test_globe_warp_tiny_selection.py`

New behavior:

- tiny countries now get:
  - tighter local border sampling
  - local interior seed densification inside the shared partition mesh
- partition-solver outputs for tiny countries can now automatically fall back
  to a per-country candidate when that candidate scores better
- this is still automatic strategy selection, not a manual per-country override

Validation:

```bash
cd /data/workspace/Geography
.venv/bin/python -m unittest \
  tests/test_globe_partition_mesh.py \
  tests/test_globe_warp_tiny_selection.py

.venv/bin/python tools/build_globe_global_warps.py \
  --region asien \
  --solver partition-mesh-arap \
  --partition-canary \
  --partition-debug-dir artifacts/globe_partition_debug_canary_tiny_v2 \
  --partition-raster-dir artifacts/globe_partition_raster_canary_tiny_v2 \
  --partition-solver-border-step 54 \
  --partition-solver-grid-step 144 \
  --partition-arap-iterations 10 \
  --no-previews
```

Result for `asien`:

- mean IoU: `0.8524`
- p10 IoU: `0.7377`

Selected countries:

- `JPN`: `0.5584`
  - strategy: `partition-mesh-arap+tiny-fallback-country-inverse`
- `BRN`: `0.3086`
  - strategy: `partition-mesh-arap+tiny-fallback-country-inverse`

Interpretation:

- tiny-country candidate rescue materially improved the lower tail for `asien`
- `JPN` moved from a clear outlier to a workable score because the builder now
  automatically recognizes that per-country inverse rendering is better there
- `BRN` improved only slightly, so the smallest compact-country cases are still
  not fully solved even after the stronger mesh and rescue path

### Implementation step 8: compact tiny-country similarity candidate

Files updated:

- `tools/build_globe_global_warps.py`
- `tests/test_globe_warp_tiny_selection.py`

New behavior:

- tiny rescue can now also evaluate a compact-country candidate:
  - uniform similarity fit
  - preserve source aspect ratio
  - choose the best from a small contain-scale sweep
- this path is only considered for compact tiny countries
- automatic tiny rescue now compares:
  - partition-solver output
  - `country-inverse`
  - `country-compact-tiny-fit`
  - optional rigid bbox candidate if explicitly enabled for the feature

Validation:

```bash
cd /data/workspace/Geography
.venv/bin/python -m unittest \
  tests/test_globe_partition_mesh.py \
  tests/test_globe_warp_tiny_selection.py

.venv/bin/python tools/build_globe_global_warps.py \
  --region asien \
  --solver partition-mesh-arap \
  --partition-canary \
  --partition-debug-dir artifacts/globe_partition_debug_canary_tiny_v3 \
  --partition-raster-dir artifacts/globe_partition_raster_canary_tiny_v3 \
  --partition-solver-border-step 54 \
  --partition-solver-grid-step 144 \
  --partition-arap-iterations 10 \
  --no-previews
```

Result for `asien`:

- mean IoU: `0.8546`
- p10 IoU: `0.7377`

Selected countries:

- `JPN`: `0.5584`
  - strategy: `partition-mesh-arap+tiny-fallback-country-inverse`
- `BRN`: `0.4197`
  - strategy: `partition-mesh-arap+tiny-fallback-country-compact-tiny-fit`

Interpretation:

- this is the first step that materially improved the compact tiny-country
  class, not just the chain/island class
- `BRN` is now no longer stuck near `0.31`; the compact similarity candidate is
  doing real work there
- the remaining weakness is no longer “we have no compact tiny rescue path”, but
  whether this is good enough to promote `asien` or whether a few more tiny
  countries should still be reviewed first

### Implementation step 9: Asia tiny-review and promotion

Files updated:

- `assets/globe/solver_promotions.json`
- `tests/test_globe_solver_promotions.py`

Review procedure:

1. capture current `partition-mesh-arap` tiny-suite values for `asien`
2. rerun `asien` on `legacy`
3. compare the same tiny-country set against the current partition path

Tiny-suite comparison highlights (`partition` minus `legacy` IoU):

- `BRN`: `+0.1111`
- `ADM0:PSX`: `+0.2972`
- `LBN`: `+0.3319`
- `QAT`: `+0.1317`
- `TLS`: `+0.4541`
- `KWT`: `+0.2083`
- `ISR`: `+0.3904`
- `BTN`: `+0.1911`
- `JOR`: `+0.2285`
- `AZE`: `+0.1836`

Neutral tiny cases:

- `MDV`: unchanged at `1.0`
- `SGP`: unchanged at `1.0`
- `BHR`: unchanged at `1.0`
- `TWN`: unchanged at `0.8`

Decision:

- promote `asien` to `partition-mesh-arap`

Reasoning:

- lower tail improved from legacy `0.5264` to partition `0.7377`
- the tiny-suite review shows broad gains rather than one or two cherry-picked
  wins
- `JPN` and `BRN` both now have viable automatic rescue strategies

Post-promotion validation command:

```bash
cd /data/workspace/Geography
.venv/bin/python -m unittest tests/test_globe_solver_promotions.py

.venv/bin/python tools/build_globe_global_warps.py \
  --region asien \
  --solver auto \
  --partition-canary \
  --partition-debug-dir artifacts/globe_partition_debug_canary_auto_asien \
  --partition-raster-dir artifacts/globe_partition_raster_canary_auto_asien \
  --no-previews
```
