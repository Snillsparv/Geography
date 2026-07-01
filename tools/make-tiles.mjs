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
// Each country contributes five MLS pins ON its artwork's opaque mass
// (centroid + principal-axis points) whose targets blend (--geo 0..1):
//   geo 0  →  the region's least-squares affine (the hand-drawn composition
//             reproduced exactly, like the old per-continent demo)
//   geo 1  →  the moment-transport affine onto the true projected polygon
//             (right place, right size, right tilt — max geographic accuracy)
// Isolated island nations drawn far larger than life (Pacific/Caribbean
// micro-states …) are "badges": they always keep the composition placement.
//
// Sheets are rasterized per pixel (inverse-bilinear per warp cell): exact
// coverage, no mesh seams. Neighbours of shape-locked countries get any
// art shortfall against the locked true border filled with their own
// colour-extended underlay, and sheets are clipped out of locked polygons,
// whose outlines re-stroke on top — crisp borders, no ocean slivers.
//
// Tiles are 512×512 WebP, skipped where no artwork lands, packed into a single
// PMTiles archive servable from any static host with HTTP range requests.
//
// Usage:  node tools/make-tiles.mjs [--maxzoom 7] [--geo 1] [--outline 2.5]
//         [--out tiles/world.pmtiles] [--save DIR] [--assemble]
//         [--window z:x0:y0[:x1:y1]]
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
// Geographic pinning strength. Default 1: every country at its true projected
// bbox. Mixed levels concentrate all adjustment at the boundary between
// levels (the "curtain" zones below Russia/USA, then around Uzbekistan/Indien
// when only the first ring was promoted) — uniform geo 1 spreads it evenly
// and the shared grid keeps the jigsaw glued.
const GEO = Math.max(0, Math.min(1, +arg('geo', 1)));
// Resumable mode: --save DIR writes each tile to DIR/z/x/y.webp and skips
// tiles that already exist, so an interrupted build continues where it left
// off on the next invocation. --assemble packs DIR into the PMTiles archive.
const SAVE = arg('save', null);
const ASSEMBLE = argv.includes('--assemble');
// Uniform country outline: a crisp black line of THIS width (px, identical
// at every zoom level → constant on-screen thickness) drawn along every
// country's rendered edge — coasts, land borders and the shape-locked
// polygons alike. 0 keeps only the artwork's own hand-drawn contours.
const OUTLINE = Math.max(0, +arg('outline', 2.5));
// Debug: --window z:x0:y0[:x1:y1] renders ONLY that tile range at that zoom
// (combine with --save DIR to inspect the webp files without a full build).
const WINDOW = (() => {
  const w = arg('window', null);
  if (!w) return null;
  const [z, x0, y0, x1, y1] = w.split(':').map(Number);
  const win = { z, x0, y0, x1: x1 ?? x0, y1: y1 ?? y0 };
  if (![win.z, win.x0, win.y0, win.x1, win.y1].every(Number.isInteger)) {
    throw new Error(`ogiltigt --window "${w}" (förväntar z:x0:y0[:x1:y1])`);
  }
  if (win.z > MAXZOOM) throw new Error(`--window z${win.z} > --maxzoom ${MAXZOOM}`);
  return win;
})();

const TILE = 512;
const RASTER_CAP = 8192;            // max raster width per country (memory —
                                    // run node with --max-old-space-size=12288)
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
  ['asien/ryssland', 'exact'],
  ['nordamerika/kanada', 'exact'],
  ['nordamerika/usa', 'exact'],
]);
const LOCK_MIN_RING_AREA = 5e-7;    // skip micro-island rings (steradians)
const LOCK_OVERSCAN = 1.05;         // stretch art 5 % past the bbox → no alpha holes at edges


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
  ctx.lineWidth = OUTLINE || Math.max(1.2, Math.min(12, (d.geom.maxX - d.geom.minX) * world / 400));
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
        anchor, fullGeom: f.geometry,
      });
    }
    if (countries.length) regions.push({ slug, countries });
  }
  return regions;
}

// ── 2×2 symmetric-matrix helpers (stored as [xx, xy, yy]) ──
// Used for the moment-transport pin targets: the affine that carries the
// artwork's mass distribution onto the true polygon's mass distribution.
function spdSqrt(m) {
  const [a, b, c] = m;
  const s = Math.sqrt(Math.max(0, a * c - b * b));
  const t = Math.sqrt(Math.max(1e-30, a + c + 2 * s));
  return [(a + s) / t, b / t, (c + s) / t];
}
function spdInv(m) {
  const [a, b, c] = m;
  const det = a * c - b * b || 1e-30;
  return [c / det, -b / det, a / det];
}
function symSandwich(s, c) {   // S·C·S for symmetric S, C → symmetric
  const [a, b, e] = s, [d, f, g] = c;
  const p00 = a * d + b * f, p01 = a * f + b * g;
  const p10 = b * d + e * f, p11 = b * f + e * g;
  return [p00 * a + p01 * b, (p00 * b + p01 * e + p10 * a + p11 * b) / 2, p10 * b + p11 * e];
}
// Optimal-transport map between two centred Gaussians: T·C0·T = C1.
function transport2(C0, C1) {
  const S0 = spdSqrt(C0);
  const S0i = spdInv(S0);
  return symSandwich(S0i, spdSqrt(symSandwich(S0, C1)));
}
function eigen2(cxx, cxy, cyy) {
  const tr = cxx + cyy, det = cxx * cyy - cxy * cxy;
  const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = Math.max(0, tr / 2 - disc);
  let v1 = Math.abs(cxy) > 1e-14 ? [l1 - cyy, cxy] : (cxx >= cyy ? [1, 0] : [0, 1]);
  const n = Math.hypot(v1[0], v1[1]) || 1;
  v1 = [v1[0] / n, v1[1] / n];
  return { l1, l2, v1, v2: [-v1[1], v1[0]] };
}

