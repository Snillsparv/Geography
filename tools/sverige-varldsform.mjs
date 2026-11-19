// ──────────────────────────────────────────────────────────────────────────
// Landskapen i världskartans Sverigeform.
//
// USA:s delstater varpas mot sina riktiga gränser (us_states.geojson), och
// bakningens snäpp-pass klipper/fyller dem sedan mot världskartans målade
// USA — de två formerna ligger nästan på varandra. För Sverige gör de inte
// det: världskartans Sverige (Marge) är smalare än det riktiga, Norges val
// täcker fjällkedjan (västra Jämtland, Härjedalen och Dalarna), och nordspetsen
// går nästan en grad längre norrut. Varpade mot de riktiga gränserna och
// sedan klippta till Marges yta blev Jämtlands och Härjedalens västra halvor
// lösa bitar ute över Norges blå.
//
// Det här skriptet flyttar därför landskapsgränserna in i den MÅLADE formen
// innan bakningen pinnar teckningarna mot dem:
//
// - fastlandet rad för rad i Mercator: radens västra och östra kant i det
//   riktiga Sverige (utjämnade över några rader, så fjordar och skärgård
//   inte vrider allt) sträcks linjärt till samma rads kanter i den målade
//   formen, och raderna fördelas linjärt mellan sydspets och nordspets.
// - Gotland och Öland: var och en till sin målade ö med en egen affin
//   (bbox mot bbox).
//
// Ut: tools/data/svenska_landskap_varld.geojson, som make-tiles --dataset
// sverige läser i stället för de riktiga gränserna. Körs om när världs-
// kartan (art-regions.json) bakats om:
//
//   node tools/sverige-varldsform.mjs
// ──────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const IN = path.join(here, 'data/svenska_landskap.geojson');
const UT = path.join(here, 'data/svenska_landskap_varld.geojson');

const MAX_LAT = 85.051128779807;
const mercX = lng => lng / 360 + 0.5;
const mercY = lat => {
  const phi = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI / 180;
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI);
};
const invX = x => (x - 0.5) * 360;
const invY = y => (2 * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - Math.PI / 2) * 180 / Math.PI;

const OAR = new Set(['gotland', 'oland']);
const polys = g => g.type === 'Polygon' ? [g.coordinates] : g.coordinates;

const landskap = JSON.parse(readFileSync(IN, 'utf8'));
const varld = JSON.parse(readFileSync(path.join(repo, 'assets/art-regions.json'), 'utf8'));
const sv = varld.features.find(f => f.properties.key === 'europa/sverige' && !f.properties.dekor);
if (!sv) throw new Error('hittar inte europa/sverige i assets/art-regions.json');

// målade polygoner: största = fastlandet, resten öar
const ytaLL = ring => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(a / 2);
};
const malade = polys(sv.geometry).map(p => ({ p, yta: ytaLL(p[0]) })).sort((a, b) => b.yta - a.yta);
const maladFast = malade[0].p;
const maladeOar = malade.slice(1).map(m => m.p);

