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

// Read each region's config.json so we know each country's local position
// (left, top, width, height) inside its source region canvas.
const regionConfigs = {};
for (const region of REGIONS) {
  try {
    const cfg = JSON.parse(readFileSync(path.join(repo, 'assets', region, 'config.json'), 'utf8'));
    const m = {};
    for (const c of cfg.countries) m[c.filename] = c;
    regionConfigs[region] = { canvasW: cfg.canvasWidth, canvasH: cfg.canvasHeight, countries: m };
  } catch {}
}

// Group matched countries by their source region so each continent can be
// placed as a single unit (preserves the relative positions you drew).
const regions = REGIONS.map(slug => ({ slug, countries: [] }));
const regionBySlug = Object.fromEntries(regions.map(r => [r.slug, r]));
const used = new Set();
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
    if (used.has(iso)) continue;
    const pos = regionConfigs[region]?.countries[base];
    if (!pos) continue;
    used.add(iso);
    regionBySlug[region].countries.push({
      iso, name: feat.properties.NAME_SV,
      svg: `assets/${region}/countries/${fn}`,
      left: pos.left, top: pos.top, width: pos.width, height: pos.height,
      geometry: feat.geometry,
    });
  }
}
const nMatched = regions.reduce((s, r) => s + r.countries.length, 0);
console.error(`Matched ${nMatched} countries grouped into ${regions.filter(r=>r.countries.length).length} regions.`);
// Strip heavy properties from the world feature collection — we only need
// geometry. Keeps the embedded payload manageable; borders are drawn for ALL
// countries (including those without an illustration) for full-world context.
const allBorders = {
  type: 'FeatureCollection',
  features: world.features.map(f => ({ type: 'Feature', geometry: f.geometry })),
};


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
  .graticule { fill: none; stroke: #1b3a52; stroke-width: .5;
    vector-effect: non-scaling-stroke; }
  /* country contour lines, drawn on top of the illustrations */
  .borders { pointer-events: none; }
  .country-border { fill: none; stroke: #0a0a0a; stroke-width: 1.4;
    vector-effect: non-scaling-stroke; stroke-linejoin: round; stroke-linecap: round; }
  .borders.thin .country-border { stroke-width: .7; }
  .borders.bold .country-border { stroke-width: 2.4; }
  .borders.light .country-border { stroke: #f5f5f5; }
  .borders.gold  .country-border { stroke: #f0c64a; }
  .borders.off { display: none; }
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
  button.bord, button.bordcol, button.fit { flex: 1; min-width: 50px; padding: 6px 8px; border-radius: 7px;
    border: 1px solid rgba(91,191,255,.25); background: rgba(255,255,255,.04);
    color: #cde; font-size: .78rem; cursor: pointer; }
  button.bord.active, button.bordcol.active, button.fit.active { background: #234058; border-color: #5bbfff; color: #fff; }
  label.chk { display: flex; align-items: center; gap: 7px; font-size: .82rem; color: #acc; cursor: pointer; }
  .hint { font-size: .72rem; color: #5a7e98; margin-top: 8px; }
</style></head>
<body>
<svg id="map"></svg>
<div id="panel">
  <h1>Jonas geografi på kartan</h1>
  <p>${nMatched} länder placerade per kontinent. Dra för att snurra/panorera, scrolla för att zooma.</p>
  <div class="row">
    <button class="proj active" data-proj="mercator">Mercator</button>
    <button class="proj" data-proj="equalEarth">Equal Earth</button>
    <button class="proj" data-proj="globe">Glob 🌍</button>
  </div>
  <div style="font-size:.78rem;color:#7ea6c4;margin-bottom:6px">Passning per kontinent:</div>
  <div class="row">
    <button class="fit" data-fit="similarity">Likformig</button>
    <button class="fit active" data-fit="affine">Affin</button>
  </div>
  <div style="font-size:.78rem;color:#7ea6c4;margin-bottom:6px">Konturer (riktiga landgränser ovanp&aring;):</div>
  <div class="row">
    <button class="bord" data-bord="off">Av</button>
    <button class="bord" data-bord="thin">Tunn</button>
    <button class="bord active" data-bord="">Normal</button>
    <button class="bord" data-bord="bold">Tjock</button>
  </div>
  <div class="row">
    <button class="bordcol active" data-bordcol="">M&ouml;rk</button>
    <button class="bordcol" data-bordcol="light">Ljus</button>
    <button class="bordcol" data-bordcol="gold">Guld</button>
  </div>
</div>

<script>${d3src}</script>
<script>
const REGIONS_DATA = ${JSON.stringify(regions.filter(r => r.countries.length))};
const ALL_BORDERS = ${JSON.stringify(allBorders)};
const svg = d3.select('#map');
let W = innerWidth, H = innerHeight;
let projName = 'mercator';
let k = 1, tx = 0, ty = 0;            // screen-space zoom/pan
let rotate = [-10, -20];              // globe rotation

// Everything that should pan/zoom together lives under root, including the
// ocean disc and graticule (otherwise the globe sphere stays put while the
// continents on it scale, which looks broken).
const root   = svg.append('g');
const defs   = svg.append('defs');
// Clip everything inside root to the visible sphere on the globe, so continent
// images stretched by the per-region affine fit can't spill into outer space.
defs.append('clipPath').attr('id', 'sphereClip').append('path').attr('id', 'sphereClipPath');
const gOcean = root.append('path').attr('class', 'ocean');
const gGrat  = root.append('path').attr('class', 'graticule');
const gFill  = root.append('g');
const gBord  = root.append('g').attr('class', 'borders');
const graticule = d3.geoGraticule10();
let bordStyle = '';   // '', 'thin', 'bold', 'off'
let bordColor = '';   // '', 'light', 'gold'
let fitMode = 'affine';   // 'affine' (6 dof) or 'similarity' (4 dof)
function applyBordClass() {
  gBord.attr('class', 'borders ' + bordStyle + ' ' + bordColor);
}

function makeProjection() {
  let p;
  if (projName === 'mercator') p = d3.geoMercator();
  else if (projName === 'equalEarth') p = d3.geoEqualEarth();
  else { p = d3.geoOrthographic().clipAngle(90).rotate(rotate); }
  if (projName === 'globe') p.fitExtent([[20,20],[W-20,H-20]], {type:'Sphere'});
  else p.fitExtent([[10,10],[W-10,H-10]], ALL_BORDERS);
  return p;
}

let projection = makeProjection();
let geoPath = d3.geoPath(projection);

// Build per-region DOM. Each region is one <g> containing every illustrated
// country at its position from the source region map (config.json). The region
// group then gets a single similarity transform per render that lines its
// countries' centroids up with where the matching real countries land on the
// current projection. This preserves the relative composition you drew while
// rotating, scaling and translating the whole continent into place.
for (const r of REGIONS_DATA) {
  r._centroids = r.countries.map(c => d3.geoCentroid({type:'Feature', geometry: c.geometry}));
  r._regionPts = r.countries.map(c => [c.left + c.width/2, c.top + c.height/2]);
  r._group = gFill.append('g').attr('class', 'region-' + r.slug);
  for (const c of r.countries) {
    r._group.append('image')
      .attr('href', c.svg)
      .attr('x', c.left).attr('y', c.top)
      .attr('width', c.width).attr('height', c.height);
  }
}
// One border path per world country, drawn on top of every fill.
const borderPaths = ALL_BORDERS.features.map(f =>
  gBord.append('path').attr('class', 'country-border').datum(f));

function applyRoot() { root.attr('transform', 'translate('+tx+','+ty+') scale('+k+')'); }

// 2D similarity fit (rotation + uniform scale + translation). 4 dof, robust.
// Returns coefficients for SVG matrix(a, b, -b, a, tx, ty).
function fitSimilarity(srcPts, dstPts) {
  const n = srcPts.length;
  if (n < 2) return null;
  let mSx = 0, mSy = 0, mDx = 0, mDy = 0;
  for (let i = 0; i < n; i++) {
    mSx += srcPts[i][0]; mSy += srcPts[i][1];
    mDx += dstPts[i][0]; mDy += dstPts[i][1];
  }
  mSx /= n; mSy /= n; mDx /= n; mDy /= n;
  let varS = 0, cAA = 0, cAB = 0;
  for (let i = 0; i < n; i++) {
    const sx = srcPts[i][0] - mSx, sy = srcPts[i][1] - mSy;
    const dx = dstPts[i][0] - mDx, dy = dstPts[i][1] - mDy;
    varS += sx*sx + sy*sy;
    cAA  += sx*dx + sy*dy;
    cAB  += sx*dy - sy*dx;
  }
  if (varS < 1e-9) return null;
  const a = cAA / varS, b = cAB / varS;
  return { a, b, c: -b, d: a,
    tx: mDx - a*mSx + b*mSy,
    ty: mDy - b*mSx - a*mSy };
}

// 2D affine fit (rotation + independent x/y scale + shear + translation),
// 6 dof, by closed-form least squares (Cramer's rule on the 3x3 normal eqns).
// Returns matrix coefficients (a, b, c, d, tx, ty) for SVG matrix(a, b, c, d, tx, ty),
// i.e. x' = a·x + c·y + tx,  y' = b·x + d·y + ty.
function fitAffine(srcPts, dstPts) {
  const n = srcPts.length;
  if (n < 3) return fitSimilarity(srcPts, dstPts);
  let Sxx=0, Sxy=0, Syy=0, Sx=0, Sy=0;
  let SxX=0, SyX=0, SX=0, SxY=0, SyY=0, SY=0;
  for (let i = 0; i < n; i++) {
    const x = srcPts[i][0], y = srcPts[i][1];
    const X = dstPts[i][0], Y = dstPts[i][1];
    Sxx += x*x; Sxy += x*y; Syy += y*y; Sx += x; Sy += y;
    SxX += x*X; SyX += y*X; SX += X;
    SxY += x*Y; SyY += y*Y; SY += Y;
  }
  // Normal-equations matrix M = [[Sxx,Sxy,Sx],[Sxy,Syy,Sy],[Sx,Sy,n]]
  const det = Sxx*(Syy*n - Sy*Sy) - Sxy*(Sxy*n - Sy*Sx) + Sx*(Sxy*Sy - Syy*Sx);
  if (Math.abs(det) < 1e-9) return fitSimilarity(srcPts, dstPts);
  const id = 1/det;
  function solve(r0, r1, r2) {
    const da = r0 *(Syy*n  - Sy*Sy) - Sxy*(r1 *n  - Sy*r2) + Sx *(r1 *Sy - Syy*r2);
    const dc = Sxx*(r1 *n  - Sy*r2) - r0 *(Sxy*n  - Sy*Sx) + Sx *(Sxy*r2 - r1 *Sx);
    const dt = Sxx*(Syy*r2 - r1*Sy) - Sxy*(Sxy*r2 - r1*Sx) + r0 *(Sxy*Sy - Syy*Sx);
    return [da*id, dc*id, dt*id];
  }
  const [a, c, tx] = solve(SxX, SyX, SX);
  const [b, d, ty] = solve(SxY, SyY, SY);
  return { a, b, c, d, tx, ty };
}

function render() {
  const onGlobe = projName === 'globe';
  const sphereD = onGlobe ? geoPath({type:'Sphere'}) : null;
  gOcean.attr('d', sphereD).style('display', onGlobe ? null : 'none');
  d3.select('#sphereClipPath').attr('d', sphereD);
  // Clip fills + borders to the sphere on the globe so continent groups
  // stretched by the per-region affine can't extend past the horizon.
  gFill.attr('clip-path', onGlobe ? 'url(#sphereClip)' : null);
  gBord.attr('clip-path', onGlobe ? 'url(#sphereClip)' : null);
  gGrat.attr('d', geoPath(graticule));
  for (const bp of borderPaths) bp.attr('d', geoPath(bp.datum()));
  // d3 clips back-side points (returns null) on the globe; that makes the per-
  // region fit jitter as countries cross the horizon. Use a visibility check
  // against the view centre instead — back-side countries are excluded from the
  // fit, and the whole region is hidden once too few of its countries remain.
  const viewCentre = onGlobe ? [-rotate[0], -rotate[1]] : null;
  for (const r of REGIONS_DATA) {
    const dst = [];
    const src = [];
    for (let i = 0; i < r.countries.length; i++) {
      if (onGlobe && d3.geoDistance(viewCentre, r._centroids[i]) > Math.PI/2 - 0.05) continue;
      const sp = projection(r._centroids[i]);
      if (sp && isFinite(sp[0]) && isFinite(sp[1])) {
        dst.push(sp);
        src.push(r._regionPts[i]);
      }
    }
    if (src.length < (onGlobe ? 3 : 2)) {
      r._group.style('display', 'none');
      continue;
    }
    const T = (fitMode === 'affine' ? fitAffine : fitSimilarity)(src, dst);
    if (!T) { r._group.style('display', 'none'); continue; }
    r._group.style('display', null)
      .attr('transform', 'matrix(' + T.a + ',' + T.b + ',' + T.c + ',' + T.d + ',' + T.tx + ',' + T.ty + ')');
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
// Fit-mode buttons (similarity vs affine)
d3.selectAll('button.fit').on('click', function() {
  d3.selectAll('button.fit').classed('active', false);
  d3.select(this).classed('active', true);
  fitMode = this.dataset.fit;
  render();
});

// Border style / colour buttons
d3.selectAll('button.bord').on('click', function() {
  d3.selectAll('button.bord').classed('active', false);
  d3.select(this).classed('active', true);
  bordStyle = this.dataset.bord;
  applyBordClass();
});
d3.selectAll('button.bordcol').on('click', function() {
  d3.selectAll('button.bordcol').classed('active', false);
  d3.select(this).classed('active', true);
  bordColor = this.dataset.bordcol;
  applyBordClass();
});

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