// Signed-area moments of a set of rings (Green's theorem): area, centroid,
// central covariance. Holes are wound opposite and subtract naturally.
function polyMoments(rings) {
  let A = 0, Sx = 0, Sy = 0, Sxx = 0, Sxy = 0, Syy = 0;
  for (const pts of rings) {
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const x0 = pts[i * 2], y0 = pts[i * 2 + 1];
      const x1 = pts[j * 2], y1 = pts[j * 2 + 1];
      const cr = x0 * y1 - x1 * y0;
      A += cr;
      Sx += (x0 + x1) * cr; Sy += (y0 + y1) * cr;
      Sxx += (x0 * x0 + x0 * x1 + x1 * x1) * cr;
      Syy += (y0 * y0 + y0 * y1 + y1 * y1) * cr;
      Sxy += (2 * x0 * y0 + x0 * y1 + x1 * y0 + 2 * x1 * y1) * cr;
    }
  }
  A /= 2;
  if (Math.abs(A) < 1e-16) return null;
  const cx = Sx / (6 * A), cy = Sy / (6 * A);
  return {
    area: Math.abs(A), cx, cy,
    cxx: Sxx / (12 * A) - cx * cx,
    cxy: Sxy / (24 * A) - cx * cy,
    cyy: Syy / (12 * A) - cy * cy,
  };
}

// Project a (multi)polygon to unit Mercator, longitudes unwrapped around ref.
function ringsToMerc(geometry, refLng) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const rings = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polys) {
    for (const ring of poly) {
      const pts = new Float64Array(ring.length * 2);
      for (let i = 0; i < ring.length; i++) {
        let lng = ring[i][0];
        while (lng - refLng > 180) lng -= 360;
        while (lng - refLng < -180) lng += 360;
        const x = mercX(lng), y = mercY(ring[i][1]);
        pts[i * 2] = x; pts[i * 2 + 1] = y;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      rings.push(pts);
    }
  }
  return { rings, minX, minY, maxX, maxY };
}

// Opaque-pixel mask of an artwork, probed on a small raster: relative 0..1
// pixel centres of every opaque pixel. Pins built from these sit ON the
// drawn country, never in the empty corners of its bounding quad.
const artMaskCache = new Map();
async function getArtMask(key, svgPath) {
  if (artMaskCache.has(key)) return artMaskCache.get(key);
  const png = new Resvg(readFileSync(svgPath, 'utf8'), { fitTo: { mode: 'width', value: 256 } }).render().asPng();
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  const d = cx.getImageData(0, 0, img.width, img.height).data;
  const us = [], vs = [];
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (d[(y * img.width + x) * 4 + 3] > 60) {
        us.push((x + 0.5) / img.width);
        vs.push((y + 0.5) / img.height);
      }
    }
  }
  const m = { us: Float64Array.from(us), vs: Float64Array.from(vs), total: img.width * img.height };
  artMaskCache.set(key, m);
  return m;
}

// Weighted relative moments of an art mask.
function maskMoments(mask, w) {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < mask.us.length; i++) {
    const wt = w ? w[i] : 1;
    if (!wt) continue;
    const u = mask.us[i], v = mask.vs[i];
    n += wt; sx += wt * u; sy += wt * v;
    sxx += wt * u * u; sxy += wt * u * v; syy += wt * v * v;
  }
  if (n <= 16) return { cx: 0.5, cy: 0.5, frac: 1, cxx: 1 / 12, cxy: 0, cyy: 1 / 12, n: 0 };
  const mx = sx / n, my = sy / n;
  return {
    cx: mx, cy: my, frac: n / mask.total, n,
    cxx: sxx / n - mx * mx, cxy: sxy / n - mx * my, cyy: syy / n - my * my,
  };
}

// Rasterize a country's true polygon (unit merc rings) into a small lookup
// mask over its bbox, for the decoration-trimming test below.
function polygonLookup(geom, size = 256) {
  const spanX = geom.maxX - geom.minX, spanY = geom.maxY - geom.minY;
  if (!(spanX > 0) || !(spanY > 0)) return null;
  const W = size, H = Math.max(8, Math.min(1024, Math.round(size * spanY / spanX)));
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  for (const pts of geom.rings) {
    ctx.moveTo((pts[0] - geom.minX) / spanX * W, (pts[1] - geom.minY) / spanY * H);
    for (let i = 2; i < pts.length; i += 2) {
      ctx.lineTo((pts[i] - geom.minX) / spanX * W, (pts[i + 1] - geom.minY) / spanY * H);
    }
    ctx.closePath();
  }
  ctx.fill('evenodd');
  const d = ctx.getImageData(0, 0, W, H).data;
  const m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) m[i] = d[i * 4 + 3] > 127 ? 1 : 0;
  return {
    contains: (x, y) => {
      const px = Math.floor((x - geom.minX) / spanX * W);
      const py = Math.floor((y - geom.minY) / spanY * H);
      if (px < 0 || px >= W || py < 0 || py >= H) return 0;
      return m[py * W + px];
    },
  };
}

