// ══════════════════════════════════════════════════════════════════════
// Jonas geografi på JORDGLOBEN — samma spelmekanik som originalsidan
// (Utforska + Klassiskt Quiz + Världstest), men kartan är MapLibre-globen
// med de förbakade kartrutorna, och länderna är klickytorna ur
// assets/art-regions.json. I regionläge är resten av världen grön;
// regionens länder är täckta ("konturkarta") och avslöjar sin bild när
// man hittar dem. Platt karta (Robinson) finns som alternativ vy.
// ══════════════════════════════════════════════════════════════════════

const GRON = '#2e9e44';        // resten av världen i regionläge
const TACK = '#f2ead8';        // "papper" över oupptäckta länder
const GUL = '#ffdc32';         // hover / ledtrådsblink
const ROD = '#e05252';         // felklick

const WORLD_SLUGS = ['europa', 'afrika', 'asien', 'nordamerika', 'sydamerika', 'oceanien', 'vastindien'];
const KAMERA = {
  world: { center: [10, 25], zoom: 1.4 },
  europa: { center: [15, 54], zoom: 2.6 },
  afrika: { center: [17, 1], zoom: 2.1 },
  asien: { center: [88, 40], zoom: 1.9 },
  nordamerika: { center: [-95, 45], zoom: 1.9 },
  sydamerika: { center: [-60, -22], zoom: 2.2 },
  oceanien: { center: [150, -22], zoom: 2.2 },
  vastindien: { center: [-71, 18], zoom: 3.4 },
};

// ── DOM ──
const mapPanel = document.getElementById('map-panel');
const cursorLabel = document.getElementById('cursor-label');
const headerHint = document.getElementById('header-hint');
const infoDefault = document.getElementById('info-default');
const infoCard = document.getElementById('info-card');
const infoName = document.getElementById('info-name');
const infoShape = document.getElementById('info-shape');
const infoDesc = document.getElementById('info-desc');
const exploredCountEl = document.getElementById('explored-count');
const seterraTargetName = document.getElementById('seterra-target-name');
const seterraScoreEl = document.getElementById('seterra-score');
const seterraTimeEl = document.getElementById('seterra-time');
const seterraCorrectEl = document.getElementById('seterra-correct');
const seterraWrongEl = document.getElementById('seterra-wrong');
const seterraBar = document.getElementById('seterra-bar');
const seterraProgressLabel = document.getElementById('seterra-progress-label');
const seterraFeedback = document.getElementById('seterra-feedback');
const seterraDone = document.getElementById('seterra-done');
const seterraGame = document.getElementById('seterra-game');
const seterraHintBtn = document.getElementById('seterra-hint-btn');
const seterraHintBox = document.getElementById('seterra-hint');

// ── Speltillstånd ──
let regionsGj = null;             // art-regions.json (alla klickytor)
let featureByFilename = new Map();// filnamn → feature
let featureByGid = new Map();     // gid → feature (för prickklick m.m.)
let COUNTRIES = [];               // aktiva (spelbara) länder i vald region/test
let aktivByGid = new Map();       // gid → country
let IMAGE_ASSOCIATIONS = {};
let HS_KEY = '';
let ASSET_BASE = '';
let currentMode = 'explore';
let isWorldTest = false;
let map = null;
const revealed = new Set();       // gid
let activeCountry = null;
let exploreTooltipTimer = null;

let seterraQueue = [];
let seterraTarget = null;
let seterraCorrect = 0, seterraWrong = 0, seterraTotal = 0;
let seterraStartTime = 0, seterraTimerInterval = null;
let seterraLocked = false, seterraTargetMisses = 0, seterraElapsed = 0;
let seterraMissedCountries = new Set();
let seterraIsRetry = false;
let currentHintText = '';

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ══════════════════════════════════════════════════
// Landtillstånd: gid → {gron, tackt, hover, fel, tips}
// Speglas till MapLibre feature-state och plattkartan.
// ══════════════════════════════════════════════════
const tillstand = new Map();
function setLand(gid, patch) {
  const t = tillstand.get(gid) || {};
  Object.assign(t, patch);
  tillstand.set(gid, t);
  if (map) {
    try {
      map.setFeatureState({ source: 'regioner', id: gid }, t);
      map.setFeatureState({ source: 'markorer', id: gid }, t);
      map.setFeatureState({ source: 'borders', id: gid }, t);
    } catch (e) { /* källan inte laddad än — tillståndet ligger i tillstand-mappen */ }
  }
  flatDirty();
  origApplyState(gid, t);
}
function landState(gid) { return tillstand.get(gid) || {}; }

function revealCountry(gid) {
  revealed.add(gid);
  setLand(gid, { tackt: false, hover: false, fel: false, tips: false });
}
function coverCountry(gid) {
  revealed.delete(gid);
  setLand(gid, { tackt: true });
}
function flashWrong(gid) {
  if (revealed.has(gid)) return;
  setLand(gid, { fel: true, hover: false });
  setTimeout(() => setLand(gid, { fel: false }), 1200);
}
function blinkHint(gid) {
  if (revealed.has(gid)) return;
  let n = 0;
  const iv = setInterval(() => {
    setLand(gid, { tips: n % 2 === 0 });
    if (++n >= 6) { clearInterval(iv); setLand(gid, { tips: false }); }
  }, 260);
}
function resetOverlays() {
  for (const c of COUNTRIES) coverCountry(c.gid);
  revealed.clear();
  flatDirty();
}

// ══════════════════════════════════
// Dataladdning
// ══════════════════════════════════
// ?v=N på alla resurser som ändras vid deploy: mobilwebbläsare och CDN:er
// cachar hårt, och en gammal glob-spel.js mot nya datafiler gav trasiga
// halvlägen (döda flikar/klick). V bumpas i EN konstant här och i
// glob.html:s skriptreferens — aldrig fler handbumpade URL:er.
const V = '6';
// På *.githack.com (förhandslänkar) klarar proxyn varken stora filer eller
// range-requests pålitligt — datafilerna hämtas då direkt från GitHubs
// råfilsserver (206 + CORS verifierat). /ägare/repo/gren läses ur sidans URL.
const RAW_BAS = (() => {
  if (!/\.githack\.com$/.test(location.hostname)) return '';
  const p = location.pathname.split('/');   // ['', ägare, repo, …gren, 'glob.html']
  return p.length >= 4 ? 'https://raw.githubusercontent.com/' + p.slice(1, -1).join('/') + '/' : '';
})();
const dataUrl = f => RAW_BAS + f;
async function fetchJson(path) {
  const r = await fetch(dataUrl(path));
  if (!r.ok) throw new Error(path + ' → HTTP ' + r.status);
  return r.json();
}
// tile-arkivet är oförändrat sedan v2 — behåller sin version så mobiler
// slipper ladda om 45 MB i onödan
const TILE_URL = dataUrl('tiles/world.pmtiles?v=2');
let pmArchive = null;   // hela arkivet i minnet (fylls i bakgrunden)
let pmStream = null;    // strömmande instans tills nedladdningen är klar
let protocol = null;    // maplibre-pmtiles-protokollet (sätts i initMap)
function pmSource() {
  if (pmArchive) return pmArchive;
  if (!pmStream) pmStream = new pmtiles.PMTiles(TILE_URL);
  return pmStream;
}
// Hela arkivet (≈45 MB) hämtas i BAKGRUNDEN: spelet startar direkt med
// range requests (bara de rutor som syns laddas — en handfull för en
// region) och växlar till minnesversionen när nedladdningen är klar, så
// att globen sedan snurrar utan att rutor laddar i kanterna.
async function preloadTiles(onProgress) {
  try {
    const resp = await fetch(TILE_URL);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const total = +resp.headers.get('Content-Length') || 0;
    const reader = resp.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (total && onProgress) onProgress(got / total);
    }
    const buf = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { buf.set(c, o); o += c.length; }
    pmArchive = new pmtiles.PMTiles({
      getKey: () => TILE_URL,
      getBytes: async (offset, length) => ({ data: buf.buffer.slice(offset, offset + length) }),
    });
    if (protocol) protocol.add(pmArchive);   // efterföljande rutor tas ur minnet
  } catch (e) {
    console.warn('Bakgrundsladdningen misslyckades – fortsätter strömma.', e);
  }
}

async function loadRegions() {
  regionsGj = await fetchJson('assets/art-regions.json?v=' + V);
  for (const f of regionsGj.features) {
    featureByFilename.set(f.properties.key.split('/')[1], f);
    featureByGid.set(f.id, f);
  }
}

// Markörerna: badge-ländernas RIKTIGA former + alla länders mittpunkter.
// De överritade småstaternas bilder har inte landets form — när ett sådant
// land är täckt döljs bilden med havsfärg och man ser i stället den riktiga
// formen och en klickbar prick (ring för utspridda ö-nationer).
let markersGj = { type: 'FeatureCollection', features: [] };
let markerPts = [];             // {gid, lng, lat, omfang, spridd, _vis}
async function loadMarkers() {
  try {
    markersGj = await fetchJson('assets/art-markers.json?v=' + V);
    markerPts = markersGj.features
      .filter(f => f.geometry.type === 'Point')
      .map(f => ({ gid: f.id, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
                   omfang: f.properties.omfang, spridd: f.properties.spridd ? 1 : 0, _vis: null }));
  } catch (e) { console.warn('kunde inte läsa art-markers.json', e); }
}

// Cirkeln har FAST storlek på kartan (geografiskt förankrad — den zoomar
// med kartan i stället för att krympa relativt den), med en minsta
// skärmstorlek så den alltid syns och går att trycka på utzoomat.
const PRICK_GRAD = 0.35, RING_GRAD = 0.6;   // radie i grader (ring = spridd ö-nation)
const PRICK_MIN = 5, RING_MIN = 8;          // minsta skärmradie i px
function prickRadiePx(spridd, zoomPx) {
  // zoomPx = kartpixlar per grad vid aktuell zoom/skala
  return Math.max(spridd ? RING_MIN : PRICK_MIN,
                  (spridd ? RING_GRAD : PRICK_GRAD) * zoomPx);
}

const configCache = {};
async function loadRegionConfig(slug) {
  if (configCache[slug]) return configCache[slug];
  const raw = await fetchJson(`assets/${slug}/config.json?v=` + V);
  configCache[slug] = raw;
  return raw;
}

// Spelbara länder för en region: config-länder som har en klickyta
function buildCountries(slug, raw) {
  const out = [];
  for (const c of raw.countries) {
    const filename = c.filename || c.file.replace('countries/', '').replace('.webp', '');
    const f = featureByFilename.get(filename);
    if (!f) { console.warn('ingen klickyta:', slug, filename); continue; }
    out.push({
      name: c.name, filename, slug, gid: f.id,
      desc: c.desc || '', assoc: c.imageAssociation || '',
    });
  }
  return out;
}

