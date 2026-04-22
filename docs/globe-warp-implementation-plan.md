# Globe Warp Implementation Plan

This document turns the replacement design in
[`docs/globe-warp-replacement-design.md`](./globe-warp-replacement-design.md)
into a concrete implementation plan against the current code in
`tools/build_globe_global_warps.py`.

## Scope

We want to replace the current globe fitting pipeline without breaking the
existing asset contract consumed by the frontend:

- `assets/globe/config.json`
- `assets/globe/warped/<feature_key>.webp`
- `warpLeft`, `warpTop`, `warpWidth`, `warpHeight`
- existing globe renderer in `game.js`

So the frontend should remain unchanged at first.
The replacement happens in the build pipeline.

## What we can keep from the current builder

The current file already contains useful pieces we should preserve:

### Keep as-is or nearly as-is

- geometry projection helpers
  - `project_ring_wrapped(...)`
  - `choose_polygon_branch_shifts(...)`
  - `target_mask_and_bbox(...)`
- source image loading / underlay composition
- alpha/raster utilities
  - `premultiply_rgba(...)`
  - `unpremultiply_rgba(...)`
  - `alpha_blit(...)`
  - `dehalo_rgba_edges(...)`
  - `edge_pad_rgba(...)`
- post-render cleanup helpers
  - `stabilize_tiny_island_rgba(...)`
  - `micro_mask_snap_rgba(...)`
  - `prune_alpha_components_by_geo_proximity(...)`
- reporting / config writing

### Keep only as bootstrap / fallback

- `RegionWarpModel`
- `build_country_anchors(...)`
- `render_country_with_inverse_map(...)`
- `render_country_with_bbox_fit(...)`

These should stop being the final deformation model and become:

- coarse initialization
- candidate fallback
- regression baseline

## What should be replaced

The main region fit block in `main()` should be replaced:

1. region-wide anchor aggregation
2. `RegionWarpModel.fit(...)`
3. one continuous `cv2.remap(...)` from the global TPS inverse
4. pixel ownership splitting / owner gap filling
5. the large heuristic cascade that decides whether to rescue countries after
   the fact

This is the section currently starting roughly where jobs are collected and
continuing through:

- `build_country_anchors(...)`
- `model.fit(...)`
- region sheet remap
- per-country extraction

## New architecture

Introduce a new partition-aware builder under `tools/`.

Recommended file split:

- `tools/globe_partition_model.py`
  - source/target partition data structures
- `tools/globe_partition_mesh.py`
  - mesh generation / constrained triangulation
- `tools/globe_partition_solver.py`
  - initialization + ARAP / bounded-distortion solve
- `tools/globe_partition_rasterize.py`
  - triangle-owner rasterization to warped sheet + per-country crops
- `tools/build_globe_global_warps.py`
  - orchestration only

Do not keep growing everything inside one file.

## New data structures

### 1. SourceRegionPartition

Represents the source mnemonic sheet as one partitioned region domain.

Fields:

- `region_name`
- `canvas_width`, `canvas_height`
- `country_masks`: source alpha masks in region coordinates
- `country_polygons`: simplified source contours in region coordinates
- `adjacency`: neighboring country pairs inferred from touching masks
- `region_union_mask`

How to build it:

- start from current `RegionCountryJob.source_rgba` and `(source_left, source_top)`
- rasterize each source sprite alpha into region coordinates
- derive contours from those masks

This is a better source representation than the current sparse landmark cloud.

### 2. TargetRegionPartition

Represents the projected atlas partition for one source region.

Fields:

- `country_masks`
- `country_polygons`
- `region_union_mask`
- `unwrap_center_x`

This reuses the geometry path already present in:

- `project_ring_wrapped(...)`
- `choose_polygon_branch_shifts(...)`
- `target_mask_and_bbox(...)`

But instead of storing only bbox + mask per country, we should also keep the
full region partition geometry.

### 3. PartitionMesh

The core shared-sheet representation.

Fields:

- `vertices_src`
- `vertices_init`
- `vertices_dst`
- `triangles`
- `triangle_country_id`
- `border_edges`
- `country_boundary_vertex_ids`
- `country_interior_vertex_ids`
- `is_locked_vertex`

