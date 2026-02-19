# Jonas geografi

Interaktivt geografi-spel med:

- 2D-kartor per region (utforska + quiz)
- 3D-världsglob (utforska + quiz)

## Starta lokalt

```bash
python3 -m http.server 8000
```

Öppna sedan `http://localhost:8000/`.

## 3D-globen

Välj kortet **Världen (3D)** på startsidan.

Globen använder:

- landpolygoner för klick/hit-test
- samma landbeskrivningar och bildassociationer som regionkartorna
- projicerad overlay på globen för avslöjade mnemoniska bilder

## Bygg globe-data igen

Om regiondata ändras kan globe-filer genereras om:

```bash
node tools/build_globe_assets.mjs
```

Detta skapar:

- `assets/globe/config.json`
- `assets/globe/world.geojson`

## Förbättra globe-passning (auto-warp)

För att auto-justera mnemonik-bilder mot landpolygoner:

```bash
python3 -m venv .venv
.venv/bin/pip install opencv-contrib-python-headless pillow numpy
.venv/bin/python tools/build_globe_warps.py
```

Detta skapar:

- `assets/globe/warped/*.webp`
- `assets/globe/warp_report.json`
- uppdaterar `assets/globe/config.json` med warp-metadata
