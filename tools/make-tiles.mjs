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
// Resumable mode: --save DIR writes each tile to DIR/z/x/y.webp and skips
// tiles that already exist, so an interrupted build continues where it left
// off on the next invocation. --assemble packs DIR into the PMTiles archive.
const SAVE = arg('save', null);
const ASSEMBLE = argv.includes('--assemble');

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

// Countries whose hand-drawn shape comes from another projection and can
// never match Mercator at high latitudes (Russia/Canada/USA are "true shape
// + flag/pattern" art). These are SHAPE-LOCKED: skipped by the rubber sheet
// and instead drawn clipped to their true projected polygons, with the art
// stretched over the true footprint (their art already includes Alaska and
// the arctic islands) and the outline stroked in the artwork's style. They
// render UNDER the region sheets, so continent seams can show a little
// overlap but never an ocean gap.
// mode 'whole': one art stretch over the full true footprint (art drawn with
// islands/outliers in matching relative positions). mode 'perpiece': art is
// stretched into each major polygon separately (USA: mainland gets the flag,
// Alaska gets its own flag fill — complete coverage, no underlay patches).
const SHAPE_LOCK = new Map([
  ['asien/ryssland', 'whole'],
  ['nordamerika/kanada', 'whole'],
  ['nordamerika/usa', 'perpiece'],
]);
const LOCK_MIN_RING_AREA = 5e-7;    // skip micro-island rings (steradians)
const LOCK_OVERSCAN = 1.05;         // stretch art 5 % past the bbox → no alpha holes at edges

// Countries that share a land border with a locked country sit at FULL
// geographic position (geo 1): their own top edge is then already at the true
// border, so the edge pins barely move anything — the stretch that used to
// concentrate in an ugly curtain zone is instead spread evenly across the
// whole country (a uniform bbox fit, like the early geo-1 comparison).
const ADJ_GEO1 = new Set([
  'asien/kazakstan', 'asien/mongoliet', 'asien/kina', 'asien/nordkorea',
  'asien/georgien', 'asien/azerbajdzjan',
  'nordamerika/mexiko',
]);

// Landmasses with no artwork, drawn as flat fills with the artwork-style
// outline so the world map is complete (true shapes from Natural Earth).
const EXTRA_FILLS = [
  { a3: 'GRL', color: '#f2f4f6' },   // Grönland — vit
  { a3: 'ATA', color: '#e7eaee' },   // Antarktis — ljusgrå
];

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

// Build draw geometry for the artwork-less flat fills (Grönland, Antarktis).
// Raw longitudes — NE's Antarctica ring closes along the antimeridian itself,
// and Mercator's ±85° clamp gives it the usual flat bottom edge.
function buildFills(byA3) {
  const fills = [];
  for (const spec of EXTRA_FILLS) {
    const f = byA3[spec.a3];
    if (!f) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const rings = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const poly of polys) {
      if (geoArea({ type: 'Polygon', coordinates: poly }) < LOCK_MIN_RING_AREA) continue;
      for (const ring of poly) {
        const pts = new Float64Array(ring.length * 2);
        for (let i = 0; i < ring.length; i++) {
          const x = mercX(ring[i][0]), y = mercY(ring[i][1]);
          pts[i * 2] = x; pts[i * 2 + 1] = y;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        rings.push(pts);
      }
    }
    fills.push({ a3: spec.a3, color: spec.color, rings, minX, minY, maxX, maxY });
  }
  return fills;
}