Important property:

- neighboring countries share the same border vertices and edges

That is what gives the partition effect.

### 4. CountryGuideSet

Internal guides for one country.

Fields:

- `skeleton_points`
- `component_centroids`
- `principal_axis_points`
- `island_groups`

These are optional in phase 1, but the structure should exist from the start.

## Mesh construction

Use constrained triangulation.

Recommended approach:

- build simplified polygon boundaries for every country from source masks
- merge all country boundaries into one planar partition graph
- triangulate the partition with country borders as constrained edges

Requirements:

- no triangle should cross a country border
- all shared borders should exist only once in the mesh
- interior triangles belong to exactly one country

Potential implementation choices:

- `triangle` / Shewchuk Triangle bindings
- `meshpy`
- `shapely` + triangulation fallback

If we want the cleanest path, add one explicit triangulation dependency instead
of trying to improvise this with OpenCV.

## Initialization step

Do not throw away the current TPS code immediately.

Use it to initialize the target vertex positions:

1. build the `PartitionMesh` in source coordinates
2. run the current region TPS fit exactly as today
3. map all mesh vertices through `RegionWarpModel.forward(...)`
4. use those positions as `vertices_init`

This keeps the new system close to the current behavior initially and makes the
later optimizer much easier to debug.

## Main solver

### Phase-1 solver: ARAP refinement on shared partition mesh

Start with an ARAP-style mesh solve on top of the TPS initialization.

Unknowns:

- destination positions of free mesh vertices

Hard constraints:

- outer region boundary vertices lie on target region boundary
- selected country-boundary vertices lie on target country boundaries
- triangle orientation must stay positive

Soft energies:

- ARAP rigidity energy per triangle
- border-fit energy
- mild initialization energy to stay near TPS bootstrap
- optional country-local smoothness

Important note:

The objective should be solved globally over the whole mesh, not separately per
country.

That keeps seams consistent by construction.

### Why ARAP first

It is the simplest strong improvement over TPS that directly attacks the real
problem:

- local shear
- local nonuniform scaling
- motif collapse

It also fits the shared-mesh representation naturally.

## Target constraints

We should avoid the old "fit to bbox" mental model.

Instead:

- country boundary vertices are attracted to the target country polygon
- region outer boundary vertices are attracted to the target region outline
- optional interior guides are attracted weakly to target positions or target
  directions

Practical first version:

- sample corresponding vertices along source and target country boundaries
- use those as soft correspondence constraints

Later versions:

- nearest-edge projection
- quasi-conformal / bounded-distortion constraints

## Rasterization

After solving, rasterize the shared deformed mesh directly.

New raster path:

1. composite region source sheet as today
2. for each triangle:
   - source triangle in source region sheet
   - destination triangle in solved mesh
   - warp the triangle patch
3. accumulate into:
   - one region warped sheet
   - per-country canvas from triangle ownership

This is the key improvement over the previous failed approach:

- ownership comes from triangle membership, not post-hoc pixel guessing

So no more:

- `owner` label map hacks
- `fill_owner_gaps(...)`
- bleed from neighboring countries because the rasterizer already knows which
  triangle belongs to which country

## Quality scoring

Add a new scorer module and stop relying mainly on IoU.

### Metrics to compute per country

- `borderRecall`
- `borderPrecision`
- `alphaRecall`
- `alphaPrecision`
- `componentCountError`
- `skeletonDeviation`
- `meanLocalAngleDistortion`
- `maxTriangleDistortion`
- `spillArea`

### Aggregate score

A good first composite score:

- strong penalty for triangle flips / injectivity failure
- strong penalty for border spill
- medium penalty for component mismatch
- medium penalty for skeleton distortion
- medium penalty for large local angle distortion
- low weight on plain IoU

This shifts the system from "mask overlap first" to "readable, partition-safe
deformation first".

## Candidate system

The new pipeline should still keep multiple candidate strategies, but they
should be clean and few:

- `tps-init`
- `mesh-arap`
- `mesh-arap+guides`
- `rigid-bbox` fallback for a tiny set of edge cases

