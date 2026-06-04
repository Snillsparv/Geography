# Tools

Offline helper scripts. None of this runs in the browser or ships to users —
it only generates assets that get committed.

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