// Flat fill + outline for an artwork-less landmass.
function renderFill(ctx, d, world, tx, ty) {
  const ox = -tx * TILE, oy = -ty * TILE;
  ctx.beginPath();
  for (const pts of d.geom.rings) {
    ctx.moveTo(pts[0] * world + ox, pts[1] * world + oy);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] * world + ox, pts[i + 1] * world + oy);
    ctx.closePath();
  }
  ctx.fillStyle = d.fill;
  ctx.fill('evenodd');
  ctx.strokeStyle = '#0a0a0a';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.2, Math.min(12, (d.geom.maxX - d.geom.minX) * world / 400));
  ctx.stroke();
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
      const lock = SHAPE_LOCK.get(`${slug}/${base}`) || null;
      // Locked art includes the outlying parts (Alaska, arctic islands), so it
      // anchors against the FULL geometry instead of the largest polygon.
      const anchor = lock ? f.geometry : anchorGeometry(f.geometry);
      countries.push({
        base, svgPath, lock,
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
    // Precompute shape-lock geometry: polygon rings in unit Mercator
    // (longitude-unwrapped around the country), big polygons only, grouped
    // into draw pieces ('whole' = one piece, 'perpiece' = one per polygon).
    for (const c of r.countries) {
      if (!c.lock) continue;
      const cLng = c.centroid[0];
      const polys = c.anchor.type === 'Polygon' ? [c.anchor.coordinates] : c.anchor.coordinates;
      const polyPieces = [];
      for (const poly of polys) {
        if (geoArea({ type: 'Polygon', coordinates: poly }) < LOCK_MIN_RING_AREA) continue;
        const rings = [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let latMin = Infinity, latMax = -Infinity;
        for (const ring of poly) {
          const pts = new Float64Array(ring.length * 2);
          for (let i = 0; i < ring.length; i++) {
            let lng = ring[i][0];
            while (lng - cLng > 180) lng -= 360;
            while (lng - cLng < -180) lng += 360;
            const x = mercX(lng), y = mercY(ring[i][1]);
            pts[i * 2] = x; pts[i * 2 + 1] = y;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            const la = ring[i][1];
            if (la < latMin) latMin = la; if (la > latMax) latMax = la;
          }
          rings.push(pts);
        }
        polyPieces.push({ rings, minX, minY, maxX, maxY, latMin, latMax });
      }
      let pieces;
      if (c.lock === 'perpiece') {
        pieces = polyPieces;
      } else {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let latMin = Infinity, latMax = -Infinity;
        const rings = [];
        for (const p of polyPieces) {
          rings.push(...p.rings);
          if (p.minX < minX) minX = p.minX; if (p.maxX > maxX) maxX = p.maxX;
          if (p.minY < minY) minY = p.minY; if (p.maxY > maxY) maxY = p.maxY;
          if (p.latMin < latMin) latMin = p.latMin; if (p.latMax > latMax) latMax = p.latMax;
        }
        pieces = [{ rings, minX, minY, maxX, maxY, latMin, latMax }];
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      let latMinAll = Infinity, latMaxAll = -Infinity;
      for (const p of pieces) {
        if (p.minX < minX) minX = p.minX; if (p.maxX > maxX) maxX = p.maxX;
        if (p.minY < minY) minY = p.minY; if (p.maxY > maxY) maxY = p.maxY;
        if (p.latMin < latMinAll) latMinAll = p.latMin;
        if (p.latMax > latMaxAll) latMaxAll = p.latMax;
      }
      c.lockGeom = { pieces, minX, minY, maxX, maxY, latMin: latMinAll, latMax: latMaxAll, mode: c.lock };

      // Border bins for edge pins: per x-column the true south/north border y,
      // per y-row the true west/east border x. Small islands are excluded so
      // e.g. the Kurils don't drag the "southern border" out to sea.
      const big = pieces.flatMap(p => p.rings.map(pts => ({ pts, area: 0 })));
      // ring bbox area as island filter
      let maxArea = 0;
      for (const rg of big) {
        let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
        for (let i = 0; i < rg.pts.length; i += 2) {
          if (rg.pts[i] < mnx) mnx = rg.pts[i]; if (rg.pts[i] > mxx) mxx = rg.pts[i];
          if (rg.pts[i + 1] < mny) mny = rg.pts[i + 1]; if (rg.pts[i + 1] > mxy) mxy = rg.pts[i + 1];
        }
        rg.area = (mxx - mnx) * (mxy - mny);
        if (rg.area > maxArea) maxArea = rg.area;
      }
      const NB = 64;
      const g0 = c.lockGeom;
      const southY = new Array(NB).fill(NaN), northY = new Array(NB).fill(NaN);
      const westX = new Array(NB).fill(NaN), eastX = new Array(NB).fill(NaN);
      for (const rg of big) {
        if (rg.area < maxArea * 0.1) continue;
        for (let i = 0; i < rg.pts.length; i += 2) {
          const x = rg.pts[i], y = rg.pts[i + 1];
          const bx = Math.max(0, Math.min(NB - 1, Math.floor((x - g0.minX) / (g0.maxX - g0.minX) * NB)));
          const by = Math.max(0, Math.min(NB - 1, Math.floor((y - g0.minY) / (g0.maxY - g0.minY) * NB)));
          if (!(southY[bx] >= y)) southY[bx] = Math.max(southY[bx] || -Infinity, y);
          if (!(northY[bx] <= y)) northY[bx] = Math.min(northY[bx] || Infinity, y);
          if (!(westX[by] <= x)) westX[by] = Math.min(westX[by] || Infinity, x);
          if (!(eastX[by] >= x)) eastX[by] = Math.max(eastX[by] || -Infinity, x);
        }
      }
      const fillGaps = a => {
        for (let i = 0; i < NB; i++) {
          if (Number.isNaN(a[i])) {
            let j = 1;
            while (j < NB && Number.isNaN(a[(i + j) % NB]) && Number.isNaN(a[(i - j + NB) % NB])) j++;
            a[i] = !Number.isNaN(a[(i - j + NB) % NB]) ? a[(i - j + NB) % NB] : a[(i + j) % NB];
          }
        }
      };
      fillGaps(southY); fillGaps(northY); fillGaps(westX); fillGaps(eastX);
      c.borderBins = { southY, northY, westX, eastX, NB };
    }

    // Controls. Non-locked countries: geo-blended bbox corners as before.
    // Locked countries contribute NO interior corners — instead, pins along
    // their art-quad edges map straight onto the TRUE border, so neighbours
    // (Kazakstan/Mongoliet/Kina mot Ryssland, Mexiko mot USA …) get pulled all
    // the way to the real boundary: crisp seams, no filler band needed.
    const lockTarget = (c, px, py) => {
      const g0 = c.lockGeom, bins = c.borderBins;
      const u = Math.max(0, Math.min(1, (px - c.left) / c.width));
      const v = Math.max(0, Math.min(1, (py - c.top) / c.height));
      // latitude is linear in the drawings → strip mapping for y
      const lat = g0.latMax + v * (g0.latMin - g0.latMax);
      const yLin = mercY(lat);
      const x = g0.minX + u * (g0.maxX - g0.minX);
      const bx = Math.max(0, Math.min(bins.NB - 1, Math.floor(u * bins.NB)));
      const by = Math.max(0, Math.min(bins.NB - 1, Math.floor((yLin - g0.minY) / (g0.maxY - g0.minY) * bins.NB)));
      // pick the nearest quad edge
      const dEdge = Math.min(v, 1 - v, u, 1 - u);
      if (dEdge === 1 - v) return [x, bins.southY[bx]];
      if (dEdge === v) return [x, bins.northY[bx]];
      if (dEdge === u) return [bins.westX[by], yLin];
      return [bins.eastX[by], yLin];
    };

    const controls = [];
    const lockedCs = r.countries.filter(c => c.lock);
    for (const c of r.countries) {
      if (c.lock) {
        // pins along all four edges (interior samples; corners excluded)
        for (let i = 1; i <= 9; i++) {
          const t = i / 10;
          const ex = c.left + t * c.width, ey = c.top + t * c.height;
          controls.push({ p: [ex, c.top], q: lockTarget(c, ex, c.top) });
          controls.push({ p: [ex, c.top + c.height], q: lockTarget(c, ex, c.top + c.height) });
          controls.push({ p: [c.left, ey], q: lockTarget(c, c.left, ey) });
          controls.push({ p: [c.left + c.width, ey], q: lockTarget(c, c.left + c.width, ey) });
        }
        continue;
      }
      const b = projectedBbox(c.anchor, ref);
      const corners = [
        [c.left, c.top], [c.left + c.width, c.top],
        [c.left + c.width, c.top + c.height], [c.left, c.top + c.height],
      ];
      const bq = [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]];
      corners.forEach((p, i) => {
        // corners that touch a locked country's quad edge snap to its TRUE
        // border instead of the geo blend — agreement kills the pinch zone
        const TOL = 50;
        for (const lc of lockedCs) {
          const nearX = p[0] > lc.left - TOL && p[0] < lc.left + lc.width + TOL;
          const nearY = p[1] > lc.top - TOL && p[1] < lc.top + lc.height + TOL;
          const onEdge = nearX && nearY && (
            Math.abs(p[1] - (lc.top + lc.height)) < TOL || Math.abs(p[1] - lc.top) < TOL ||
            Math.abs(p[0] - (lc.left + lc.width)) < TOL || Math.abs(p[0] - lc.left) < TOL);
          if (onEdge) {
            controls.push({ p, q: lockTarget(lc, p[0], p[1]) });
            return;
          }
        }
        const qa = A(p);
        const geo = ADJ_GEO1.has(`${r.slug}/${c.base}`) ? 1 : GEO;
        controls.push({ p, q: [qa[0] * (1 - geo) + bq[i][0] * geo, qa[1] * (1 - geo) + bq[i][1] * geo] });
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

// Average colour of an artwork's opaque pixels — used as underlay inside the
// true polygon of shape-locked countries, plugging any alpha holes where the
// drawn shape doesn't quite reach the real coastline.
const avgColorCache = new Map();
async function getAvgColor(key, svgPath) {
  if (avgColorCache.has(key)) return avgColorCache.get(key);
  const png = new Resvg(readFileSync(svgPath, 'utf8'), { fitTo: { mode: 'width', value: 64 } }).render().asPng();
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 200) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  }
  const col = n ? `rgb(${(r / n) | 0},${(g / n) | 0},${(b / n) | 0})` : '#888';
  avgColorCache.set(key, col);
  return col;
}

// Render a shape-locked country into a tile. Per piece: build the true
// polygon path, clip, lay down the artwork's average colour (plugs alpha
// holes), stretch the art over the piece's footprint with slight overscan,
// then stroke the outline in the artwork's own style.
async function renderLocked(ctx, d, world, tx, ty) {
  const g = d.geom;
  const ox = -tx * TILE + d.off, oy = -ty * TILE;
  const tileMinX = -d.off + tx * TILE, tileMaxX = tileMinX + TILE;
  const tileMinY = ty * TILE, tileMaxY = tileMinY + TILE;
  const visiblePieces = g.pieces.filter(p =>
    p.maxX * world >= tileMinX && p.minX * world <= tileMaxX &&
    p.maxY * world >= tileMinY && p.minY * world <= tileMaxY);
  if (!visiblePieces.length) return;

  const trace = piece => {
    ctx.beginPath();
    for (const pts of piece.rings) {
      ctx.moveTo(pts[0] * world + ox, pts[1] * world + oy);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] * world + ox, pts[i + 1] * world + oy);
      ctx.closePath();
    }
  };
  // raster sized for the country's full footprint (largest piece dominates)
  const fullW = (g.maxX - g.minX) * world;
  const raster = await getRaster(d.key, d.svgPath, Math.min(RASTER_CAP, fullW * LOCK_OVERSCAN));
  const underlay = await getUnderlayScaled(d.key, d.svgPath, fullW);
  // Per piece: grab the art sub-rect at the piece's relative position within
  // the full footprint (the artist drew Alaska/mainland in roughly correct
  // relative positions) and stretch it over the piece. perpiece uses a large
  // overscan to swallow small misalignments — the clip hides the excess.
  const over = LOCK_OVERSCAN;
  const spanX = g.maxX - g.minX, spanY = g.maxY - g.minY;
  // Tight opaque-art bounds for every mode: 'whole' gets one piece (= the
  // art's full opaque bbox stretched edge-to-edge over the true footprint,
  // so narrow-drawn art still covers e.g. easternmost Russia).
  const artBounds = await getPieceArtBounds(d.key, d.svgPath, g);

  for (let pi = 0; pi < g.pieces.length; pi++) {
    const piece = g.pieces[pi];
    if (!visiblePieces.includes(piece)) continue;
    const bx = piece.minX * world + ox, by = piece.minY * world + oy;
    const bw = (piece.maxX - piece.minX) * world, bh = (piece.maxY - piece.minY) * world;
    // art sub-rect: tight opaque bbox for perpiece, relative bbox otherwise
    let sx, sy, sw, sh;
    const ab = artBounds && artBounds[pi];
    if (ab) {
      sx = ab[0] * raster.w; sy = ab[1] * raster.h;
      sw = (ab[2] - ab[0]) * raster.w; sh = (ab[3] - ab[1]) * raster.h;
    } else {
      sx = (piece.minX - g.minX) / spanX * raster.w;
      sy = (piece.minY - g.minY) / spanY * raster.h;
      sw = (piece.maxX - piece.minX) / spanX * raster.w;
      sh = (piece.maxY - piece.minY) / spanY * raster.h;
    }
    const ow = bw * over;
    const dx0 = bx - (ow - bw) / 2;
    ctx.save();
    trace(piece);
    ctx.clip('evenodd');
    // The drawings use roughly LINEAR latitude, but Mercator doesn't: a
    // single vertical stretch can't put both the south coast and the arctic
    // in the right place (Chukotka ended up showing only the wash). Draw in
    // horizontal strips instead — strip s covers an equal latitude band of
    // the artwork and lands at that band's true Mercator y.
    const NS = 32;
    const ku = underlay.width / raster.w;
    const latSpan = piece.latMax - piece.latMin;
    for (let s = 0; s < NS; s++) {
      const t0 = s / NS, t1 = (s + 1) / NS;
      const lat0 = piece.latMax - t0 * latSpan;       // art top = north
      const lat1 = piece.latMax - t1 * latSpan;
      const dy0 = mercY(lat0) * world + oy;
      const dy1 = mercY(lat1) * world + oy;
      const dh = dy1 - dy0 + 0.6;                     // slight overlap, no hairlines
      const sy0 = sy + t0 * sh, sh0 = sh / NS;
      ctx.drawImage(underlay, sx * ku, sy0 * ku, sw * ku, sh0 * ku, dx0, dy0, ow, dh);
      ctx.drawImage(raster.img, sx, sy0, sw, sh0, dx0, dy0, ow, dh);
    }
    ctx.restore();
    trace(piece);
    ctx.strokeStyle = '#0a0a0a';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.2, Math.min(12, fullW / 400));
    ctx.stroke();
  }
}

// Underlay for shape-locked countries: the artwork at 1024 px with every
// transparent pixel BFS-filled from its nearest opaque neighbour. True-
// geometry land that falls on transparent art areas (drawn seas/bays inside
// the bbox, e.g. the Sea of Okhotsk gap in the Russia drawing) then picks up
// the local artwork colour instead of a flat average — Chukotka turns white
// like the flag's top stripe rather than grey.
const underlayCache = new Map();
async function getUnderlay(key, svgPath) {
  if (underlayCache.has(key)) return underlayCache.get(key);
  const png = new Resvg(readFileSync(svgPath, 'utf8'), { fitTo: { mode: 'width', value: 1024 } }).render().asPng();
  const img = await loadImage(png);
  const W = img.width, H = img.height;
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, W, H);
  const d = id.data;
  // BFS från ljusa opaka pixlar; utbredningen får passera GENOM mörka
  // konturpixlar (de bär färgen vidare utan att själva ändras), så att
  // instängda vikar bakom svarta kustlinjer ändå fylls med flaggfärg.
  // Avståndstak: fyll inre hav helt men låt den yttre marginalen bara få
  // ett smalt "förkläde" (≈6 % av bredden) — resten förblir transparent.
  const CAP = Math.round(W * 0.06);
  const queue = new Int32Array(W * H);
  const seen = new Uint8Array(W * H);
  const dist = new Uint16Array(W * H);
  const car = new Uint8Array(W * H * 3);    // carried colour per node
  let qh = 0, qt = 0;
  for (let i = 0; i < W * H; i++) {
    const a = d[i * 4 + 3], lum = d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2];
    if (a > 200 && lum > 150) {
      car[i * 3] = d[i * 4]; car[i * 3 + 1] = d[i * 4 + 1]; car[i * 3 + 2] = d[i * 4 + 2];
      seen[i] = 1; queue[qt++] = i;
    }
  }
  while (qh < qt) {
    const i = queue[qh++];
    if (dist[i] >= CAP) continue;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const ni = ny * W + nx;
      if (seen[ni]) continue;
      seen[ni] = 1;
      dist[ni] = dist[i] + 1;
      car[ni * 3] = car[i * 3]; car[ni * 3 + 1] = car[i * 3 + 1]; car[ni * 3 + 2] = car[i * 3 + 2];
      if (d[ni * 4 + 3] <= 200) {
        d[ni * 4] = car[ni * 3]; d[ni * 4 + 1] = car[ni * 3 + 1]; d[ni * 4 + 2] = car[ni * 3 + 2];
        d[ni * 4 + 3] = 255;
      }
      queue[qt++] = ni;
    }
  }
  ctx.putImageData(id, 0, 0);
  // No blur: the fill is only ever visible INSIDE the true polygon where the
  // art is transparent, and crisp nearest-colour extension matches the art
  // style ("södra Ryssland ska bara vara rött") — blur gave smudged shadows.
  // Round-trip to a real Image: canvases as drawImage sources segfault
  // intermittently in @napi-rs/canvas when combined with clip + transform.
  const img2 = await loadImage(await c.encode('png'));
  underlayCache.set(key, img2);
  return img2;
}

