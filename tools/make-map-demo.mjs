#!/usr/bin/env node
// Build a self-contained map-demo.html that places the vectorized country
// illustrations on real geography, with a projection switcher (flat Mercator,
// Equal Earth, and a draggable 3D globe). d3 is inlined so the page works
// offline; country borders come from Natural Earth (matched to our files by
// their Swedish names, NAME_SV).
//
// Usage: node tools/make-map-demo.mjs [path/to/world.geojson]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const geoPath = process.argv[2] || '/tmp/world.geojson';

const world = JSON.parse(readFileSync(geoPath, 'utf8'));

// Region → which countries we have illustrations for.
const REGIONS = ['europa', 'afrika', 'asien', 'nordamerika', 'sydamerika', 'oceanien', 'vastindien'];
// Manual aliases (filename base → ISO_A3) for spellings/typos the auto-match misses.
const ALIAS = {
  indoneien: 'IDN', demokratiska_republiken_kongo: 'COD', eciador: 'ECU',
  kongo_brazaville: 'COG', burma: 'MMR', vitryssland: 'BLR', luxembourg: 'LUX',
  bosnien_hercegovina: 'BIH', makedonien: 'MKD',
};

const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

const bySv = {}, byIso = {};
for (const f of world.features) {
  const sv = norm(f.properties.NAME_SV);
  if (sv) bySv[sv] = f;
  byIso[f.properties.ISO_A3] = f;
}

// Match each illustration file to a country feature and attach its svg path.
const shapeStats = JSON.parse(readFileSync(path.join(here, 'shape-stats.json'), 'utf8'));
const used = new Set();
const features = [];
for (const region of REGIONS) {
  const dir = path.join(repo, 'assets', region, 'countries');
  let files;
  try { files = readdirSync(dir); } catch { continue; }
  for (const fn of files) {
    if (!fn.endsWith('.svg') || fn.includes('_shape')) continue;
    const base = fn.replace('.svg', '');
    const feat = bySv[norm(base)] || (ALIAS[base] && byIso[ALIAS[base]]);
    if (!feat) continue;
    const iso = feat.properties.ISO_A3;
    if (used.has(iso)) continue;            // one illustration per country
    used.add(iso);
    const stats = shapeStats[`${region}/${base}`];
    if (!stats) continue;                   // need shape stats for placement
    features.push({
      type: 'Feature',
      geometry: feat.geometry,
      properties: {
        name: feat.properties.NAME_SV,
        svg: `assets/${region}/countries/${fn}`,
        ill: stats,
      },
    });
  }
}
console.error(`Matched ${features.length} countries onto the map.`);

const matched = { type: 'FeatureCollection', features };

// Inline d3 (order matters: array → geo, then selection, drag).
const d3src = ['d3-array', 'd3-geo', 'd3-dispatch', 'd3-selection', 'd3-drag']
  .map(p => readFileSync(path.join(here, 'node_modules', p, 'dist', `${p}.min.js`), 'utf8'))
  .join('\n');

