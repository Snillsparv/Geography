# Plan: Geografispelet - Alla Regioner

## Sammanfattning

Bygga om det nuvarande Sydamerika-spelet till ett komplett geografispel med startskärm och stöd för 10 regioner. Allt i en enda `index.html` (inga externa ramverk, inga beroenden) med dynamisk laddning av assets per region.

---

## Tillgängliga regioner (10 st)

| Region | Antal länder/områden | Total storlek (assets) |
|--------|---------------------|----------------------|
| Sydamerika | 13 | ~1.5 MB |
| Nordamerika | 14 | ~1.9 MB |
| Europa | 48 | ~2.7 MB |
| Asien | 50 | ~2.7 MB |
| Afrika | 55 | ~2.0 MB |
| Oceanien | 14 | ~933 KB |
| USA (delstater) | 50 | ~2.5 MB |
| Sverige (landskap) | 25* | ~1.3 MB |
| Västindien | 9 | ~582 KB |

*Sverige har 27 lager men Vättern och Vänern är sjöar - de exkluderas från quizet men visas som bakgrund.

**Filstorlekar är OK för webben.** Varje region laddas on-demand (lazy loading), så användaren laddar bara 1-3 MB åt gången, aldrig alla ~14 MB samtidigt.

---

## Arkitektur

### Enkelsidesapp (SPA)
- **En enda `index.html`** - ingen server krävs, kan serveras som statisk fil
- **Två vyer**: Startskärm och Spelvy, växling via JS (ingen sidladdning)
- **Dynamisk dataladdning**: `config.json` + WebP-assets laddas först när regionen väljs
- **Ingen extern JS/CSS** - allt inbäddat, precis som nu

### Filstruktur (ingen ändring i assets)
```
index.html              ← Ny version (ersätter nuvarande)
assets/
  sydamerika/config.json + map.webp + overlay.webp + countries/*.webp
  nordamerika/...
  europa/...
  asien/...
  afrika/...
  oceanien/...
  usa/...
  sverige/...
  vastindien/...
Jonas_1.webp, Jonas_2.webp, high_five.wav  ← Oförändrade
```

---

## Steg-för-steg implementation

### Steg 1: Startskärm (HTML + CSS)

Snygg startskärm med:
- Titel "Forma-spelet" (eller liknande)
- Grid med 10 regionkort (3-4 per rad på desktop, 2 per rad på mobil)
- Varje kort visar: Regionnamn + antal länder/områden + liten kartförhandsvisning (map.webp thumbnail via CSS `background-image`, lazy-loaded)
- Gruppering: "Världsdelar" (6 st) | "Övriga" (Västindien, Sverige, USA)
- Mörkt tema som matchar nuvarande design

### Steg 2: Datadriven spelmotor (JS refaktorering)

Omstrukturera all spellogik att vara parameteriserad:

**Nuvarande problem (hårdkodat):**
- `COUNTRIES` array med 13 sydamerikanska länder
- `MAP_LEFT`, `MAP_TOP`, `MAP_W`, `MAP_H` som konstanter
- `IMAGE_ASSOCIATIONS` - bara Sydamerika
- Bildvägar pekar på `assets/countries/*.png` (gammal PNG-mapp)
- Bolivia-speciallogik (shape-fil)
- `HS_KEY = 'sydamerika-highscores'`

**Ny struktur:**
```javascript
// All regiondata laddas dynamiskt från config.json
let currentRegion = null;  // { id, name, config, countries, mapW, mapH, ... }

async function loadRegion(regionId) {
  // 1. Hämta config.json
  // 2. Parsa länder, filtrera bort speciallager
  // 3. Ladda map.webp + overlay.webp
  // 4. Ladda alla country-bilder (parallellt)
  // 5. Bygg hit-detection data
  // 6. Processa hover-bilder
  // 7. Visa spelvy
}
```

**Nyckelförändringar:**
- `COUNTRIES` → dynamisk array från `config.json`
- Hit-detection laddar WebP-bilder via `<canvas>` (samma teknik, bara annan filväg)
- `IMAGE_ASSOCIATIONS` och `desc` finns bara för Sydamerika → i utforska-läget visas dessa om de finns, annars bara landsnamnet
- `HS_KEY` → `${regionId}-highscores` (separata topplistor per region)
- Bolivia Shape → generaliserad: alla entries som matchar `*_shape` eller `* Shape` i config.json behandlas som hit-detection-shapes

### Steg 3: Specialfall hantering

**3a. Bolivia Shape (Sydamerika)**
- Config.json har en entry "Bolivia Shape" med fil `bolivia_shape.webp`
- Logik: om en entry heter `X Shape`, koppla den till land `X` som hit-detection-override
- Generaliserat: scanna config efter `_shape`-suffix i filnamn

**3b. Västindien - dubbletter med "!"**
- Config.json har entries som "Barbados!" och "Barbados" (utan !)
- "!"-entries är cirkulära markeringar/callouts på kartan (overlay-dekorationer)
- Entries utan "!" är de riktiga länderna för quiz/hit-detection
- Implementation: filtrera bort "!"-entries från COUNTRIES-arrayen (quizlistan) men visa dem som extra overlays om det behövs. Alternativt: ignorera "!"-entries helt om de inte behövs visuellt (de är callout-cirklar som redan syns i overlay.webp)