// Power-of-two downscaled underlay buckets: at low zooms the mesh draws the
// underlay thousands of times per tile, and sampling a full 1024 px image
// down to sub-pixel triangles is what made z0 take minutes. Match the source
// size to the destination instead.
const underlayScaledCache = new Map();
async function getUnderlayScaled(key, svgPath, width) {
  const base = await getUnderlay(key, svgPath);
  let bucket = 64;
  while (bucket < width && bucket < base.width) bucket *= 2;
  bucket = Math.min(bucket, base.width);
  if (bucket === base.width) return base;
  const ck = key + '@' + bucket;
  if (underlayScaledCache.has(ck)) return underlayScaledCache.get(ck);
  const c = createCanvas(bucket, Math.max(2, Math.round(base.height * bucket / base.width)));
  c.getContext('2d').drawImage(base, 0, 0, c.width, c.height);
  const img = await loadImage(await c.encode('png'));
  underlayScaledCache.set(ck, img);
  return img;
}

// For perpiece shape-locks: find the art's tight opaque-pixel bbox inside
// each piece's relative sub-rect (probed once on a 512 px raster), so the
// drawn Alaska stretches exactly onto true Alaska even when the artist's
// relative layout is a bit off. Returns per-piece [x0,y0,x1,y1] in 0..1
// relative art coordinates, or null when the sub-rect holds no opaque art.
const pieceArtCache = new Map();
async function getPieceArtBounds(key, svgPath, geom) {
  if (pieceArtCache.has(key)) return pieceArtCache.get(key);
  const png = new Resvg(readFileSync(svgPath, 'utf8'), { fitTo: { mode: 'width', value: 512 } }).render().asPng();
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  const data = cx.getImageData(0, 0, img.width, img.height).data;
  const spanX = geom.maxX - geom.minX, spanY = geom.maxY - geom.minY;
  const bounds = geom.pieces.map(p => {
    const px0 = Math.max(0, Math.floor((p.minX - geom.minX) / spanX * img.width));
    const px1 = Math.min(img.width, Math.ceil((p.maxX - geom.minX) / spanX * img.width));
    const py0 = Math.max(0, Math.floor((p.minY - geom.minY) / spanY * img.height));
    const py1 = Math.min(img.height, Math.ceil((p.maxY - geom.minY) / spanY * img.height));
    let ax0 = Infinity, ay0 = Infinity, ax1 = -Infinity, ay1 = -Infinity;
    for (let y = py0; y < py1; y++) for (let x = px0; x < px1; x++) {
      if (data[(y * img.width + x) * 4 + 3] > 60) {
        if (x < ax0) ax0 = x; if (x > ax1) ax1 = x;
        if (y < ay0) ay0 = y; if (y > ay1) ay1 = y;
      }
    }
    if (!(ax1 >= ax0)) return null;
    return [ax0 / img.width, ay0 / img.height, (ax1 + 1) / img.width, (ay1 + 1) / img.height];
  });
  pieceArtCache.set(key, bounds);
  return bounds;
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
  if (ASSEMBLE) { await assemble([]); return; }
  const regions = matchRegions();
  const nMatched = regions.reduce((s, r) => s + r.countries.length, 0);
  console.log(`Matched ${nMatched} countries in ${regions.length} regions.`);
  buildWarps(regions);
  const fills = buildFills(loadFeatures().byA3);
  console.log(`Flat fills: ${fills.map(f => f.a3).join(', ')}`);

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
        if (c.lock) {
          // Shape-locked: drawn clipped to the true polygons, on top of its
          // own sheet-warped underlay (added below) but under the neighbours.
          const lg = c.lockGeom;
          const minX = lg.minX * world, maxX = lg.maxX * world;
          const minY = lg.minY * world, maxY = lg.maxY * world;
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
              lock: true, order: 1,
              key: `${r.slug}/${c.base}`, svgPath: c.svgPath,
              geom: lg, off, dstW: maxX - minX,
            };
            for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
              const kk = tx + ',' + ty;
              if (!draws.has(kk)) draws.set(kk, []);
              draws.get(kk).push(drawRec);
            }
          }
          continue;   // edge pins pull the neighbours to the true border —
                      // no filler band needed, the seams meet crisply
        }
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
            order: 2,
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

    // Mesh draw through the shared grid.
    const renderSheet = async (ctx, d, tx, ty) => {
      const raster = await getRaster(d.key, d.svgPath, d.dstW);
      const sx = raster.w / d.srcW;     // region-canvas units → raster px
      const sy = raster.h / d.srcH;
      const ox = -tx * TILE + d.off, oy = -ty * TILE;
      const g = d.grid;
      const srcAt = (gx, gy) => [
        (g.x0 + gx * g.step - d.left) * sx,
        (g.y0 + gy * g.step - d.top) * sy,
      ];
      for (let gy = d.gy0; gy < d.gy1; gy++) for (let gx = d.gx0; gx < d.gx1; gx++) {
        const dA = d.node(gx, gy), dB = d.node(gx + 1, gy);
        const dC = d.node(gx + 1, gy + 1), dD = d.node(gx, gy + 1);
        const tA = [dA[0] + ox, dA[1] + oy], tB = [dB[0] + ox, dB[1] + oy];
        const tC = [dC[0] + ox, dC[1] + oy], tD = [dD[0] + ox, dD[1] + oy];
        const xs = [tA[0], tB[0], tC[0], tD[0]], ys = [tA[1], tB[1], tC[1], tD[1]];
        if (Math.max(...xs) < 0 || Math.min(...xs) > TILE || Math.max(...ys) < 0 || Math.min(...ys) > TILE) continue;
        const sA = srcAt(gx, gy), sB = srcAt(gx + 1, gy);
        const sC = srcAt(gx + 1, gy + 1), sD = srcAt(gx, gy + 1);
        drawTriangle(ctx, raster.img, [sA, sB, sC], [tA, tB, tC]);
        drawTriangle(ctx, raster.img, [sA, sC, sD], [tA, tC, tD]);
      }
    };

    // flat-fill landmasses (Grönland, Antarktis) — order 0, under everything
    for (const fl of fills) {
      const tx0 = Math.max(0, Math.floor(fl.minX * world / TILE));
      const tx1 = Math.min(nTiles - 1, Math.floor(fl.maxX * world / TILE));
      const ty0 = Math.max(0, Math.floor(fl.minY * world / TILE));
      const ty1 = Math.min(nTiles - 1, Math.floor(fl.maxY * world / TILE));
      const drawRec = { fill: fl.color, geom: fl, order: 0 };
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        const kk = tx + ',' + ty;
        if (!draws.has(kk)) draws.set(kk, []);
        draws.get(kk).push(drawRec);
      }
    }

    // render tiles in Hilbert order (clustered archive + raster cache locality)
    const keys = [...draws.keys()]
      .map(k => { const [x, y] = k.split(',').map(Number); return { k, x, y, id: zxyToTileId(z, x, y) }; })
      .sort((a, b) => a.id - b.id);

    let written = 0, bytes = 0, skipped = 0;
    for (const { k, x: tx, y: ty } of keys) {
      let savePath = null;
      if (SAVE) {
        savePath = path.join(repo, SAVE, String(z), String(tx), ty + '.webp');
        if (existsSync(savePath)) { skipped++; continue; }    // resume support
      }
      const canvas = createCanvas(TILE, TILE);
      const ctx = canvas.getContext('2d');
      const tileDraws = draws.get(k).slice().sort((a, b) => (a.order - b.order));
      for (const d of tileDraws) {
        if (d.fill) {
          renderFill(ctx, d, world, tx, ty);
          continue;
        }
        if (d.lock) {
          await renderLocked(ctx, d, world, tx, ty);
          continue;
        }
        await renderSheet(ctx, d, tx, ty);
      }
      const buf = await canvas.encode('webp', 82);
      if (SAVE) {
        mkdirSync(path.dirname(savePath), { recursive: true });
        writeFileSync(savePath, buf);
      } else {
        allTiles.push({ z, x: tx, y: ty, data: buf });
      }
      written++; bytes += buf.length;
    }
    console.log(`z${z}: ${written} tiles${skipped ? ` (+${skipped} fanns redan)` : ''}, ${(bytes / 1048576).toFixed(1)} MB (cache ${(cacheBytes / 1048576) | 0} MB)`);
  }

  if (SAVE) {
    console.log('\nTile files saved. Run with --assemble to pack the archive.');
    return;
  }
  await assemble(allTiles);
}

async function assemble(allTiles) {
  if (ASSEMBLE) {
    const { readdirSync } = await import('node:fs');
    const dir = path.join(repo, SAVE);
    allTiles = [];
    for (const z of readdirSync(dir)) {
      for (const x of readdirSync(path.join(dir, z))) {
        for (const f of readdirSync(path.join(dir, z, x))) {
          allTiles.push({ z: +z, x: +x, y: +f.replace('.webp', ''), data: readFileSync(path.join(dir, z, x, f)) });
        }
      }
    }
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
