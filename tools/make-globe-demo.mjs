#!/usr/bin/env node
// Build globe-demo.html — HUVUDPROGRAMMET: jordglob + platt väggkarta i en fil.
//
//  · Glob: MapLibre GL (globe projection) över den förbakade PMTiles-pyramiden,
//    med konstens egna vektorgränser (assets/art-borders.json) ovanpå.
//  · Väggkarta: samma karta varpad per pixel till klassiska platta projektioner
//    (Robinson/rektangulär/Miller/Equal Earth) — identisk med den gamla
//    wallmap-demon, nu inbyggd som kartans platta läge.
//  · Interaktivt: alla länder är klickbara i båda lägena. Ett klick växlar
//    landet mellan sin vanliga bild och en enfärgad grön yta (klickytorna
//    kommer ur assets/art-regions.json — landets faktiskt målade område).
//
// Allt utom tile-arkivet och geojson-filerna är inlinat: en enda HTML-fil.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const read = p => readFileSync(path.join(here, 'node_modules', p), 'utf8');

const maplibreJs = read('maplibre-gl/dist/maplibre-gl.js');
const maplibreCss = read('maplibre-gl/dist/maplibre-gl.css');
const pmtilesJs = read('pmtiles/dist/pmtiles.js');

const html = `<!DOCTYPE html>
<html lang="sv"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Jonas geografi – jordglob &amp; väggkarta</title>
<style>${maplibreCss}</style>
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; height: 100%; background: #081320; font-family: system-ui, sans-serif; }
  #map { position: absolute; inset: 0; }
  #flat { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; }
  #flat canvas { max-width: 100%; max-height: 100%; cursor: pointer; }
  body.platt #map { visibility: hidden; }
  body.platt #flat { display: flex; }
  #panel { position: fixed; top: 14px; left: 14px; z-index: 5; background: rgba(10,22,38,.92);
    border: 1px solid rgba(91,191,255,.25); border-radius: 12px; padding: 14px 16px;
    backdrop-filter: blur(4px); max-width: 280px; color: #cde; }
  #panel h1 { font-size: 1rem; margin: 0 0 4px; }
  #panel p { font-size: .8rem; color: #7ea6c4; margin: 0 0 12px; line-height: 1.4; }
  .row { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
  .lbl { font-size: .78rem; color: #7ea6c4; margin-bottom: 6px; }
  button.opt { flex: 1; min-width: 56px; padding: 7px 9px; border-radius: 8px;
    border: 1px solid rgba(91,191,255,.3); background: rgba(255,255,255,.04);
    color: #cde; font-size: .8rem; cursor: pointer; white-space: nowrap; }
  button.opt.active { background: #2980b9; border-color: #5bbfff; color: #fff; font-weight: 600; }
  #projrow, #projrow2 { display: none; }
  body.platt #projrow, body.platt #projrow2 { display: flex; }
  #projrow button, #projrow2 button { flex: 1 1 46%; }
  #load { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%); z-index: 6;
    background: rgba(10,22,38,.94); border: 1px solid rgba(91,191,255,.3); border-radius: 10px;
    padding: 10px 16px; color: #cde; font-size: .82rem; min-width: 260px; text-align: center; }
  #load .track { height: 6px; border-radius: 3px; background: rgba(255,255,255,.12); margin-top: 8px; overflow: hidden; }
  #load .fill { height: 100%; width: 0%; background: #5bbfff; transition: width .15s; }
</style></head>
<body>
<div id="map"></div>
<div id="flat"><canvas id="fc"></canvas></div>
<div id="load"><span id="loadtxt">Laddar hela kartan f&ouml;r s&ouml;ml&ouml;s snurr &hellip;</span>
  <div class="track"><div class="fill" id="loadbar"></div></div></div>
<div id="panel">
  <h1>Jonas geografi</h1>
  <p>F&ouml;rbakade kartrutor + MLS-varp: varje land p&aring; sin riktiga plats.
     Klicka p&aring; ett land s&aring; blir det gr&ouml;nt — klicka igen s&aring; kommer bilden tillbaka!</p>
  <div class="lbl">Karta:</div>
  <div class="row">
    <button class="opt view active" data-view="glob">Glob &#127757;</button>
    <button class="opt view" data-view="platt">V&auml;ggkarta</button>
  </div>
  <div class="row" id="projrow">
    <button class="opt proj active" data-p="robinson">Robinson</button>
    <button class="opt proj" data-p="rect">Rektangul&auml;r</button>
  </div>
  <div class="row" id="projrow2">
    <button class="opt proj" data-p="miller">Miller</button>
    <button class="opt proj" data-p="equalearth">Equal Earth</button>
  </div>
  <div class="lbl">Konturer:</div>
  <div class="row">
    <button class="opt bw" data-w="0">Av</button>
    <button class="opt bw" data-w="0.8">Tunn</button>
    <button class="opt bw active" data-w="1.5">Normal</button>
    <button class="opt bw" data-w="2.6">Tjock</button>
  </div>
  <div class="row">
    <button class="opt bc active" data-c="#0a0a0a">M&ouml;rk</button>
    <button class="opt bc" data-c="#f5f5f5">Ljus</button>
    <button class="opt bc" data-c="#f0c64a">Guld</button>
  </div>
</div>

<script>${maplibreJs}</script>
<script>${pmtilesJs}</script>
<script type="module">
const GRON = '#2e9e44';                 // vald-land-färgen
const D2R = Math.PI / 180;
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

// Förladda hela arkivet till minnet (≈45 MB): varje rotation, panorering och
// zoom blir därefter omedelbar — inga rutor som laddar i kanterna. Lägg till
// ?stream=1 i adressen för att i stället strömma via range requests.
// Samma arkivinstans bygger även väggkartans mosaik.
const TILE_URL = 'tiles/world.pmtiles';
let pmArchive = null;
async function preloadTiles() {
  const loadEl = document.getElementById('load');
  if (new URLSearchParams(location.search).has('stream')) { loadEl.remove(); return; }
  try {
    const resp = await fetch(TILE_URL);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const total = +resp.headers.get('Content-Length') || 0;
    const reader = resp.body.getReader();
    const chunks = [];
    let got = 0;
    const bar = document.getElementById('loadbar');
    const txt = document.getElementById('loadtxt');
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (total) bar.style.width = (got / total * 100).toFixed(1) + '%';
      txt.textContent = 'Laddar hela kartan \\u2026 ' + (got / 1048576).toFixed(1) +
        (total ? ' / ' + (total / 1048576).toFixed(0) + ' MB' : ' MB');
    }
    const buf = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { buf.set(c, o); o += c.length; }
    pmArchive = new pmtiles.PMTiles({
      getKey: () => TILE_URL,
      getBytes: async (offset, length) => ({ data: buf.buffer.slice(offset, offset + length) }),
    });
    protocol.add(pmArchive);
  } catch (e) {
    console.warn('Förladdning misslyckades – strömmar via range requests i stället.', e);
  }
  loadEl.remove();
}
const regionsReq = fetch('assets/art-regions.json').then(r => r.json()).catch(e => {
  console.warn('kunde inte läsa art-regions.json', e);
  return { type: 'FeatureCollection', features: [] };
});
const bordersReq = fetch('assets/art-borders.json').then(r => r.json()).catch(() => null);
await preloadTiles();
const regionsGj = await regionsReq;

// ── Val: klickade länder (gid → grön yta), delas av glob och väggkarta ──
const valda = new Set();
function toggleLand(gid) {
  if (valda.has(gid)) valda.delete(gid); else valda.add(gid);
  map.setFeatureState({ source: 'regioner', id: gid }, { vald: valda.has(gid) });
}

const map = new maplibregl.Map({
  container: 'map',
  hash: true,
  center: [10, 30],
  zoom: 1.6,
  maxZoom: 9.5,
  // standardtoleransen är 3 px: minsta darr under klicket räknas då som en
  // dragning och klicket slukas. 10 px gör landval lätta även med pekplatta,
  // pekskärm eller barnhänder — medvetna dragningar är ändå längre än så.
  clickTolerance: 10,
  // snabba landklick i rad ska inte tolkas som dubbelklick-zoom
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
      // konstens egna gränser (exporterade ur tile-bygget): vektorlinjer =
      // exakt samma tjocklek på ALLA zoomnivåer, även mellan heltalszoom
      borders: { type: 'geojson', data: 'assets/art-borders.json' },
      // klickytorna: varje lands faktiskt målade område, med stabilt id
      regioner: { type: 'geojson', data: regionsGj },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0e2438' } },
      { id: 'art', type: 'raster', source: 'art',
        paint: { 'raster-resampling': 'linear' } },
      { id: 'regioner-fyll', type: 'fill', source: 'regioner',
        paint: {
          'fill-color': GRON,
          'fill-opacity': ['case', ['boolean', ['feature-state', 'vald'], false], 1, 0],
        } },
      { id: 'borders', type: 'line', source: 'borders',
        paint: { 'line-color': '#0a0a0a', 'line-width': 1.5, 'line-opacity': 0.9 },
        layout: { 'line-join': 'round', 'line-cap': 'round' } },
    ],
  },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
map.on('click', e => {
  const hits = map.queryRenderedFeatures(e.point, { layers: ['regioner-fyll'] });
  if (hits.length) toggleLand(hits[0].id);
});
map.on('mousemove', e => {
  const hits = map.queryRenderedFeatures(e.point, { layers: ['regioner-fyll'] });
  map.getCanvas().style.cursor = hits.length ? 'pointer' : '';
});

// ════ Väggkartan: Mercator-mosaik ur arkivet, varpad per pixel ════
const Z = 3, N = 1 << Z, T = 512, MOS = N * T;      // 4096 px mosaik
const fcanvas = document.getElementById('fc');
const fctx = fcanvas.getContext('2d');
let mdata = null;
async function loadMosaic() {
  if (mdata) return;
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

// ── Projektioner: forward(λ,φ)→[x,y] och inverse(x,y)→[λ,φ]|null (radianer) ──
// Robinson-tabellerna (var 5:e grad)
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
    let lo = 0, hi = 18;                 // binärsök φ i RY-tabellen (monoton)
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
const rect = {
  forward: (l, p) => [l, p],
  inverse: (x, y) => (Math.abs(x) > Math.PI || Math.abs(y) > Math.PI / 2) ? null : [x, y],
};
const miller = {
  forward: (l, p) => [l, 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * p))],
  inverse(x, y) {
    if (Math.abs(x) > Math.PI) return null;
    const p = 2.5 * (Math.atan(Math.exp(0.8 * y)) - Math.PI / 4);
    if (Math.abs(p) > 85.5 * D2R) return null;
    return [x, p];
  },
};
const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, M = Math.sqrt(3) / 2;
const eePoly = t => t * (A1 + A2 * t * t + t ** 6 * (A3 + A4 * t * t));
const eeDer = t => A1 + 3 * A2 * t * t + t ** 6 * (7 * A3 + 9 * A4 * t * t);
const equalearth = {
  forward(l, p) {
    const th = Math.asin(M * Math.sin(p));
    return [l * Math.cos(th) / (M * eeDer(th)), eePoly(th)];
  },
  inverse(x, y) {
    let th = y;
    for (let i = 0; i < 12; i++) th -= (eePoly(th) - y) / eeDer(th);
    const s = Math.sin(th) / M;
    if (Math.abs(s) > 1) return null;
    const p = Math.asin(s);
    const l = x * M * eeDer(th) / Math.cos(th);
    if (!isFinite(l) || Math.abs(l) > Math.PI) return null;
    return [l, p];
  },
};
const PROJ = { robinson, rect, miller, equalearth };
let projName = 'robinson';
let flat = { xm: 1, ym: 1, W: 2, H: 2 };            // senaste renderingens geometri

// ── Rendera väggkartan: bas-varp + gröna valda länder + vektorgränser ──
const MAXLAT = 85.051128779807 * D2R;
function renderFlat() {
  if (!mdata) return;
  const proj = PROJ[projName];
  let xm = 0, ym = 0;
  for (let p = -90; p <= 90; p += 0.5) {
    const [x, y] = proj.forward(Math.PI, p * D2R);
    xm = Math.max(xm, Math.abs(x)); ym = Math.max(ym, Math.abs(y));
  }
  const availW = window.innerWidth - 24, availH = window.innerHeight - 24;
  let W = Math.min(1600, availW);
  let H = Math.round(W * ym / xm);
  if (H > availH) { H = availH; W = Math.round(H * xm / ym); }
  fcanvas.width = W; fcanvas.height = H;
  flat = { xm, ym, W, H };
  const id = fctx.createImageData(W, H);
  const out = id.data;
  const sx = 2 * xm / W, sy = 2 * ym / H;
  for (let py = 0; py < H; py++) {
    const yv = ym - (py + 0.5) * sy;
    for (let px = 0; px < W; px++) {
      const xv = (px + 0.5) * sx - xm;
      const ll = proj.inverse(xv, yv);
      const o = (py * W + px) * 4;
      if (!ll) continue;                              // utanför kartytan → sidbakgrund
      const [l, p] = ll;
      const mx = (l / (2 * Math.PI) + 0.5) * MOS - 0.5;
      const phi = Math.max(-MAXLAT, Math.min(MAXLAT, p));
      const my = (0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI)) * MOS - 0.5;
      const fx = Math.floor(mx), fy = Math.floor(my);
      let r = 0, g = 0, b = 0, a = 0;
      for (let t = 0; t < 4; t++) {
        const tx2 = Math.min(MOS - 1, Math.max(0, fx + (t & 1)));
        const ty2 = Math.min(MOS - 1, Math.max(0, fy + (t >> 1)));
        const w = (t & 1 ? mx - fx : 1 - (mx - fx)) * (t >> 1 ? my - fy : 1 - (my - fy));
        const si = (ty2 * MOS + tx2) * 4;
        const wa = w * mdata[si + 3] / 255;
        r += mdata[si] * wa; g += mdata[si + 1] * wa; b += mdata[si + 2] * wa;
        a += wa;
      }
      // konst över ljus "papperssjö" — väggkartekänsla
      out[o] = r + 205 * (1 - a);
      out[o + 1] = g + 228 * (1 - a);
      out[o + 2] = b + 246 * (1 - a);
      out[o + 3] = 255;
    }
  }
  fctx.putImageData(id, 0, 0);
  drawSelectedFlat(proj);
  drawBordersFlat(proj);
}

// projicera en lng/lat-punkt till väggkartans canvas-px
function projPt(proj, lng, lat) {
  const [x, y] = proj.forward(lng * D2R, lat * D2R);
  return [(x + flat.xm) / (2 * flat.xm) * flat.W, (flat.ym - y) / (2 * flat.ym) * flat.H];
}

// valda länder: enfärgad grön yta ovanpå konsten (samma polygoner som globen)
function drawSelectedFlat(proj) {
  if (!valda.size) return;
  fctx.fillStyle = GRON;
  for (const f of regionsGj.features) {
    if (!valda.has(f.id)) continue;
    fctx.beginPath();
    for (const poly of f.geometry.coordinates) {
      for (const ring of poly) {
        ring.forEach(([lng, lat], i) => {
          const [px, py] = projPt(proj, lng, lat);
          if (i) fctx.lineTo(px, py); else fctx.moveTo(px, py);
        });
        fctx.closePath();
      }
    }
    fctx.fill('evenodd');
  }
}

let borderLines = [];
bordersReq.then(gj => { if (gj) borderLines = gj.features[0].geometry.coordinates; });
let bWidth = 1.5, bColor = '#0a0a0a';
function drawBordersFlat(proj) {
  if (!borderLines.length || !bWidth) return;
  fctx.strokeStyle = bColor;
  fctx.lineWidth = bWidth;
  fctx.lineJoin = 'round';
  fctx.lineCap = 'round';
  fctx.beginPath();
  for (const line of borderLines) {
    let prev = null;
    for (const [lng, lat] of line) {
      const [px, py] = projPt(proj, lng, lat);
      // bryt vid antimeridianhopp
      if (prev !== null && Math.abs(px - prev) > flat.W / 2) { fctx.moveTo(px, py); prev = px; continue; }
      if (prev === null) fctx.moveTo(px, py); else fctx.lineTo(px, py);
      prev = px;
    }
  }
  fctx.stroke();
}

// klick på väggkartan: canvas-px → inverterad projektion → land-polygon
fcanvas.addEventListener('click', ev => {
  const r = fcanvas.getBoundingClientRect();
  const px = (ev.clientX - r.left) * fcanvas.width / r.width;
  const py = (ev.clientY - r.top) * fcanvas.height / r.height;
  const proj = PROJ[projName];
  const ll = proj.inverse((px / flat.W) * 2 * flat.xm - flat.xm, flat.ym - (py / flat.H) * 2 * flat.ym);
  if (!ll) return;
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
    if (inside) { toggleLand(f.id); renderFlat(); return; }
  }
});

// ── Panelen ──
function activate(sel, btn) {
  document.querySelectorAll(sel).forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}
document.querySelectorAll('button.view').forEach(b => b.addEventListener('click', async () => {
  activate('button.view', b);
  const platt = b.dataset.view === 'platt';
  document.body.classList.toggle('platt', platt);
  if (platt) { await loadMosaic(); renderFlat(); }
}));
document.querySelectorAll('button.proj').forEach(b => b.addEventListener('click', () => {
  activate('button.proj', b);
  projName = b.dataset.p;
  renderFlat();
}));
document.querySelectorAll('button.bw').forEach(b => b.addEventListener('click', () => {
  activate('button.bw', b);
  bWidth = +b.dataset.w;
  if (bWidth === 0) map.setLayoutProperty('borders', 'visibility', 'none');
  else {
    map.setLayoutProperty('borders', 'visibility', 'visible');
    map.setPaintProperty('borders', 'line-width', bWidth);
  }
  if (document.body.classList.contains('platt')) renderFlat();
}));
document.querySelectorAll('button.bc').forEach(b => b.addEventListener('click', () => {
  activate('button.bc', b);
  bColor = b.dataset.c;
  map.setPaintProperty('borders', 'line-color', bColor);
  if (document.body.classList.contains('platt')) renderFlat();
}));
let rz;
window.addEventListener('resize', () => {
  if (!document.body.classList.contains('platt')) return;
  clearTimeout(rz); rz = setTimeout(renderFlat, 200);
});

// litet API för tester och kommande spelmekanik
window.geo = {
  map, valda, toggleLand, renderFlat, regions: regionsGj,
  projPt: (lng, lat) => projPt(PROJ[projName], lng, lat),
};
</script>
</body></html>`;

writeFileSync(path.join(repo, 'globe-demo.html'), html);
console.error(`Wrote globe-demo.html (${(html.length / 1048576).toFixed(2)} MB raw).`);
