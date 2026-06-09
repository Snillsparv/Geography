#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────
// Bake the hand-drawn world into a Web-Mercator raster tile pyramid (PMTiles).
//
// Each hand-drawn region is warped as ONE rubber sheet: a single fixed grid
// over the region canvas, deformed by a Moving Least Squares field, shared by
// every country in the region. Because neighbouring countries sample the
// exact same grid nodes, the jigsaw the maps were drawn as stays glued —
// no cracks, no overlaps. The grid lives in region-canvas space and its
// warped node positions are computed once in unit-Mercator coordinates, then
// only scaled per zoom, so geometry is IDENTICAL at every zoom level (shapes
// never change as you zoom — deeper tiles are just sharper).
//
// The MLS control targets blend two anchors per country corner (--geo 0..1):
//   geo 0  →  the region's least-squares affine (the hand-drawn composition
//             reproduced exactly, like the old per-continent demo)
//   geo 1  →  the country's true projected bbox (max geographic accuracy)
//
// Tiles are 512×512 WebP, skipped where no artwork lands, packed into a single
// PMTiles archive servable from any static host with HTTP range requests.
//
// Usage:  node tools/make-tiles.mjs [--maxzoom 7] [--geo 0.5] [--out tiles/world.pmtiles]
// ──────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { Resvg } from '@resvg/resvg-js';
import { geoCentroid, geoArea } from 'd3-geo';
import { zxyToTileId } from 'pmtiles';
import { mlsAffine } from './lib/mls.mjs';
import { buildPmtiles } from './lib/pmtiles-write.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const MAXZOOM = +arg('maxzoom', 7);
const OUT = path.resolve(repo, arg('out', 'tiles/world.pmtiles'));
// Geographic pinning strength: 0 = pure region affine (hand-drawn composition
// exactly), 1 = countries pulled fully onto their real projected bboxes.
const GEO = Math.max(0, Math.min(1, +arg('geo', 0.5)));

const TILE = 512;
const RASTER_CAP = 8192;            // max raster width per country (memory)
const CACHE_BUDGET = 1.5e9;         // LRU raster cache, bytes
const GRID_STEP = 80;               // region-canvas px between shared warp-grid nodes

const REGIONS = ['europa', 'afrika', 'asien', 'nordamerika', 'sydamerika', 'oceanien', 'vastindien'];
// filename → Natural Earth A3 for spellings the name match can't bridge
const ALIAS = {
  indoneien: 'IDN', demokratiska_republiken_kongo: 'COD', eciador: 'ECU',
  kongo_brazaville: 'COG', burma: 'MMR', vitryssland: 'BLR', luxembourg: 'LUX',
  bosnien_hercegovina: 'BIH', makedonien: 'MKD',
  sao_tome__principe: 'STP', solomonoarna: 'SLB', marshaloarna: 'MHL',
  mikronesien: 'FSM', antigua__barbuda: 'ATG', saint_kitts__nevis: 'KNA',
  trinidad__tobago: 'TTO', saint_vincent__grenadinerna: 'VCT',
};

const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

// ── Web Mercator (unit square) ──
const MAX_LAT = 85.051128779807;
function mercX(lng) { return lng / 360 + 0.5; }
function mercY(lat) {
  const phi = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI / 180;
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI);
}

// ── Load Natural Earth; map_units first (England/Skottland/FXX/GUF …) ──
function loadFeatures() {
  const units = JSON.parse(readFileSync(path.join(here, 'data/ne_50m_map_units.geojson'), 'utf8'));
  const countries = JSON.parse(readFileSync(path.join(here, 'data/ne_50m_countries.geojson'), 'utf8'));
  const bySv = {}, byA3 = {};
  // countries first so map_units (more specific) overwrite shared names
  for (const fc of [countries, units]) {
    for (const f of fc.features) {
      const sv = norm(f.properties.NAME_SV);
      if (sv) bySv[sv] = f;
      for (const k of ['GU_A3', 'ISO_A3', 'ADM0_A3']) {
        const a3 = f.properties[k];
        if (a3 && a3 !== '-99' && !(a3 in byA3)) byA3[a3] = f;
      }
    }
  }
  return { bySv, byA3 };
}

