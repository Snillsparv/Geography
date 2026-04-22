# Globe Warp Replacement Design

## Goal

Replace the current region-wide TPS-based globe fitting pipeline with a stronger
partition-preserving deformation pipeline that:

- keeps the "single sheet" / partition feel
- preserves shared borders exactly or near-exactly
- avoids overlap and separation between countries
- preserves mnemonic art much better by default
- reduces the need for country-specific fallback lists and manual retuning

This is explicitly **not** a design for independent per-country warps.
Countries should still behave like cells in one shared deformed sheet.

## Why the current pipeline needs manual fixes

The current globe build in `tools/build_globe_global_warps.py` does four things:

1. builds a target mask + bbox per country
2. extracts sparse silhouette landmarks per country
3. fits one `RegionWarpModel` per source region
4. inverse-samples each country through that region-wide model

This creates three structural weaknesses:

### 1. One smooth warp is shared across many incompatible countries

The same region-wide affine + TPS field must simultaneously satisfy:

- large countries
- tiny countries
- archipelagos
- long thin countries
- concave countries
- countries with important internal art structure

This is too much to ask of one smooth field.

### 2. The correspondences are silhouette-only

`build_country_anchors(...)` uses centroid + directional contour extrema.
That gives very weak control over interior visual structure.

So the optimization is effectively:

- "make the outside shape line up roughly"

instead of:

- "keep the horse face intact"
- "keep the motif readable"
- "do not shear the main interior drawing"

### 3. The quality objective is geometry-heavy and art-light

The current diagnostics mostly reward overlap with the geographic mask.
That is useful, but it is not the same as mnemonic readability.

This is why a warp can score "acceptable" geometrically but still look broken.

## Core design change

Replace the current region-wide TPS final warp with a **single partitioned mesh
deformation per region**.

The important point is:

- still one shared deformed region sheet
- still shared borders and seam continuity
- but the deformation is represented by a constrained mesh, not by a single
  global TPS field

Think of it as:

- one region sheet
- cut into country cells
- deformed by a shared mesh solver
- with continuity across shared borders guaranteed by shared vertices/edges

## Proposed representation

For each source region, build a constrained triangulated mesh over the region
sheet.

The mesh should include:

- country borders as constrained edges
- coastlines / outer region silhouette
- additional interior guide curves or points for countries where the art needs
  internal structure preservation

Each triangle belongs to exactly one country cell.
Neighboring countries share the same border vertices.

This gives the desired partition behavior automatically:

- no gaps
- no overlap
- no drifting seams

because two neighboring countries do not have separate seam geometry.
They literally share the same mesh boundary.

## Target construction

Build the target region partition on the globe atlas using the projected
country polygons.

This is not a per-country bbox target anymore.
Instead, for a given region, construct:

- one target partition mesh
- same connectivity as the source mesh where possible
- target border vertices lying on the projected country borders

The source region mesh and target partition mesh now define a region-wide but
partition-aware registration problem.

## Solver

The solver should be a **global mesh optimization** with these ingredients.

### Hard or near-hard constraints

- shared country borders stay shared
- country cells remain non-overlapping
- region boundary maps to the target region boundary
- triangle flips are forbidden

### Soft objectives

- low local angle distortion
- low local shear
- low local scale variation
- better preservation of salient interior art structure
- mild preference to remain close to an initial coarse fit

### Recommended energy family

Use a bounded-distortion / ARAP-like objective on the partition mesh.

Good fit for this problem:

- ARAP-style local rigidity for interior art preservation
- bounded-distortion or injectivity constraints to avoid foldovers
- optional cage/BBW-style localized control where needed

This is a better match than TPS because it directly optimizes local triangle
quality, not just a smooth interpolant through sparse contour landmarks.

## Initialization

Keep the existing region TPS only as an initializer.

That means:

1. run the current coarse region fit
2. use it to place the initial target positions of mesh vertices
3. refine with the new partition-preserving optimizer

This reduces implementation risk and should speed convergence.

## Country-specific art preservation without breaking the shared partition

The key requirement from the product side is correct:

