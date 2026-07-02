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
  if (map) map.setFeatureState({ source: 'regioner', id: gid }, t);
  flatDirty();
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
const TILE_URL = 'tiles/world.pmtiles';
let pmArchive = null;
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
  } catch (e) {
    console.warn('Förladdning misslyckades – strömmar i stället.', e);
  }
}

async function loadRegions() {
  regionsGj = await (await fetch('assets/art-regions.json')).json();
  for (const f of regionsGj.features) {
    featureByFilename.set(f.properties.key.split('/')[1], f);
  }
}

const configCache = {};
async function loadRegionConfig(slug) {
  if (configCache[slug]) return configCache[slug];
  const raw = await (await fetch(`assets/${slug}/config.json`)).json();
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
  const protocol = new pmtiles.Protocol();
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
          url: 'pmtiles://tiles/world.pmtiles',
          tileSize: 512,
          attribution: 'Illustrationer © Jonas · Gränser: Natural Earth',
        },
        borders: { type: 'geojson', data: 'assets/art-borders.json' },
        regioner: { type: 'geojson', data: regionsGj },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#0e2438' } },
        { id: 'art', type: 'raster', source: 'art', paint: { 'raster-resampling': 'linear' } },
        { id: 'cover', type: 'fill', source: 'regioner',
          paint: {
            'fill-color': ['case',
              ['boolean', ['feature-state', 'fel'], false], ROD,
              ['boolean', ['feature-state', 'tips'], false], GUL,
              ['boolean', ['feature-state', 'hover'], false], GUL,
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
        { id: 'borders', type: 'line', source: 'borders',
          paint: { 'line-color': '#0a0a0a', 'line-width': 1.5, 'line-opacity': 0.9 },
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
    const hits = map.queryRenderedFeatures(e.point, { layers: ['cover'] });
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
    const hits = map.queryRenderedFeatures(e.point, { layers: ['cover'] });
    if (!hits.length) return;
    handleMapClick(hits[0].id, e.originalEvent);
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
// Plattkartan (Robinson)
// ══════════════════════════════════
const D2R = Math.PI / 180;
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
let mdata = null;                 // mercator-mosaik (4096²)
let flatBase = null;              // varpad bas-konst (offscreen)
let flat = { xm: 1, ym: 1, W: 2, H: 2 };
let borderLines = [];
let flatDirtyFlag = false;

fetch('assets/art-borders.json').then(r => r.json())
  .then(gj => { borderLines = gj.features[0].geometry.coordinates; flatDirty(); })
  .catch(() => {});

function flatDirty() {
  if (!flatVisible || flatDirtyFlag) return;
  flatDirtyFlag = true;
  requestAnimationFrame(() => { flatDirtyFlag = false; composeFlat(); });
}

async function loadMosaic() {
  if (mdata) return;
  const Z = 3, N = 1 << Z, T = 512, MOS = N * T;
  const pm = pmArchive || new pmtiles.PMTiles(TILE_URL);
  const mosaic = document.createElement('canvas');
  mosaic.width = MOS; mosaic.height = MOS;
  const mctx = mosaic.getContext('2d');
  const jobs = [];
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) {
      jobs.push(pm.getZxy(Z, x, y).then(async t => {
        if (!t || !t.data) return;
        const img = await createImageBitmap(new Blob([t.data], { type: 'image/webp' }));
        mctx.drawImage(img, x * T, y * T);
      }).catch(() => {}));
    }
  }
  await Promise.all(jobs);
  mdata = mctx.getImageData(0, 0, MOS, MOS).data;
}

// bas-varpen (dyr) renderas en gång per storlek; tillstånden komponeras ovanpå
function renderFlatBase() {
  const MOS = 4096;
  const MAXLAT = 85.051128779807 * D2R;
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
  flat = { xm, ym, W, H };
  flatBase = document.createElement('canvas');
  flatBase.width = W; flatBase.height = H;
  const bctx = flatBase.getContext('2d');
  const id = bctx.createImageData(W, H);
  const out = id.data;
  const sx = 2 * xm / W, sy = 2 * ym / H;
  for (let py = 0; py < H; py++) {
    const yv = ym - (py + 0.5) * sy;
    for (let px = 0; px < W; px++) {
      const xv = (px + 0.5) * sx - xm;
      const ll = robinson.inverse(xv, yv);
      const o = (py * W + px) * 4;
      if (!ll) continue;
      const [l, p] = ll;
      const mx = (l / (2 * Math.PI) + 0.5) * MOS - 0.5;
      const phi = Math.max(-MAXLAT, Math.min(MAXLAT, p));
      const my = (0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI)) * MOS - 0.5;
      const fx = Math.floor(mx), fy = Math.floor(my);
      let r2 = 0, g2 = 0, b2 = 0, a2 = 0;
      for (let t = 0; t < 4; t++) {
        const tx2 = Math.min(MOS - 1, Math.max(0, fx + (t & 1)));
        const ty2 = Math.min(MOS - 1, Math.max(0, fy + (t >> 1)));
        const w = (t & 1 ? mx - fx : 1 - (mx - fx)) * (t >> 1 ? my - fy : 1 - (my - fy));
        const si = (ty2 * MOS + tx2) * 4;
        const wa = w * mdata[si + 3] / 255;
        r2 += mdata[si] * wa; g2 += mdata[si + 1] * wa; b2 += mdata[si + 2] * wa;
        a2 += wa;
      }
      out[o] = r2 + 205 * (1 - a2);
      out[o + 1] = g2 + 228 * (1 - a2);
      out[o + 2] = b2 + 246 * (1 - a2);
      out[o + 3] = 255;
    }
  }
  bctx.putImageData(id, 0, 0);
}

function projPt(lng, lat) {
  const [x, y] = robinson.forward(lng * D2R, lat * D2R);
  return [(x + flat.xm) / (2 * flat.xm) * flat.W, (flat.ym - y) / (2 * flat.ym) * flat.H];
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
  flatCtx.drawImage(flatBase, 0, 0);
  for (const f of regionsGj.features) {
    const t = landState(f.id);
    let color = null, alpha = 1;
    if (t.fel) { color = ROD; alpha = 0.92; }
    else if (t.tips) { color = GUL; alpha = 0.92; }
    else if (t.hover) { color = GUL; alpha = 0.6; }
    else if (t.gron) color = GRON;
    else if (t.tackt) color = TACK;
    if (!color) continue;
    flatCtx.globalAlpha = alpha;
    flatCtx.fillStyle = color;
    traceFeature(flatCtx, f);
    flatCtx.fill('evenodd');
  }
  flatCtx.globalAlpha = 1;
  if (borderLines.length) {
    flatCtx.strokeStyle = '#0a0a0a';
    flatCtx.lineWidth = 1.5;
    flatCtx.lineJoin = 'round';
    flatCtx.lineCap = 'round';
    flatCtx.beginPath();
    for (const line of borderLines) {
      let prev = null;
      for (const [lng, lat] of line) {
        const [px, py] = projPt(lng, lat);
        if (prev !== null && Math.abs(px - prev) > flat.W / 2) { flatCtx.moveTo(px, py); prev = px; continue; }
        if (prev === null) flatCtx.moveTo(px, py); else flatCtx.lineTo(px, py);
        prev = px;
      }
    }
    flatCtx.stroke();
  }
}

function flatHit(ev) {
  const r = flatCanvas.getBoundingClientRect();
  const px = (ev.clientX - r.left) * flatCanvas.width / r.width;
  const py = (ev.clientY - r.top) * flatCanvas.height / r.height;
  const ll = robinson.inverse((px / flat.W) * 2 * flat.xm - flat.xm, flat.ym - (py / flat.H) * 2 * flat.ym);
  if (!ll) return null;
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

flatCanvas.addEventListener('click', ev => {
  const f = flatHit(ev);
  if (f) handleMapClick(f.id, ev);
});
let flatHoverGid = null, flatHoverRaf = false;
flatCanvas.addEventListener('pointermove', ev => {
  if (currentMode === 'seterra' && seterraTarget && !seterraLocked) {
    cursorLabel.style.left = ev.clientX + 'px';
    cursorLabel.style.top = ev.clientY + 'px';
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

async function setView(platt) {
  document.getElementById('view-glob').classList.toggle('active', !platt);
  document.getElementById('view-platt').classList.toggle('active', platt);
  mapPanel.classList.toggle('platt', platt);
  flatVisible = platt;
  if (platt) {
    if (!mdata) {
      const load = document.getElementById('spel-load');
      load.style.display = '';
      document.getElementById('spel-load-txt').textContent = 'Bygger plattkartan …';
      await loadMosaic();
      renderFlatBase();
      load.style.display = 'none';
    } else if (!flatBase) renderFlatBase();
    composeFlat();
  }
}
document.getElementById('view-glob').addEventListener('click', () => setView(false));
document.getElementById('view-platt').addEventListener('click', () => setView(true));
window.addEventListener('resize', () => {
  if (flatVisible) { flatBase = null; renderFlatBase(); composeFlat(); }
});

// ══════════════════════════════════
// Spelstart för region / världstest
// ══════════════════════════════════
async function startRegion(slug) {
  const raw = await loadRegionConfig(slug);
  COUNTRIES = buildCountries(slug, raw);
  aktivByGid = new Map(COUNTRIES.map(c => [c.gid, c]));
  IMAGE_ASSOCIATIONS = Object.fromEntries(COUNTRIES.filter(c => c.assoc).map(c => [c.filename, c.assoc]));
  HS_KEY = 'glob-' + (raw.hsKey || slug + '-highscores');
  ASSET_BASE = 'assets/' + slug;
  isWorldTest = false;

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
  IMAGE_ASSOCIATIONS = Object.fromEntries(COUNTRIES.filter(c => c.assoc).map(c => [c.filename, c.assoc]));
  HS_KEY = 'glob-world-highscores';
  isWorldTest = true;

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
}

// ══════════════════════
// Utforska-läget
// ══════════════════════
function countryImgSrc(c) {
  return `assets/${c.slug}/countries/${c.filename}.webp`;
}
function showInfoCard(c) {
  activeCountry = c.gid;
  infoName.textContent = c.name;
  infoShape.src = countryImgSrc(c);
  infoDesc.innerHTML = (c.assoc ? `<div class="assoc-box">${escHtml(c.assoc)}</div>` : '') + escHtml(c.desc);
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
  klick: gid => handleMapClick(gid, null),
  setLand, landState,
};

// ══════════════════════
// Uppstart
// ══════════════════════
(async () => {
  const params = new URLSearchParams(window.location.search);
  const region = params.get('region');
  if (!region) { showRegionSelector(); document.getElementById('spel-load').style.display = 'none'; return; }

  showGame();
  const loadBar = document.getElementById('spel-load-bar');
  const loadTxt = document.getElementById('spel-load-txt');
  await Promise.all([
    preloadTiles(f => { loadBar.style.width = (f * 100).toFixed(1) + '%'; }),
    loadRegions(),
  ]);
  loadTxt.textContent = 'Startar …';
  initMap();
  // feature-states kan inte sättas innan stilen laddat klart
  await new Promise(res => map.once('load', res));
  document.getElementById('spel-load').style.display = 'none';

  if (region === 'world') {
    // världstest: välj antal länder i modalen, sedan quiz över hela globen
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