// ══════════════════════════════════
// MapLibre-globen
// ══════════════════════════════════
function initMap() {
  protocol = new pmtiles.Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  if (pmArchive) protocol.add(pmArchive);

  map = new maplibregl.Map({
    container: 'spel-map',
    center: KAMERA.world.center,
    zoom: KAMERA.world.zoom,
    maxZoom: 9.5,
    clickTolerance: 10,
    doubleClickZoom: false,
    attributionControl: { compact: true },
    style: {
      version: 8,
      projection: { type: 'globe' },
      sources: {
        art: {
          type: 'raster',
          url: 'pmtiles://' + TILE_URL,
          // rutorna är 512 px men deklareras som 256: MapLibre hämtar då
          // en zoomnivå djupare rutor för samma vy — konsten blir skarp
          // redan utzoomat i stället för suddig fram till nästa nivå
          tileSize: 256,
          attribution: 'Illustrationer © Jonas · Gränser: Natural Earth',
        },
        borders: { type: 'geojson', data: dataUrl('assets/art-borders.json?v=' + V) },
        regioner: { type: 'geojson', data: regionsGj },
        markorer: { type: 'geojson', data: markersGj },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#0e2438' } },
        { id: 'art', type: 'raster', source: 'art', paint: { 'raster-resampling': 'linear' } },
        // täcket: badge-öar (bilden ligger i havet men har inte landets
        // form) döljs med HAVSFÄRG när de är täckta/gröna — den riktiga
        // formen och pricken nedanför visar var landet faktiskt finns
        { id: 'cover', type: 'fill', source: 'regioner',
          paint: {
            'fill-color': ['case',
              ['boolean', ['feature-state', 'fel'], false], ROD,
              ['boolean', ['feature-state', 'tips'], false], GUL,
              ['boolean', ['feature-state', 'hover'], false], GUL,
              ['all', ['==', ['get', 'badge'], 1], ['==', ['get', 'hav'], 1]], '#0e2438',
              ['boolean', ['feature-state', 'gron'], false], GRON,
              TACK],
            'fill-opacity': ['case',
              ['boolean', ['feature-state', 'fel'], false], 0.92,
              ['boolean', ['feature-state', 'tips'], false], 0.92,
              ['boolean', ['feature-state', 'hover'], false], 0.6,
              ['boolean', ['feature-state', 'gron'], false], 1,
              ['boolean', ['feature-state', 'tackt'], false], 1,
              0],
          } },
        // bildens antialiasing-frans (alfa < 128) ligger strax UTANFÖR
        // klickytan — en kantlinje i havsfärg sväljer den så inga
        // konturrester av den dolda bilden skymtar på havet
        { id: 'cover-kant', type: 'line', source: 'regioner',
          filter: ['all', ['==', ['get', 'badge'], 1], ['==', ['get', 'hav'], 1]],
          paint: {
            'line-color': '#0e2438',
            'line-width': 3,
            'line-opacity': ['case',
              ['any',
                ['boolean', ['feature-state', 'fel'], false],
                ['boolean', ['feature-state', 'tips'], false],
                ['boolean', ['feature-state', 'hover'], false]], 0,
              ['any',
                ['boolean', ['feature-state', 'tackt'], false],
                ['boolean', ['feature-state', 'gron'], false]], 1,
              0],
          },
          layout: { 'line-join': 'round' } },
        // badge-ländernas RIKTIGA Natural Earth-form: medan landet är
        // täckt syns BARA cirkeln — formen visas först när landet
        // avslöjats (och som grön geografi i den gröna omvärlden)
        { id: 'former', type: 'fill', source: 'markorer',
          filter: ['==', ['get', 'form'], 1],
          paint: {
            'fill-color': ['case',
              ['boolean', ['feature-state', 'gron'], false], '#45b45e',
              TACK],
            'fill-opacity': ['case',
              ['boolean', ['feature-state', 'gron'], false], 1,
              ['boolean', ['feature-state', 'tackt'], false], 0,
              1],
            'fill-outline-color': '#0a0a0a',
          } },
        // klickbar prick (ring för utspridda ö-nationer) på täckta
        // småländer. FAST storlek på kartan: radien växer exponentiellt
        // med zoomen (geografiskt förankrad), aldrig under minsta
        // skärmstorlek — utzoomat alltid synlig, inzoomat markerar den
        // landets faktiska område.
        { id: 'prickar', type: 'circle', source: 'markorer',
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-radius': ['interpolate', ['exponential', 2], ['zoom'],
              0, ['case', ['boolean', ['feature-state', 'tackt'], false],
                   ['case', ['==', ['get', 'spridd'], 1], 8, 5], 0],
              3.3, ['case', ['boolean', ['feature-state', 'tackt'], false],
                     ['case', ['==', ['get', 'spridd'], 1], 8.4, 5], 0],
              10, ['case', ['boolean', ['feature-state', 'tackt'], false],
                    ['case', ['==', ['get', 'spridd'], 1], 874, 510], 0]],
            'circle-color': ['case',
              ['boolean', ['feature-state', 'fel'], false], ROD,
              ['any', ['boolean', ['feature-state', 'tips'], false],
                      ['boolean', ['feature-state', 'hover'], false]], GUL,
              TACK],
            'circle-opacity': ['case', ['==', ['get', 'spridd'], 1], 0.25, 0.95],
            'circle-stroke-color': '#0a0a0a',
            'circle-stroke-width': ['case',
              ['boolean', ['feature-state', 'tackt'], false],
              ['case', ['==', ['get', 'spridd'], 1], 2.5, 1.5],
              0],
          } },
        { id: 'borders', type: 'line', source: 'borders',
          paint: { 'line-color': '#0a0a0a', 'line-width': 1.5,
            // badge-blobbarnas konturer (egna features, id = gid) släcks när
            // landet är täckt/grönt — bilden de ramar in är ju dold då
            'line-opacity': ['case',
              ['all', ['==', ['get', 'badge'], 1],
                ['any', ['boolean', ['feature-state', 'tackt'], false],
                        ['boolean', ['feature-state', 'gron'], false]]],
              0, 0.9] },
          layout: { 'line-join': 'round', 'line-cap': 'round' } },
      ],
    },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');

  let hoverGid = null;
  map.on('mousemove', e => {
    if (currentMode === 'seterra' && seterraTarget && !seterraLocked) {
      cursorLabel.style.left = e.originalEvent.clientX + 'px';
      cursorLabel.style.top = e.originalEvent.clientY + 'px';
    }
    const hits = map.queryRenderedFeatures(e.point, { layers: ['prickar', 'former', 'cover'] });
    const gid = hits.length ? hits[0].id : null;
    const c = gid !== null ? aktivByGid.get(gid) : null;
    const newHover = c && !revealed.has(gid) ? gid : null;
    if (newHover !== hoverGid) {
      if (hoverGid !== null) setLand(hoverGid, { hover: false });
      if (newHover !== null && !landState(newHover).fel) setLand(newHover, { hover: true });
      hoverGid = newHover;
    }
    map.getCanvas().style.cursor = gid !== null ? 'pointer' : '';
  });
  map.on('click', e => {
    const hits = map.queryRenderedFeatures(e.point, { layers: ['prickar', 'former', 'cover'] });
    if (!hits.length) return;
    handleMapClick(hits[0].id, e.originalEvent);
  });
  // tillstånd satta innan stilen laddat klart (snabbstart/trög proxy)
  // försvinner i setLands try-fångst — lägg på dem igen när stilen är klar
  map.on('load', () => {
    for (const [gid, t] of tillstand) {
      try {
        map.setFeatureState({ source: 'regioner', id: gid }, t);
        map.setFeatureState({ source: 'markorer', id: gid }, t);
        map.setFeatureState({ source: 'borders', id: gid }, t);
      } catch (e) { /* källa saknas ännu — hämtas när den laddat */ }
    }
  });
}

function handleMapClick(gid, ev) {
  const c = aktivByGid.get(gid);
  if (currentMode === 'explore') {
    if (c) exploreClick(c, ev);
    return;
  }
  // quiz: klick på land utanför spelet räknas också (man ser vad det var)
  if (c) seterraClick(c);
  else {
    const f = regionsGj.features.find(f2 => f2.id === gid);
    if (f) seterraClick({ name: f.properties.namn, filename: null, gid, desc: '', assoc: '', frammande: true });
  }
}

// ══════════════════════════════════
// Väggkartan (Robinson) — zoombar
// ══════════════════════════════════
const D2R = Math.PI / 180;
const MAXLAT = 85.051128779807 * D2R;
const RX = [1.0000,0.9986,0.9954,0.9900,0.9822,0.9730,0.9600,0.9427,0.9216,0.8962,0.8679,0.8350,0.7986,0.7597,0.7186,0.6732,0.6213,0.5722,0.5322];
const RY = [0.0000,0.0620,0.1240,0.1860,0.2480,0.3100,0.3720,0.4340,0.4958,0.5571,0.6176,0.6769,0.7346,0.7903,0.8435,0.8936,0.9394,0.9761,1.0000];
const lerpTab = (tab, t) => {
  const i = Math.min(17, Math.floor(t)), f = t - i;
  return tab[i] + (tab[i + 1] - tab[i]) * f;
};
const robinson = {
  forward(l, p) {
    const t = Math.abs(p) / D2R / 5;
    return [0.8487 * lerpTab(RX, t) * l, 1.3523 * lerpTab(RY, t) * Math.sign(p)];
  },
  inverse(x, y) {
    const Yv = Math.abs(y) / 1.3523;
    if (Yv > 1) return null;
    let lo = 0, hi = 18;
    while (hi - lo > 1e-6) {
      const mid = (lo + hi) / 2;
      if (lerpTab(RY, mid) < Yv) lo = mid; else hi = mid;
    }
    const t = (lo + hi) / 2;
    const p = t * 5 * D2R * Math.sign(y);
    const l = x / (0.8487 * lerpTab(RX, t));
    if (Math.abs(l) > Math.PI) return null;
    return [l, p];
  },
};

const flatCanvas = document.getElementById('flat-canvas');
const flatCtx = flatCanvas.getContext('2d');
let flatVisible = false;
const MOSZ = 3, MOS = 512 << MOSZ;
let mdata = null;                 // mercator-helmosaik (4096²)
let flatBase = null;              // senaste fullrenderade utsnittet (offscreen)
let flatBaseView = null;          // vyn {k,cx,cy,W,H} som flatBase gäller för
let flat = { xm: 1, ym: 1, W: 2, H: 2, k: 1, cx: 0, cy: 0 };
const FLAT_MAX = 16;
let borderFeats = [];           // {gid: 0 | badge-gid, lines}
let flatDirtyFlag = false;
let flatSeq = 0;                  // gör pågående asynkrona renderingar föråldrade
let flatTimer = null;
let patch = null;                 // högupplöst tile-utsnitt {z,tx0,ty0,W,H,data}

fetchJson('assets/art-borders.json?v=' + V)
  .then(gj => {
    borderFeats = gj.features.map(f => ({
      gid: f.properties && f.properties.badge ? f.properties.gid : 0,
      lines: f.geometry.coordinates,
    }));
    flatDirty();
  })
  .catch(() => {});

function flatDirty() {
  if (!flatVisible || flatDirtyFlag) return;
  flatDirtyFlag = true;
  requestAnimationFrame(() => { flatDirtyFlag = false; composeFlat(); });
}

async function loadMosaic() {
  if (mdata) return;
  const N = 1 << MOSZ, T = 512;
  const pm = pmSource();
  const mosaic = document.createElement('canvas');
  mosaic.width = MOS; mosaic.height = MOS;
  const mctx = mosaic.getContext('2d');
  const jobs = [];
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) {
      jobs.push(pm.getZxy(MOSZ, x, y).then(async t => {
        if (!t || !t.data) return;
        const img = await createImageBitmap(new Blob([t.data], { type: 'image/webp' }));
        mctx.drawImage(img, x * T, y * T);
      }).catch(() => {}));
    }
  }
  await Promise.all(jobs);
  mdata = mctx.getImageData(0, 0, MOS, MOS).data;
}