// ── rastrera i Mercator inom en gemensam ram ──
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
const utvidga = p => {
  for (const ring of p) for (const [lng, lat] of ring) {
    const x = mercX(lng), y = mercY(lat);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
};
for (const f of landskap.features) for (const p of polys(f.geometry)) utvidga(p);
utvidga(maladFast);
const RADER = 3000;
const skala = RADER / (maxY - minY);
const BRED = Math.ceil((maxX - minX) * skala) + 2;
const rastrera = lista => {
  const c = createCanvas(BRED, RADER + 2);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  for (const p of lista) for (const ring of p) {
    ring.forEach(([lng, lat], i) => {
      const x = (mercX(lng) - minX) * skala, y = (mercY(lat) - minY) * skala;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.closePath();
  }
  ctx.fill('nonzero');
  const d = ctx.getImageData(0, 0, BRED, RADER + 2).data;
  // per rad: västligaste och östligaste fyllda pixel
  const a = new Float64Array(RADER + 2).fill(NaN), b = new Float64Array(RADER + 2).fill(NaN);
  for (let y = 0; y < RADER + 2; y++) {
    for (let x = 0; x < BRED; x++) if (d[(y * BRED + x) * 4 + 3] > 127) { a[y] = x; break; }
    for (let x = BRED - 1; x >= 0; x--) if (d[(y * BRED + x) * 4 + 3] > 127) { b[y] = x + 1; break; }
  }
  return { a, b };
};
const riktigFast = [];
for (const f of landskap.features) {
  if (OAR.has(f.properties.filename)) continue;
  for (const p of polys(f.geometry)) riktigFast.push(p);
}
const R = rastrera(riktigFast);
const M = rastrera([maladFast]);
const spann = ({ a }) => {
  let y0 = -1, y1 = -1;
  for (let y = 0; y < a.length; y++) if (!Number.isNaN(a[y])) { if (y0 < 0) y0 = y; y1 = y; }
  return [y0, y1 + 1];
};
const [ry0, ry1] = spann(R), [my0, my1] = spann(M);
// utjämning: glidande median-fritt medel över ±UTJ rader (~0,4 % av längden),
// bara över rader som har land
const UTJ = 12;
const jamna = (v, y0, y1) => {
  const ut = new Float64Array(v.length).fill(NaN);
  for (let y = y0; y < y1; y++) {
    let s = 0, n = 0;
    for (let k = Math.max(y0, y - UTJ); k < Math.min(y1, y + UTJ + 1); k++) {
      if (!Number.isNaN(v[k])) { s += v[k]; n++; }
    }
    ut[y] = n ? s / n : NaN;
  }
  // hål (rader utan land mitt i) fylls från närmaste rad
  for (let y = y0 + 1; y < y1; y++) if (Number.isNaN(ut[y])) ut[y] = ut[y - 1];
  return ut;
};
const Ra = jamna(R.a, ry0, ry1), Rb = jamna(R.b, ry0, ry1);
const Ma = jamna(M.a, my0, my1), Mb = jamna(M.b, my0, my1);
const interp = (v, y, y0, y1) => {
  const t = Math.max(y0, Math.min(y1 - 1, y - 0.5));
  const i = Math.floor(t), f = t - i;
  const j = Math.min(y1 - 1, i + 1);
  return v[i] * (1 - f) + v[j] * f;
};
// en punkt i rasterpixlar (riktiga) → målade rasterpixlar
const fastland = (px, py) => {
  const ny = my0 + (py - ry0) * (my1 - my0) / (ry1 - ry0);
  const a = interp(Ra, py, ry0, ry1), b = interp(Rb, py, ry0, ry1);
  const a2 = interp(Ma, ny, my0, my1), b2 = interp(Mb, ny, my0, my1);
  const nx = a2 + (px - a) * (b2 - a2) / Math.max(1e-6, b - a);
  return [nx, ny];
};

// ── öarna: bbox mot bbox mot närmaste målade ö ──
const bboxM = p => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [lng, lat] of p[0]) {
    const x = mercX(lng), y = mercY(lat);
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
};
const oaffin = new Map();
for (const f of landskap.features) {
  if (!OAR.has(f.properties.filename)) continue;
  // största polygonen styr (småöar runt följer med)
  const ps = polys(f.geometry).slice().sort((p, q) => ytaLL(q[0]) - ytaLL(p[0]));
  const r = bboxM(ps[0]);
  let bast = null, bd = Infinity;
  for (const p of maladeOar) {
    const m = bboxM(p);
    const d = Math.hypot(m.cx - r.cx, m.cy - r.cy);
    if (d < bd) { bd = d; bast = m; }
  }
  if (!bast) throw new Error(`ingen målad ö för ${f.properties.filename}`);
  oaffin.set(f.properties.filename, ([x, y]) => [
    bast.x0 + (x - r.x0) * (bast.x1 - bast.x0) / (r.x1 - r.x0),
    bast.y0 + (y - r.y0) * (bast.y1 - bast.y0) / (r.y1 - r.y0),
  ]);
  console.log(`${f.properties.filename}: till målade ön ${invY(bast.cy).toFixed(2)}°N ${invX(bast.cx).toFixed(2)}°E`);
}

const r5 = v => Math.round(v * 1e5) / 1e5;
const flytta = (fn, [lng, lat]) => {
  const [x, y] = fn([mercX(lng), mercY(lat)]);
  return [r5(invX(x)), r5(invY(y))];
};
const fastFn = ([x, y]) => {
  const [nx, ny] = fastland((x - minX) * skala, (y - minY) * skala);
  return [nx / skala + minX, ny / skala + minY];
};
const ut = {
  type: 'FeatureCollection',
  features: landskap.features.map(f => {
    const fn = oaffin.get(f.properties.filename) || fastFn;
    const map = p => p.map(ring => ring.map(c => flytta(fn, c)));
    const geometry = f.geometry.type === 'Polygon'
      ? { type: 'Polygon', coordinates: map(f.geometry.coordinates) }
      : { type: 'MultiPolygon', coordinates: f.geometry.coordinates.map(map) };
    return { type: 'Feature', properties: { ...f.properties, varldsform: 1 }, geometry };
  }),
};
writeFileSync(UT, JSON.stringify(ut));
console.log(`fastlandet: riktiga rader ${ry0}–${ry1} → målade ${my0}–${my1} (av ${RADER}); ` +
  `skrev ${path.relative(repo, UT)}`);