// Geometry to anchor against, ignoring far-flung minor polygons (Alaska
// pulling USA west, etc.): if one polygon holds ≥70 % of the spherical area,
// anchor on that polygon alone; otherwise use the whole multipolygon
// (archipelagos like Indonesia, where the art covers everything).
function anchorGeometry(geometry) {
  if (geometry.type === 'MultiPolygon') {
    let best = null, bestArea = 0, total = 0;
    for (const coords of geometry.coordinates) {
      const a = geoArea({ type: 'Polygon', coordinates: coords });
      total += a;
      if (a > bestArea) { bestArea = a; best = coords; }
    }
    if (bestArea / total >= 0.7) {
      return { type: 'Polygon', coordinates: best };
    }
  }
  return geometry;
}

function matchRegions() {
  const { bySv, byA3 } = loadFeatures();
  const used = new Set();
  const regions = [];
  for (const slug of REGIONS) {
    const cfg = JSON.parse(readFileSync(path.join(repo, 'assets', slug, 'config.json'), 'utf8'));
    const countries = [];
    for (const c of cfg.countries) {
      const base = c.filename;
      const svgPath = path.join(repo, 'assets', slug, 'countries', base + '.svg');
      if (!existsSync(svgPath)) continue;
      const f = bySv[norm(base)] || (ALIAS[base] && byA3[ALIAS[base]]);
      if (!f) continue;
      const key = f.properties.GU_A3 || f.properties.ISO_A3 || f.properties.NAME;
      if (used.has(key)) continue;
      used.add(key);
      const anchor = anchorGeometry(f.geometry);
      countries.push({
        base, svgPath,
        left: c.left, top: c.top, width: c.width, height: c.height,
        centroid: geoCentroid(anchor),
        anchor,
      });
    }
    if (countries.length) regions.push({ slug, countries });
  }
  return regions;
}

