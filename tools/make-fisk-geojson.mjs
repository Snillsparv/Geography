#!/usr/bin/env node
// Michigans fisk på den engelska USA-kartan som polygon i lng/lat:
// tools/data/usa-en-fisk.geojson. make-tiles --lang en fredar konsten
// innanför den från snäpp-passets klipp och kantätning (FREDAD_KONST_EN),
// och postprocess-usa-data.py --lang en gör den till Michigans utstickare:
// fisken visas ovanpå sjöarna och Kanadas halva när Michigan är avslöjad.
//
// Konturen spåras (marching squares, alfa 128) ur den synliga fisken
// (psd/engelska/michigan-fisk.png: framdelen plus bakdelen där vanten inte
// täcker den), snittad med den bakade SVG:ns egen alfa så att polygonen
// aldrig når utanför det som faktiskt ritas (vektoriseringen rundar
// fenspetsarna), och krympt KRYMP PSD-px. Bakningens steg 3 gör nämligen
// den halvgenomskinliga fransen till opak underläggsfärg utan att fråga
// fredad(), och den fransen får inte hamna innanför polygonen — då fick
// fisken en röd rand ute i sjön. Hål i fisken fylls (inne i fisken ska
// aldrig sjön synas). Dukpunkterna läggs på jorden genom Michigans
// varpnät, som make-tiles --varpnat skriver ut: exakt bakningens varp.
//
//   node tools/make-fisk-geojson.mjs [--krymp 1]
//
// Körs om när fiskmasken, Michigans engelska bild eller placering, eller
// varpen (svenska ankarbilder och placeringar) ändras — och då bakas
// usa-en om. Tar några sekunder.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { Resvg } from '@resvg/resvg-js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : dflt;
};

const LANG = 'en';
const KEY = 'usa/michigan';
const MASK = 'psd/engelska/michigan-fisk.png';
const UT = 'tools/data/usa-en-fisk.geojson';
// krympning i PSD-px (min-filter över en skiva med den radien): fransen
// är under en z7-pixel, en PSD-px är ~1,8 z7-px
const KRYMP = +arg('krymp', 1);
const TROSKEL = 127.5;          // alfa: över = fisk
const MINSTA = 20;              // PSD-px²: mindre bitar (lösa prickar) tas bort
const FORENKLING = 0.15;        // PSD-px, Douglas–Peucker på konturen

// ── 1) Michigans varpnät, ur bakningens egen kod ──
const tmp = mkdtempSync(path.join(os.tmpdir(), 'fisk-'));
function varpnat(lang) {
  const fil = path.join(tmp, `varpnat-${lang || 'sv'}.json`);
  execFileSync(process.execPath, [path.join(here, 'make-tiles.mjs'), '--dataset', 'usa',
    ...(lang ? ['--lang', lang] : []), '--varpnat', fil], { stdio: ['ignore', 'ignore', 'inherit'] });
  const regioner = JSON.parse(readFileSync(fil, 'utf8'));
  const r = regioner.find(x => x.countries.some(c => c.key === KEY));
  if (!r) throw new Error(`hittar inte ${KEY} i varpnäten`);
  return { grid: r.grid, stat: r.countries.find(c => c.key === KEY) };
}
let en, sv;
try {
  en = varpnat(LANG);
  sv = varpnat(null);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
// kontroll: den engelska varpen ska vara den svenska (förankrad i de svenska
// bilderna) — gallret har samma rutnät, bara möjligen fler noder
{
  const a = en.grid, b = sv.grid;
  const dx = (a.x0 - b.x0) / a.step, dy = (a.y0 - b.y0) / a.step;
  let max = 0, n = 0;
  for (let gy = 0; gy <= a.ny; gy++) for (let gx = 0; gx <= a.nx; gx++) {
    const hx = gx + dx, hy = gy + dy;
    if (hx < 0 || hy < 0 || hx > b.nx || hy > b.ny) continue;
    const i = (gy * (a.nx + 1) + gx) * 2, j = (hy * (b.nx + 1) + hx) * 2;
    max = Math.max(max, Math.abs(a.u[i] - b.u[j]), Math.abs(a.u[i + 1] - b.u[j + 1]));
    n++;
  }
  console.log(`Varpnät: ${n} gemensamma noder, största skillnad mot svenska ${max} ` +
    `(${(max * 40075).toFixed(4)} km)`);
  if (max > 0) console.warn('VARNING: den engelska varpen är inte den svenska — kolla ankarna i matchRegions');
}
const g = en.grid;
const duk = en.stat;   // Michigans engelska placering på duken (config.en.json)

// ── 2) fiskens alfa ∧ SVG:ns alfa, i PSD-px ──
async function alfa(png) {
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  return { w: img.width, h: img.height, d: cx.getImageData(0, 0, img.width, img.height).data };
}
const fisk = await alfa(readFileSync(path.join(repo, MASK)));
const W = fisk.w, H = fisk.h;
const konf = JSON.parse(readFileSync(path.join(repo, 'assets/usa/config.en.json'), 'utf8'));
const ov = konf.countries.find(c => c.filename === KEY.split('/')[1]);
const svgFil = path.join(repo, 'assets/usa', ov.file.replace(/\.[^.]+$/, '.svg'));
const svg = await alfa(new Resvg(readFileSync(svgFil, 'utf8'), { fitTo: { mode: 'width', value: W } }).render().asPng());
if (svg.w !== W || svg.h !== H) throw new Error(`${svgFil}: ${svg.w}×${svg.h}, masken ${W}×${H}`);
if (duk.left !== ov.left || duk.top !== ov.top || duk.width !== ov.width || duk.height !== ov.height) {
  throw new Error('bakningens placering av Michigan är inte config.en.json:s');
}
// gråskalemasken läses som RGB (R = G = B = grånivån)
let falt = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) falt[i] = Math.min(fisk.d[i * 4], svg.d[i * 4 + 3]);
// krymp: min över en skiva med radien KRYMP
if (KRYMP > 0) {
  const r = Math.ceil(KRYMP), offs = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy <= KRYMP * KRYMP + 1e-9) offs.push([dx, dy]);
  }
  const ny = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = 255;
    for (const [dx, dy] of offs) {
      const xx = x + dx, yy = y + dy;
      const v = xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : falt[yy * W + xx];
      if (v < m) m = v;
    }
    ny[y * W + x] = m;
  }
  falt = ny;
}