// Which countries share a land border (identical Natural Earth vertices)?
// Separates isolated island nations (badge candidates) from jigsaw members,
// and flags neighbours of shape-locked countries for the seam gap fill.
function computeAdjacency(regions) {
  const all = [];
  for (const r of regions) for (const c of r.countries) all.push(c);
  const seen = new Map();
  const shared = new Map();
  all.forEach((c, i) => {
    const polys = c.fullGeom.type === 'Polygon' ? [c.fullGeom.coordinates] : c.fullGeom.coordinates;
    // ALL rings, including holes: an enclave's border is its host's hole ring
    // (Lesotho in Sydafrika), and hole vertices are what the enclave shares.
    for (const poly of polys) {
      for (const ring of poly) {
        for (const [lng, lat] of ring) {
          const k = lng + ',' + lat;
          const j = seen.get(k);
          if (j === undefined) { seen.set(k, i); continue; }
          if (j === i) continue;
          const sk = j < i ? j * 4096 + i : i * 4096 + j;
          shared.set(sk, (shared.get(sk) || 0) + 1);
        }
      }
    }
  });
  for (const c of all) { c.hasLandBorder = false; c.gapAdj = false; }
  for (const [sk, n] of shared) {
    // <8 shared vertices = micro-border (San Marino/Monaco/Vatikanen have
    // 5-6 in ne_50m). Deliberately NOT counted: oversized enclave art works
    // far better as a composition-placed badge than moment-pinned into a
    // dot inside its host, which would pinch the host's field violently.
    if (n < 8) continue;
    const a = all[(sk / 4096) | 0], b = all[sk % 4096];
    a.hasLandBorder = b.hasLandBorder = true;
    if (a.lock && !b.lock) b.gapAdj = true;
    if (b.lock && !a.lock) a.gapAdj = true;
  }
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

async function buildWarps(regions) {
  computeAdjacency(regions);
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
    }

    // |det A| of the composition affine (canvas px² → unit-merc²), for the
    // badge test below.
    const a00 = A([0, 0]), a10 = A([1, 0]), a01 = A([0, 1]);
    const detA = Math.abs((a10[0] - a00[0]) * (a01[1] - a00[1]) - (a10[1] - a00[1]) * (a01[0] - a00[0]));

    // Control pins. The old scheme pinned the four QUAD CORNERS of every
    // country onto the corners of its true projected bbox. For interlocking
    // shapes (Peru wrapping Ecuador, Chile/Argentina) the quads and bboxes
    // overlap each other, so corner pins land inside NEIGHBOUR territory with
    // contradictory targets and the MLS field folds — the squished west coast
    // of South America. Instead, pin points ON the artwork's opaque mass
    // (centroid + the four principal-axis points), mapped by the affine that
    // carries the art's mass distribution onto the true polygon's mass
    // distribution. Pins now always sit on drawn land, which neighbours never
    // overlap, and diagonal countries (Norway, Chile) get their tilt from the
    // covariance instead of a forced axis-aligned bbox stretch.
    const controls = [];
    for (const c of r.countries) {
      // Shape-locked countries (Russia/Canada/USA) are drawn separately, clipped
      // to their true polygons, and contribute NOTHING to the rubber sheet.
      if (c.lock) {
        c.mercGeom = ringsToMerc(c.anchor, ref);
        continue;
      }
      c.mercGeom = ringsToMerc(c.anchor, ref);
      const pm = polyMoments(c.mercGeom.rings);
      const mask = await getArtMask(`${r.slug}/${c.base}`, c.svgPath);
      // Many artworks carry memory-aid decorations OUTSIDE the country body
      // (Ecuador's water jet, Bolivia's ball). Including them in the mass
      // moments squeezes the actual country. Trim iteratively: fit the
      // moment transport, drop mask pixels that land outside the true
      // polygon, refit — after a couple of rounds only the body steers.
      const regC = (0.02 * Math.hypot(c.width, c.height)) ** 2;
      const regQ = (0.02 * Math.hypot(c.mercGeom.maxX - c.mercGeom.minX, c.mercGeom.maxY - c.mercGeom.minY)) ** 2;
      const lookup = pm ? polygonLookup(c.mercGeom) : null;
      let weights = null;
      let am = maskMoments(mask, null);
      let mx = c.left + am.cx * c.width, my = c.top + am.cy * c.height;
      let Cm = [
        am.cxx * c.width * c.width + regC,
        am.cxy * c.width * c.height,
        am.cyy * c.height * c.height + regC,
      ];
      let toTrue = null;
      if (pm && lookup) {
        const total = am.n;
        for (let it = 0; it < 3; it++) {
          const Cq = [pm.cxx + regQ, pm.cxy, pm.cyy + regQ];
          const T = transport2(Cm, Cq);
          const map = p => [
            pm.cx + T[0] * (p[0] - mx) + T[1] * (p[1] - my),
            pm.cy + T[1] * (p[0] - mx) + T[2] * (p[1] - my),
          ];
          toTrue = map;
          if (it === 2) break;   // final T computed from the trimmed mass
          const w = new Float64Array(mask.us.length);
          let kept = 0;
          for (let i = 0; i < mask.us.length; i++) {
            const q = map([c.left + mask.us[i] * c.width, c.top + mask.vs[i] * c.height]);
            w[i] = lookup.contains(q[0], q[1]) ? 1 : 0;
            kept += w[i];
          }
          // if the fit is so far off that most mass lands outside, trimming
          // would amplify the error — keep everything instead
          if (kept < total * 0.4) break;
          weights = w;
          am = maskMoments(mask, weights);
          mx = c.left + am.cx * c.width; my = c.top + am.cy * c.height;
          Cm = [
            am.cxx * c.width * c.width + regC,
            am.cxy * c.width * c.height,
            am.cyy * c.height * c.height + regC,
          ];
        }
      }
      // Badge countries: isolated island nations drawn far larger than life
      // (Pacific and Caribbean micro-states, Maldives …). Squeezing them into
      // their true footprint makes them invisible and tears the field around
      // them — keep them at the hand-drawn composition instead.
      const bodyArea = am.n / mask.total * c.width * c.height;
      const ratio = pm ? Math.sqrt(bodyArea * detA / Math.max(pm.area, 1e-12)) : 1;
      c.badge = !c.hasLandBorder && ratio > 3;
      if (c.badge) console.log(`  badge: ${r.slug}/${c.base} (${ratio.toFixed(1)}× överritad)`);
      const eg = eigen2(Cm[0], Cm[1], Cm[2]);
      const K = 1.6;
      const s1 = K * Math.sqrt(eg.l1), s2 = K * Math.sqrt(eg.l2);
      const pins = [
        [mx, my],
        [mx + eg.v1[0] * s1, my + eg.v1[1] * s1],
        [mx - eg.v1[0] * s1, my - eg.v1[1] * s1],
        [mx + eg.v2[0] * s2, my + eg.v2[1] * s2],
        [mx - eg.v2[0] * s2, my - eg.v2[1] * s2],
      ];
      if (c.badge) toTrue = null;
      for (const p of pins) {
        const qa = A(p);
        if (!toTrue) { controls.push({ p, q: qa }); continue; }
        const qm = toTrue(p);
        controls.push({ p, q: [qa[0] * (1 - GEO) + qm[0] * GEO, qa[1] * (1 - GEO) + qm[1] * GEO] });
      }
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

// Premultiply straight-alpha RGBA in place (bilinear sampling and manual
// source-over compositing must run in premultiplied space, or transparent
// black pixels bleed dark fringes into the edges).
function premultiply(d) {
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 255) continue;
    if (a === 0) { d[i] = d[i + 1] = d[i + 2] = 0; continue; }
    d[i] = (d[i] * a + 127) / 255; d[i + 1] = (d[i + 1] * a + 127) / 255; d[i + 2] = (d[i + 2] * a + 127) / 255;
  }
}