// ── vy-transformen: projektionskoordinater ↔ canvaspixlar ──
function flatScale() { return flat.W / (2 * flat.xm) * flat.k; }   // px per projenhet
function projToCanvas(x, y) {
  const s = flatScale();
  return [(x - flat.cx) * s + flat.W / 2, (flat.cy - y) * s + flat.H / 2];
}
function canvasToProj(px, py) {
  const s = flatScale();
  return [flat.cx + (px - flat.W / 2) / s, flat.cy - (py - flat.H / 2) / s];
}
function projPt(lng, lat) {
  const f = robinson.forward(lng * D2R, lat * D2R);
  return projToCanvas(f[0], f[1]);
}
function clampFlatView() {
  flat.k = Math.max(1, Math.min(FLAT_MAX, flat.k));
  const mx = flat.xm * (1 - 1 / flat.k), my = flat.ym * (1 - 1 / flat.k);
  flat.cx = Math.max(-mx, Math.min(mx, flat.cx));
  flat.cy = Math.max(-my, Math.min(my, flat.cy));
}

// Inzoomad vy samplar ett HÖGUPPLÖST tile-utsnitt (z4–z7) över det synliga
// området i stället för helmosaiken — annars blir väggkartan suddig när man
// zoomar. Utsnittet hämtas ur samma förladdade arkiv, max ~48 rutor.
async function ensurePatch(seq) {
  const zWant = MOSZ + Math.max(0, Math.floor(Math.log2(flat.k)));
  if (zWant <= MOSZ) { patch = null; return; }
  // synligt mercatorområde: sampla ett rutnät över canvasen
  let m0x = Infinity, m1x = -Infinity, m0y = Infinity, m1y = -Infinity, any = false;
  for (let iy = 0; iy <= 4; iy++) {
    for (let ix = 0; ix <= 4; ix++) {
      const pr = canvasToProj(flat.W * ix / 4, flat.H * iy / 4);
      const ll = robinson.inverse(pr[0], pr[1]);
      if (!ll) continue;
      any = true;
      const mx = ll[0] / (2 * Math.PI) + 0.5;
      const phi = Math.max(-MAXLAT, Math.min(MAXLAT, ll[1]));
      const my = 0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI);
      if (mx < m0x) m0x = mx; if (mx > m1x) m1x = mx;
      if (my < m0y) m0y = my; if (my > m1y) m1y = my;
    }
  }
  if (!any) { patch = null; return; }
  const marg = 0.03 / flat.k;
  for (let zs = Math.min(7, zWant); zs > MOSZ; zs--) {
    const n = 1 << zs;
    const tx0 = Math.max(0, Math.floor((m0x - marg) * n));
    const tx1 = Math.min(n - 1, Math.floor((m1x + marg) * n));
    const ty0 = Math.max(0, Math.floor((m0y - marg) * n));
    const ty1 = Math.min(n - 1, Math.floor((m1y + marg) * n));
    const txn = tx1 - tx0 + 1, tyn = ty1 - ty0 + 1;
    if (txn * tyn > 48) continue;                    // för stort — prova grövre z
    if (patch && patch.z === zs && patch.tx0 === tx0 && patch.ty0 === ty0 &&
        patch.W === txn * 512 && patch.H === tyn * 512) return;   // återanvänd
    const pm = pmSource();
    const c = document.createElement('canvas');
    c.width = txn * 512; c.height = tyn * 512;
    const cx2 = c.getContext('2d');
    const jobs = [];
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        jobs.push(pm.getZxy(zs, tx, ty).then(async t => {
          if (!t || !t.data) return;
          const img = await createImageBitmap(new Blob([t.data], { type: 'image/webp' }));
          cx2.drawImage(img, (tx - tx0) * 512, (ty - ty0) * 512);
        }).catch(() => {}));
      }
    }
    await Promise.all(jobs);
    if (seq !== flatSeq) return;                     // vyn hann ändras
    patch = { z: zs, tx0, ty0, W: c.width, H: c.height,
              data: cx2.getImageData(0, 0, c.width, c.height).data };
    return;
  }
  patch = null;
}

// bas-varpen (dyr) renderas per vy; tillstånden komponeras ovanpå varje gång
async function renderFlatBase() {
  const seq = ++flatSeq;
  let xm = 0, ym = 0;
  for (let p = -90; p <= 90; p += 0.5) {
    const [x, y] = robinson.forward(Math.PI, p * D2R);
    xm = Math.max(xm, Math.abs(x)); ym = Math.max(ym, Math.abs(y));
  }
  const r = mapPanel.getBoundingClientRect();
  const availW = r.width - 16, availH = r.height - 16;
  let W = Math.min(1600, Math.max(320, availW));
  let H = Math.round(W * ym / xm);
  if (H > availH) { H = Math.max(200, availH); W = Math.round(H * xm / ym); }
  flat.xm = xm; flat.ym = ym; flat.W = W; flat.H = H;
  clampFlatView();
  await ensurePatch(seq);
  if (seq !== flatSeq) return;
  const base = document.createElement('canvas');
  base.width = W; base.height = H;
  const bctx = base.getContext('2d');
  const id = bctx.createImageData(W, H);
  const out = id.data;
  const p2 = patch, pScale = p2 ? 512 << p2.z : 0;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const pr = canvasToProj(px + 0.5, py + 0.5);
      const ll = robinson.inverse(pr[0], pr[1]);
      if (!ll) continue;
      const o = (py * W + px) * 4;
      const m01x = ll[0] / (2 * Math.PI) + 0.5;
      const phi = Math.max(-MAXLAT, Math.min(MAXLAT, ll[1]));
      const m01y = 0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI);
      // högupplösta utsnittet om pixeln täcks av det, annars helmosaiken
      let data = mdata, SW = MOS, SH = MOS;
      let mx = m01x * MOS - 0.5, my = m01y * MOS - 0.5;
      if (p2) {
        const hx = m01x * pScale - p2.tx0 * 512 - 0.5;
        const hy = m01y * pScale - p2.ty0 * 512 - 0.5;
        if (hx >= -0.5 && hy >= -0.5 && hx <= p2.W - 0.5 && hy <= p2.H - 0.5) {
          data = p2.data; SW = p2.W; SH = p2.H; mx = hx; my = hy;
        }
      }
      const fx = Math.floor(mx), fy = Math.floor(my);
      let r2 = 0, g2 = 0, b2 = 0, a2 = 0;
      for (let t = 0; t < 4; t++) {
        const tx2 = Math.min(SW - 1, Math.max(0, fx + (t & 1)));
        const ty2 = Math.min(SH - 1, Math.max(0, fy + (t >> 1)));
        const w = (t & 1 ? mx - fx : 1 - (mx - fx)) * (t >> 1 ? my - fy : 1 - (my - fy));
        const si = (ty2 * SW + tx2) * 4;
        const wa = w * data[si + 3] / 255;
        r2 += data[si] * wa; g2 += data[si + 1] * wa; b2 += data[si + 2] * wa;
        a2 += wa;
      }
      out[o] = r2 + 205 * (1 - a2);
      out[o + 1] = g2 + 228 * (1 - a2);
      out[o + 2] = b2 + 246 * (1 - a2);
      out[o + 3] = 255;
    }
  }
  bctx.putImageData(id, 0, 0);
  flatBase = base;
  flatBaseView = { k: flat.k, cx: flat.cx, cy: flat.cy, W, H };
}

function scheduleFlatRender() {
  clearTimeout(flatTimer);
  flatTimer = setTimeout(async () => {
    await renderFlatBase();
    composeFlat();
  }, 160);
}

function updateZoomLabel() {
  const el = document.getElementById('zoom-level');
  if (mapPanel.classList.contains('orig')) el.textContent = Math.round(origZoom * 100) + '%';
  else el.textContent = Math.round(flat.k * 100) + '%';
}

// zooma mot en canvaspunkt: punkten under pekaren står stilla
function flatZoomTo(newK, px, py) {
  const before = canvasToProj(px, py);
  flat.k = Math.max(1, Math.min(FLAT_MAX, newK));
  const after = canvasToProj(px, py);
  flat.cx += before[0] - after[0];
  flat.cy += before[1] - after[1];
  clampFlatView();
  updateZoomLabel();
  composeFlat();
  scheduleFlatRender();
}

function traceFeature(ctx, f) {
  ctx.beginPath();
  for (const poly of f.geometry.coordinates) {
    for (const ring of poly) {
      ring.forEach(([lng, lat], i) => {
        const [px, py] = projPt(lng, lat);
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      });
      ctx.closePath();
    }
  }
}

