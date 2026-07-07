#!/usr/bin/env node
// Generate redraw templates: one high-resolution PNG per country with the
// TRUE Web-Mercator outline to draw inside — light grey fill, crisp black
// contour, a faint 5° graticule for proportion, and the current artwork
// ghosted at low opacity inside the shape as a motif reference.
//
// Draw your new art inside the black contour (any canvas size — keep the
// proportions), export as PNG/SVG, and the tile pipeline takes it from there.
//
// Usage: node tools/make-templates.mjs [a3 ...]    (default: RUS CAN USA)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { Resvg } from '@resvg/resvg-js';
import { geoArea } from 'd3-geo';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');

const SPECS = {
  RUS: { sv: 'Ryssland', art: 'assets/asien/countries/ryssland.svg' },
  CAN: { sv: 'Kanada', art: 'assets/nordamerika/countries/kanada.svg' },
  USA: { sv: 'USA', art: 'assets/nordamerika/countries/usa.svg' },
  MEX: { sv: 'Mexiko', art: 'assets/nordamerika/countries/mexiko.svg' },
  CHN: { sv: 'Kina', art: 'assets/asien/countries/kina.svg' },
  MNG: { sv: 'Mongoliet', art: 'assets/asien/countries/mongoliet.svg' },
  KAZ: { sv: 'Kazakstan', art: 'assets/asien/countries/kazakstan.svg' },
  GRL: { sv: 'Grönland', art: null },
  ATA: { sv: 'Antarktis', art: null },
};
const WANT = process.argv.slice(2).length ? process.argv.slice(2).map(s => s.toUpperCase()) : ['RUS', 'CAN', 'USA'];

const MAX_LAT = 85.051128779807;
const mercX = lng => lng / 360 + 0.5;
const mercY = lat => {
  const phi = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI / 180;
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI);
};

const fc = JSON.parse(readFileSync(path.join(here, 'data/ne_50m_countries.geojson'), 'utf8'));
const byA3 = {};
for (const f of fc.features) {
  for (const k of ['ISO_A3', 'ADM0_A3']) {
    if (f.properties[k] && f.properties[k] !== '-99' && !(f.properties[k] in byA3)) byA3[f.properties[k]] = f;
  }
}

const OUTW = 4000;          // template width, px
const MARGIN = 120;

async function makeTemplate(a3) {
  const spec = SPECS[a3];
  const feat = byA3[a3];
  if (!spec || !feat) { console.error(`hoppar över ${a3} (okänd)`); return; }

  // project rings, unwrapped around the centroid-ish first big ring
  const polys = feat.geometry.type === 'Polygon' ? [feat.geometry.coordinates] : feat.geometry.coordinates;
  const refLng = polys[0][0][0][0];
  const rings = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polys) {
    if (geoArea({ type: 'Polygon', coordinates: poly }) < 5e-7) continue;
    for (const ring of poly) {
      const pts = [];
      for (const [lngRaw, lat] of ring) {
        let lng = lngRaw;
        while (lng - refLng > 180) lng -= 360;
        while (lng - refLng < -180) lng += 360;
        const x = mercX(lng), y = mercY(lat);
        pts.push([x, y]);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      rings.push(pts);
    }
  }

  const scale = (OUTW - 2 * MARGIN) / (maxX - minX);
  const H = Math.round((maxY - minY) * scale) + 2 * MARGIN + 80;
  const W = OUTW;
  const px = x => MARGIN + (x - minX) * scale;
  const py = y => MARGIN + 80 + (y - minY) * scale;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // faint 5° graticule
  ctx.strokeStyle = '#cfe3f0';
  ctx.lineWidth = 1;
  const lngA = (minX - 0.5) * 360, lngB = (maxX - 0.5) * 360;
  for (let lng = Math.ceil(lngA / 5) * 5; lng <= lngB; lng += 5) {
    ctx.beginPath(); ctx.moveTo(px(lng / 360 + 0.5), py(minY)); ctx.lineTo(px(lng / 360 + 0.5), py(maxY)); ctx.stroke();
  }
  for (let lat = -85; lat <= 85; lat += 5) {
    const y = mercY(lat);
    if (y < minY || y > maxY) continue;
    ctx.beginPath(); ctx.moveTo(px(minX), py(y)); ctx.lineTo(px(maxX), py(y)); ctx.stroke();
  }

  // shape: fill + ghost art + contour
  const trace = () => {
    ctx.beginPath();
    for (const pts of rings) {
      ctx.moveTo(px(pts[0][0]), py(pts[0][1]));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(px(pts[i][0]), py(pts[i][1]));
      ctx.closePath();
    }
  };
  trace();
  ctx.fillStyle = '#ececec';
  ctx.fill('evenodd');

  if (spec.art && existsSync(path.join(repo, spec.art))) {
    const png = new Resvg(readFileSync(path.join(repo, spec.art), 'utf8'), { fitTo: { mode: 'width', value: 2000 } }).render().asPng();
    const img = await loadImage(png);
    ctx.save();
    trace();
    ctx.clip('evenodd');
    ctx.globalAlpha = 0.18;
    ctx.drawImage(img, px(minX), py(minY), (maxX - minX) * scale, (maxY - minY) * scale);
    ctx.restore();
  }

  trace();
  ctx.strokeStyle = '#000000';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.stroke();

  // label
  ctx.fillStyle = '#444';
  ctx.font = 'bold 44px sans-serif';
  ctx.fillText(`${spec.sv} — Mercator-kontur (rita innanför den svarta linjen)`, MARGIN, 60);
  ctx.font = '26px sans-serif';
  ctx.fillText('Ljusblå linjer = 5° lat/lng · skuggbilden = din nuvarande teckning som referens', MARGIN, 100);

  mkdirSync(path.join(repo, 'templates'), { recursive: true });
  const out = path.join(repo, 'templates', `${spec.sv.toLowerCase().replace(/ /g, '_')}-mall.png`);
  writeFileSync(out, await canvas.encode('png'));
  console.log(`skrev ${out} (${W}×${H})`);
}

for (const a3 of WANT) await makeTemplate(a3);