// ── LRU raster cache (country SVG → premultiplied pixels [+ bitmap]) ──
// The bitmap Image is only kept when needImg is set (shape-locked countries,
// drawn via canvas drawImage) — sheet countries sample the pixel data only.
const cache = new Map();   // key → {img?, data, w, h, bytes, tick}
let cacheBytes = 0, tick = 0;
async function getRaster(key, svgPath, width, needImg = false) {
  const want = Math.min(RASTER_CAP, Math.max(16, Math.ceil(width)));
  const hit = cache.get(key);
  if (hit && hit.w >= want && (!needImg || hit.img)) { hit.tick = ++tick; return hit; }
  const svg = readFileSync(svgPath, 'utf8');
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: want } }).render().asPng();
  const img = await loadImage(png);
  const pc = createCanvas(img.width, img.height);
  const pctx = pc.getContext('2d');
  pctx.drawImage(img, 0, 0);
  const data = pctx.getImageData(0, 0, img.width, img.height).data;
  premultiply(data);
  const entry = {
    img: needImg ? img : null, data, w: img.width, h: img.height,
    bytes: img.width * img.height * (needImg ? 8 : 4), tick: ++tick,
  };
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

// Render a shape-locked country into a tile. Build the true polygon path,
// clip, lay down the colour-extended underlay (plugs alpha holes and drawn-
// contour shortfall), stretch the art over the footprint, then stroke the
// outline in the artwork's own style.
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
  const raster = await getRaster(d.key, d.svgPath, Math.min(RASTER_CAP, fullW * LOCK_OVERSCAN), true);

  // 'exact' mode: the art was drawn ON the Mercator template, so its latitude
  // is already non-linear Mercator. No strip remap — just map the art's tight
  // opaque bbox 1:1 onto the country's true projected bbox and clip to the
  // polygon. Zero distortion; this is the mode for redrawn countries. The
  // colour-extended underlay goes beneath the art: where the drawn contour
  // sits a touch inside the true border (or leaves interior slivers), the
  // local artwork colour shows instead of an ocean hole.
  if (g.mode === 'exact') {
    const ab = (await getPieceArtBounds(d.key, d.svgPath, g))[0];
    const sx = ab[0] * raster.w, sy = ab[1] * raster.h;
    const sw = (ab[2] - ab[0]) * raster.w, sh = (ab[3] - ab[1]) * raster.h;
    const bx = g.minX * world + ox, by = g.minY * world + oy;
    const bw = (g.maxX - g.minX) * world, bh = (g.maxY - g.minY) * world;
    const un = await getUnderlayFullImage(d.key, d.svgPath);
    const kuw = un.width / raster.w, kuh = un.height / raster.h;
    ctx.save();
    ctx.beginPath();
    for (const piece of g.pieces) {
      for (const pts of piece.rings) {
        ctx.moveTo(pts[0] * world + ox, pts[1] * world + oy);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] * world + ox, pts[i + 1] * world + oy);
        ctx.closePath();
      }
    }
    ctx.clip('evenodd');
    ctx.drawImage(un, sx * kuw, sy * kuh, sw * kuw, sh * kuh, bx, by, bw, bh);
    ctx.drawImage(raster.img, sx, sy, sw, sh, bx, by, bw, bh);
    ctx.restore();
    // crisp true-polygon outline on top (matches the art's own contour)
    ctx.beginPath();
    for (const piece of g.pieces) {
      for (const pts of piece.rings) {
        ctx.moveTo(pts[0] * world + ox, pts[1] * world + oy);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] * world + ox, pts[i + 1] * world + oy);
        ctx.closePath();
      }
    }
    ctx.strokeStyle = '#0a0a0a';
    ctx.lineJoin = 'round';
    ctx.lineWidth = OUTLINE || Math.max(1.2, Math.min(12, fullW / 400));
    ctx.stroke();
    return;
  }

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
    ctx.lineWidth = OUTLINE || Math.max(1.2, Math.min(12, fullW / 400));
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
  const { canvas: c } = await extendArt(svgPath, 0.06);
  // No blur: the fill is only ever visible INSIDE the true polygon where the
  // art is transparent, and crisp nearest-colour extension matches the art
  // style ("södra Ryssland ska bara vara rött") — blur gave smudged shadows.
  // Round-trip to a real Image: canvases as drawImage sources segfault
  // intermittently in @napi-rs/canvas when combined with clip + transform.
  const img2 = await loadImage(await c.encode('png'));
  underlayCache.set(key, img2);
  return img2;
}

// The artwork with transparent pixels BFS-filled from their nearest opaque
// neighbour, up to capFrac of the width (Infinity = fill everything).
async function extendArt(svgPath, capFrac) {
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
  // ett smalt "förkläde" — resten förblir transparent.
  const CAP = capFrac === Infinity ? W * H : Math.round(W * capFrac);
  const queue = new Int32Array(W * H);
  const seen = new Uint8Array(W * H);
  const dist = new Uint16Array(W * H);
  const car = new Uint8Array(W * H * 3);    // carried colour per node
  const filled = new Uint8Array(W * H);     // pixels the BFS painted
  let qh = 0, qt = 0;
  for (let i = 0; i < W * H; i++) {
    // seed only from real FILL colours: saturated or light pixels — never
    // black contours or dark shading, whose carried colour reads as smudge
    // in the visible gap fill (a pure flag red still passes via max-channel)
    const a = d[i * 4 + 3];
    const mx = Math.max(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    if (a > 200 && mx > 110) {
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
        filled[ni] = 1;
      }
      queue[qt++] = ni;
    }
  }
  ctx.putImageData(id, 0, 0);
  return { canvas: c, filled };
}