function composeFlat() {
  if (!flatBase || !regionsGj) return;
  flatCanvas.width = flat.W; flatCanvas.height = flat.H;
  flatCtx.fillStyle = '#0e2438';
  flatCtx.fillRect(0, 0, flat.W, flat.H);
  // rita basen transformerad från vyn den renderades för till den aktuella
  // vyn — under en pågående gest är det en billig förhandsvisning, efter
  // omrenderingen är transformen identitet och bilden knivskarp
  const s = flatScale();
  const sb = flatBaseView.W / (2 * flat.xm) * flatBaseView.k;
  const sc = s / sb;
  const ox = (flatBaseView.cx - flat.cx) * s + flat.W / 2 - sc * flatBaseView.W / 2;
  const oy = (flat.cy - flatBaseView.cy) * s + flat.H / 2 - sc * flatBaseView.H / 2;
  flatCtx.drawImage(flatBase, ox, oy, flatBaseView.W * sc, flatBaseView.H * sc);
  const SJO = 'rgb(205,228,246)';        // väggkartans havston
  for (const f of regionsGj.features) {
    const t = landState(f.id);
    const havBadge = f.properties.badge === 1 && f.properties.hav === 1;
    let color = null, alpha = 1;
    if (t.fel) { color = ROD; alpha = 0.92; }
    else if (t.tips) { color = GUL; alpha = 0.92; }
    else if (t.hover) { color = GUL; alpha = 0.6; }
    else if (t.gron) color = havBadge ? SJO : GRON;
    else if (t.tackt) color = havBadge ? SJO : TACK;
    if (!color) continue;
    flatCtx.globalAlpha = alpha;
    flatCtx.fillStyle = color;
    traceFeature(flatCtx, f);
    flatCtx.fill('evenodd');
    if (havBadge && !t.fel && !t.tips && !t.hover) {
      // svälj bildens antialiasing-frans strax utanför klickytan
      flatCtx.strokeStyle = color;
      flatCtx.lineWidth = 3;
      flatCtx.lineJoin = 'round';
      flatCtx.stroke();
    }
  }
  flatCtx.globalAlpha = 1;
  // badge-ländernas riktiga former: medan landet är täckt syns BARA
  // cirkeln — formen ritas först när landet avslöjats (grön i den gröna
  // omvärlden, papper med kontur efter avslöjande)
  for (const f of markersGj.features) {
    if (f.properties.form !== 1) continue;
    const t = landState(f.id);
    let color = null;
    const alpha = 1;
    if (t.gron) color = '#45b45e';
    else if (!t.tackt) color = TACK;
    if (!color) continue;
    flatCtx.globalAlpha = alpha;
    flatCtx.fillStyle = color;
    traceFeature(flatCtx, f);
    flatCtx.fill('evenodd');
    flatCtx.globalAlpha = 1;
    flatCtx.lineWidth = 1;
    flatCtx.strokeStyle = '#0a0a0a';
    flatCtx.stroke();
  }
  // klickbara prickar/ringar på täckta småländer — fast storlek på
  // kartan (zoomar med), aldrig mindre än minsta skärmradien
  const pxPerDeg = flatScale() * 0.8487 * Math.PI / 180;
  for (const m of markerPts) {
    const t = landState(m.gid);
    if (!t.tackt) continue;
    const rr = prickRadiePx(m.spridd, pxPerDeg);
    const [mx, my] = projPt(m.lng, m.lat);
    if (mx < -rr - 20 || mx > flat.W + rr + 20 || my < -rr - 20 || my > flat.H + rr + 20) continue;
    flatCtx.beginPath();
    flatCtx.arc(mx, my, rr, 0, Math.PI * 2);
    flatCtx.globalAlpha = m.spridd ? 0.25 : 0.95;
    flatCtx.fillStyle = t.fel ? ROD : (t.tips || t.hover) ? GUL : TACK;
    flatCtx.fill();
    flatCtx.globalAlpha = 1;
    flatCtx.lineWidth = m.spridd ? 2.5 : 1.5;
    flatCtx.strokeStyle = '#0a0a0a';
    flatCtx.stroke();
  }
  if (borderFeats.length) {
    flatCtx.strokeStyle = '#0a0a0a';
    flatCtx.lineWidth = 1.5;
    flatCtx.lineJoin = 'round';
    flatCtx.lineCap = 'round';
    flatCtx.beginPath();
    for (const bf of borderFeats) {
      if (bf.gid) {
        // badge-blobbens kontur ritas bara när bilden faktiskt syns
        const t = landState(bf.gid);
        if (t.tackt || t.gron) continue;
      }
      for (const line of bf.lines) {
        let prev = null;
        for (const [lng, lat] of line) {
          const [px, py] = projPt(lng, lat);
          if (prev !== null && Math.abs(px - prev) > flat.W / 2) { flatCtx.moveTo(px, py); prev = px; continue; }
          if (prev === null) flatCtx.moveTo(px, py); else flatCtx.lineTo(px, py);
          prev = px;
        }
      }
    }
    flatCtx.stroke();
  }
}

function flatHit(ev) {
  const r = flatCanvas.getBoundingClientRect();
  const px = (ev.clientX - r.left) * flatCanvas.width / r.width;
  const py = (ev.clientY - r.top) * flatCanvas.height / r.height;
  const pr = canvasToProj(px, py);
  const ll = robinson.inverse(pr[0], pr[1]);
  if (!ll) return null;
  // prickarna testas FÖRST: de indikerar länder som är för små att träffa
  // på landmassan (Vatikanens prick ligger t.ex. ovanpå Italiens yta)
  const pxPerDeg = flatScale() * 0.8487 * Math.PI / 180;
  for (const m of markerPts) {
    const t = landState(m.gid);
    if (!t.tackt) continue;
    const [mx, my] = projPt(m.lng, m.lat);
    if (Math.hypot(mx - px, my - py) <= prickRadiePx(m.spridd, pxPerDeg) + 4) {
      return featureByGid.get(m.gid) || null;
    }
  }
  const lng = ll[0] / D2R, lat = ll[1] / D2R;
  for (const f of regionsGj.features) {
    let inside = false;
    for (const poly of f.geometry.coordinates) {
      for (const ring of poly) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
          if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
        }
      }
    }
    if (inside) return f;
  }
  return null;
}

// ── väggkartans gester: dra = panorera, hjul/nyp = zooma, stillaklick = spel ──
// Nypzoomen går HELT via pointer events (två aktiva pekare) i stället för
// touch events — en och samma kodväg i alla webbläsare, även iOS Safari.
const fPtrs = new Map();          // pointerId → {x, y}
let fDrag = null, fPinch = null;
let flatHoverGid = null, flatHoverRaf = false;
flatCanvas.addEventListener('pointerdown', ev => {
  if (ev.pointerType === 'mouse' && ev.button !== 0) return;
  ev.preventDefault();
  flatCanvas.setPointerCapture(ev.pointerId);
  fPtrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (fPtrs.size === 2) {
    const [a, b] = [...fPtrs.values()];
    fPinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k0: flat.k };
    fDrag = null;
    flatCanvas.classList.add('dragging');
  } else if (fPtrs.size === 1) {
    // riktiga fingrar darrar flera pixlar under ett tryck — med för snäv
    // tröskel tolkas trycket som en dragning och klicket sväljs
    fDrag = { id: ev.pointerId, sx: ev.clientX, sy: ev.clientY,
              cx0: flat.cx, cy0: flat.cy, moved: false,
              tol: ev.pointerType === 'touch' ? 12 : 4 };
  } else {
    fDrag = null;
  }
});
flatCanvas.addEventListener('pointermove', ev => {
  if (currentMode === 'seterra' && seterraTarget && !seterraLocked) {
    cursorLabel.style.left = ev.clientX + 'px';
    cursorLabel.style.top = ev.clientY + 'px';
  }
  const p = fPtrs.get(ev.pointerId);
  if (p) { p.x = ev.clientX; p.y = ev.clientY; }
  if (fPinch && fPtrs.size >= 2) {
    const [a, b] = [...fPtrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > 0 && fPinch.d > 0) {
      const r = flatCanvas.getBoundingClientRect();
      flatZoomTo(fPinch.k0 * d / fPinch.d,
        ((a.x + b.x) / 2 - r.left) * flat.W / r.width,
        ((a.y + b.y) / 2 - r.top) * flat.H / r.height);
    }
    return;
  }
  if (fDrag && ev.pointerId === fDrag.id) {
    const dx = ev.clientX - fDrag.sx, dy = ev.clientY - fDrag.sy;
    if (Math.abs(dx) > fDrag.tol || Math.abs(dy) > fDrag.tol) {
      fDrag.moved = true;
      flatCanvas.classList.add('dragging');
    }
    if (fDrag.moved) {
      const r = flatCanvas.getBoundingClientRect();
      const s = flatScale() * (r.width / flat.W);   // skärm-px per projenhet
      flat.cx = fDrag.cx0 - dx / s;
      flat.cy = fDrag.cy0 + dy / s;
      clampFlatView();
      composeFlat();
      scheduleFlatRender();
    }
    return;
  }
  if (flatHoverRaf) return;
  flatHoverRaf = true;
  requestAnimationFrame(() => {
    flatHoverRaf = false;
    const f = flatHit(ev);
    const gid = f && aktivByGid.has(f.id) && !revealed.has(f.id) ? f.id : null;
    if (gid !== flatHoverGid) {
      if (flatHoverGid !== null) setLand(flatHoverGid, { hover: false });
      if (gid !== null && !landState(gid).fel) setLand(gid, { hover: true });
      flatHoverGid = gid;
    }
  });
});
function flatPointerEnd(ev) {
  fPtrs.delete(ev.pointerId);
  if (fPinch) {
    if (fPtrs.size < 2) {
      fPinch = null;
      if (!fPtrs.size) flatCanvas.classList.remove('dragging');
    }
    return;
  }
  if (!fDrag || ev.pointerId !== fDrag.id) return;
  const moved = fDrag.moved;
  fDrag = null;
  flatCanvas.classList.remove('dragging');
  if (moved || ev.type === 'pointercancel') return;
  const f = flatHit(ev);
  if (f) handleMapClick(f.id, ev);
}
flatCanvas.addEventListener('pointerup', flatPointerEnd);
flatCanvas.addEventListener('pointercancel', flatPointerEnd);
flatCanvas.addEventListener('wheel', ev => {
  ev.preventDefault();
  const r = flatCanvas.getBoundingClientRect();
  const px = (ev.clientX - r.left) * flat.W / r.width;
  const py = (ev.clientY - r.top) * flat.H / r.height;
  flatZoomTo(flat.k * (ev.deltaY > 0 ? 0.9 : 1.1), px, py);
}, { passive: false });

// ══════════════════════════════════
// Originalkartan — regionens handritade karta precis som originalsidan:
// map.webp + landbilderna på sina composition-koordinater, alfa-träffytor,
// gula hover-bilder klippta vid gränserna, specialformer och zoom/panorering.
// Drivs av samma speltillstånd som globen och väggkartan.
// ══════════════════════════════════
const origWrap = document.getElementById('orig-wrap');
const origWrapper = document.getElementById('orig-wrapper');
const origBase = document.getElementById('orig-base');
let origInit = false, origLoading = false;
let origSlug = null, origRaw = null;
let ORIG = { L: 0, T: 0, W: 1, H: 1 };
const origOverlayEls = {}, origHoverEls = {}, origMarkerEls = {};
const origHitData = {}, origShapes = {};
let origSorted = [];
let aktivByFile = new Map();      // filnamn → aktivt land (för klick/hover)
let origZoom = 1, origPanX = 0, origPanY = 0;
const ORIG_MIN = 0.5, ORIG_MAX = 5;

function origApplyTransform() {
  origWrapper.style.transform = `translate(${origPanX}px, ${origPanY}px) scale(${origZoom})`;
  updateZoomLabel();
}
function origClampPan() {
  const bw = origBase.offsetWidth, bh = origBase.offsetHeight;
  const pw = origWrap.clientWidth, ph = origWrap.clientHeight;
  const maxX = Math.max(0, (bw * origZoom - pw) / 2 + pw * 0.5);
  const maxY = Math.max(0, (bh * origZoom - ph) / 2 + ph * 0.5);
  origPanX = Math.max(-maxX, Math.min(maxX, origPanX));
  origPanY = Math.max(-maxY, Math.min(maxY, origPanY));
}
function origSetZoom(nz, cursorX, cursorY) {
  const oz = origZoom;
  origZoom = Math.max(ORIG_MIN, Math.min(ORIG_MAX, nz));
  if (origZoom === oz) return;
  if (cursorX !== undefined) {
    const r = origWrap.getBoundingClientRect();
    const px = cursorX - r.left - r.width / 2, py = cursorY - r.top - r.height / 2;
    origPanX = px - ((px - origPanX) / oz) * origZoom;
    origPanY = py - ((py - origPanY) / oz) * origZoom;
  }
  origClampPan();
  origApplyTransform();
}