// ── 3) marching squares på pixelmitterna (kanten runt bilden räknas som 0) ──
const val = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : falt[y * W + x]);
const in_ = (x, y) => val(x, y) > TROSKEL;
const EW = W + 2;
// kantpunkternas id: vågrät kant (x,y)–(x+1,y) och lodrät (x,y)–(x,y+1),
// x och y från −1
const hId = (x, y) => ((y + 1) * EW + (x + 1)) * 2;
const vId = (x, y) => ((y + 1) * EW + (x + 1)) * 2 + 1;
const punkt = id => {
  const k = id >> 1, x = (k % EW) - 1, y = Math.floor(k / EW) - 1;
  if (id & 1) {
    const a = val(x, y), b = val(x, y + 1);
    return [x + 0.5, y + 0.5 + (TROSKEL - a) / (b - a)];
  }
  const a = val(x, y), b = val(x + 1, y);
  return [x + 0.5 + (TROSKEL - a) / (b - a), y + 0.5];
};
const segA = [], segB = [];
const vidKant = new Map();   // kant-id → segment
const lagg = (a, b) => {
  const s = segA.length;
  segA.push(a); segB.push(b);
  for (const e of [a, b]) {
    const l = vidKant.get(e);
    if (l) l.push(s); else vidKant.set(e, [s]);
  }
};
for (let y = -1; y < H; y++) {
  for (let x = -1; x < W; x++) {
    const tl = in_(x, y), tr = in_(x + 1, y), br = in_(x + 1, y + 1), bl = in_(x, y + 1);
    const fall = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
    if (fall === 0 || fall === 15) continue;
    const T = hId(x, y), B = hId(x, y + 1), L = vId(x, y), R = vId(x + 1, y);
    switch (fall) {
      case 1: case 14: lagg(L, B); break;
      case 2: case 13: lagg(B, R); break;
      case 3: case 12: lagg(L, R); break;
      case 4: case 11: lagg(T, R); break;
      case 6: case 9: lagg(T, B); break;
      case 7: case 8: lagg(L, T); break;
      case 5: case 10: {
        // sadel: mitten avgör vilka hörn som hänger ihop
        const mitt = (val(x, y) + val(x + 1, y) + val(x + 1, y + 1) + val(x, y + 1)) / 4 > TROSKEL;
        if ((fall === 10) === mitt) { lagg(T, R); lagg(L, B); } else { lagg(L, T); lagg(B, R); }
        break;
      }
    }
  }
}
// länka segmenten till slutna ringar
const anvand = new Uint8Array(segA.length);
const ringar = [];
for (let s0 = 0; s0 < segA.length; s0++) {
  if (anvand[s0]) continue;
  anvand[s0] = 1;
  const start = segA[s0];
  const ring = [punkt(start)];
  let kant = segB[s0], s = s0;
  while (kant !== start) {
    ring.push(punkt(kant));
    const l = vidKant.get(kant);
    const nasta = l.find(t => t !== s && !anvand[t]);
    if (nasta === undefined) throw new Error('öppen kontur');
    anvand[nasta] = 1;
    kant = segA[nasta] === kant ? segB[nasta] : segA[nasta];
    s = nasta;
  }
  ringar.push(ring);
}
const yta = ring => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return a / 2;
};
const inuti = ([px, py], ring) => {
  let ut = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) ut = !ut;
  }
  return ut;
};
const stora = ringar.filter(r => Math.abs(yta(r)) >= MINSTA);
// yttre ringar (inte inuti någon annan); hål och öar i hål fylls
const yttre = stora.filter(r => !stora.some(o => o !== r && Math.abs(yta(o)) > Math.abs(yta(r)) && inuti(r[0], o)));
console.log(`Kontur: ${ringar.length} ringar, ${stora.length} större än ${MINSTA} PSD-px², ` +
  `${yttre.length} yttre (${stora.length - yttre.length} hål fyllda, ` +
  `${ringar.length - stora.length} prickar bort)`);