// Soften the BFS extension: nearest-neighbour colour carry produces stripes
// of whatever single pixel happened to be closest. Box-blur the image and
// write the blurred values back ONLY into BFS-painted pixels, so the visible
// gap fill is a smooth local average while the artwork itself stays crisp.
function blurFilled(canvas, filled, radius, passes) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  const id = ctx.getImageData(0, 0, W, H);
  let src = id.data;
  // horizontal then vertical pass, RGB only (alpha is 255 everywhere here);
  // two ping-pong buffers hoisted out of the pass loop
  const bufA = new Uint8ClampedArray(src.length);
  const bufB = new Uint8ClampedArray(src.length);
  const tmp = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    const out = p % 2 === 0 ? bufA : bufB;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let r = 0, g = 0, b = 0, n = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = x + k;
          if (xx < 0 || xx >= W) continue;
          const i = (y * W + xx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; n++;
        }
        const o = (y * W + x) * 4;
        tmp[o] = r / n; tmp[o + 1] = g / n; tmp[o + 2] = b / n;
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let r = 0, g = 0, b = 0, n = 0;
        for (let k = -radius; k <= radius; k++) {
          const yy = y + k;
          if (yy < 0 || yy >= H) continue;
          const i = (yy * W + x) * 4;
          r += tmp[i]; g += tmp[i + 1]; b += tmp[i + 2]; n++;
        }
        const o = (y * W + x) * 4;
        out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = src[o + 3];
      }
    }
    src = out;
  }
  for (let i = 0; i < W * H; i++) {
    if (!filled[i]) continue;
    const j = i * 4;
    id.data[j] = src[j]; id.data[j + 1] = src[j + 1]; id.data[j + 2] = src[j + 2];
  }
  ctx.putImageData(id, 0, 0);
}

// Fully colour-extended artwork as premultiplied pixels, bucketed to roughly
// the requested width. Used by the seam gap fill: any pixel inside a
// neighbour-of-locked country's true polygon that its warped art misses gets
// the nearest artwork colour instead of an ocean hole.
const underlayFullCache = new Map();       // key → canvas (1024, fully extended)
const underlayFullDataCache = new Map();   // key@bucket → {data, w, h}
async function getUnderlayFullBase(key, svgPath) {
  let base = underlayFullCache.get(key);
  if (!base) {
    const ext = await extendArt(svgPath, Infinity);
    blurFilled(ext.canvas, ext.filled, 10, 2);
    base = ext.canvas;
    underlayFullCache.set(key, base);
  }
  return base;
}
async function getUnderlayFullData(key, svgPath, width) {
  const base = await getUnderlayFullBase(key, svgPath);
  let bucket = 64;
  while (bucket < width && bucket < base.width) bucket *= 2;
  bucket = Math.min(bucket, base.width);
  const ck = key + '@' + bucket;
  if (underlayFullDataCache.has(ck)) return underlayFullDataCache.get(ck);
  const c = createCanvas(bucket, Math.max(2, Math.round(base.height * bucket / base.width)));
  const cx = c.getContext('2d');
  cx.drawImage(base, 0, 0, c.width, c.height);
  const id = cx.getImageData(0, 0, c.width, c.height);
  premultiply(id.data);
  const entry = { data: id.data, w: c.width, h: c.height };
  underlayFullDataCache.set(ck, entry);
  return entry;
}

// Image version of the fully extended underlay, for canvas drawImage paths
// (shape-locked 'exact' rendering). PNG round-trip: see getUnderlay.
const underlayFullImgCache = new Map();
async function getUnderlayFullImage(key, svgPath) {
  if (underlayFullImgCache.has(key)) return underlayFullImgCache.get(key);
  const base = await getUnderlayFullBase(key, svgPath);
  const img = await loadImage(await base.encode('png'));
  underlayFullImgCache.set(key, img);
  return img;
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

// ── Per-pixel sheet renderer ──────────────────────────────────────────────
// The region sheets used to be drawn as two affine-clipped canvas triangles
// per warp cell. The antialiased clip edges never quite added up to full
// coverage, leaving hairline seams of partial (or zero) alpha along every
// cell diagonal — the thin streaks visible across large countries. Instead,
// rasterize each cell exactly: for every tile pixel inside the warped cell
// quad, invert the bilinear patch to (u,v) and sample the artwork. A pixel
// centre lies in exactly one cell, so coverage is exact and seams cannot
// exist by construction. All math runs in premultiplied alpha.
// The sheet layer renders into a buffer with a small GUTTER around the tile:
// the uniform outline needs to see ownership just across the tile seam, or
// borders would break (or double) exactly along the tile grid.
const G = OUTLINE > 0 ? Math.ceil(OUTLINE / 2) + 1 : 0;
const TG = TILE + 2 * G;
const sheetBuf = new Uint8ClampedArray(TG * TG * 4);   // tile's sheet layer
const scratch = new Uint8ClampedArray(TG * TG * 4);    // one country's art
const artCov = new Uint8Array(TG * TG);                // art alpha per pixel
const ownerBuf = new Uint16Array(TG * TG);             // visible country per pixel
const blitCanvas = createCanvas(TG, TG);               // sheetBuf → tile ctx

// Rasterize polygon rings (unit merc × world, gutter-buffer space) → 0/1 mask.
// One shared canvas: ~16k tiles × several masks each would otherwise churn
// through tens of thousands of native 1 MB canvas allocations.
const maskCanvas = createCanvas(TG, TG);
function buildMask(groups, world, tx, ty, mode, lineWidth) {
  const ctx = maskCanvas.getContext('2d');
  ctx.clearRect(0, 0, TG, TG);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineJoin = 'round';
  if (lineWidth) ctx.lineWidth = lineWidth;
  const pad = (lineWidth || 0) / 2 + 1;
  let any = false;
  for (const grp of groups) {
    const ox = -tx * TILE + (grp.off || 0) + G, oy = -ty * TILE + G;
    if (grp.maxX * world + ox < -pad || grp.minX * world + ox > TG + pad ||
        grp.maxY * world + oy < -pad || grp.minY * world + oy > TG + pad) continue;
    any = true;
    ctx.beginPath();
    for (const pts of grp.rings) {
      ctx.moveTo(pts[0] * world + ox, pts[1] * world + oy);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] * world + ox, pts[i + 1] * world + oy);
      ctx.closePath();
    }
    if (mode === 'stroke') ctx.stroke();
    else ctx.fill('evenodd');
  }
  if (!any) return null;
  const d = ctx.getImageData(0, 0, TG, TG).data;
  const m = new Uint8Array(TG * TG);
  let cnt = 0;
  for (let i = 0; i < TG * TG; i++) {
    if (d[i * 4 + 3] > 127) { m[i] = 1; cnt++; }
  }
  return cnt ? m : null;
}