async function initOrig() {
  const slug = origSlug, raw = origRaw;
  origBase.src = `assets/${slug}/map.webp`;
  await new Promise(res => {
    if (origBase.complete && origBase.naturalWidth > 0) res();
    else { origBase.onload = res; origBase.onerror = res; }
  });
  ORIG = { L: raw.mapOffset.left, T: raw.mapOffset.top, W: raw.mapWidth, H: raw.mapHeight };
  for (const [key, sh] of Object.entries(raw.specialShapes || {})) {
    origShapes[key] = { file: `assets/${slug}/${sh.file}`, left: sh.left, top: sh.top,
      width: sh.width, height: sh.height, hitOnly: !!sh.hitOnly, data: null, canvas: null };
  }
  const list = raw.countries.map(c => ({
    name: c.name,
    filename: c.filename || c.file.replace('countries/', '').replace('.webp', ''),
    left: c.left, top: c.top, width: c.width, height: c.height,
  }));
  origSorted = [...list].sort((a, b) => a.width * a.height - b.width * b.height);
  for (const c of list) {
    const img = document.createElement('img');
    img.className = 'country-overlay';
    img.src = `assets/${slug}/countries/${c.filename}.webp`;
    img.draggable = false;
    origWrapper.appendChild(img);
    origOverlayEls[c.filename] = img;
    const sh = origShapes[c.filename];
    if (sh && sh.hitOnly) {
      const marker = document.createElement('div');
      marker.className = 'hit-marker';
      origWrapper.appendChild(marker);
      origMarkerEls[c.filename] = marker;
    } else {
      const hover = document.createElement('img');
      hover.className = 'hover-highlight';
      hover.draggable = false;
      origWrapper.appendChild(hover);
      origHoverEls[c.filename] = hover;
    }
  }
  // konturöverlägg överst, om regionen har ett
  const ov = document.createElement('img');
  ov.className = 'map-overlay';
  ov.id = 'orig-overlay';
  ov.draggable = false;
  ov.style.display = 'none';
  ov.onload = () => { ov.style.display = ''; origPosition(); };
  ov.onerror = () => ov.remove();
  ov.src = `assets/${slug}/overlay.webp`;
  origWrapper.appendChild(ov);

  // träffdata: alfakanalen i varje landbild (och specialform). Stora länder
  // samplas i HALV upplösning — träffsäkerheten påverkas inte märkbart, men
  // fullupplösta ImageData-buffertar för alla länder samtidigt kan spränga
  // mobilens canvas-minne. Små länder behåller full precision.
  const loadImg = src => new Promise(res => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });
  const hitScale = (w, h) => (w * h > 1000000 ? 2 : 1);
  await Promise.all([
    ...list.map(async c => {
      const i = await loadImg(`assets/${slug}/countries/${c.filename}.webp`);
      if (!i) return;
      const s = hitScale(c.width, c.height);
      const w = Math.max(1, Math.round(c.width / s)), h = Math.max(1, Math.round(c.height / s));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const cx2 = cv.getContext('2d');
      cx2.drawImage(i, 0, 0, w, h);
      origHitData[c.filename] = { data: cx2.getImageData(0, 0, w, h).data, w, h, s, canvas: cv };
    }),
    ...Object.values(origShapes).map(async sh => {
      const i = await loadImg(sh.file);
      if (!i) return;
      const s = hitScale(sh.width, sh.height);
      const w = Math.max(1, Math.round(sh.width / s)), h = Math.max(1, Math.round(sh.height / s));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const cx2 = cv.getContext('2d');
      cx2.drawImage(i, 0, 0, w, h);
      sh.data = cx2.getImageData(0, 0, w, h).data;
      sh.w = w; sh.h = h; sh.s = s;
      sh.canvas = cv;
    }),
  ]);
  origHoverImages(list);
  origPosition();
  for (const [gid, t] of tillstand) origApplyState(gid, t);
  origInit = true;
}

// gula hover-bilder: landbilden tonad gul, klippt vid baskartans konturer.
// Gränsmasken byggs i HALV upplösning (en fjärdedels minne — mobilen) och
// hover-bilderna genereras i träffdatans skala; CSS sträcker upp dem.
function origHoverImages(list) {
  const HR = 255, HG = 220, HB = 50, TH = 150;
  const MW = Math.max(1, ORIG.W >> 1), MH = Math.max(1, ORIG.H >> 1);
  const mc = document.createElement('canvas');
  mc.width = MW; mc.height = MH;
  const mctx = mc.getContext('2d');
  mctx.drawImage(origBase, 0, 0, MW, MH);
  const md = mctx.getImageData(0, 0, MW, MH).data;
  const raw = new Uint8Array(MW * MH);
  for (let i = 0; i < MW * MH; i++) {
    const mi = i * 4;
    const b = (md[mi] + md[mi + 1] + md[mi + 2]) / 3;
    if (b < TH || md[mi + 3] < 128) raw[i] = 1;
  }
  const border = new Uint8Array(raw);
  for (let y = 0; y < MH; y++) {
    for (let x = 0; x < MW; x++) {
      const i = y * MW + x;
      if (border[i]) continue;
      if ((x > 0 && raw[i - 1]) || (x < MW - 1 && raw[i + 1]) ||
          (y > 0 && raw[i - MW]) || (y < MH - 1 && raw[i + MW])) border[i] = 1;
    }
  }
  for (const c of list) {
    const sh = origShapes[c.filename];
    if (sh && sh.hitOnly) continue;
    let hd, L, T, FW, FH;
    if (sh && sh.canvas) { hd = sh; L = sh.left; T = sh.top; FW = sh.width; FH = sh.height; }
    else {
      hd = origHitData[c.filename];
      if (!hd || !hd.canvas) continue;
      L = c.left; T = c.top; FW = c.width; FH = c.height;
    }
    const s = hd.s || 1, W2 = hd.w, H2 = hd.h;
    const cv = document.createElement('canvas');
    cv.width = W2; cv.height = H2;
    const cx2 = cv.getContext('2d');
    cx2.drawImage(hd.canvas, 0, 0);
    const pix = cx2.getImageData(0, 0, W2, H2);
    const d = pix.data;
    const sx = L - ORIG.L, sy = T - ORIG.T;
    for (let y = 0; y < H2; y++) {
      for (let x = 0; x < W2; x++) {
        const mx = (sx + x * s) >> 1, my = (sy + y * s) >> 1;
        const ci = (y * W2 + x) * 4;
        if (mx < 0 || mx >= MW || my < 0 || my >= MH || border[my * MW + mx]) {
          d[ci + 3] = 0;
        } else if (d[ci + 3] > 0) {
          d[ci] = HR; d[ci + 1] = HG; d[ci + 2] = HB;
        }
      }
    }
    cx2.putImageData(pix, 0, 0);
    const el = origHoverEls[c.filename];
    if (el) { el.src = cv.toDataURL(); el._rect = { L, T, W: FW, H: FH }; }
  }
}

function origPosition() {
  if (!origBase.naturalWidth) return;
  const mapRect = origBase.getBoundingClientRect();
  const wrapRect = origWrapper.getBoundingClientRect();
  // rektanglarna är lästa GENOM wrapper-transformen — dela bort zoomen,
  // stilarna sätts i wrapperns otransformerade koordinater
  const scale = mapRect.width / origZoom / ORIG.W;
  const offX = (mapRect.left - wrapRect.left) / origZoom;
  const offY = (mapRect.top - wrapRect.top) / origZoom;
  const place = (el, l, t, w, h) => {
    el.style.left = (offX + (l - ORIG.L) * scale) + 'px';
    el.style.top = (offY + (t - ORIG.T) * scale) + 'px';
    el.style.width = (w * scale) + 'px';
    el.style.height = (h * scale) + 'px';
  };
  for (const c of origSorted) {
    const el = origOverlayEls[c.filename];
    if (el) place(el, c.left, c.top, c.width, c.height);
    const hv = origHoverEls[c.filename];
    if (hv && hv._rect) place(hv, hv._rect.L, hv._rect.T, hv._rect.W, hv._rect.H);
    else if (hv) place(hv, c.left, c.top, c.width, c.height);
    const mk = origMarkerEls[c.filename];
    if (mk) {
      const sh = origShapes[c.filename];
      mk.style.left = (offX + (sh.left + sh.width / 2 - ORIG.L) * scale) + 'px';
      mk.style.top = (offY + (sh.top + sh.height / 2 - ORIG.T) * scale) + 'px';
    }
  }
  const ov = document.getElementById('orig-overlay');
  if (ov) {
    ov.style.left = offX + 'px';
    ov.style.top = offY + 'px';
    ov.style.width = (mapRect.width / origZoom) + 'px';
    ov.style.height = (mapRect.height / origZoom) + 'px';
  }
}

function origHitTest(clientX, clientY) {
  const mapRect = origBase.getBoundingClientRect();
  if (!mapRect.width) return null;
  const sc = ORIG.W / mapRect.width;          // skärm-px → kartpixlar (zoom ingår)
  const mapX = (clientX - mapRect.left) * sc + ORIG.L;
  const mapY = (clientY - mapRect.top) * sc + ORIG.T;
  for (const c of origSorted) {
    const sh = origShapes[c.filename];
    if (sh) {
      if (!sh.data) continue;
      const lx = Math.floor((mapX - sh.left) / sh.s), ly = Math.floor((mapY - sh.top) / sh.s);
      if (lx < 0 || ly < 0 || lx >= sh.w || ly >= sh.h) continue;
      if (sh.data[(ly * sh.w + lx) * 4 + 3] > 30) return c;
    } else {
      const hd = origHitData[c.filename];
      if (!hd) continue;
      const lx = Math.floor((mapX - c.left) / hd.s), ly = Math.floor((mapY - c.top) / hd.s);
      if (lx < 0 || ly < 0 || lx >= hd.w || ly >= hd.h) continue;
      if (hd.data[(ly * hd.w + lx) * 4 + 3] > 30) return c;
    }
  }
  return null;
}

// spegla speltillståndet till originalvyns element
function origApplyState(gid, t) {
  const a = aktivByGid.get(gid);
  if (!a) return;
  const el = origOverlayEls[a.filename];
  if (!el) return;
  if (t.fel) el.classList.add('visible', 'flash-wrong');
  else {
    el.classList.remove('flash-wrong');
    el.classList.toggle('visible', !t.tackt);
  }
  const glow = !t.fel && !!t.tackt && (!!t.hover || !!t.tips);
  const hv = origHoverEls[a.filename];
  if (hv) hv.classList.toggle('active', glow);
  const mk = origMarkerEls[a.filename];
  if (mk) mk.classList.toggle('active', glow);
}

