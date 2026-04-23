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

## Säkert deploya en hemlig globe-path på `viewmymodel.com`

För att lägga globe-bygget under en separat hemlig path utan att ändra den
nuvarande live-roten på `viewmymodel.com`, använd:

```bash
python3 tools/deploy_secret_globe_path.py --dry-run
```

Detta gör:

- verifierar att `https://viewmymodel.com/` fortfarande matchar live-roten i
  `/data/workspace/graph-synchronizer/docs/prototypes`
- bygger en temporär staging-site från den befintliga live-sajten
- lägger Geography under en ny underkatalog `globe-<gitsha>/`

För att först verifiera staging-siten på en preview-channel:

```bash
python3 tools/deploy_secret_globe_path.py \
  --preview-channel globe-path-smoke-<tag>
```

För att sedan lägga exakt samma staging på custom-domänen:

```bash
python3 tools/deploy_secret_globe_path.py --deploy-live
```

Den live URL som verktyget bygger är:

- `https://viewmymodel.com/globe-<gitsha>/?region=globe`

Viktigt:

- helpern deployar inte något live om du inte anger `--deploy-live`
- helpern vägrar som default att deploya live om den upptäcker att
  `viewmymodel.com/` inte längre matchar den repo-root som staging bygger på