// The uniform outline: after all sheet countries are composited, find every
// pixel where the visible OWNER changes (country↔country or country↔ocean),
// and stamp a black disc of ⌀ OUTLINE on it. Seams against shape-locked
// polygons are skipped — their vector stroke draws the line instead.
function outlineSheet(lockedMask) {
  if (!OUTLINE) return;
  const R = OUTLINE / 2;
  const ri = Math.ceil(R);
  const offs = [];
  for (let dy = -ri; dy <= ri; dy++) {
    for (let dx = -ri; dx <= ri; dx++) {
      if (dx * dx + dy * dy <= R * R + 0.25) offs.push([dx, dy]);
    }
  }
  const seeds = [];
  for (let y = 0; y < TG; y++) {
    const rowBase = y * TG;
    for (let x = 0; x < TG; x++) {
      const i = rowBase + x;
      const o = ownerBuf[i];
      if (x < TG - 1) {
        const j = i + 1;
        if (ownerBuf[j] !== o && !(lockedMask && (lockedMask[i] || lockedMask[j]))) seeds.push(i);
      }
      if (y < TG - 1) {
        const j = i + TG;
        if (ownerBuf[j] !== o && !(lockedMask && (lockedMask[i] || lockedMask[j]))) seeds.push(i);
      }
    }
  }
  for (const s of seeds) {
    const sx = s % TG, sy = (s / TG) | 0;
    for (const [dx, dy] of offs) {
      const px = sx + dx, py = sy + dy;
      if (px < 0 || px >= TG || py < 0 || py >= TG) continue;
      const j = (py * TG + px) * 4;
      sheetBuf[j] = 10; sheetBuf[j + 1] = 10; sheetBuf[j + 2] = 10; sheetBuf[j + 3] = 255;
    }
  }
}

