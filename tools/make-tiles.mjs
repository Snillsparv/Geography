#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────
// Bake the hand-drawn world into a Web-Mercator raster tile pyramid (PMTiles).
//
// Per zoom level, every country illustration is drawn through a Moving Least
// Squares warp: control points are each country's centre in the hand-drawn
// region canvas → the country's true projected centroid. The warp interpolates
// every control point exactly (each country lands on its real location) while
// deforming the space between smoothly, so the composition's neighbourhoods
// survive. Each country is drawn as a triangle mesh (up to 16×16 cells) so the
// warp bends *within* large countries too — a single affine cannot follow
// Mercator's nonlinearity across e.g. Canada or Russia.
//
// Tiles are 512×512 WebP, skipped where no artwork lands, packed into a single
// PMTiles archive servable from any static host with HTTP range requests.
//
// Usage:  node tools/make-tiles.mjs [--maxzoom 7] [--out tiles/world.pmtiles]
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

const TILE = 512;
const RASTER_CAP = 8192;            // max raster width per country (memory)
const CACHE_BUDGET = 1.5e9;         // LRU raster cache, bytes
const MESH_CELL_PX = 256;           // target dst px per mesh cell
const MESH_MAX = 16;                // max cells per axis

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

function buildWarps(regions) {
  for (const r of regions) {
    const ref = r.countries[0].centroid[0];
    const controls = [];
    for (const c of r.countries) {
      const b = projectedBbox(c.anchor, ref);
      const x0 = c.left, x1 = c.left + c.width;
      const y0 = c.top, y1 = c.top + c.height;
      controls.push(
        { p: [x0, y0], q: [b.minX, b.minY] },
        { p: [x1, y0], q: [b.maxX, b.minY] },
        { p: [x1, y1], q: [b.maxX, b.maxY] },
        { p: [x0, y1], q: [b.minX, b.maxY] },
      );
    }
    r.warp = mlsAffine(controls);
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

    // dst mesh per country at this zoom
    const draws = new Map();   // tileKey → [{country, mesh, raster info…}]
    for (const r of regions) {
      for (const c of r.countries) {
        // coarse bbox from 3×3 samples
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let gy = 0; gy <= 2; gy++) for (let gx = 0; gx <= 2; gx++) {
          const [ux, uy] = r.warp([c.left + gx / 2 * c.width, c.top + gy / 2 * c.height]);
          const x = ux * world, y = uy * world;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        const dstW = maxX - minX, dstH = maxY - minY;
        if (!(dstW > 0 && dstH > 0)) continue;
        const nx = Math.max(1, Math.min(MESH_MAX, Math.round(dstW / MESH_CELL_PX)));
        const ny = Math.max(1, Math.min(MESH_MAX, Math.round(dstH / MESH_CELL_PX)));
        // full mesh corners
        const mesh = [];
        for (let gy = 0; gy <= ny; gy++) {
          const row = [];
          for (let gx = 0; gx <= nx; gx++) {
            const [ux, uy] = r.warp([c.left + gx / nx * c.width, c.top + gy / ny * c.height]);
            row.push([ux * world, uy * world]);
          }
          mesh.push(row);
        }
        // refresh bbox from full mesh (warp can bow outside corner samples)
        minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
        for (const row of mesh) for (const [x, y] of row) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
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
            mesh, off, nx, ny, dstW,
            srcW: c.width, srcH: c.height,
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
        for (let gy = 0; gy < d.ny; gy++) for (let gx = 0; gx < d.nx; gx++) {
          const sA = [gx / d.nx * d.srcW * sx, gy / d.ny * d.srcH * sy];
          const sB = [(gx + 1) / d.nx * d.srcW * sx, gy / d.ny * d.srcH * sy];
          const sC = [(gx + 1) / d.nx * d.srcW * sx, (gy + 1) / d.ny * d.srcH * sy];
          const sD = [gx / d.nx * d.srcW * sx, (gy + 1) / d.ny * d.srcH * sy];
          const m = d.mesh;
          const dA = [m[gy][gx][0] + ox, m[gy][gx][1] + oy];
          const dB = [m[gy][gx + 1][0] + ox, m[gy][gx + 1][1] + oy];
          const dC = [m[gy + 1][gx + 1][0] + ox, m[gy + 1][gx + 1][1] + oy];
          const dD = [m[gy + 1][gx][0] + ox, m[gy + 1][gx][1] + oy];
          // skip cells fully outside this tile
          const xs = [dA[0], dB[0], dC[0], dD[0]], ys = [dA[1], dB[1], dC[1], dD[1]];
          if (Math.max(...xs) < 0 || Math.min(...xs) > TILE || Math.max(...ys) < 0 || Math.min(...ys) > TILE) continue;
          drawTriangle(ctx, raster.img, [sA, sB, sC], [dA, dB, dC]);
          drawTriangle(ctx, raster.img, [sA, sC, sD], [dA, dC, dD]);
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