- countries should not become independent floating stickers
- but each country's art still needs to fit its own border much better

The way to get both is:

- shared geometry at the borders
- country-local interior freedom

Concretely:

- border vertices are shared between neighbors
- interior vertices are owned by one country
- each country can have extra internal guide handles
- those guide handles affect only triangles inside that country cell

This lets one country preserve its motif without tearing away from its
neighbors.

## Internal guides

The current system has almost no notion of interior semantics.
That should change.

Per country, automatically derive a small set of interior guide primitives:

- alpha medial axis / skeleton points
- connected-component centroids
- strong curvature points on the alpha silhouette
- optional saliency points from the art image

These are not independent target landmarks.
They are regularizers that help the optimizer keep the interior structure
stable while the border aligns to geography.

Examples:

- long countries: add spine handles along the medial axis
- archipelagos: add one guide group per island cluster
- large countries: add sparse interior rigidity anchors

## Special handling for archipelagos and disconnected countries

A single connected deformation model is especially bad for:

- Kiribati
- Fiji
- Bahamas
- Solomon Islands
- Indonesia

These should still remain one country in the partition, but internally they
should be represented as multiple island groups.

Recommended approach:

- each island group gets its own local rigid/similarity sub-handle set
- those sub-handles are coupled weakly at country level
- all groups still live inside the same country cell ownership

This avoids forcing one smooth deformation to explain a disconnected country.

## Rasterization / export

Do not return to the old `region-global-sheet+labels` style post-hoc splitting.

Instead:

1. solve one shared partition mesh deformation
2. rasterize triangles directly with known triangle ownership
3. export:
   - one optional region warped sheet for debugging
   - per-country crops from that rasterization

The important distinction is:

- ownership should come from the mesh triangles
- not from guessing pixels afterward with geographic label splitting

That removes the earlier cross-country bleed failure mode.

## Automatic strategy selection

The new pipeline should still evaluate multiple candidate solvers, but the
candidates should be principled, not ad-hoc heuristics.

Recommended candidates:

- coarse TPS init only
- mesh ARAP refinement
- mesh similarity refinement
- bounded-distortion refinement
- rigid-country fallback for a small subset of tiny/micro countries

Then score them with a multi-objective metric.

## Better scoring

Replace "mostly IoU" with a score that reflects what the user actually cares
about:

- border fit
- no overlap / no separation
- connected-component preservation
- medial-axis preservation
- local angle distortion
- local area distortion
- spill outside owned cell
- alpha recall inside owned cell

This score should drive strategy selection automatically.

## Suggested rollout

### Phase 1

Implement the shared partition mesh and triangle-owner rasterization.

Goal:

- preserve seams
- remove post-hoc pixel ownership guessing
- keep current frontend asset format

### Phase 2

Add ARAP-style refinement on top of the current TPS initialization.

Goal:

- improve large countries
- improve long thin countries
- reduce motif shearing

### Phase 3

Add internal guides and disconnected-country handling.

Goal:

- improve archipelagos
- improve tiny countries
- improve interior mnemonic readability

### Phase 4

Replace most hardcoded feature-key fallback lists with automatic candidate
selection using the new quality score.

## Expected effect

This design should reduce manual cleanup because it fixes the actual mismatch in
the current system:

- today: one smooth regional interpolation is trying to solve a partitioned art
  deformation problem
- proposed: one partition-preserving mesh deformation solves the partitioned art
  deformation problem directly

The result should be:

- better continuity between countries
- better border adherence
- better preservation of each country's mnemonic art
- fewer special-case overrides

## References

- Igarashi, Moscovich, Hughes. As-Rigid-As-Possible Shape Manipulation. 2005.
- Schaefer, McPhail, Warren. Image Deformation Using Moving Least Squares. 2006.
- Jacobson, Baran, Popovic, Sorkine. Bounded Biharmonic Weights for Real-Time Deformation. 2011.
- Lipman. Bounded Distortion Mapping Spaces for Triangular Meshes. 2012.
- Lam, Lui. Landmark and Intensity Based Registration with Large Deformations via Quasi-Conformal Maps. 2013.