// Warp one country's art into `scratch`, then source-over onto `sheetBuf`
// (skipping pixels inside locked-country polygons). With gap fill active,
// pixels inside the country's true polygon near a locked border sample the
// colour-extended underlay beneath the art, so art shortfall against the
// locked country's true border shows local artwork colour instead of ocean.
async function renderSheetPx(d, world, tx, ty, lockedMask, lockedBand, ownerIdx) {
  const raster = await getRaster(d.key, d.svgPath, d.dstW);
  const rw = raster.w, rh = raster.h, rd = raster.data;
  const sxs = rw / d.srcW, sys = rh / d.srcH;
  const ox = -tx * TILE + d.off + G, oy = -ty * TILE + G;
  const g = d.grid;

  let gapMask = null, un = null, ku = 1;
  if (d.gapGeom && lockedBand) {
    gapMask = buildMask([{ ...d.gapGeom, off: d.off }], world, tx, ty, 'fill');
    if (gapMask) {
      let cnt = 0;
      for (let i = 0; i < gapMask.length; i++) { gapMask[i] &= lockedBand[i]; cnt += gapMask[i]; }
      if (cnt) {
        un = await getUnderlayFullData(d.key, d.svgPath, rw);
        ku = un.w / rw;
      } else gapMask = null;
    }
  }
  // gap fill must reach polygon slivers outside the art quad → widen the
  // cell range to the whole region grid (cheap: bbox-rejected per cell)
  const gx0 = gapMask ? 0 : d.gx0, gx1 = gapMask ? g.nx : d.gx1;
  const gy0 = gapMask ? 0 : d.gy0, gy1 = gapMask ? g.ny : d.gy1;

  // `scratch` is all-zero between calls (cleared below, restricted to the
  // touched rectangle — most draws only cover a corner of the tile)
  let tminx = TG, tminy = TG, tmaxx = -1, tmaxy = -1;
  const row = (g.nx + 1) * 2;
  for (let gy = gy0; gy < gy1; gy++) {
    for (let gx = gx0; gx < gx1; gx++) {
      const i00 = (gy * (g.nx + 1) + gx) * 2;
      const Ax = g.u[i00] * world + ox, Ay = g.u[i00 + 1] * world + oy;
      const Bx = g.u[i00 + 2] * world + ox, By = g.u[i00 + 3] * world + oy;
      const Dx = g.u[i00 + row] * world + ox, Dy = g.u[i00 + row + 1] * world + oy;
      const Cx = g.u[i00 + row + 2] * world + ox, Cy = g.u[i00 + row + 3] * world + oy;
      const minx = Math.min(Ax, Bx, Cx, Dx), maxx = Math.max(Ax, Bx, Cx, Dx);
      const miny = Math.min(Ay, By, Cy, Dy), maxy = Math.max(Ay, By, Cy, Dy);
      if (maxx < 0 || minx > TG || maxy < 0 || miny > TG) continue;
      const px0 = Math.max(0, Math.floor(minx)), px1 = Math.min(TG - 1, Math.ceil(maxx));
      const py0 = Math.max(0, Math.floor(miny)), py1 = Math.min(TG - 1, Math.ceil(maxy));
      if (px1 < px0 || py1 < py0) continue;
      if (px0 < tminx) tminx = px0; if (px1 > tmaxx) tmaxx = px1;
      if (py0 < tminy) tminy = py0; if (py1 > tmaxy) tmaxy = py1;
      // source rect of this cell (axis-aligned in the raster)
      const sX0 = (g.x0 + gx * g.step - d.left) * sxs;
      const sY0 = (g.y0 + gy * g.step - d.top) * sys;
      const sW = g.step * sxs, sH = g.step * sys;
      // bilinear patch P(u,v) = A + uE + vF + uvG
      const Ex = Bx - Ax, Ey = By - Ay;
      const Fx = Dx - Ax, Fy = Dy - Ay;
      const Gx = Cx - Bx - Dx + Ax, Gy = Cy - By - Dy + Ay;
      const qa = Fy * Gx - Fx * Gy;
      for (let py = py0; py <= py1; py++) {
        for (let px = px0; px <= px1; px++) {
          const hx = px + 0.5 - Ax, hy = py + 0.5 - Ay;
          const qb = hx * Gy - hy * Gx + Fy * Ex - Fx * Ey;
          const qc = hx * Ey - hy * Ex;
          let v;
          if (Math.abs(qa) < 1e-9) {
            if (Math.abs(qb) < 1e-12) continue;
            v = -qc / qb;
          } else {
            // disc < 0 only happens in folded/degenerate cells; clamp to the
            // nearest real solution instead of dropping the pixel (pinholes)
            const disc = Math.max(0, qb * qb - 4 * qa * qc);
            const sq = Math.sqrt(disc);
            v = (-qb + sq) / (2 * qa);
            if (v < -1e-4 || v > 1.0001) v = (-qb - sq) / (2 * qa);
          }
          if (v < -1e-4 || v > 1.0001) continue;
          const den1 = Ex + v * Gx, den2 = Ey + v * Gy;
          const u = Math.abs(den1) > Math.abs(den2) ? (hx - v * Fx) / den1 : (hy - v * Fy) / den2;
          if (u < -1e-4 || u > 1.0001) continue;
          const sx = sX0 + u * sW - 0.5, sy = sY0 + v * sH - 0.5;
          // bilinear art sample (premultiplied, transparent outside)
          const fx = Math.floor(sx), fy = Math.floor(sy);
          const wx = sx - fx, wy = sy - fy;
          let r = 0, gr = 0, b = 0, a = 0;
          for (let t = 0; t < 4; t++) {
            const tx2 = fx + (t & 1), ty2 = fy + (t >> 1);
            if (tx2 < 0 || tx2 >= rw || ty2 < 0 || ty2 >= rh) continue;
            const w = (t & 1 ? wx : 1 - wx) * (t >> 1 ? wy : 1 - wy);
            if (!w) continue;
            const si = (ty2 * rw + tx2) * 4;
            r += rd[si] * w; gr += rd[si + 1] * w; b += rd[si + 2] * w; a += rd[si + 3] * w;
          }
          const gi = py * TG + px;
          const aArt = a;   // art alpha before any underlay is mixed in
          if (gapMask && gapMask[gi]) {
            // underlay beneath the art: clamped sample of the extended colours
            const ux = Math.min(un.w - 1, Math.max(0, (sx + 0.5) * ku - 0.5));
            const uy = Math.min(un.h - 1, Math.max(0, (sy + 0.5) * ku - 0.5));
            const ufx = Math.floor(ux), ufy = Math.floor(uy);
            const uwx = ux - ufx, uwy = uy - ufy;
            let ur = 0, ug = 0, ub = 0, ua = 0;
            for (let t = 0; t < 4; t++) {
              const tx2 = Math.min(un.w - 1, ufx + (t & 1)), ty2 = Math.min(un.h - 1, ufy + (t >> 1));
              const w = (t & 1 ? uwx : 1 - uwx) * (t >> 1 ? uwy : 1 - uwy);
              if (!w) continue;
              const si = (ty2 * un.w + tx2) * 4;
              ur += un.data[si] * w; ug += un.data[si + 1] * w; ub += un.data[si + 2] * w; ua += un.data[si + 3] * w;
            }
            const inv = 1 - a / 255;
            r += ur * inv; gr += ug * inv; b += ub * inv; a += ua * inv;
          } else if (a < 1) continue;
          // overlapping cells (folds, or the gap-widened grid loop): a write
          // carrying MORE art must never be replaced by a fill-only write
          if (aArt < artCov[gi]) continue;
          artCov[gi] = aArt;
          const pi = gi * 4;
          scratch[pi] = r; scratch[pi + 1] = gr; scratch[pi + 2] = b; scratch[pi + 3] = a;
        }
      }
    }
  }
  if (tmaxx < 0) return;
  // source-over scratch → sheetBuf (never inside locked-country polygons),
  // zeroing scratch behind us so it is clean for the next draw
  for (let py = tminy; py <= tmaxy; py++) {
    const rowBase = py * TG;
    for (let px = tminx; px <= tmaxx; px++) {
      const i = rowBase + px;
      const j = i * 4;
      const a = scratch[j + 3];
      if (!a || (lockedMask && lockedMask[i])) continue;
      if (a >= 128) ownerBuf[i] = ownerIdx;
      if (a === 255) {
        sheetBuf[j] = scratch[j]; sheetBuf[j + 1] = scratch[j + 1];
        sheetBuf[j + 2] = scratch[j + 2]; sheetBuf[j + 3] = 255;
      } else {
        const inv = (255 - a) / 255;
        sheetBuf[j] = scratch[j] + sheetBuf[j] * inv;
        sheetBuf[j + 1] = scratch[j + 1] + sheetBuf[j + 1] * inv;
        sheetBuf[j + 2] = scratch[j + 2] + sheetBuf[j + 2] * inv;
        sheetBuf[j + 3] = a + sheetBuf[j + 3] * inv;
      }
    }
    scratch.fill(0, (rowBase + tminx) * 4, (rowBase + tmaxx + 1) * 4);
    artCov.fill(0, rowBase + tminx, rowBase + tmaxx + 1);
  }
}

// Crisp true-polygon outline for a shape-locked country, drawn ABOVE the
// region sheets so neighbouring art can never paint over the border line.
function strokeLocked(ctx, d, world, tx, ty) {
  const ox = -tx * TILE + d.off, oy = -ty * TILE;
  const lw = OUTLINE || Math.max(1.2, Math.min(12, d.dstW / 400));
  const pad = lw / 2 + 1;   // stroke bleeds half its width past the bbox
  ctx.beginPath();
  for (const piece of d.geom.pieces) {
    if (piece.maxX * world + ox < -pad || piece.minX * world + ox > TILE + pad ||
        piece.maxY * world + oy < -pad || piece.minY * world + oy > TILE + pad) continue;
    for (const pts of piece.rings) {
      ctx.moveTo(pts[0] * world + ox, pts[1] * world + oy);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] * world + ox, pts[i + 1] * world + oy);
      ctx.closePath();
    }
  }
  ctx.strokeStyle = '#0a0a0a';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lw;
  ctx.stroke();
}

