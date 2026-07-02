#!/usr/bin/env node
// Build wallmap-demo.html: den handritade världen som klassisk VÄGGKARTA.
// Sidan hämtar z3-rutorna ur tiles/world.pmtiles, bygger en Mercator-mosaik
// och varpar den per pixel till valbar projektion — Robinson (skolplansch),
// Miller, Equal Earth eller rektangulär plattkarta (Seterra-stil).
// Allt utom tile-arkivet är inlinat: en enda fil.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const pmtilesJs = readFileSync(path.join(here, 'node_modules/pmtiles/dist/pmtiles.js'), 'utf8');

const html = `<!DOCTYPE html>
<html lang="sv"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Jonas geografi – väggkarta</title>
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; height: 100%; background: #081320; font-family: system-ui, sans-serif; }
  #wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  canvas { max-width: 100%; max-height: 100%; }
  #panel { position: fixed; top: 14px; left: 14px; z-index: 5; background: rgba(10,22,38,.92);
    border: 1px solid rgba(91,191,255,.25); border-radius: 12px; padding: 14px 16px;
    backdrop-filter: blur(4px); max-width: 300px; color: #cde; }
  #panel h1 { font-size: 1rem; margin: 0 0 4px; }
  #panel p { font-size: .8rem; color: #7ea6c4; margin: 0 0 12px; line-height: 1.4; }
  .row { display: flex; gap: 6px; margin-bottom: 6px; flex-wrap: wrap; }
  button.opt { flex: 1 1 46%; padding: 7px 9px; border-radius: 8px;
    border: 1px solid rgba(91,191,255,.3); background: rgba(255,255,255,.04);
    color: #cde; font-size: .8rem; cursor: pointer; white-space: nowrap; }
  button.opt.active { background: #2980b9; border-color: #5bbfff; color: #fff; font-weight: 600; }
  #status { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%); z-index: 6;
    background: rgba(10,22,38,.94); border: 1px solid rgba(91,191,255,.3); border-radius: 10px;
    padding: 10px 18px; color: #cde; font-size: .82rem; }
  #status.hidden { display: none; }
  a { color: #5bbfff; }
</style></head>
<body>
<div id="wrap"><canvas id="c"></canvas></div>
<div id="panel">
  <h1>Jonas geografi – väggkarta</h1>
  <p>Samma förbakade karta, varpad till klassiska platta projektioner.
     <a href="globe-demo.html">Till jordgloben &rarr;</a></p>
  <div class="lbl"></div>
  <div class="row">
    <button class="opt proj active" data-p="robinson">Robinson (väggkarta)</button>
    <button class="opt proj" data-p="rect">Rektangulär (Seterra)</button>
  </div>
  <div class="row">
    <button class="opt proj" data-p="miller">Miller</button>
    <button class="opt proj" data-p="equalearth">Equal Earth</button>
  </div>
</div>
<div id="status">Hämtar kartrutor &hellip;</div>

<script>${pmtilesJs}</script>
<script type="module">
const TILE_URL = 'tiles/world.pmtiles';
const Z = 3, N = 1 << Z, T = 512, MOS = N * T;      // 4096 px Mercator-mosaik
const OCEAN = [8, 19, 32, 255];                     // sidbakgrundens ton utanför land = genomskinligt → mörkt

const status = document.getElementById('status');
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

// ── Mercator-mosaik från arkivet ──
const pm = new pmtiles.PMTiles(TILE_URL);
const mosaic = document.createElement('canvas');
mosaic.width = MOS; mosaic.height = MOS;
const mctx = mosaic.getContext('2d');
let mdata = null;
async function loadMosaic() {
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
const D2R = Math.PI / 180;
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
    // binärsök φ i RY-tabellen (monoton)
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

// ── Rendera vald projektion per pixel med bilinjär sampling ur mosaiken ──
const MAXLAT = 85.051128779807 * D2R;
function render(name) {
  const proj = PROJ[name];
  // projektionens utsträckning: skanna randen
  let xm = 0, ym = 0;
  for (let p = -90; p <= 90; p += 0.5) {
    const [x, y] = proj.forward(Math.PI, p * D2R);
    xm = Math.max(xm, Math.abs(x)); ym = Math.max(ym, Math.abs(y));
  }
  const availW = window.innerWidth - 24, availH = window.innerHeight - 24;
  let W = Math.min(1600, availW);
  let H = Math.round(W * ym / xm);
  if (H > availH) { H = availH; W = Math.round(H * xm / ym); }
  canvas.width = W; canvas.height = H;
  const id = ctx.createImageData(W, H);
  const out = id.data;
  const sx = 2 * xm / W, sy = 2 * ym / H;
  for (let py = 0; py < H; py++) {
    const yv = ym - (py + 0.5) * sy;
    for (let px = 0; px < W; px++) {
      const xv = (px + 0.5) * sx - xm;
      const ll = proj.inverse(xv, yv);
      const o = (py * W + px) * 4;
      if (!ll) continue;                                  // utanför kartytan → sidbakgrund
      const [l, p] = ll;
      out[o] = OCEAN[0]; out[o + 1] = OCEAN[1]; out[o + 2] = OCEAN[2]; out[o + 3] = 0;
      const mx = (l / (2 * Math.PI) + 0.5) * MOS - 0.5;
      const phi = Math.max(-MAXLAT, Math.min(MAXLAT, p));
      const my = (0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI)) * MOS - 0.5;
      // bilinjärt
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
      const SEA = [205, 228, 246];
      out[o] = r + SEA[0] * (1 - a);
      out[o + 1] = g + SEA[1] * (1 - a);
      out[o + 2] = b + SEA[2] * (1 - a);
      out[o + 3] = 255;
    }
  }
  ctx.putImageData(id, 0, 0);
}

let current = 'robinson';
status.textContent = 'Hämtar kartrutor …';
await loadMosaic();
status.classList.add('hidden');
render(current);

document.querySelectorAll('button.proj').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('button.proj').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  current = b.dataset.p;
  render(current);
}));
let rz;
window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => render(current), 200); });
</script>
</body></html>`;

writeFileSync(path.join(repo, 'wallmap-demo.html'), html);
console.error(`Wrote wallmap-demo.html (${(html.length / 1048576).toFixed(2)} MB raw).`);
