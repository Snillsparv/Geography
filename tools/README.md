# Tools

Offline helper scripts. None of this runs in the browser or ships to users —
it only generates assets that get committed.

## World tile pyramid + globe (the fast path)

`make-tiles.mjs` bakes the hand-drawn world into a Web-Mercator raster
pyramid (512 px WebP tiles, z0–7) packed as a single `tiles/world.pmtiles`
archive. Each region is warped as ONE rubber sheet: a fixed grid over the
region canvas, deformed by a Moving Least Squares field shared by every
country, so the jigsaw the maps were drawn as stays glued (no cracks or
overlaps between neighbours) and geometry is identical at every zoom level
(deeper tiles are just sharper — shapes never morph).

Every country pins the warp with five control points ON its artwork's
opaque mass (centroid + principal axes — never the empty quad corners, which
overlap neighbours and used to fold the field around interlocking shapes
like Peru/Ecuador/Chile). `--geo 0..1` blends the pin targets between the
region's least-squares affine (0 = the hand-drawn composition exactly) and
the moment-transport affine onto the true projected polygon (1 = right
place, size and tilt). Default 1. Isolated island nations drawn far larger
than life (Pacific/Caribbean micro-states, Maldiverna …) are detected
automatically and always keep the composition placement ("badges").

The sheets render per pixel (inverse-bilinear per warp cell — exact
coverage, so no hairline mesh seams). Neighbours of the shape-locked
countries (Ryssland/Kanada/USA, drawn clipped to their true Natural Earth
polygons) get art shortfall near the locked border filled with their own
colour-extended, blurred underlay; sheets are clipped out of the locked
polygons and the locked outlines re-stroke on top — crisp borders, no
ocean slivers.

Debugging: `--window z:x0:y0[:x1:y1]` renders only that tile range
(combine with `--save DIR` and inspect the webp files directly).

`make-globe-demo.mjs` builds `globe-demo.html`: MapLibre GL (globe + mercator
projections) reading the PMTiles via HTTP range requests, with a Natural
Earth border line layer (vector → crisp at every zoom, styleable live).

```bash
cd tools && npm install
node make-tiles.mjs --maxzoom 7 --geo 0.5   # ⇒ tiles/world.pmtiles (~10–20 min)
node make-globe-demo.mjs               # ⇒ globe-demo.html
```

Needs `tools/data/ne_50m_countries.geojson` and
`tools/data/ne_50m_map_units.geojson` (committed; originally from the
Natural Earth GitHub mirror).

## Map demo (illustrations on real geography)

`tools/make-map-demo.mjs` builds a self-contained `map-demo.html` that places
the country illustrations on real borders (Natural Earth, matched by Swedish
name `NAME_SV`) with a projection switcher — flat Mercator, Equal Earth, and a
draggable 3D globe. d3 is inlined so the page works offline.

```bash
# needs a Natural Earth countries GeoJSON (110m is enough), e.g.:
curl -o /tmp/world.geojson \
  https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson
cd tools && npm install            # also installs the d3 packages
node make-map-demo.mjs /tmp/world.geojson
```

## Vectorize country images → SVG

Converts the hand-drawn country images (`assets/**/countries/*.webp|png|jpg`)
into clean, scalable SVG written next to each source file. The original raster
files are left untouched, so the app keeps working until you switch it over.

### Why

- **Smaller over the wire.** SVG is text; Firebase Hosting serves it
  gzip/brotli-compressed — typically ~3× smaller than the already-binary webp.
- **Infinitely scalable.** Zoom in as far as you like with no blur.
- **Projection-ready.** Vector paths can be clipped to real country polygons
  and reprojected onto a flat map or a 3D globe.

### One-time setup

```bash
# from the repo root
pip install -r tools/requirements.txt      # Pillow (image preprocessing)
cd tools && npm install                     # VTracer + SVGO
```

### Run

```bash
# from the repo root
node tools/vectorize.mjs                    # scans ./assets, skips up-to-date SVGs
node tools/vectorize.mjs assets/europa      # limit to one region
node tools/vectorize.mjs assets --force     # rebuild everything
```

### Tuning (env vars)

| Var                  | Default | Meaning                                             |
|----------------------|---------|-----------------------------------------------------|
| `VEC_COLORS`         | 0       | Palette quantization (0 = off; >0 shrinks files but can drop small-region colours) |
| `VEC_MEDIAN`         | 3       | Median-filter size for denoising (1 = off)          |
| `VEC_ALPHA`          | 128     | Alpha cut-off for crisp edges (0–255)               |
| `VEC_COLOR_PRECISION`| 8       | VTracer colour precision (higher = more faithful colours) |
| `VEC_FILTER_SPECKLE` | 6       | VTracer speckle removal                             |

> **Tip:** for maximum fidelity, run the pipeline on your original
> high-resolution scans rather than the downscaled webp in the repo, then
> drop the resulting SVGs in place.
