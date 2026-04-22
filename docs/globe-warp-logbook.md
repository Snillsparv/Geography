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