Pick the candidate with the best composite score automatically.

This should replace most of the current hardcoded feature-key rescue logic.

## Archipelagos and disconnected countries

These remain a special case even in the new design.

Recommended representation:

- one country id
- multiple island-group interior guide sets
- optional internal local-rigidity groups

Do **not** solve each island as an entirely independent sprite.
Instead:

- keep them in one country ownership
- but give each island group local internal guides

This should directly target the countries that are currently worst:

- `KIR`
- `FJI`
- `BHS`
- `SLB`
- `IDN`

## Stepwise migration plan

### Step 0: Baseline freeze

Before changing behavior:

- keep the current rebuilt `country-inverse` outputs as baseline
- keep current reports and preview generation

No behavior change here.

### Step 1: Add partition data extraction

Implement:

- `SourceRegionPartition`
- `TargetRegionPartition`

Outputs:

- debug previews showing source partition and target partition

Risk:

- low

### Step 2: Add shared constrained mesh generation

Implement:

- partition graph
- constrained triangulation
- triangle country ownership

Outputs:

- debug preview of source mesh overlaid on source region

Risk:

- moderate

### Step 3: Use TPS only to initialize mesh vertices

Implement:

- map mesh vertices through existing `RegionWarpModel.forward(...)`

Outputs:

- preview of initialized mesh in target space

Risk:

- low

### Step 4: Add triangle-owner rasterization without ARAP

Before changing the solver, first change rasterization:

- rasterize by mesh triangles
- crop per-country from triangle ownership

This alone removes the old region-sheet label-split failure mode in a principled
way.

Risk:

- moderate

### Step 5: Add ARAP refinement

Implement:

- global solve for mesh vertices
- border attraction + rigidity energy

Start on one region only:

- `asien`

because it shows the problem clearly and has enough variety to stress the
method.

Risk:

- moderate to high

### Step 6: Add interior guides

Implement:

- skeleton extraction
- component centroids
- principal-axis guides

Apply first to:

- long countries
- large countries
- archipelagos

Risk:

- moderate

### Step 7: Replace heuristic rescue lists with candidate scoring

Only once the new score is stable:

- remove most of:
  - `RELAXED_CLIP_FEATURE_KEYS`
  - `SELECTIVE_ISLAND_FALLBACK_FEATURE_KEYS`
  - `LARGE_ARCHIPELAGO_FALLBACK_FEATURE_KEYS`
  - `ART_PRIORITY_FALLBACK_FEATURE_KEYS`
  - `FORCED_ART_FALLBACK_FEATURE_KEYS`
  - `LOW_RECALL_MASK_LOCK_FEATURE_KEYS`
  - `RIGID_ART_FALLBACK_FEATURE_KEYS`
  - `LARGE_GEO_LOCK_FEATURE_KEYS`
  - `AGGRESSIVE_RELAX_FEATURE_KEYS`

The goal is not zero exceptions, but dramatically fewer.

## Recommended first implementation target

Do **not** start by fully replacing every region.

Start with:

- one new canary path
- one region
- one solver

Recommendation:

- add `--solver partition-mesh-arap`
- add `--region asien`
- write outputs into a parallel debug folder first

Once `asien` is better, scale to:

- `europa`
- `nordamerika`
- `oceanien`

## Minimal code changes in the first PR

The first implementation PR should do only this:

1. add partition extraction
2. add constrained mesh generation
3. add triangle-owner rasterization
4. keep existing TPS init as the only deformation source

That already gives:

- correct partition semantics
- shared borders
- no post-hoc owner guessing
- no cross-country texture bleed

Then the second PR adds ARAP refinement.

That split reduces risk a lot.

## What success should look like

Before removing the old path, require the new path to beat it on:

- `KAZ` / `RUS` style border contamination cases
- `ITA`, `CHL`, `JPN` long-shape cases
- `KIR`, `FJI`, `BHS`, `SLB` archipelago cases
- large countries like `USA`, `CAN`, `RUS`

And require:

- zero gaps between neighboring countries
- zero overlap between neighboring countries
- no triangle flips

That is the right bar for promoting the new pipeline.