// ── Per-region MLS in unit-mercator space, with longitude unwrap ──
// Four control points per country (art-quad corners → the corners of the
// country's projected bbox), so the warp pins both position AND scale per
// country: art fills its real footprint, including Mercator's polar stretch,
// while the space between countries still deforms smoothly.
function projectedBbox(anchor, refLng) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const polys = anchor.type === 'Polygon' ? [anchor.coordinates] : anchor.coordinates;
  for (const poly of polys) for (const [lngRaw, lat] of poly[0]) {
    let lng = lngRaw;
    while (lng - refLng > 180) lng -= 360;
    while (lng - refLng < -180) lng += 360;
    const x = mercX(lng), y = mercY(lat);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

// Least-squares 2D affine (6 dof) src→dst, closed form via normal equations.
function fitAffine(srcPts, dstPts) {
  const n = srcPts.length;
  let Sxx = 0, Sxy = 0, Syy = 0, Sx = 0, Sy = 0;
  let SxX = 0, SyX = 0, SX = 0, SxY = 0, SyY = 0, SY = 0;
  for (let i = 0; i < n; i++) {
    const [x, y] = srcPts[i], [X, Y] = dstPts[i];
    Sxx += x * x; Sxy += x * y; Syy += y * y; Sx += x; Sy += y;
    SxX += x * X; SyX += y * X; SX += X;
    SxY += x * Y; SyY += y * Y; SY += Y;
  }
  const det = Sxx * (Syy * n - Sy * Sy) - Sxy * (Sxy * n - Sy * Sx) + Sx * (Sxy * Sy - Syy * Sx);
  const solve = (r0, r1, r2) => {
    const da = r0 * (Syy * n - Sy * Sy) - Sxy * (r1 * n - Sy * r2) + Sx * (r1 * Sy - Syy * r2);
    const dc = Sxx * (r1 * n - Sy * r2) - r0 * (Sxy * n - Sy * Sx) + Sx * (Sxy * r2 - r1 * Sx);
    const dt = Sxx * (Syy * r2 - r1 * Sy) - Sxy * (Sxy * r2 - r1 * Sx) + r0 * (Sxy * Sy - Syy * Sx);
    return [da / det, dc / det, dt / det];
  };
  const [a, c, tx] = solve(SxX, SyX, SX);
  const [b, d, ty] = solve(SxY, SyY, SY);
  return v => [a * v[0] + c * v[1] + tx, b * v[0] + d * v[1] + ty];
}

function buildWarps(regions) {
  for (const r of regions) {
    const ref = r.countries[0].centroid[0];
    const unwrap = lng => {
      while (lng - ref > 180) lng -= 360;
      while (lng - ref < -180) lng += 360;
      return lng;
    };
    // region-wide compositional anchor: affine over centres → true centroids
    const A = fitAffine(
      r.countries.map(c => [c.left + c.width / 2, c.top + c.height / 2]),
      r.countries.map(c => [mercX(unwrap(c.centroid[0])), mercY(c.centroid[1])]),
    );
    // blended corner controls
    const controls = [];
    for (const c of r.countries) {
      const b = projectedBbox(c.anchor, ref);
      const corners = [
        [c.left, c.top], [c.left + c.width, c.top],
        [c.left + c.width, c.top + c.height], [c.left, c.top + c.height],
      ];
      const bq = [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]];
      corners.forEach((p, i) => {
        const qa = A(p);
        controls.push({ p, q: [qa[0] * (1 - GEO) + bq[i][0] * GEO, qa[1] * (1 - GEO) + bq[i][1] * GEO] });
      });
    }
    const warp = mlsAffine(controls);

    // ONE fixed grid over the whole region canvas, shared by all countries.
    // Node positions are evaluated once in unit Mercator: identical geometry
    // at every zoom (scaled only), and neighbours share nodes exactly.
    let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
    for (const c of r.countries) {
      if (c.left < minL) minL = c.left;
      if (c.top < minT) minT = c.top;
      if (c.left + c.width > maxR) maxR = c.left + c.width;
      if (c.top + c.height > maxB) maxB = c.top + c.height;
    }
    const x0 = Math.floor(minL / GRID_STEP - 1) * GRID_STEP;
    const y0 = Math.floor(minT / GRID_STEP - 1) * GRID_STEP;
    const nx = Math.ceil((maxR - x0) / GRID_STEP) + 1;
    const ny = Math.ceil((maxB - y0) / GRID_STEP) + 1;
    const u = new Float64Array((nx + 1) * (ny + 1) * 2);
    for (let gy = 0; gy <= ny; gy++) {
      for (let gx = 0; gx <= nx; gx++) {
        const [ux, uy] = warp([x0 + gx * GRID_STEP, y0 + gy * GRID_STEP]);
        const i = (gy * (nx + 1) + gx) * 2;
        u[i] = ux; u[i + 1] = uy;
      }
    }
    r.grid = { x0, y0, step: GRID_STEP, nx, ny, u };
  }
}

// ── LRU raster cache (country SVG → bitmap at requested width) ──
const cache = new Map();   // key → {img, w, h, bytes, tick}
let cacheBytes = 0, tick = 0;
async function getRaster(key, svgPath, width) {
  const want = Math.min(RASTER_CAP, Math.max(16, Math.ceil(width)));
  const hit = cache.get(key);
  if (hit && hit.w >= want) { hit.tick = ++tick; return hit; }
  const svg = readFileSync(svgPath, 'utf8');
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: want } }).render().asPng();
  const img = await loadImage(png);
  const entry = { img, w: img.width, h: img.height, bytes: img.width * img.height * 4, tick: ++tick };
  if (hit) cacheBytes -= hit.bytes;
  cache.set(key, entry);
  cacheBytes += entry.bytes;
  while (cacheBytes > CACHE_BUDGET && cache.size > 1) {
    let lruKey = null, lruTick = Infinity;
    for (const [k, v] of cache) if (v.tick < lruTick) { lruTick = v.tick; lruKey = k; }
    if (lruKey === key) break;
    cacheBytes -= cache.get(lruKey).bytes;
    cache.delete(lruKey);
  }
  return entry;
}