// ── 4) förenkla, lägg på duken och genom varpen ──
function dp(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
  let max = -1, k = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
    if (d > max) { max = d; k = i; }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  return dp(pts.slice(0, k + 1), eps).slice(0, -1).concat(dp(pts.slice(k), eps));
}
function forenkla(ring) {
  // dela den slutna ringen vid punkten längst från första punkten
  let k = 0, max = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > max) { max = d; k = i; }
  }
  const a = dp(ring.slice(0, k + 1), FORENKLING), b = dp(ring.slice(k).concat([ring[0]]), FORENKLING);
  return a.slice(0, -1).concat(b.slice(0, -1));
}
const sx = duk.width / W, sy = duk.height / H;
function varpa([px, py]) {
  const x = duk.left + px * sx, y = duk.top + py * sy;
  const fx = (x - g.x0) / g.step, fy = (y - g.y0) / g.step;
  const gx = Math.min(g.nx - 1, Math.max(0, Math.floor(fx)));
  const gy = Math.min(g.ny - 1, Math.max(0, Math.floor(fy)));
  const u = fx - gx, v = fy - gy;
  const nod = (a, b) => { const i = (b * (g.nx + 1) + a) * 2; return [g.u[i], g.u[i + 1]]; };
  const A = nod(gx, gy), B = nod(gx + 1, gy), D = nod(gx, gy + 1), C = nod(gx + 1, gy + 1);
  const mx = A[0] * (1 - u) * (1 - v) + B[0] * u * (1 - v) + D[0] * (1 - u) * v + C[0] * u * v;
  const my = A[1] * (1 - u) * (1 - v) + B[1] * u * (1 - v) + D[1] * (1 - u) * v + C[1] * u * v;
  const lng = (mx - 0.5) * 360;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180 / Math.PI;
  return [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
}
const polys = [];
let nPunkter = 0;
let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
for (const r of yttre) {
  let ll = forenkla(r).map(varpa);
  // moturs i lng/lat (RFC 7946); bildens y pekar nedåt, latituden uppåt
  if (yta(ll) < 0) ll.reverse();
  ll.push(ll[0]);
  nPunkter += ll.length;
  for (const [a, b] of ll) { x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b); }
  polys.push([ll]);
}
writeFileSync(path.join(repo, UT), JSON.stringify({
  type: 'FeatureCollection',
  features: [{
    type: 'Feature', id: duk.gid,
    properties: { gid: duk.gid, key: KEY, kalla: MASK, krymp: KRYMP },
    geometry: { type: 'MultiPolygon', coordinates: polys },
  }],
}));
console.log(`Skrev ${UT}: ${polys.length} delar, ${nPunkter} punkter, ` +
  `lng ${x0.toFixed(3)}…${x1.toFixed(3)}, lat ${y0.toFixed(3)}…${y1.toFixed(3)}.`);