// gester: dra = panorera, hjul/nyp = zooma, stillaklick = spel — nypzoomen
// via pointer events (två aktiva pekare), samma kodväg även på iOS Safari
const oPtrs = new Map();          // pointerId → {x, y}
let oDrag = null, oPinch = null, origHoverFile = null, origHoverRaf = false;
origWrap.addEventListener('pointerdown', ev => {
  if (ev.pointerType === 'mouse' && ev.button !== 0) return;
  if (ev.target.closest('.zoom-controls') || ev.target.closest('.view-toggle') ||
      ev.target.closest('.explore-toggle-buttons')) return;
  ev.preventDefault();
  origWrap.setPointerCapture(ev.pointerId);
  oPtrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (oPtrs.size === 2) {
    const [a, b] = [...oPtrs.values()];
    oPinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z0: origZoom };
    oDrag = null;
    origWrapper.classList.add('dragging');
  } else if (oPtrs.size === 1) {
    oDrag = { id: ev.pointerId, sx: ev.clientX, sy: ev.clientY,
              px0: origPanX, py0: origPanY, moved: false,
              tol: ev.pointerType === 'touch' ? 12 : 4 };
    origWrapper.classList.add('dragging');
  } else {
    oDrag = null;
  }
});
origWrap.addEventListener('pointermove', ev => {
  if (currentMode === 'seterra' && seterraTarget && !seterraLocked) {
    cursorLabel.style.left = ev.clientX + 'px';
    cursorLabel.style.top = ev.clientY + 'px';
  }
  const p = oPtrs.get(ev.pointerId);
  if (p) { p.x = ev.clientX; p.y = ev.clientY; }
  if (oPinch && oPtrs.size >= 2) {
    const [a, b] = [...oPtrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > 0 && oPinch.d > 0) {
      origSetZoom(oPinch.z0 * d / oPinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
    return;
  }
  if (oDrag && ev.pointerId === oDrag.id) {
    const dx = ev.clientX - oDrag.sx, dy = ev.clientY - oDrag.sy;
    if (Math.abs(dx) > oDrag.tol || Math.abs(dy) > oDrag.tol) oDrag.moved = true;
    if (oDrag.moved) {
      origPanX = oDrag.px0 + dx;
      origPanY = oDrag.py0 + dy;
      origClampPan();
      origApplyTransform();
    }
    return;
  }
  if (origHoverRaf) return;
  origHoverRaf = true;
  requestAnimationFrame(() => {
    origHoverRaf = false;
    const hit = origHitTest(ev.clientX, ev.clientY);
    const a = hit ? aktivByFile.get(hit.filename) : null;
    const file = a && !revealed.has(a.gid) ? hit.filename : null;
    if (file !== origHoverFile) {
      if (origHoverFile) {
        const prev = aktivByFile.get(origHoverFile);
        if (prev) setLand(prev.gid, { hover: false });
      }
      if (file && !landState(a.gid).fel) setLand(a.gid, { hover: true });
      origHoverFile = file;
    }
    origWrap.style.cursor = hit && a ? 'pointer' : '';
  });
});
function origPointerEnd(ev) {
  oPtrs.delete(ev.pointerId);
  if (oPinch) {
    if (oPtrs.size < 2) {
      oPinch = null;
      if (!oPtrs.size) origWrapper.classList.remove('dragging');
    }
    return;
  }
  if (!oPtrs.size) origWrapper.classList.remove('dragging');
  if (!oDrag || ev.pointerId !== oDrag.id) return;
  const moved = oDrag.moved;
  oDrag = null;
  if (moved || ev.type === 'pointercancel') return;
  const hit = origHitTest(ev.clientX, ev.clientY);
  const a = hit ? aktivByFile.get(hit.filename) : null;
  if (a) handleMapClick(a.gid, ev);
}
origWrap.addEventListener('pointerup', origPointerEnd);
origWrap.addEventListener('pointercancel', origPointerEnd);
origWrap.addEventListener('wheel', ev => {
  ev.preventDefault();
  origSetZoom(origZoom * (ev.deltaY > 0 ? 0.9 : 1.1), ev.clientX, ev.clientY);
}, { passive: false });

// ══════════════════════════════════
// Vyväxling: glob / väggkarta / original
// ══════════════════════════════════
let aktivVy = 'glob';
async function setView(vy) {
  if (vy === 'orig' && !origSlug) vy = 'glob';   // världstestet saknar originalkarta
  aktivVy = vy;
  document.getElementById('view-glob').classList.toggle('active', vy === 'glob');
  document.getElementById('view-platt').classList.toggle('active', vy === 'platt');
  document.getElementById('view-orig').classList.toggle('active', vy === 'orig');
  mapPanel.classList.toggle('platt', vy === 'platt');
  mapPanel.classList.toggle('orig', vy === 'orig');
  flatVisible = vy === 'platt';
  const load = document.getElementById('spel-load');
  if (vy === 'platt') {
    if (!mdata) {
      load.style.display = '';
      document.getElementById('spel-load-txt').textContent = 'Bygger väggkartan …';
      await loadMosaic();
      await renderFlatBase();
      load.style.display = 'none';
    } else if (!flatBase) {
      await renderFlatBase();
    }
    composeFlat();
  } else if (vy === 'orig' && !origInit && !origLoading) {
    origLoading = true;
    load.style.display = '';
    document.getElementById('spel-load-txt').textContent = 'Laddar originalkartan …';
    try {
      await initOrig();
    } catch (e) {
      // visa åtminstone baskartan i stället för att fastna på spinnern
      console.warn('originalkartan kunde inte laddas helt', e);
    } finally {
      load.style.display = 'none';
      origLoading = false;
    }
  }
  updateZoomLabel();
}
document.getElementById('view-glob').addEventListener('click', () => setView('glob'));
document.getElementById('view-platt').addEventListener('click', () => setView('platt'));
document.getElementById('view-orig').addEventListener('click', () => setView('orig'));
document.getElementById('zoom-in').addEventListener('click', () => {
  if (aktivVy === 'orig') origSetZoom(origZoom * 1.3);
  else if (aktivVy === 'platt') flatZoomTo(flat.k * 1.3, flat.W / 2, flat.H / 2);
});
document.getElementById('zoom-out').addEventListener('click', () => {
  if (aktivVy === 'orig') origSetZoom(origZoom / 1.3);
  else if (aktivVy === 'platt') flatZoomTo(flat.k / 1.3, flat.W / 2, flat.H / 2);
});
window.addEventListener('resize', () => {
  if (flatVisible && mdata) renderFlatBase().then(composeFlat);
  if (origInit) { origPosition(); origClampPan(); origApplyTransform(); }
});

// ══════════════════════════════════
// Spelstart för region / världstest
// ══════════════════════════════════
async function startRegion(slug) {
  const raw = await loadRegionConfig(slug);
  COUNTRIES = buildCountries(slug, raw);
  aktivByGid = new Map(COUNTRIES.map(c => [c.gid, c]));
  aktivByFile = new Map(COUNTRIES.map(c => [c.filename, c]));
  IMAGE_ASSOCIATIONS = Object.fromEntries(COUNTRIES.filter(c => c.assoc).map(c => [c.filename, c.assoc]));
  HS_KEY = 'glob-' + (raw.hsKey || slug + '-highscores');
  ASSET_BASE = 'assets/' + slug;
  isWorldTest = false;
  origSlug = slug;                 // originalvyn = regionens handritade karta
  origRaw = raw;
  document.getElementById('view-orig').style.display = '';

  document.title = `${raw.name} – Jonas geografi`;
  document.querySelector('header h1').textContent = raw.name + ' 🌍';
  document.querySelectorAll('[data-total]').forEach(el => el.textContent = COUNTRIES.length);
  seterraProgressLabel.textContent = `0 / ${COUNTRIES.length}`;

  // resten av världen grön, regionens länder täckta
  for (const f of regionsGj.features) {
    if (aktivByGid.has(f.id)) setLand(f.id, { gron: false, tackt: true });
    else setLand(f.id, { gron: true, tackt: false });
  }
  const kam = KAMERA[slug] || KAMERA.world;
  map.jumpTo({ center: kam.center, zoom: kam.zoom });
  preloadCountryImages();
}

async function startWorld(count) {
  // proportionellt urval över regionerna (största rest-metoden)
  const entries = [];
  for (const slug of WORLD_SLUGS) {
    const raw = await loadRegionConfig(slug);
    entries.push({ slug, raw, countries: shuffle(buildCountries(slug, raw)) });
  }
  const totalCountries = entries.reduce((s, e) => s + e.countries.length, 0);
  if (count > totalCountries) count = totalCountries;
  const alloc = entries.map(e => {
    const exact = (e.countries.length / totalCountries) * count;
    return { e, exact, n: Math.floor(exact) };
  });
  let allocated = alloc.reduce((s, a) => s + a.n, 0);
  alloc.map((a, i) => ({ i, rem: a.exact - a.n }))
    .sort((a, b) => b.rem - a.rem)
    .forEach(r => { if (allocated < count) { alloc[r.i].n++; allocated++; } });

  COUNTRIES = [];
  for (const a of alloc) COUNTRIES.push(...a.e.countries.slice(0, a.n));
  aktivByGid = new Map(COUNTRIES.map(c => [c.gid, c]));
  aktivByFile = new Map(COUNTRIES.map(c => [c.filename, c]));
  IMAGE_ASSOCIATIONS = Object.fromEntries(COUNTRIES.filter(c => c.assoc).map(c => [c.filename, c.assoc]));
  HS_KEY = 'glob-world-highscores';
  isWorldTest = true;
  origSlug = null;                 // världstestet har ingen originalkarta
  document.getElementById('view-orig').style.display = 'none';
  if (aktivVy === 'orig') setView('glob');

  document.title = 'Världstest – Jonas geografi';
  document.querySelector('header h1').textContent = 'Världstest 🌍';
  document.querySelectorAll('[data-total]').forEach(el => el.textContent = COUNTRIES.length);

  // ALLA länder täckta — hela världen är spelplan
  for (const f of regionsGj.features) {
    setLand(f.id, { gron: !aktivByGid.has(f.id), tackt: aktivByGid.has(f.id) });
  }
  map.jumpTo({ center: KAMERA.world.center, zoom: KAMERA.world.zoom });
  switchMode('seterra', true);
  startSeterra();
  preloadCountryImages();
}

// ══════════════════════
// Utforska-läget
// ══════════════════════
function countryImgSrc(c) {
  return `assets/${c.slug}/countries/${c.filename}.webp`;
}
// Förladda de spelbara ländernas bilder så infokortet och quiz-feedbacken
// visar landbilden DIREKT i stället för efter en nedladdningssekund.
let bildCache = [];
function preloadCountryImages() {
  bildCache = COUNTRIES.map(c => {
    const i = new Image();
    i.decoding = 'async';
    i.src = countryImgSrc(c);
    return i;
  });
}
// beskrivningen ligger hopfälld bakom en knapp — fäll ihop vid varje nytt land
const infoToggle = document.getElementById('info-toggle');
const infoExtra = document.getElementById('info-extra');
infoToggle.addEventListener('click', () => {
  const open = infoExtra.style.display !== 'none';
  infoExtra.style.display = open ? 'none' : '';
  infoToggle.classList.toggle('open', !open);
  infoToggle.textContent = open ? 'Visa info om landet' : 'Dölj info om landet';
});
function showInfoCard(c) {
  activeCountry = c.gid;
  infoName.textContent = c.name;
  infoShape.src = countryImgSrc(c);
  const infoAssoc = document.getElementById('info-assoc');
  infoAssoc.textContent = c.assoc || '';
  infoAssoc.style.display = c.assoc ? '' : 'none';   // minnesregeln syns alltid
  infoDesc.innerHTML = escHtml(c.desc);
  infoExtra.style.display = 'none';
  infoToggle.classList.remove('open');
  infoToggle.textContent = 'Visa info om landet';
  infoDefault.style.display = 'none';
  infoCard.classList.add('active');
}
function exploreClick(c, e) {
  if (revealed.has(c.gid)) coverCountry(c.gid);
  else revealCountry(c.gid);
  showInfoCard(c);
  if (e) {
    clearTimeout(exploreTooltipTimer);
    cursorLabel.textContent = c.name;
    cursorLabel.classList.add('explore-tooltip');
    cursorLabel.style.left = e.clientX + 'px';
    cursorLabel.style.top = e.clientY + 'px';
    cursorLabel.style.display = 'block';
    exploreTooltipTimer = setTimeout(hideExploreTooltip, 1000);
  }
  exploredCountEl.textContent = revealed.size;
}
function hideExploreTooltip() {
  clearTimeout(exploreTooltipTimer);
  cursorLabel.style.display = 'none';
  cursorLabel.classList.remove('explore-tooltip');
}

// ══════════════════════
// Klassiskt quiz
// ══════════════════════
function startSeterra() {
  resetOverlays();
  seterraQueue = shuffle([...COUNTRIES]);
  seterraCorrect = 0; seterraWrong = 0;
  seterraTotal = COUNTRIES.length;
  seterraLocked = false; seterraTargetMisses = 0;
  seterraIsRetry = false;
  seterraMissedCountries.clear();
  seterraStartTime = Date.now();
  seterraGame.classList.add('active');
  seterraDone.classList.remove('active');
  cursorLabel.style.display = 'block';
  updateSeterraUI();
  nextSeterraTarget();
  clearInterval(seterraTimerInterval);
  seterraTimerInterval = setInterval(updateSeterraTimer, 500);
}

function startSeterraRetry() {
  const missedList = COUNTRIES.filter(c => seterraMissedCountries.has(c.gid));
  if (missedList.length === 0) return;
  resetOverlays();
  COUNTRIES.forEach(c => { if (!seterraMissedCountries.has(c.gid)) revealCountry(c.gid); });
  seterraQueue = shuffle([...missedList]);
  seterraCorrect = 0; seterraWrong = 0;
  seterraTotal = missedList.length;
  seterraLocked = false; seterraTargetMisses = 0;
  seterraIsRetry = true;
  seterraMissedCountries.clear();
  seterraStartTime = Date.now();
  seterraGame.classList.add('active');
  seterraDone.classList.remove('active');
  cursorLabel.style.display = 'block';
  updateSeterraUI();
  nextSeterraTarget();
  clearInterval(seterraTimerInterval);
  seterraTimerInterval = setInterval(updateSeterraTimer, 500);
}

function nextSeterraTarget() {
  if (seterraQueue.length === 0) { endSeterra(); return; }
  seterraTarget = seterraQueue.pop();
  seterraTargetMisses = 0;
  seterraTargetName.textContent = seterraTarget.name;
  cursorLabel.textContent = seterraTarget.name;
  seterraFeedback.className = 'seterra-feedback';
  seterraFeedback.innerHTML = '';
  setHint(seterraTarget.assoc || '');
}

function setHint(text) {
  currentHintText = text || '';
  seterraHintBox.style.display = 'none';
  seterraHintBox.textContent = '';
  seterraHintBtn.classList.remove('used');
  seterraHintBtn.style.display = currentHintText ? '' : 'none';
}
seterraHintBtn.addEventListener('click', () => {
  if (!currentHintText) return;
  seterraHintBox.textContent = currentHintText;
  seterraHintBox.style.display = '';
  seterraHintBtn.classList.add('used');
});

function seterraClick(c) {
  if (!seterraTarget || seterraLocked) return;
  if (revealed.has(c.gid)) return;

  if (c.gid === seterraTarget.gid) {
    seterraCorrect++;
    seterraTargetMisses = 0;
    revealCountry(c.gid);
    seterraFeedback.className = 'seterra-feedback correct-fb';
    seterraFeedback.innerHTML = `<div class="fb-banner correct-banner">RÄTT!</div><div class="fb-title">${escHtml(c.name)}</div>${c.assoc ? `<div class="assoc-box">${escHtml(c.assoc)}</div>` : ''}<div class="fb-desc">${escHtml(c.desc)}</div>`;
    burstConfetti();
    updateSeterraUI();
    nextSeterraTarget();
  } else {
    seterraWrong++;
    seterraTargetMisses++;
    seterraMissedCountries.add(seterraTarget.gid);
    flashWrong(c.gid);
    seterraFeedback.className = 'seterra-feedback wrong-fb';
    seterraFeedback.innerHTML = `<div class="fb-title">Det var ${escHtml(c.name)}</div>${c.assoc ? `<div class="assoc-box">${escHtml(c.assoc)}</div>` : ''}${c.desc ? `<div class="fb-desc">${escHtml(c.desc)}</div>` : ''}`;
    updateSeterraUI();
    if (seterraTargetMisses >= 3) blinkHint(seterraTarget.gid);
    seterraLocked = true;
    setTimeout(() => { seterraLocked = false; }, 600);
  }
}

function updateSeterraUI() {
  const totalClicks = seterraCorrect + seterraWrong;
  const score = totalClicks > 0 ? Math.round((seterraCorrect / totalClicks) * 100) : 100;
  seterraScoreEl.textContent = score + '%';
  seterraCorrectEl.textContent = seterraCorrect;
  seterraWrongEl.textContent = seterraWrong;
  const pct = Math.round((seterraCorrect / seterraTotal) * 100);
  seterraBar.style.width = pct + '%';
  seterraProgressLabel.textContent = `${seterraCorrect} / ${seterraTotal}`;
}

function updateSeterraTimer() {
  const elapsed = Math.floor((Date.now() - seterraStartTime) / 1000);
  const m = Math.floor(elapsed / 60), s = elapsed % 60;
  seterraTimeEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
}

function endSeterra() {
  clearInterval(seterraTimerInterval);
  updateSeterraTimer();
  seterraTarget = null;
  cursorLabel.style.display = 'none';
  const totalClicks = seterraCorrect + seterraWrong;
  const score = totalClicks > 0 ? Math.round((seterraCorrect / totalClicks) * 100) : 100;
  seterraElapsed = Math.floor((Date.now() - seterraStartTime) / 1000);
  const m = Math.floor(seterraElapsed / 60), s = seterraElapsed % 60;
  seterraGame.classList.remove('active');
  seterraDone.classList.add('active');
  document.getElementById('seterra-final-score').textContent = score + '%';
  document.getElementById('seterra-final-detail').innerHTML =
    `${seterraCorrect} av ${seterraTotal} länder<br>${seterraWrong} felklick<br>Tid: ${m}:${s.toString().padStart(2, '0')}`;
  const retryBtn = document.getElementById('seterra-retry');
  if (seterraMissedCountries.size > 0) {
    retryBtn.style.display = '';
    retryBtn.textContent = `Öva på felaktiga (${seterraMissedCountries.size} st)`;
  } else {
    retryBtn.style.display = 'none';
  }
  document.getElementById('hs-form').style.display = 'none';
  document.getElementById('hs-saved-msg').style.display = 'none';
  if (!seterraIsRetry && score === 100 && seterraWrong === 0) {
    showCelebration(m, s);
  } else if (!seterraIsRetry) {
    showNameModal(score, m, s);
  } else {
    renderHighscores();
  }
}

// ══════════════════════
// Topplistor (Firebase + lokalt) — samma som originalsidan
// ══════════════════════
function getLocalHighscores() {
  try { return JSON.parse(localStorage.getItem(HS_KEY)) || []; }
  catch { return []; }
}
async function getHighscores() {
  const local = getLocalHighscores();
  if (!firebaseDB) return local;
  try {
    const snap = await firebaseDB.ref('highscores/' + HS_KEY).once('value');
    const remote = [];
    snap.forEach(child => { remote.push(child.val()); });
    const remoteDates = new Set(remote.map(e => e.date));
    const localOnly = local.filter(e => !remoteDates.has(e.date));
    if (localOnly.length > 0) {
      const updates = {};
      for (const e of localOnly) {
        const newKey = firebaseDB.ref('highscores/' + HS_KEY).push().key;
        updates[newKey] = e;
      }
      await firebaseDB.ref('highscores/' + HS_KEY).update(updates);
      remote.push(...localOnly);
    }
    const seen = new Set(remote.map(e => e.date));
    const merged = [...remote];
    for (const e of local) if (!seen.has(e.date)) merged.push(e);
    merged.sort((a, b) => b.score - a.score || a.time - b.time);
    if (merged.length > 30) merged.length = 30;
    localStorage.setItem(HS_KEY, JSON.stringify(merged));
    return merged;
  } catch (e) {
    console.warn('Firebase read failed, using local:', e);
    return local;
  }
}
async function saveHighscore(name, score, time, wrong) {
  const entry = { name, score, time, wrong, date: Date.now() };
  const local = getLocalHighscores();
  local.push(entry);
  local.sort((a, b) => b.score - a.score || a.time - b.time);
  if (local.length > 30) local.length = 30;
  localStorage.setItem(HS_KEY, JSON.stringify(local));
  if (firebaseDB) {
    try {
      await firebaseDB.ref('highscores/' + HS_KEY).push(entry);
      const snap = await firebaseDB.ref('highscores/' + HS_KEY).orderByChild('score').once('value');
      const all = [];
      snap.forEach(child => { all.push({ key: child.key, ...child.val() }); });
      all.sort((a, b) => b.score - a.score || a.time - b.time);
      if (all.length > 30) {
        const removes = {};
        for (let i = 30; i < all.length; i++) removes[all[i].key] = null;
        await firebaseDB.ref('highscores/' + HS_KEY).update(removes);
      }
    } catch (e) { console.warn('Firebase write failed:', e); }
  }
  return entry;
}
async function renderHighscores(highlightEntry) {
  const container = document.getElementById('highscore-list');
  container.innerHTML = '<div class="hs-empty">Laddar topplista...</div>';
  const list = await getHighscores();
  if (list.length === 0) {
    container.innerHTML = '<div class="hs-empty">Inga sparade resultat ännu.</div>';
    return;
  }
  let html = '<h3>Topp 30</h3><table class="hs-table"><thead><tr><th>#</th><th>Namn</th><th>Poäng</th><th>Tid</th></tr></thead><tbody>';
  list.forEach((e, i) => {
    const m = Math.floor(e.time / 60), s = e.time % 60;
    const isCurrent = highlightEntry && e.date === highlightEntry.date && e.name === highlightEntry.name;
    html += `<tr class="${isCurrent ? 'hs-current' : ''}"><td>${i + 1}</td><td>${escHtml(e.name)}</td><td>${e.score}%</td><td>${m}:${s.toString().padStart(2, '0')}</td></tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

// ── Namn-modal ──
const nameModalOverlay = document.getElementById('name-modal-overlay');
const modalNameInput = document.getElementById('modal-name');
function showNameModal(score, m, s) {
  document.getElementById('modal-score').textContent = score + '%';
  document.getElementById('modal-detail').innerHTML =
    `${seterraCorrect} av ${seterraTotal} länder &bull; ${seterraWrong} fel &bull; ${m}:${s.toString().padStart(2, '0')}`;
  modalNameInput.value = '';
  nameModalOverlay.classList.add('active');
  setTimeout(() => modalNameInput.focus(), 100);
}
function closeNameModal() { nameModalOverlay.classList.remove('active'); }

document.getElementById('hs-save').addEventListener('click', async () => {
  const name = document.getElementById('hs-name').value.trim();
  if (!name) return;
  const totalClicks = seterraCorrect + seterraWrong;
  const score = totalClicks > 0 ? Math.round((seterraCorrect / totalClicks) * 100) : 100;
  const entry = await saveHighscore(name, score, seterraElapsed, seterraWrong);
  document.getElementById('hs-form').style.display = 'none';
  document.getElementById('hs-saved-msg').style.display = '';
  await renderHighscores(entry);
});
document.getElementById('hs-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('hs-save').click();
});
document.getElementById('seterra-restart').addEventListener('click', () => startSeterra());
document.getElementById('seterra-retry').addEventListener('click', startSeterraRetry);
document.getElementById('modal-save').addEventListener('click', async () => {
  const name = modalNameInput.value.trim();
  if (!name) { modalNameInput.focus(); return; }
  const totalClicks = seterraCorrect + seterraWrong;
  const score = totalClicks > 0 ? Math.round((seterraCorrect / totalClicks) * 100) : 100;
  const entry = await saveHighscore(name, score, seterraElapsed, seterraWrong);
  closeNameModal();
  await renderHighscores(entry);
});
modalNameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('modal-save').click();
});
document.getElementById('modal-skip').addEventListener('click', () => {
  closeNameModal();
  renderHighscores();
});
nameModalOverlay.addEventListener('click', e => {
  if (e.target === nameModalOverlay) { closeNameModal(); renderHighscores(); }
});

// ══════════════════════
// Lägesväxling
// ══════════════════════
function switchMode(mode, force) {
  if (mode === currentMode && !force) return;
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  if (mode === 'explore') {
    document.getElementById('explore-ui').style.display = '';
    document.getElementById('seterra-ui').style.display = 'none';
    document.getElementById('explore-toggle-buttons').style.display = '';
    hideExploreTooltip();
    clearInterval(seterraTimerInterval);
    seterraTarget = null;
    headerHint.textContent = 'Klicka på ett land';
    resetOverlays();
    activeCountry = null;
    infoCard.classList.remove('active');
    infoDefault.style.display = '';
    exploredCountEl.textContent = '0';
  } else {
    document.getElementById('explore-ui').style.display = 'none';
    document.getElementById('seterra-ui').style.display = '';
    document.getElementById('explore-toggle-buttons').style.display = 'none';
    headerHint.textContent = 'Klicka där du tror landet är!';
    startSeterra();
  }
}
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => switchMode(btn.dataset.mode));
});

document.getElementById('show-all-btn').addEventListener('click', () => {
  COUNTRIES.forEach(c => revealCountry(c.gid));
  exploredCountEl.textContent = revealed.size;
  if (COUNTRIES.length) showInfoCard(COUNTRIES[0]);
});
document.getElementById('hide-all-btn').addEventListener('click', () => {
  resetOverlays();
  exploredCountEl.textContent = '0';
  activeCountry = null;
  infoCard.classList.remove('active');
  infoDefault.style.display = '';
});

// ── Jonas high-five ──
const jonasImg = document.getElementById('jonas-img');
const highfiveCountEl = document.getElementById('highfive-count');
const highfiveAudio = new Audio('high_five.wav');
const highfiveRef = firebaseDB ? firebaseDB.ref('highfives') : null;
if (highfiveRef) {
  highfiveRef.on('value', snap => { highfiveCountEl.textContent = snap.val() || 0; });
} else {
  highfiveCountEl.textContent = localStorage.getItem('highfive-count') || '0';
}
jonasImg.addEventListener('click', () => {
  highfiveAudio.currentTime = 0;
  highfiveAudio.play();
  jonasImg.src = 'Jonas_2.webp';
  setTimeout(() => { jonasImg.src = 'Jonas_1.webp'; }, 1000);
  if (highfiveRef) highfiveRef.transaction(cur => (cur || 0) + 1);
  else {
    const count = parseInt(localStorage.getItem('highfive-count') || '0', 10) + 1;
    localStorage.setItem('highfive-count', count);
    highfiveCountEl.textContent = count;
  }
});

// ══════════════════════
// Konfetti + firande — samma som originalsidan
// ══════════════════════
function startConfetti(canvas) {
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const colors = ['#ff4444', '#ffdd00', '#44bb44', '#4488ff', '#ff44ff', '#ff8800', '#00ddff', '#ffd700'];
  const pieces = [];
  for (let i = 0; i < 200; i++) {
    pieces.push({
      x: Math.random() * canvas.width, y: Math.random() * -canvas.height,
      w: 6 + Math.random() * 8, h: 4 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      speed: 1.5 + Math.random() * 3, drift: (Math.random() - 0.5) * 1.5,
      rot: Math.random() * Math.PI * 2, rotSpeed: (Math.random() - 0.5) * 0.15,
    });
  }
  let running = true;
  (function draw() {
    if (!running) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of pieces) {
      p.y += p.speed; p.x += p.drift; p.rot += p.rotSpeed;
      if (p.y > canvas.height) { p.y = -10; p.x = Math.random() * canvas.width; }
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    requestAnimationFrame(draw);
  })();
  return () => { running = false; ctx.clearRect(0, 0, canvas.width, canvas.height); };
}

function burstConfetti() {
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-burst-canvas';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const W = window.innerWidth, H = window.innerHeight;
  canvas.width = W; canvas.height = H;
  const colors = ['#ff4444', '#ffdd00', '#44bb44', '#4488ff', '#ff44ff', '#ff8800', '#00ddff', '#ffd700'];
  const pieces = [];
  const cannons = [
    { x: 0, y: H, aMin: -1.35, aMax: -0.35 },
    { x: W, y: H, aMin: Math.PI + 0.35, aMax: Math.PI + 1.35 },
  ];
  for (const cannon of cannons) {
    for (let i = 0; i < 45; i++) {
      const angle = cannon.aMin + Math.random() * (cannon.aMax - cannon.aMin);
      const speed = 11 + Math.random() * 11;
      pieces.push({
        x: cannon.x, y: cannon.y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        w: 6 + Math.random() * 7, h: 4 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * Math.PI * 2, rotSpeed: (Math.random() - 0.5) * 0.3,
      });
    }
  }
  const gravity = 0.32, duration = 1300;
  const start = performance.now();
  (function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, W, H);
    const fade = Math.max(0, 1 - t / duration);
    for (const p of pieces) {
      p.vy += gravity; p.vx *= 0.99;
      p.x += p.vx; p.y += p.vy; p.rot += p.rotSpeed;
      ctx.save();
      ctx.globalAlpha = Math.min(1, fade * 1.6);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (t < duration) requestAnimationFrame(frame);
    else canvas.remove();
  })(start);
}

function showCelebration(m, s) {
  const overlay = document.getElementById('celebration-overlay');
  document.getElementById('celebration-detail').innerHTML =
    `${seterraCorrect} av ${seterraTotal} länder &bull; 0 fel &bull; ${m}:${s.toString().padStart(2, '0')}`;
  overlay.classList.add('active');
  const stopConfetti = startConfetti(document.getElementById('confetti-canvas'));
  const celebMusic = new Audio('CELEBRATION.mp3');
  celebMusic.loop = true; celebMusic.volume = 0.7;
  celebMusic.play().catch(() => {});
  const jonasEl = document.getElementById('celebration-jonas-img');
  let toggle = false;
  const jonasInterval = setInterval(() => {
    toggle = !toggle;
    jonasEl.src = toggle ? 'Jonas_2.webp' : 'Jonas_1.webp';
  }, 300);
  const celebAudio = new Audio('high_five.wav');
  celebAudio.play().catch(() => {});
  const soundInterval = setInterval(() => {
    celebAudio.currentTime = 0;
    celebAudio.play().catch(() => {});
  }, 800);
  const closeBtn = document.getElementById('celebration-close');
  const closeFn = () => {
    clearInterval(jonasInterval);
    clearInterval(soundInterval);
    stopConfetti();
    celebMusic.pause(); celebMusic.currentTime = 0;
    overlay.classList.remove('active');
    jonasEl.src = 'Jonas_1.webp';
    closeBtn.removeEventListener('click', closeFn);
    showNameModal(100, m, s);
  };
  closeBtn.addEventListener('click', closeFn);
}

// ══════════════════════
// Regionväljare / navigering
// ══════════════════════
function showRegionSelector() {
  document.getElementById('region-selector').style.display = '';
  document.querySelector('.game-container').style.display = 'none';
  document.querySelector('.mode-toggle').style.display = 'none';
  document.getElementById('header-hint').style.display = 'none';
  document.getElementById('back-btn').style.display = 'none';
  document.querySelector('header h1').textContent = 'Jonas geografi';
  document.title = 'Jonas geografi – jordglob';
  document.body.style.overflow = 'auto';
}
document.getElementById('back-btn').addEventListener('click', () => {
  window.location.href = window.location.pathname;
});

function showGame() {
  document.getElementById('region-selector').style.display = 'none';
  document.querySelector('.game-container').style.display = '';
  document.querySelector('.mode-toggle').style.display = '';
  document.getElementById('header-hint').style.display = '';
  document.getElementById('back-btn').style.display = '';
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    const header = document.querySelector('header');
    if (header) document.documentElement.style.setProperty('--mobile-header-h', header.offsetHeight + 'px');
  });
}

// litet API för tester och felsökning
window.spel = {
  get map() { return map; },
  get countries() { return COUNTRIES; },
  get revealed() { return revealed; },
  get target() { return seterraTarget; },
  get mode() { return currentMode; },
  get vy() { return aktivVy; },
  get flat() { return flat; },
  get origZoom() { return origZoom; },
  klick: gid => handleMapClick(gid, null),
  setLand, landState, setView, flatZoomTo, origSetZoom,
};

// ══════════════════════
// Uppstart
// ══════════════════════
(async () => {
  const params = new URLSearchParams(window.location.search);
  const region = params.get('region');
  if (!region) { showRegionSelector(); document.getElementById('spel-load').style.display = 'none'; return; }

  showGame();
  const loadTxt = document.getElementById('spel-load-txt');
  loadTxt.textContent = 'Startar …';
  // Bara klickytorna behövs innan spelet drar igång — kartrutorna strömmar
  // på begäran (regionens rutor är en handfull), och hela arkivet hämtas i
  // bakgrunden och ger sedan helt sömlös snurr.
  try {
    await Promise.all([loadRegions(), loadMarkers()]);
    preloadTiles();
    initMap();
    // feature-states kan inte sättas innan stilen laddat klart — men om
    // kartrutorna strular (t.ex. trög förhandsproxy) startar spelet ändå:
    // vektorlagren funkar direkt och tillstånden återappliceras på 'load'
    await new Promise(res => { map.once('load', res); setTimeout(res, 8000); });
  } catch (e) {
    // fastna ALDRIG tyst på "Startar …" — visa vad som gick fel
    loadTxt.textContent = 'Kunde inte ladda kartdata — prova att ladda om sidan. [' + ((e && e.message) || e) + ']';
    throw e;
  }
  document.getElementById('spel-load').style.display = 'none';

  if (region === 'world') {
    // världstest: välj antal länder i modalen, sedan quiz över hela globen
    document.getElementById('view-orig').style.display = 'none';
    const overlay = document.getElementById('world-setup-overlay');
    overlay.classList.add('active');
    document.getElementById('world-setup-loading').style.display = 'none';
    document.getElementById('world-setup-ready').style.display = '';
    let count = 50;
    document.querySelectorAll('#world-count-buttons button').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#world-count-buttons button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        count = +b.dataset.count;
      });
    });
    document.getElementById('world-start-btn').addEventListener('click', async () => {
      overlay.classList.remove('active');
      await startWorld(count);
    });
    // visa globen bakom modalen under tiden
    for (const f of regionsGj.features) setLand(f.id, { gron: false, tackt: false });
  } else if (WORLD_SLUGS.includes(region)) {
    await startRegion(region);
  } else {
    showRegionSelector();
  }
})();