// Affine from 3 src→dst points; draw img clipped to (slightly expanded) dst tri.
function drawTriangle(ctx, img, s, d) {
  const [s0, s1, s2] = s, [d0, d1, d2] = d;
  const denom = s0[0] * (s1[1] - s2[1]) + s1[0] * (s2[1] - s0[1]) + s2[0] * (s0[1] - s1[1]);
  if (Math.abs(denom) < 1e-9) return;
  const a = (d0[0] * (s1[1] - s2[1]) + d1[0] * (s2[1] - s0[1]) + d2[0] * (s0[1] - s1[1])) / denom;
  const c = (d0[0] * (s2[0] - s1[0]) + d1[0] * (s0[0] - s2[0]) + d2[0] * (s1[0] - s0[0])) / denom;
  const e = (d0[0] * (s1[0] * s2[1] - s2[0] * s1[1]) + d1[0] * (s2[0] * s0[1] - s0[0] * s2[1]) + d2[0] * (s0[0] * s1[1] - s1[0] * s0[1])) / denom;
  const b = (d0[1] * (s1[1] - s2[1]) + d1[1] * (s2[1] - s0[1]) + d2[1] * (s0[1] - s1[1])) / denom;
  const dd = (d0[1] * (s2[0] - s1[0]) + d1[1] * (s0[0] - s2[0]) + d2[1] * (s1[0] - s0[0])) / denom;
  const f = (d0[1] * (s1[0] * s2[1] - s2[0] * s1[1]) + d1[1] * (s2[0] * s0[1] - s0[0] * s2[1]) + d2[1] * (s0[0] * s1[1] - s1[0] * s0[1])) / denom;
  // expand clip ~0.7 px from centroid to hide mesh seams
  const cx = (d0[0] + d1[0] + d2[0]) / 3, cy = (d0[1] + d1[1] + d2[1]) / 3;
  const grow = p => {
    const dx = p[0] - cx, dy = p[1] - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [p[0] + dx / len * 0.7, p[1] + dy / len * 0.7];
  };
  const [g0, g1, g2] = [grow(d0), grow(d1), grow(d2)];
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(g0[0], g0[1]); ctx.lineTo(g1[0], g1[1]); ctx.lineTo(g2[0], g2[1]);
  ctx.closePath();
  ctx.clip();
  ctx.setTransform(a, b, c, dd, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

async function main() {
  const regions = matchRegions();
  const nMatched = regions.reduce((s, r) => s + r.countries.length, 0);
  console.log(`Matched ${nMatched} countries in ${regions.length} regions.`);
  buildWarps(regions);

  const allTiles = [];

  for (let z = 0; z <= MAXZOOM; z++) {
    const world = TILE * (1 << z);
    const nTiles = 1 << z;

    // Per country: its cell range in the region's shared grid, dst bbox at
    // this zoom (grid nodes × world), and the tiles it touches.
    const draws = new Map();   // tileKey → [drawRec]
    for (const r of regions) {
      const g = r.grid;
      const node = (gx, gy) => {
        const i = (gy * (g.nx + 1) + gx) * 2;
        return [g.u[i] * world, g.u[i + 1] * world];
      };
      for (const c of r.countries) {
        const gx0 = Math.max(0, Math.floor((c.left - g.x0) / g.step));
        const gx1 = Math.min(g.nx, Math.ceil((c.left + c.width - g.x0) / g.step));
        const gy0 = Math.max(0, Math.floor((c.top - g.y0) / g.step));
        const gy1 = Math.min(g.ny, Math.ceil((c.top + c.height - g.y0) / g.step));
        if (gx1 <= gx0 || gy1 <= gy0) continue;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
          const [x, y] = node(gx, gy);
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        const dstW = maxX - minX;
        if (!(dstW > 0)) continue;
        // world copies for antimeridian-crossing regions
        const offsets = [0];
        if (maxX > world) offsets.push(-world);
        if (minX < 0) offsets.push(world);
        for (const off of offsets) {
          const tx0 = Math.max(0, Math.floor((minX + off) / TILE));
          const tx1 = Math.min(nTiles - 1, Math.floor((maxX + off) / TILE));
          const ty0 = Math.max(0, Math.floor(minY / TILE));
          const ty1 = Math.min(nTiles - 1, Math.floor(maxY / TILE));
          if (tx1 < tx0 || ty1 < ty0) continue;
          const drawRec = {
            key: `${r.slug}/${c.base}`, svgPath: c.svgPath,
            grid: g, node, off, gx0, gx1, gy0, gy1, dstW,
            left: c.left, top: c.top, srcW: c.width, srcH: c.height,
          };
          for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
            const k = tx + ',' + ty;
            if (!draws.has(k)) draws.set(k, []);
            draws.get(k).push(drawRec);
          }
        }
      }
    }

    // render tiles in Hilbert order (clustered archive + raster cache locality)
    const keys = [...draws.keys()]
      .map(k => { const [x, y] = k.split(',').map(Number); return { k, x, y, id: zxyToTileId(z, x, y) }; })
      .sort((a, b) => a.id - b.id);

    let written = 0, bytes = 0;
    for (const { k, x: tx, y: ty } of keys) {
      const canvas = createCanvas(TILE, TILE);
      const ctx = canvas.getContext('2d');
      for (const d of draws.get(k)) {
        const raster = await getRaster(d.key, d.svgPath, d.dstW);
        const sx = raster.w / d.srcW;     // region-canvas units → raster px
        const sy = raster.h / d.srcH;
        const ox = -tx * TILE + d.off, oy = -ty * TILE;
        const g = d.grid;
        // src position of a grid node, in the country's raster pixels
        const srcAt = (gx, gy) => [
          (g.x0 + gx * g.step - d.left) * sx,
          (g.y0 + gy * g.step - d.top) * sy,
        ];
        for (let gy = d.gy0; gy < d.gy1; gy++) for (let gx = d.gx0; gx < d.gx1; gx++) {
          const dA = d.node(gx, gy), dB = d.node(gx + 1, gy);
          const dC = d.node(gx + 1, gy + 1), dD = d.node(gx, gy + 1);
          const tA = [dA[0] + ox, dA[1] + oy], tB = [dB[0] + ox, dB[1] + oy];
          const tC = [dC[0] + ox, dC[1] + oy], tD = [dD[0] + ox, dD[1] + oy];
          // skip cells fully outside this tile
          const xs = [tA[0], tB[0], tC[0], tD[0]], ys = [tA[1], tB[1], tC[1], tD[1]];
          if (Math.max(...xs) < 0 || Math.min(...xs) > TILE || Math.max(...ys) < 0 || Math.min(...ys) > TILE) continue;
          const sA = srcAt(gx, gy), sB = srcAt(gx + 1, gy);
          const sC = srcAt(gx + 1, gy + 1), sD = srcAt(gx, gy + 1);
          drawTriangle(ctx, raster.img, [sA, sB, sC], [tA, tB, tC]);
          drawTriangle(ctx, raster.img, [sA, sC, sD], [tA, tC, tD]);
        }
      }
      const buf = await canvas.encode('webp', 82);
      allTiles.push({ z, x: tx, y: ty, data: buf });
      written++; bytes += buf.length;
    }
    console.log(`z${z}: ${written} tiles, ${(bytes / 1048576).toFixed(1)} MB (cache ${(cacheBytes / 1048576) | 0} MB)`);
  }

  const total = allTiles.reduce((s, t) => s + t.data.length, 0);
  console.log(`\nTotal: ${allTiles.length} tiles, ${(total / 1048576).toFixed(1)} MB payload.`);

  const pm = buildPmtiles(allTiles, {
    minZoom: 0, maxZoom: MAXZOOM,
    metadata: { name: 'Jonas geografi världskarta', format: 'webp' },
    bounds: [-180, -85, 180, 85],
    center: [10, 30, 2],
  });
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, pm);
  console.log(`Wrote ${OUT} (${(pm.length / 1048576).toFixed(1)} MB).`);
}

main().catch(e => { console.error(e); process.exit(1); });
