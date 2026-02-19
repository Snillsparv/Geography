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