**3c. Sverige - sjöar**
- Vättern och Vänern är sjöar (inte landskap)
- Exkludera från quiz men visa dem som bakgrundslager (synliga men inte klickbara)
- Identifiera via namn: "Vättern", "Vänern"

**3d. Namnkvalitet i config.json**
Några observerade problem i config-data:
- "VItryssland" (Europa) → borde vara "Vitryssland" (case-fel)
- "Eciador" (Sydamerika) → displaynamn "Ecuador" men filnamn förblir "eciador"
- "Indoneien" (Asien) → borde vara "Indonesien" (stavfel)
Dessa kan fixas i JS vid inläsning (namnkorrigerings-tabell) eller direkt i config.json.

### Steg 4: Bildladdning & prestanda

**Laddningsflöde:**
1. Startskärm visas direkt (ingen tunga assets)
2. Användaren väljer region
3. Laddningsindikator visas ("Laddar Sydamerika...")
4. `config.json` hämtas (2-3 KB)
5. `map.webp` + `overlay.webp` laddas parallellt
6. Alla country-bilder laddas parallellt (Promise.all)
7. Hit-detection-data bearbetas (canvas-baserad pixeldata)
8. Hover-bilder processas
9. Spelvy visas

**Prestandaoptimering:**
- **Lazy loading**: Inga assets laddas förrän en region väljs
- **WebP-format**: Redan optimerat (kvalitet 85, max 4000px)
- **Parallell laddning**: Alla bilder laddas samtidigt med `Promise.all`
- **Cachning**: Bilder cachas av webbläsaren vid andra besök
- **Inga CSS-filters i realtid**: Hover-färg bakas in i bilddatan (som nu)
- **requestAnimationFrame**: Hover-uppdatering throttlad (som nu)
- **Thumbnail-förhandsvisning**: Startskärmens kartförhandsvisningar använder CSS `background-size: cover` med map.webp - dessa laddas med `loading="lazy"` eller `IntersectionObserver`

**Filstorlekar bedömning:**
- Största regionen (Europa/Asien): ~2.7 MB - helt acceptabelt för modern webb
- Alla bilder redan i WebP (bästa komprimering för rasterbilder)
- 4000px max-dimension kan vara stort för mobil men behövs för zoom-funktionen
- Ingen ytterligare optimering behövs för bilderna

### Steg 5: UI-uppdateringar

**Header:**
- Lägg till "Tillbaka"-knapp (← pil) som går till startskärmen
- Regionnamn i titeln (dynamiskt)
- Utforska/Quiz-knappar fungerar som nu

**Info-panel:**
- Utforska-läge: Visa landsnamn + beskrivning (om tillgänglig) + association (om tillgänglig)
- Quiz-läge: Fungerar identiskt som nu
- Counter: "X / Y länder" → dynamiskt antal
- Topplistor: Per region (`${regionId}-highscores`)

**Jonas:**
- Visas i alla regioner (karaktären är inte regionspecifik)
- High-five-räknaren är global

**Startskärm → Spelvy-transition:**
- Fade-animation vid övergång
- Laddningsindikator under asset-laddning

### Steg 6: Responsive design

- Desktop: Startskärm med 3-4 kort per rad, spelvy som nu
- Tablet: 2-3 kort per rad
- Mobil: 1-2 kort per rad, spelvy staplad (karta ovan, panel under)
- Alla breakpoints matchar befintlig design

---

## Subagent-plan

Implementationen görs i en huvudagent som arbetar sekventiellt genom stegen. Jag planerar att använda subagenter för:

1. **Research-agent** (om behövs): Kolla specifika config-detaljer eller filer under arbetets gång
2. **Huvudimplementation**: Sker direkt i huvudkonversationen - skriva om `index.html`

Allt arbete sker i en enda `index.html`-fil, så parallella subagenter behövs inte.

---

## Frågor / antaganden att bekräfta

1. **Vättern & Vänern (Sverige)**: Jag planerar att exkludera dem från quizet men visa dem som icke-klickbara bakgrundselement. OK?

2. **Västindien "!"-entries**: Jag planerar att ignorera dem (de är callout-markeringar som redan syns i overlay-lagret). Om de behövs som separata visuella overlays kan det läggas till senare. OK?

3. **Beskrivningar & associationer**: Dessa finns bara för Sydamerika. Övriga regioner visar bara landsnamnet i utforska-läget. Jag kan lägga till en generisk text ("Klicka för att se mer") eller helt enkelt bara visa formen. OK?

4. **Stavfel i config**: Ska jag fixa "VItryssland" → "Vitryssland", "Indoneien" → "Indonesien" etc. direkt i config.json-filerna, eller hantera det med en korrigeringstabell i JS?

5. **Eciador**: Filnamnet är `eciador.webp` men displaynamnet borde vara "Ecuador". Jag fixar visningsnamnet i JS. OK?

---

## Leverabel

En enda uppdaterad `index.html` som:
- Visar en startskärm med alla 10 regioner
- Laddar dynamiskt rätt config + assets vid val
- Kör Utforska- och Quiz-läge identiskt för alla regioner
- Hanterar alla specialfall (Bolivia shape, Västindien, Sveriges sjöar)
- Är lika snabbt/snabbare än nuvarande version
- Fungerar som statisk fil (ingen server krävs)
