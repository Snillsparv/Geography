#!/usr/bin/env node
// Build globe-demo.html: MapLibre GL with globe projection over the pre-baked
// PMTiles artwork pyramid, plus a Natural Earth border line layer (vector, so
// contours stay crisp at every zoom and remain styleable at runtime).
//
// Everything except the tiles and the borders geojson is inlined, so the page
// is a single file; tiles stream on demand via HTTP range requests.
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
<title>Jonas geografi – jordglob</title>
<style>${maplibreCss}</style>
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; height: 100%; background: #081320; font-family: system-ui, sans-serif; }
  #map { position: absolute; inset: 0; }
  #panel { position: fixed; top: 14px; left: 14px; z-index: 5; background: rgba(10,22,38,.92);
    border: 1px solid rgba(91,191,255,.25); border-radius: 12px; padding: 14px 16px;
    backdrop-filter: blur(4px); max-width: 280px; color: #cde; }
  #panel h1 { font-size: 1rem; margin: 0 0 4px; }
  #panel p { font-size: .8rem; color: #7ea6c4; margin: 0 0 12px; line-height: 1.4; }
  .row { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
  .lbl { font-size: .78rem; color: #7ea6c4; margin-bottom: 6px; }
  button.opt { flex: 1; min-width: 56px; padding: 7px 9px; border-radius: 8px;
    border: 1px solid rgba(91,191,255,.3); background: rgba(255,255,255,.04);
    color: #cde; font-size: .8rem; cursor: pointer; }
  button.opt.active { background: #2980b9; border-color: #5bbfff; color: #fff; font-weight: 600; }
  #load { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%); z-index: 6;
    background: rgba(10,22,38,.94); border: 1px solid rgba(91,191,255,.3); border-radius: 10px;
    padding: 10px 16px; color: #cde; font-size: .82rem; min-width: 260px; text-align: center; }
  #load .track { height: 6px; border-radius: 3px; background: rgba(255,255,255,.12); margin-top: 8px; overflow: hidden; }
  #load .fill { height: 100%; width: 0%; background: #5bbfff; transition: width .15s; }
</style></head>
<body>
<div id="map"></div>
<div id="load"><span id="loadtxt">Laddar hela kartan f&ouml;r s&ouml;ml&ouml;s snurr &hellip;</span>
  <div class="track"><div class="fill" id="loadbar"></div></div></div>
<div id="panel">
  <h1>Jonas geografi – jordglob</h1>
  <p>F&ouml;rbakade kartrutor + MLS-varp: varje land ligger p&aring; sin riktiga plats. Dra, zooma och utforska!</p>
  <div class="lbl">Projektion:</div>
  <div class="row">
    <button class="opt proj active" data-proj="globe">Glob &#127757;</button>
    <button class="opt proj" data-proj="mercator">Platt</button>
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
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

// Förladda hela arkivet till minnet (≈45 MB): varje rotation, panorering och
// zoom blir därefter omedelbar — inga rutor som laddar i kanterna. Lägg till
// ?stream=1 i adressen för att i stället strömma via range requests.
const TILE_URL = 'tiles/world.pmtiles';
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
    protocol.add(new pmtiles.PMTiles({
      getKey: () => TILE_URL,
      getBytes: async (offset, length) => ({ data: buf.buffer.slice(offset, offset + length) }),
    }));
  } catch (e) {
    console.warn('Förladdning misslyckades – strömmar via range requests i stället.', e);
  }
  loadEl.remove();
}
await preloadTiles();

const map = new maplibregl.Map({
  container: 'map',
  hash: true,
  center: [10, 30],
  zoom: 1.6,
  maxZoom: 9.5,
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
      borders: { type: 'geojson', data: 'assets/world-borders.json' },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0e2438' } },
      { id: 'art', type: 'raster', source: 'art',
        paint: { 'raster-resampling': 'linear' } },
      { id: 'borders', type: 'line', source: 'borders',
        paint: { 'line-color': '#0a0a0a', 'line-width': 1.5, 'line-opacity': 0.9 },
        layout: { 'line-join': 'round', 'line-cap': 'round' } },
    ],
  },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');

function activate(sel, btn) {
  document.querySelectorAll(sel).forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}
document.querySelectorAll('button.proj').forEach(b => b.addEventListener('click', () => {
  activate('button.proj', b);
  map.setProjection({ type: b.dataset.proj });
}));
document.querySelectorAll('button.bw').forEach(b => b.addEventListener('click', () => {
  activate('button.bw', b);
  const w = +b.dataset.w;
  if (w === 0) map.setLayoutProperty('borders', 'visibility', 'none');
  else {
    map.setLayoutProperty('borders', 'visibility', 'visible');
    map.setPaintProperty('borders', 'line-width', w);
  }
}));
document.querySelectorAll('button.bc').forEach(b => b.addEventListener('click', () => {
  activate('button.bc', b);
  map.setPaintProperty('borders', 'line-color', b.dataset.c);
}));
</script>
</body></html>`;

writeFileSync(path.join(repo, 'globe-demo.html'), html);
console.error(`Wrote globe-demo.html (${(html.length / 1048576).toFixed(2)} MB raw).`);
