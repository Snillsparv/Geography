#!/usr/bin/env node
// Generate a tiny SVG snippet of the world's continents — used as a true-shape
// fill for the loading-screen globes. Equirectangular projection, simplified
// rings, single combined path so the loaders stay snippet-sized.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');

const fc = JSON.parse(readFileSync(path.join(here, 'data/ne_50m_countries.geojson'), 'utf8'));

// Ramer-Douglas-Peucker, returns indices to keep.
function rdp(pts, eps) {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0, idx = -1;
    const [x1, y1] = pts[a], [x2, y2] = pts[b];
    const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy || 1;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = pts[i];
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L2));
      const px = x1 + t * dx, py = y1 + t * dy;
      const d = (x - px) ** 2 + (y - py) ** 2;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps * eps && idx !== -1) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

const W = 360, H = 180;                   // SVG viewBox
const EPS = 0.45;                          // RDP tolerance in viewBox units
const MIN_RING_PTS = 6;
const MIN_BBOX = 1.0;                      // skip rings smaller than this (×° of arc)

let paths = '';
for (const f of fc.features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) {
    for (const ring of poly) {
      const pts = ring.map(([lng, lat]) => [(lng + 180), 90 - lat]);   // equirect, y flip
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of pts) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      if (maxX - minX < MIN_BBOX && maxY - minY < MIN_BBOX) continue;
      const simp = rdp(pts, EPS);
      if (simp.length < MIN_RING_PTS) continue;
      const r2 = simp.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L');
      paths += `M${r2}Z`;
    }
  }
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${paths}" fill="#57c785"/></svg>`;
writeFileSync(path.join(repo, 'continents.svg'), svg);
console.log(`continents.svg: ${(svg.length / 1024).toFixed(1)} KB, ${paths.match(/M/g).length} ringar`);