async function main() {
  if (ASSEMBLE) { await assemble([]); return; }
  const regions = matchRegions();
  const nMatched = regions.reduce((s, r) => s + r.countries.length, 0);
  console.log(`Matched ${nMatched} countries in ${regions.length} regions.`);
  await buildWarps(regions);
  const fills = buildFills(loadFeatures().byA3);
  console.log(`Flat fills: ${fills.map(f => f.a3).join(', ')}`);

  const allTiles = [];

  for (let z = 0; z <= MAXZOOM; z++) {
    if (WINDOW && z !== WINDOW.z) continue;
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
          // the neighbours' gap-fill band and the outline stroke bleed past
          // the polygon bbox — register those margin tiles too (fully empty
          // tiles are dropped again before encoding)
          const pad = Math.ceil((world * 0.0125 + 12) / TILE);
          for (const off of offsets) {
            const tx0 = Math.max(0, Math.floor((minX + off) / TILE) - pad);
            const tx1 = Math.min(nTiles - 1, Math.floor((maxX + off) / TILE) + pad);
            const ty0 = Math.max(0, Math.floor(minY / TILE) - pad);
            const ty1 = Math.min(nTiles - 1, Math.floor(maxY / TILE) + pad);
            if (tx1 < tx0 || ty1 < ty0) continue;
            const drawRec = {
              lock: true, order: 1,
              key: `${r.slug}/${c.base}`, svgPath: c.svgPath,
              geom: lg, off, dstW: maxX - minX,
            };
            // outline again ABOVE the sheets: neighbour art is clipped to the
            // locked polygon but its gap fill must never swallow the border
            const strokeRec = { strokeLock: true, order: 3, geom: lg, off, dstW: maxX - minX };
            for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
              const kk = tx + ',' + ty;
              if (!draws.has(kk)) draws.set(kk, []);
              draws.get(kk).push(drawRec, strokeRec);
            }
          }
          continue;
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
        // gap-fill countries paint up to their true polygon, which can jut
        // past the warped art bbox — register those tiles too, or the fill
        // would stop dead at a tile boundary
        if (c.gapAdj) {
          if (c.mercGeom.minX * world < minX) minX = c.mercGeom.minX * world;
          if (c.mercGeom.maxX * world > maxX) maxX = c.mercGeom.maxX * world;
          if (c.mercGeom.minY * world < minY) minY = c.mercGeom.minY * world;
          if (c.mercGeom.maxY * world > maxY) maxY = c.mercGeom.maxY * world;
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
            sheet: true, order: 2,
            key: `${r.slug}/${c.base}`, svgPath: c.svgPath,
            grid: g, off, gx0, gx1, gy0, gy1, dstW,
            left: c.left, top: c.top, srcW: c.width, srcH: c.height,
            gapGeom: c.gapAdj ? c.mercGeom : null,
          };
          for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
            const k = tx + ',' + ty;
            if (!draws.has(k)) draws.set(k, []);
            draws.get(k).push(drawRec);
          }
        }
      }
    }

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
      .filter(t => !WINDOW || (t.x >= WINDOW.x0 && t.x <= WINDOW.x1 && t.y >= WINDOW.y0 && t.y <= WINDOW.y1))
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
      const sheetDraws = tileDraws.filter(d => d.sheet);
      const lockedDraws = tileDraws.filter(d => d.lock);
      // masks against the locked countries' true polygons: sheets never paint
      // inside them, and the gap fill only acts near their borders
      let lockedMask = null, lockedBand = null;
      if (sheetDraws.length && lockedDraws.length) {
        const groups = lockedDraws.flatMap(d => d.geom.pieces.map(p => ({ ...p, off: d.off })));
        lockedMask = buildMask(groups, world, tx, ty, 'fill');
        if (sheetDraws.some(d => d.gapGeom)) {
          lockedBand = buildMask(groups, world, tx, ty, 'stroke', Math.max(8, world * 0.025));
        }
      }
      let sheetDone = false;
      for (const d of tileDraws) {
        if (d.fill) {
          renderFill(ctx, d, world, tx, ty);
        } else if (d.lock) {
          await renderLocked(ctx, d, world, tx, ty);
        } else if (d.sheet) {
          if (sheetDone) continue;
          sheetDone = true;
          sheetBuf.fill(0);
          ownerBuf.fill(0);
          for (let si = 0; si < sheetDraws.length; si++) {
            await renderSheetPx(sheetDraws[si], world, tx, ty, lockedMask, lockedBand, si + 1);
          }
          outlineSheet(lockedMask);
          // premultiplied → straight, composited over the locked layer
          const id = ctx.createImageData(TG, TG);
          const out = id.data;
          for (let i = 0; i < TG * TG; i++) {
            const a = sheetBuf[i * 4 + 3];
            if (!a) continue;
            const j = i * 4;
            out[j + 3] = a;
            if (a === 255) { out[j] = sheetBuf[j]; out[j + 1] = sheetBuf[j + 1]; out[j + 2] = sheetBuf[j + 2]; }
            else {
              out[j] = Math.min(255, sheetBuf[j] * 255 / a);
              out[j + 1] = Math.min(255, sheetBuf[j + 1] * 255 / a);
              out[j + 2] = Math.min(255, sheetBuf[j + 2] * 255 / a);
            }
          }
          blitCanvas.getContext('2d').putImageData(id, 0, 0);
          ctx.drawImage(blitCanvas, G, G, TILE, TILE, 0, 0, TILE, TILE);
        } else if (d.strokeLock) {
          strokeLocked(ctx, d, world, tx, ty);
        }
      }
      // registration bboxes overshoot the artwork (locked pads, badge quads) —
      // drop tiles where nothing actually landed
      const px = ctx.getImageData(0, 0, TILE, TILE).data;
      let painted = false;
      for (let i = 3; i < px.length; i += 4) {
        if (px[i]) { painted = true; break; }
      }
      if (!painted) continue;
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
  if (WINDOW) {
    console.log('\n--window utan --save: hoppar över assemble så det riktiga arkivet inte skrivs över.');
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
