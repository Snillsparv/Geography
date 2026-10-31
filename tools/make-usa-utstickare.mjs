// Bygger delstatskonst som MEDVETET sticker ut över grannlandet
// (Pennsylvanias penna ur pennskrinet, upp över Eriesjön in i Ontario) som
// en egen bild, som spelet lägger ovanpå grannens gröna när delstaten är
// avslöjad.
//
// Konsten finns redan i delstatsarkivet — make-tiles fredar den från
// klippet (FREDAD_KONST) — men delstatsrastret ligger UNDER världens täcke,
// så Kanadas gröna döljer den. postprocess-usa-data.py skriver pennans
// fotavtryck till tools/data/usa-utstickare.json; här klipps samma pixlar
// ut ur arkivets största zoomnivå. Bilden hamnar i assets/usa/utstickare/
// och hörnen (lng/lat, medsols från nordväst) i assets/usa-utstickare.json.
//
//   node make-usa-utstickare.mjs [--tiles tiles/usa.pmtiles]
//
// Körs efter make-tiles --dataset usa och postprocess-usa-data.py.
import { closeSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { PMTiles } from 'pmtiles';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const TILES = path.resolve(repo, arg('tiles', 'tiles/usa.pmtiles'));
const TILE = 512;                      // make-tiles rutstorlek
const KANT = 2;                        // px marginal runt fotavtrycket

class FilKalla {
  constructor(p) { this.p = p; this.fd = openSync(p, 'r'); }
  getKey() { return this.p; }
  async getBytes(offset, length) {
    const b = Buffer.alloc(length);
    const n = readSync(this.fd, b, 0, length, offset);
    return { data: b.buffer.slice(b.byteOffset, b.byteOffset + n) };
  }
}

const kalla = new FilKalla(TILES);
const pm = new PMTiles(kalla);
const Z = (await pm.getHeader()).maxZoom;
const world = TILE * 2 ** Z;
const mx = lng => (lng / 360 + 0.5) * world;
const my = lat => (0.5 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / (2 * Math.PI)) * world;
const ilng = x => (x / world - 0.5) * 360;
const ilat = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / world))) * 180 / Math.PI;
const r5 = v => Math.round(v * 1e5) / 1e5;

const fc = JSON.parse(readFileSync(path.join(repo, 'tools/data/usa-utstickare.json'), 'utf8'));
const ut = [];
mkdirSync(path.join(repo, 'assets/usa/utstickare'), { recursive: true });
for (const f of fc.features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of polys) for (const [lng, lat] of poly[0]) {
    x0 = Math.min(x0, mx(lng)); x1 = Math.max(x1, mx(lng));
    y0 = Math.min(y0, my(lat)); y1 = Math.max(y1, my(lat));
  }
  x0 = Math.floor(x0) - KANT; y0 = Math.floor(y0) - KANT;
  x1 = Math.ceil(x1) + KANT; y1 = Math.ceil(y1) + KANT;
  const W = x1 - x0, H = y1 - y0;
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x1 - 1) / TILE); tx++) {
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y1 - 1) / TILE); ty++) {
      const r = await pm.getZxy(Z, tx, ty);
      if (!r) continue;
      const img = await loadImage(Buffer.from(r.data));
      ctx.drawImage(img, tx * TILE - x0, ty * TILE - y0);
    }
  }
  // klipp till fotavtrycket (kantutjämnat)
  const m = createCanvas(W, H);
  const mc = m.getContext('2d');
  mc.fillStyle = '#fff';
  mc.beginPath();
  for (const poly of polys) {
    for (const ring of poly) {
      ring.forEach(([lng, lat], i) => {
        const x = mx(lng) - x0, y = my(lat) - y0;
        if (i) mc.lineTo(x, y); else mc.moveTo(x, y);
      });
      mc.closePath();
    }
  }
  mc.fill('evenodd');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(m, 0, 0);
  const fil = f.properties.key.split('/')[1];
  const rel = `assets/usa/utstickare/${fil}.webp`;
  writeFileSync(path.join(repo, rel), await c.encode('webp', 90));
  ut.push({
    gid: f.properties.gid, key: f.properties.key, bild: rel,
    // MapLibre image-källans hörn: NV, NO, SO, SV
    hörn: [[ilng(x0), ilat(y0)], [ilng(x1), ilat(y0)], [ilng(x1), ilat(y1)], [ilng(x0), ilat(y1)]]
      .map(([a, b]) => [r5(a), r5(b)]),
  });
  console.log(`${rel}: ${W}×${H} px (z${Z}) för ${f.properties.namn}`);
}
closeSync(kalla.fd);
writeFileSync(path.join(repo, 'assets/usa-utstickare.json'), JSON.stringify(ut));
console.log(`Skrev assets/usa-utstickare.json: ${ut.length} bilder.`);