const html = `<!DOCTYPE html>
<html lang="sv"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Jonas geografi – kartdemo</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; overflow: hidden;
    font-family: system-ui, sans-serif; background: #081320; color: #cde; }
  #map { width: 100vw; height: 100vh; display: block; cursor: grab; }
  #map.dragging { cursor: grabbing; }
  .ocean { fill: #0e2438; }
  .graticule { fill: none; stroke: #1b3a52; stroke-width: .5; }
  .border { fill: none; stroke: #2f5b78; stroke-width: .6; vector-effect: non-scaling-stroke; }
  .ill-border { fill: none; stroke: #14304a; stroke-width: .8; vector-effect: non-scaling-stroke; }
  #panel { position: fixed; top: 14px; left: 14px; background: rgba(10,22,38,.92);
    border: 1px solid rgba(91,191,255,.25); border-radius: 12px; padding: 14px 16px;
    backdrop-filter: blur(4px); max-width: 280px; }
  #panel h1 { font-size: 1rem; margin: 0 0 4px; }
  #panel p { font-size: .8rem; color: #7ea6c4; margin: 0 0 12px; line-height: 1.4; }
  .row { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
  button.proj { flex: 1; min-width: 80px; padding: 8px 10px; border-radius: 8px;
    border: 1px solid rgba(91,191,255,.3); background: rgba(255,255,255,.04);
    color: #cde; font-size: .82rem; cursor: pointer; }
  button.proj.active { background: #2980b9; border-color: #5bbfff; color: #fff; font-weight: 600; }
  label.chk { display: flex; align-items: center; gap: 7px; font-size: .82rem; color: #acc; cursor: pointer; }
  .hint { font-size: .72rem; color: #5a7e98; margin-top: 8px; }
</style></head>
<body>
<svg id="map"></svg>
<div id="panel">
  <h1>Jonas geografi på kartan</h1>
  <p>${features.length} länder placerade på sin riktiga plats. Dra för att snurra/panorera, scrolla för att zooma.</p>
  <div class="row">
    <button class="proj active" data-proj="mercator">Mercator</button>
    <button class="proj" data-proj="equalEarth">Equal Earth</button>
    <button class="proj" data-proj="globe">Glob 🌍</button>
  </div>
  <label class="chk"><input type="checkbox" id="clip" checked> Klipp till landgräns</label>
  <div class="hint">Avbockad = visa hela teckningen</div>
</div>

<script>${d3src}</script>
<script>
const DATA = ${JSON.stringify(matched)};
const svg = d3.select('#map');
let W = innerWidth, H = innerHeight;
let projName = 'mercator';
let clip = true;
let k = 1, tx = 0, ty = 0;            // screen-space zoom/pan
let rotate = [-10, -20];              // globe rotation

const gOcean = svg.append('path').attr('class', 'ocean');
const gGrat  = svg.append('path').attr('class', 'graticule');
const root   = svg.append('g');       // zoom/pan container
const gFill  = root.append('g');      // illustrations (clipped)
const gBord  = root.append('g');      // illustration outlines / fallback borders
const defs   = svg.append('defs');
const graticule = d3.geoGraticule10();

function makeProjection() {
  let p;
  if (projName === 'mercator') p = d3.geoMercator();
  else if (projName === 'equalEarth') p = d3.geoEqualEarth();
  else { p = d3.geoOrthographic().clipAngle(90).rotate(rotate); }
  if (projName === 'globe') p.fitExtent([[20,20],[W-20,H-20]], {type:'Sphere'});
  else p.fitExtent([[10,10],[W-10,H-10]], DATA);
  return p;
}

let projection = makeProjection();
let geoPath = d3.geoPath(projection);

// Build per-country DOM once.
// Each country = <g clip-path="poly"> containing a transformed <image>.
// The transform rotates+scales the illustration to align with the polygon's
// principal axis (computed at render time from the projected screen coords).
const items = DATA.features.map((f, i) => {
  const id = 'clip' + i;
  const cp = defs.append('clipPath').attr('id', id);
  const cpPath = cp.append('path');
  const wrap = gFill.append('g');                     // clip wrapper
  const img = wrap.append('image')
    .attr('href', f.properties.svg)
    .attr('x', 0).attr('y', 0)
    .attr('width', f.properties.ill.w)
    .attr('height', f.properties.ill.h);
  const border = gBord.append('path').attr('class', 'ill-border');
  return { f, id, cpPath, wrap, img, border };
});

function applyRoot() { root.attr('transform', 'translate('+tx+','+ty+') scale('+k+')'); }

// Principal-component analysis on the polygon's projected screen coords.
// Returns {cx, cy, vx, vy (unit), len_p, len_s} or null. Disambiguated the
// same way as the illustration side (farthest point lies in +v direction).
function polyPCA(feature) {
  const pts = [];
  const g = feature.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  // pick the largest sub-polygon by outer-ring point count (mainland)
  let best = polys[0], bestN = polys[0][0].length;
  for (const p of polys) if (p[0].length > bestN) { best = p; bestN = p[0].length; }
  for (const [lng, lat] of best[0]) {
    const sp = projection([lng, lat]);
    if (sp && isFinite(sp[0]) && isFinite(sp[1])) pts.push(sp);
  }
  if (pts.length < 5) return null;
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= pts.length; cy /= pts.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) {
    const dx = p[0] - cx, dy = p[1] - cy;
    sxx += dx*dx; sxy += dx*dy; syy += dy*dy;
  }
  sxx /= pts.length; sxy /= pts.length; syy /= pts.length;
  const tr = sxx + syy, det = sxx*syy - sxy*sxy;
  const disc = Math.sqrt(Math.max(0, tr*tr/4 - det));
  const eig = tr/2 + disc;
  let vx = sxy, vy = eig - sxx;
  if (Math.hypot(vx, vy) < 1e-9) { vx = eig - syy; vy = sxy; }
  const L = Math.hypot(vx, vy) || 1; vx /= L; vy /= L;
  // disambiguate using farthest-point rule
  let farProj = 0;
  for (const p of pts) {
    const pr = (p[0] - cx) * vx + (p[1] - cy) * vy;
    if (Math.abs(pr) > Math.abs(farProj)) farProj = pr;
  }
  if (farProj < 0) { vx = -vx; vy = -vy; }
  // axis-aligned lengths
  let pmin = Infinity, pmax = -Infinity, smin = Infinity, smax = -Infinity;
  for (const p of pts) {
    const pr = (p[0]-cx)*vx + (p[1]-cy)*vy;
    const sc = (p[0]-cx)*(-vy) + (p[1]-cy)*vx;
    if (pr < pmin) pmin = pr; if (pr > pmax) pmax = pr;
    if (sc < smin) smin = sc; if (sc > smax) smax = sc;
  }
  return { cx, cy, vx, vy, len_p: pmax - pmin, len_s: smax - smin };
}

function render() {
  gOcean.attr('d', projName === 'globe' ? geoPath({type:'Sphere'}) : null)
        .style('display', projName === 'globe' ? null : 'none');
  gGrat.attr('d', geoPath(graticule));
  for (const it of items) {
    const d = geoPath(it.f);
    const ill = it.f.properties.ill;
    const pol = polyPCA(it.f);
    if (!d || !pol || ill.len_p <= 0 || ill.len_s <= 0) {
      it.cpPath.attr('d', null);
      it.wrap.style('display', 'none');
      it.border.attr('d', null);
      continue;
    }
    it.cpPath.attr('d', d);
    it.border.attr('d', d).style('display', clip ? null : 'none');
    it.wrap.style('display', null)
      .attr('clip-path', clip ? 'url(#' + it.id + ')' : null);
    // Non-uniform scale: match the polygon's bbox along its principal axes.
    // Cap aspect ratio change so very long/thin polygons don't squash the art.
    let scaleP = pol.len_p / ill.len_p;
    let scaleS = pol.len_s / ill.len_s;
    const ratio = scaleP / scaleS;
    const maxRatio = 1.6;
    if (ratio > maxRatio) scaleS = scaleP / maxRatio;
    else if (ratio < 1/maxRatio) scaleP = scaleS / maxRatio;
    const polAngleDeg = Math.atan2(pol.vy, pol.vx) * 180 / Math.PI;
    const tf = `translate(${pol.cx},${pol.cy}) rotate(${polAngleDeg}) scale(${scaleP},${scaleS}) rotate(${-ill.angle}) translate(${-ill.cx},${-ill.cy})`;
    it.img.attr('transform', tf);
  }
}

function resize() { W = innerWidth; H = innerHeight; svg.attr('width', W).attr('height', H);
  projection = makeProjection(); geoPath = d3.geoPath(projection); render(); }

// Projection buttons
d3.selectAll('button.proj').on('click', function() {
  d3.selectAll('button.proj').classed('active', false);
  d3.select(this).classed('active', true);
  projName = this.dataset.proj; k=1; tx=0; ty=0; applyRoot();
  projection = makeProjection(); geoPath = d3.geoPath(projection); render();
});
document.getElementById('clip').addEventListener('change', e => { clip = e.target.checked; render(); });

// Drag: rotate globe, pan flat maps
let raf = null;
const drag = d3.drag()
  .on('start', () => svg.classed('dragging', true))
  .on('drag', (e) => {
    if (projName === 'globe') {
      const s = 0.25;
      rotate = [rotate[0] + e.dx * s, Math.max(-90, Math.min(90, rotate[1] - e.dy * s))];
      projection.rotate(rotate);
      if (!raf) raf = requestAnimationFrame(() => { raf = null; render(); });
    } else { tx += e.dx; ty += e.dy; applyRoot(); }
  })
  .on('end', () => { svg.classed('dragging', false); render(); });
svg.call(drag);

// Wheel zoom (screen space)
svg.on('wheel', (e) => {
  e.preventDefault();
  const f = e.deltaY < 0 ? 1.12 : 1/1.12;
  const nk = Math.max(0.5, Math.min(8, k*f));
  // zoom toward cursor
  tx = e.clientX - (e.clientX - tx) * (nk/k);
  ty = e.clientY - (e.clientY - ty) * (nk/k);
  k = nk; applyRoot();
}, { passive:false });

addEventListener('resize', resize);
resize();
</script>
</body></html>`;

writeFileSync(path.join(repo, 'map-demo.html'), html);
console.error(`Wrote map-demo.html (${(html.length/1024/1024).toFixed(1)} MB incl. inlined d3 + borders).`);
