// ══════════════════════════════════
// Dynamic globals (set by initGame)
// ══════════════════════════════════
let COUNTRIES = [];
let MAP_LEFT = 0, MAP_TOP = 0, MAP_W = 0, MAP_H = 0;
let IMAGE_ASSOCIATIONS = {};
let HS_KEY = '';
let ASSET_BASE = '';
let IMAGE_EXT = 'png';
let MAP_FILE = '';
let OVERLAY_FILE = '';
let SPECIAL_SHAPES = {};
let IS_GLOBE_REGION = false;
let GLOBE_GEO_FILE = '';
let GLOBE_WARP_ATLAS_WIDTH = 8192;
let GLOBE_WARP_ATLAS_HEIGHT = 4096;
let COUNTRY_BY_FILENAME = {};
const URL_PARAMS = new URLSearchParams(window.location.search);
const DEBUG_SHOW_ALL_GLOBE = URL_PARAMS.get('debug_all_globe') === '1';
const DEBUG_DISABLE_GLOBE_CLIP = URL_PARAMS.get('debug_clip') !== '1';
// `debug_raw_unclipped=1` lets us inspect the pre-warp globe overlay: no warp files, no polygon clipping.
const DEBUG_RAW_UNCLIPPED = URL_PARAMS.get('debug_raw_unclipped') === '1';
// Keep legacy param for compatibility, but do not disable warps with it anymore.
const DEBUG_NO_EDGE_PULL_PARAM = URL_PARAMS.get('debug_no_edge_pull') === '1';
const DEBUG_DISABLE_GLOBE_WARP = DEBUG_RAW_UNCLIPPED || URL_PARAMS.get('debug_no_warp') === '1';
// `globe_hover_legacy=1` keeps previous polygon-hover behavior.
const GLOBE_HOVER_LEGACY = URL_PARAMS.get('globe_hover_legacy') === '1';
const GLOBE_WHITE_UNCLICKED_MODE =
  URL_PARAMS.get('globe_white_unclicked') === '1' ||
  URL_PARAMS.get('globe_white_fill') === '1';
const GLOBE_BLACK_BORDERS =
  URL_PARAMS.get('globe_black_borders') === '1' ||
  URL_PARAMS.get('globe_border_black') === '1';
const DEBUG_GLOBE_POV = {
  lat: Number(URL_PARAMS.get('debug_pov_lat')),
  lng: Number(URL_PARAMS.get('debug_pov_lng')),
  altitude: Number(URL_PARAMS.get('debug_pov_alt'))
};

if (DEBUG_NO_EDGE_PULL_PARAM) {
  console.info('debug_no_edge_pull is deprecated in renderer; use debug_no_warp=1 for raw image preview.');
}

function debugPovOrDefault() {
  const lat = Number.isFinite(DEBUG_GLOBE_POV.lat) ? DEBUG_GLOBE_POV.lat : 20;
  const lng = Number.isFinite(DEBUG_GLOBE_POV.lng) ? DEBUG_GLOBE_POV.lng : 10;
  const altitude = Number.isFinite(DEBUG_GLOBE_POV.altitude) ? DEBUG_GLOBE_POV.altitude : 1.9;
  return { lat, lng, altitude };
}

// ══════════════════════════════════
// DOM references
// ══════════════════════════════════
const mapPanel = document.querySelector('.map-panel');
const mapWrapper = document.getElementById('map-wrapper');
const baseMap = document.getElementById('base-map');
const globeContainer = document.getElementById('globe-container');
const zoomLevelEl = document.getElementById('zoom-level');
const cursorLabel = document.getElementById('cursor-label');
const headerHint = document.getElementById('header-hint');

const infoDefault = document.getElementById('info-default');
const infoCard = document.getElementById('info-card');
const infoName = document.getElementById('info-name');
const infoShape = document.getElementById('info-shape');
const infoDesc = document.getElementById('info-desc');
const exploredCountEl = document.getElementById('explored-count');

const seterraTargetName = document.getElementById('seterra-target-name');
const seterraScoreEl = document.getElementById('seterra-score');
const seterraTimeEl = document.getElementById('seterra-time');
const seterraCorrectEl = document.getElementById('seterra-correct');
const seterraWrongEl = document.getElementById('seterra-wrong');
const seterraBar = document.getElementById('seterra-bar');
const seterraProgressLabel = document.getElementById('seterra-progress-label');
const seterraFeedback = document.getElementById('seterra-feedback');
const seterraDone = document.getElementById('seterra-done');
const seterraGame = document.getElementById('seterra-game');

// Shared state
const hitCanvases = {};
const hitPixelData = {};
const overlayEls = {};
const hoverEls = {};
const revealed = new Set();
const NO_HOVER = new Set();
let sortedCountries = [];
let currentMode = 'explore';

// Zoom & Pan
let zoom = 1, panX = 0, panY = 0;
const MIN_ZOOM = 1, MAX_ZOOM = 5;

// Explore state
let activeCountry = null;
let exploreTooltipTimer = null;

// Globe state (only used when region=globe)
let globe = null;
let globeFeatures = [];
let globeFeatureByKey = new Map();
let globeCountryByFeatureKey = new Map();
let globeOverlayTexture = null;
let globeOverlayMesh = null;
let globeOverlayBaseCanvas = null;
let globeHoverOverlayCanvas = null;
let globeHoverOverlayTexture = null;
let globeHoverOverlayMesh = null;
let globeHoverOverlayMaterial = null;
let globeOverlayBaseDirty = true;
let globeOverlayRenderQueued = false;
let globeOverlayRenderRaf = null;
let globeOverlayRenderInProgress = false;
let globeOverlayBaseRenderToken = 0;
let globeHoverOverlayRenderToken = 0;
let globeHoverOverlayRenderQueued = false;
let globeHoverOverlayRenderRaf = null;
let globeHoverOverlayLastRects = [];
let globeHoverFeatureKey = null;
let globeHoverMnemonicFeatureKey = null;
let globeWrongFlash = new Set();
let globeHintBlink = new Set();
let globeImageCache = new Map();
let globeImageAlphaBoundsCache = new Map();
let globeCountryFillColorCache = new Map();
let globeImageColorCache = new Map();
const externalScriptPromises = new Map();
const GLOBE_OVERLAY_MAX_WIDTH = 8192;
const GLOBE_OVERLAY_MIN_WIDTH = 8192;
const GLOBE_OVERLAY_VIEWPORT_SCALE = 3;
const GLOBE_HOVER_OVERLAY_MAX_WIDTH = 4096;
const GLOBE_OVERLAY_SPHERE_WIDTH_SEGMENTS = 96;
const GLOBE_OVERLAY_SPHERE_HEIGHT_SEGMENTS = 64;
const GLOBE_HOVER_FADE_MS = 200;
const GLOBE_HOVER_TARGET_ALPHA = 0.42;
let globeHoverMnemonicAlpha = 0;
let globeHoverMnemonicTargetAlpha = 0;
let globeHoverMnemonicFadeFrom = 0;
let globeHoverMnemonicFadeStart = 0;
let globeHoverMnemonicRaf = null;
const GLOBE_POLY_ALT_BASE = 0.002;
const GLOBE_POLY_ALT_REVEALED = 0.00025;
const GLOBE_POLY_ALT_ACTIVE = 0.003;
const GLOBE_UNDERFILL_PARAM = URL_PARAMS.get('debug_underfill');
const GLOBE_UNDERFILL_FORCE_ON = GLOBE_UNDERFILL_PARAM === '1';
const GLOBE_UNDERFILL_FORCE_OFF = GLOBE_UNDERFILL_PARAM === '0';
const GLOBE_UNDERFILL_AUTO_KEYS = new Set(['RUS', 'CAN', 'KAZ', 'CHL', 'SOM']);
const GLOBE_IGNORE_HOLES_FEATURE_KEYS = new Set(['SOM', 'RUS']);
let globeResizeObserver = null;
const globeMissingImageWarned = new Set();

// Seterra state
let seterraQueue = [];
let seterraTarget = null;
let seterraCorrect = 0;
let seterraWrong = 0;
let seterraTotal = 0;
let seterraStartTime = 0;
let seterraTimerInterval = null;
let seterraLocked = false;
let seterraTargetMisses = 0;
let seterraElapsed = 0;
let seterraMissedCountries = new Set();
let seterraIsRetry = false;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function loadExternalScriptOnce(src) {
  if (externalScriptPromises.has(src)) return externalScriptPromises.get(src);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed loading script: ${src}`));
    document.head.appendChild(script);
  });
  externalScriptPromises.set(src, promise);
  return promise;
}

async function ensureThreeGlobal() {
  if (window.THREE) return window.THREE;
  const sources = [
    'vendor/three/three.min.js',
    '/vendor/three/three.min.js',
    'https://unpkg.com/three@0.160.0/build/three.min.js',
    'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js'
  ];
  for (const src of sources) {
    try {
      await loadExternalScriptOnce(src);
      if (window.THREE) return window.THREE;
    } catch (e) {
      console.warn(e);
    }
  }
  return null;
}

async function ensureGlobeGlobal() {
  if (window.Globe) return window.Globe;
  const sources = [
    'vendor/globe.gl/globe.gl.min.js',
    '/vendor/globe.gl/globe.gl.min.js',
    'https://unpkg.com/globe.gl@2.34.4/dist/globe.gl.min.js',
    'https://cdn.jsdelivr.net/npm/globe.gl@2.34.4/dist/globe.gl.min.js'
  ];
  for (const src of sources) {
    try {
      await loadExternalScriptOnce(src);
      if (window.Globe) return window.Globe;
    } catch (e) {
      console.warn(e);
    }
  }
  return null;
}

function isGlobeReady() {
  return IS_GLOBE_REGION && globe;
}

function globeOverlayXY(lon, lat, width, height) {
  const x = ((lon + 180) / 360) * width;
  const y = ((90 - lat) / 180) * height;
  return [x, y];
}

function projectedRing(ring, width, height) {
  const pts = ring.map(([lon, lat]) => globeOverlayXY(lon, lat, width, height));
  if (pts.length === 0) return pts;

  let minX = Infinity;
  let maxX = -Infinity;
  for (const [x] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }

  // Avoid giant clip shapes when polygons cross the antimeridian.
  if (maxX - minX > width * 0.5) {
    for (const point of pts) {
      if (point[0] < width * 0.5) point[0] += width;
    }
  }
  return pts;
}

function hashString32(value) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const gray = Math.round(l * 255);
    return [gray, gray, gray];
  }
  const hueToRgb = (p, q, t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hueToRgb(p, q, h + 1 / 3);
  const g = hueToRgb(p, q, h);
  const b = hueToRgb(p, q, h - 1 / 3);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function fallbackCountryFillColor(country) {
  const key = country?.featureKey || country?.filename || 'country';
  const hash = hashString32(key);
  const hue = hash % 360;
  const sat = 0.45 + ((hash >> 8) % 20) / 100;
  const light = 0.40 + ((hash >> 16) % 14) / 100;
  const [r, g, b] = hslToRgb(hue / 360, sat, light);
  return `rgba(${r}, ${g}, ${b}, 0.96)`;
}

function dominantFillColorFromImage(image, cacheKey = '') {
  if (!image) return null;
  const key = cacheKey || `${image.src || ''}:${image.naturalWidth || image.width}x${image.naturalHeight || image.height}`;
  if (globeImageColorCache.has(key)) return globeImageColorCache.get(key);

  const sampleSize = 40;
  const canvas = document.createElement('canvas');
  canvas.width = sampleSize;
  canvas.height = sampleSize;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.clearRect(0, 0, sampleSize, sampleSize);
  ctx.drawImage(image, 0, 0, sampleSize, sampleSize);
  const data = ctx.getImageData(0, 0, sampleSize, sampleSize).data;
  const buckets = new Map();

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 70) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = (r + g + b) / 3;
    // Ignore very dark line-art pixels so fill color reflects the interior.
    if (lum < 28) continue;
    if (sat < 0.10 && lum < 60) continue;

    const qr = Math.round(r / 24) * 24;
    const qg = Math.round(g / 24) * 24;
    const qb = Math.round(b / 24) * 24;
    const bucketKey = `${qr},${qg},${qb}`;
    const weight = (a / 255) * (0.6 + sat);
    buckets.set(bucketKey, (buckets.get(bucketKey) || 0) + weight);
  }

  if (buckets.size === 0) {
    return null;
  }

  let bestKey = null;
  let bestWeight = -Infinity;
  for (const [k, w] of buckets.entries()) {
    if (w > bestWeight) {
      bestWeight = w;
      bestKey = k;
    }
  }
  if (!bestKey) return null;
  const [r, g, b] = bestKey.split(',').map(v => Number(v));
  const color = `rgba(${r}, ${g}, ${b}, 0.96)`;
  globeImageColorCache.set(key, color);
  return color;
}

function countryFillColor(country, image, imageKey) {
  const key = country?.featureKey || country?.filename;
  if (!key) return 'rgba(70, 110, 150, 0.96)';
  if (globeCountryFillColorCache.has(key)) return globeCountryFillColorCache.get(key);
  const fromImage = dominantFillColorFromImage(image, imageKey);
  const color = fromImage || fallbackCountryFillColor(country);
  globeCountryFillColorCache.set(key, color);
  return color;
}

function fillCountryFeature(ctx, feature, width, height, fillStyle) {
  if (!feature || !feature.geometry) return;
  const geometry = feature.geometry;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (!polygons || polygons.length === 0) return;
  const ignoreHoles = GLOBE_IGNORE_HOLES_FEATURE_KEYS.has(feature?.properties?.key);

  ctx.save();
  ctx.fillStyle = fillStyle;
  for (const polygon of polygons) {
    if (!polygon || polygon.length === 0) continue;
    const projected = polygon.map(ring => projectedRing(ring, width, height)).filter(ring => ring.length >= 3);
    const rings = ignoreHoles ? projected.slice(0, 1) : projected;
    if (rings.length === 0) continue;
    ctx.beginPath();
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const [x, y] = ring[i];
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
    try {
      ctx.fill('evenodd');
    } catch {
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawCountryImageClippedToFeature(ctx, image, feature, width, height) {
  if (!feature || !feature.geometry || !image) return;
  const geometry = feature.geometry;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (!polygons || polygons.length === 0) return;
  const ignoreHoles = GLOBE_IGNORE_HOLES_FEATURE_KEYS.has(feature?.properties?.key);

  for (const polygon of polygons) {
    if (!polygon || polygon.length === 0) continue;
    const projected = polygon.map(ring => projectedRing(ring, width, height)).filter(ring => ring.length >= 3);
    const rings = ignoreHoles ? projected.slice(0, 1) : projected;
    if (rings.length === 0) continue;

    const outer = rings[0];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y] of outer) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const drawW = Math.max(1, maxX - minX);
    const drawH = Math.max(1, maxY - minY);

    const imgW = image.naturalWidth || image.width;
    const imgH = image.naturalHeight || image.height;
    const cacheKey = `${image.src || ''}:${imgW}x${imgH}`;
    let alphaBounds = globeImageAlphaBoundsCache.get(cacheKey);
    if (!alphaBounds) {
      alphaBounds = { sx: 0, sy: 0, sw: imgW, sh: imgH };
      try {
        const scanCanvas = document.createElement('canvas');
        scanCanvas.width = imgW;
        scanCanvas.height = imgH;
        const scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });
        scanCtx.drawImage(image, 0, 0, imgW, imgH);
        const data = scanCtx.getImageData(0, 0, imgW, imgH).data;
        let minX = imgW;
        let minY = imgH;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < imgH; y++) {
          for (let x = 0; x < imgW; x++) {
            const a = data[(y * imgW + x) * 4 + 3];
            if (a > 10) {
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
            }
          }
        }
        if (maxX >= minX && maxY >= minY) {
          alphaBounds = {
            sx: minX,
            sy: minY,
            sw: Math.max(1, maxX - minX + 1),
            sh: Math.max(1, maxY - minY + 1)
          };
        }
      } catch {
        alphaBounds = { sx: 0, sy: 0, sw: imgW, sh: imgH };
      }
      globeImageAlphaBoundsCache.set(cacheKey, alphaBounds);
    }

    if (DEBUG_DISABLE_GLOBE_CLIP || DEBUG_RAW_UNCLIPPED) {
      for (const shift of [-width, 0, width]) {
        ctx.drawImage(
          image,
          alphaBounds.sx, alphaBounds.sy, alphaBounds.sw, alphaBounds.sh,
          minX + shift, minY, drawW, drawH
        );
      }
      continue;
    }

    ctx.save();
    ctx.beginPath();
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const [x, y] = ring[i];
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
    try {
      ctx.clip('evenodd');
    } catch {
      // Fallback for browsers that do not support clip fill-rule argument.
      ctx.clip();
    }

    // Draw wrapped copies to cover polygons close to the antimeridian.
    for (const shift of [-width, 0, width]) {
      ctx.drawImage(
        image,
        alphaBounds.sx, alphaBounds.sy, alphaBounds.sw, alphaBounds.sh,
        minX + shift, minY, drawW, drawH
      );
    }
    ctx.restore();
  }
}

function loadGlobeImage(url) {
  if (!url) return Promise.resolve(null);
  if (globeImageCache.has(url)) return globeImageCache.get(url);
  const promise = new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
  globeImageCache.set(url, promise);
  return promise;
}

function buildGlobeOverlayDrawItem(country) {
  const hasWarp = !DEBUG_DISABLE_GLOBE_WARP && !!(country.warpFile && country.warpWidth && country.warpHeight);
  return {
    country,
    isWarp: hasWarp,
    url: hasWarp ? country.warpFile : countryImgSrc(country.filename)
  };
}

function drawGlobeCountryItem(ctx, item, image, feature, width, height, sx, sy) {
  if (!item || !item.country || !image || !feature) return;
  const country = item.country;
  if (item.isWarp) {
    const dx = (country.warpLeft || 0) * sx;
    const dy = (country.warpTop || 0) * sy;
    const dw = (country.warpWidth || image.width) * sx;
    const dh = (country.warpHeight || image.height) * sy;
    for (const shift of [-width, 0, width]) {
      ctx.drawImage(image, dx + shift, dy, dw, dh);
    }
    return;
  }
  drawCountryImageClippedToFeature(ctx, image, feature, width, height);
}

async function rebuildGlobeOverlayBase() {
  if (!isGlobeReady() || !globeOverlayBaseCanvas) return false;
  const token = ++globeOverlayBaseRenderToken;
  const ctx = globeOverlayBaseCanvas.getContext('2d');
  if (!ctx) return false;

  ctx.imageSmoothingEnabled = true;
  // Keep hand-drawn edges stable when warped sprites are minified on globe.
  ctx.imageSmoothingQuality = 'high';

  const width = globeOverlayBaseCanvas.width;
  const height = globeOverlayBaseCanvas.height;
  ctx.clearRect(0, 0, width, height);

  const visibleCountries = DEBUG_SHOW_ALL_GLOBE
    ? COUNTRIES
    : COUNTRIES.filter(c => revealed.has(c.filename));
  const drawItems = visibleCountries.map(buildGlobeOverlayDrawItem);
  const images = await Promise.all(drawItems.map(item => loadGlobeImage(item.url)));
  if (token !== globeOverlayBaseRenderToken) return false;

  const sx = width / GLOBE_WARP_ATLAS_WIDTH;
  const sy = height / GLOBE_WARP_ATLAS_HEIGHT;

  drawItems.forEach((item, idx) => {
    const country = item.country;
    const image = images[idx];
    const feature = globeFeatureByKey.get(country.featureKey);
    if (!feature) return;

    if (!image) {
      // Never leave countries visually empty in debug/all-world overlays.
      const missKey = country.featureKey || country.filename || `idx-${idx}`;
      if (!globeMissingImageWarned.has(missKey)) {
        globeMissingImageWarned.add(missKey);
        console.warn('Missing globe image for country:', missKey, item.url);
      }
      fillCountryFeature(ctx, feature, width, height, fallbackCountryFillColor(country));
      return;
    }

    if (shouldUseGlobeUnderfill(country, item)) {
      const fillColor = countryFillColor(country, image, item.url);
      fillCountryFeature(ctx, feature, width, height, fillColor);
    }
    drawGlobeCountryItem(ctx, item, image, feature, width, height, sx, sy);
  });

  return token === globeOverlayBaseRenderToken;
}

function composeGlobeOverlayTexture() {
  if (!isGlobeReady() || !globeOverlayTexture) return;
  globeOverlayTexture.needsUpdate = true;
}

function setGlobeHoverOverlayOpacity(alpha) {
  if (!globeHoverOverlayMaterial) return;
  globeHoverOverlayMaterial.opacity = Math.max(0, Math.min(GLOBE_HOVER_TARGET_ALPHA, alpha));
}

function clearGlobeHoverOverlayRects(ctx, rects) {
  for (const rect of rects) {
    if (!rect) continue;
    ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
  }
}

function pushHoverRect(rects, x, y, w, h, width, height) {
  const x0 = Math.max(0, Math.floor(x) - 2);
  const y0 = Math.max(0, Math.floor(y) - 2);
  const x1 = Math.min(width, Math.ceil(x + w) + 2);
  const y1 = Math.min(height, Math.ceil(y + h) + 2);
  if (x1 <= x0 || y1 <= y0) return;
  rects.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
}

function hoverOverlayRectsForFeature(feature, width, height) {
  if (!feature || !feature.geometry) return [{ x: 0, y: 0, w: width, h: height }];
  const geometry = feature.geometry;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (!polygons || polygons.length === 0) return [{ x: 0, y: 0, w: width, h: height }];

  const rects = [];
  for (const polygon of polygons) {
    if (!polygon || polygon.length === 0) continue;
    const outer = projectedRing(polygon[0], width, height);
    if (!outer || outer.length < 3) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of outer) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    pushHoverRect(rects, minX, minY, maxX - minX, maxY - minY, width, height);
  }
  return rects.length > 0 ? rects : [{ x: 0, y: 0, w: width, h: height }];
}

async function renderGlobeHoverOverlayTexture() {
  if (!isGlobeReady() || !globeHoverOverlayCanvas || !globeHoverOverlayTexture) return;
  const token = ++globeHoverOverlayRenderToken;
  const ctx = globeHoverOverlayCanvas.getContext('2d');
  if (!ctx) return;

  const width = globeHoverOverlayCanvas.width;
  const height = globeHoverOverlayCanvas.height;
  if (globeHoverOverlayLastRects.length > 0) {
    clearGlobeHoverOverlayRects(ctx, globeHoverOverlayLastRects);
    globeHoverOverlayLastRects = [];
    globeHoverOverlayTexture.needsUpdate = true;
  }

  const hoverKey = !GLOBE_HOVER_LEGACY ? globeHoverMnemonicFeatureKey : null;
  if (!hoverKey) return;

  const feature = globeFeatureByKey.get(hoverKey);
  if (!feature) return;
  if (token !== globeHoverOverlayRenderToken) return;

  fillCountryFeature(ctx, feature, width, height, 'rgba(255, 220, 50, 1)');
  globeHoverOverlayLastRects = hoverOverlayRectsForFeature(feature, width, height);
  globeHoverOverlayTexture.needsUpdate = true;
}

function queueGlobeHoverOverlayRender() {
  globeHoverOverlayRenderQueued = true;
  if (globeHoverOverlayRenderRaf !== null) return;
  globeHoverOverlayRenderRaf = requestAnimationFrame(() => {
    globeHoverOverlayRenderRaf = null;
    if (!globeHoverOverlayRenderQueued) return;
    globeHoverOverlayRenderQueued = false;
    renderGlobeHoverOverlayTexture();
  });
}

async function processGlobeOverlayRenderQueue() {
  globeOverlayRenderRaf = null;
  if (globeOverlayRenderInProgress) return;
  globeOverlayRenderInProgress = true;

  try {
    while (globeOverlayRenderQueued) {
      globeOverlayRenderQueued = false;
      if (!isGlobeReady() || !globeOverlayTexture || !globeOverlayBaseCanvas) continue;
      if (!globeOverlayBaseDirty) continue;

      globeOverlayBaseDirty = false;
      const rebuilt = await rebuildGlobeOverlayBase();
      if (!rebuilt) globeOverlayBaseDirty = true;
      if (globeOverlayBaseDirty) {
        globeOverlayRenderQueued = true;
        continue;
      }

      composeGlobeOverlayTexture();
    }
  } finally {
    globeOverlayRenderInProgress = false;
    if (globeOverlayRenderQueued && globeOverlayRenderRaf === null) {
      globeOverlayRenderRaf = requestAnimationFrame(processGlobeOverlayRenderQueue);
    }
  }
}

function renderGlobeOverlayTexture(options = {}) {
  if (options.baseDirty) globeOverlayBaseDirty = true;
  globeOverlayRenderQueued = true;
  if (globeOverlayRenderRaf !== null || globeOverlayRenderInProgress) return;
  globeOverlayRenderRaf = requestAnimationFrame(processGlobeOverlayRenderQueue);
}

function sanitizeGlobeGeometry(feature) {
  if (!feature || !feature.geometry) return feature;
  const key = feature?.properties?.key;
  if (!GLOBE_IGNORE_HOLES_FEATURE_KEYS.has(key)) return feature;
  const geometry = feature.geometry;
  if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0) {
    return {
      ...feature,
      geometry: {
        ...geometry,
        coordinates: [geometry.coordinates[0]]
      }
    };
  }
  if (geometry.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    return {
      ...feature,
      geometry: {
        ...geometry,
        coordinates: geometry.coordinates.map(poly =>
          Array.isArray(poly) && poly.length > 0 ? [poly[0]] : poly
        )
      }
    };
  }
  return feature;
}

function globeFeatureKey(feature) {
  return feature?.properties?.key || null;
}

function findFirstSphereMesh(root) {
  if (!root) return null;
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (
      node &&
      node.isMesh &&
      node.geometry &&
      typeof node.geometry.type === 'string' &&
      node.geometry.type.toLowerCase().includes('sphere')
    ) {
      return node;
    }
    if (node && node.children && node.children.length) {
      for (let i = 0; i < node.children.length; i++) stack.push(node.children[i]);
    }
  }
  return null;
}

function shouldUseGlobeUnderfill(country, item) {
  if (GLOBE_UNDERFILL_FORCE_ON) return true;
  if (GLOBE_UNDERFILL_FORCE_OFF) return false;
  if (!item || !item.isWarp) return false;
  const key = country?.featureKey;
  return !!key && GLOBE_UNDERFILL_AUTO_KEYS.has(key);
}

function globePolygonAltitude(feature) {
  const key = globeFeatureKey(feature);
  if (!key) return GLOBE_POLY_ALT_BASE;
  const country = globeCountryByFeatureKey.get(key);
  const isRevealed = country ? revealed.has(country.filename) : false;
  const isInteractiveHighlight =
    globeHintBlink.has(key) || globeWrongFlash.has(key);

  // Keep interactive highlights slightly above base, but close enough to the
  // globe surface to avoid the "floating plates" effect.
  if (isInteractiveHighlight) return GLOBE_POLY_ALT_ACTIVE;
  if (isRevealed) return GLOBE_POLY_ALT_REVEALED;
  return GLOBE_POLY_ALT_BASE;
}

function globeCapColor(feature) {
  const key = globeFeatureKey(feature);
  if (!key) return 'rgba(88,115,140,0.34)';
  const country = globeCountryByFeatureKey.get(key);
  const isRevealed = country ? revealed.has(country.filename) : false;

  if (globeHintBlink.has(key)) return 'rgba(255, 220, 70, 0.95)';
  if (globeWrongFlash.has(key)) return 'rgba(255, 120, 120, 0.95)';
  if (GLOBE_HOVER_LEGACY && globeHoverFeatureKey === key) {
    return isRevealed ? 'rgba(255, 220, 50, 0.24)' : 'rgba(255, 220, 50, 0.85)';
  }
  if (isRevealed) return 'rgba(0, 0, 0, 0)';
  return GLOBE_WHITE_UNCLICKED_MODE ? 'rgba(255, 255, 255, 0.92)' : 'rgba(88, 115, 140, 0.26)';
}

function refreshGlobeStyles() {
  if (!isGlobeReady()) return;
  globe.polygonCapColor(globeCapColor);
  globe.polygonAltitude(globePolygonAltitude);
}

function refreshGlobeHoverStyles() {
  if (!isGlobeReady()) return;
  globe.polygonCapColor(globeCapColor);
}

function setGlobeHoverMnemonicTarget(targetAlpha) {
  const clampedTarget = Math.max(0, Math.min(GLOBE_HOVER_TARGET_ALPHA, targetAlpha));
  const targetUnchanged = Math.abs(clampedTarget - globeHoverMnemonicTargetAlpha) < 0.001;
  const alphaAtTarget = Math.abs(globeHoverMnemonicAlpha - clampedTarget) < 0.001;
  if (targetUnchanged && (globeHoverMnemonicRaf !== null || alphaAtTarget)) {
    if (clampedTarget <= 0.001 && alphaAtTarget && !globeHoverFeatureKey) {
      globeHoverMnemonicFeatureKey = null;
      queueGlobeHoverOverlayRender();
    }
    return;
  }

  globeHoverMnemonicFadeFrom = globeHoverMnemonicAlpha;
  globeHoverMnemonicTargetAlpha = clampedTarget;
  globeHoverMnemonicFadeStart = 0;

  if (Math.abs(globeHoverMnemonicFadeFrom - globeHoverMnemonicTargetAlpha) < 0.001) {
    globeHoverMnemonicAlpha = globeHoverMnemonicTargetAlpha;
    setGlobeHoverOverlayOpacity(globeHoverMnemonicAlpha);
    if (globeHoverMnemonicTargetAlpha <= 0.001 && !globeHoverFeatureKey) {
      globeHoverMnemonicFeatureKey = null;
      queueGlobeHoverOverlayRender();
    }
    return;
  }

  if (globeHoverMnemonicRaf !== null) return;

  const tick = now => {
    if (!globeHoverMnemonicFadeStart) globeHoverMnemonicFadeStart = now;
    const elapsed = now - globeHoverMnemonicFadeStart;
    const t = Math.min(1, elapsed / GLOBE_HOVER_FADE_MS);
    const eased = t * (2 - t);
    globeHoverMnemonicAlpha =
      globeHoverMnemonicFadeFrom +
      (globeHoverMnemonicTargetAlpha - globeHoverMnemonicFadeFrom) * eased;
    setGlobeHoverOverlayOpacity(globeHoverMnemonicAlpha);

    if (t >= 1 || Math.abs(globeHoverMnemonicTargetAlpha - globeHoverMnemonicAlpha) < 0.001) {
      globeHoverMnemonicAlpha = globeHoverMnemonicTargetAlpha;
      setGlobeHoverOverlayOpacity(globeHoverMnemonicAlpha);
      if (globeHoverMnemonicTargetAlpha <= 0.001 && !globeHoverFeatureKey) {
        globeHoverMnemonicFeatureKey = null;
        queueGlobeHoverOverlayRender();
      }
      globeHoverMnemonicRaf = null;
      return;
    }

    globeHoverMnemonicRaf = requestAnimationFrame(tick);
  };

  globeHoverMnemonicRaf = requestAnimationFrame(tick);
}

function setGlobeHoverFeature(nextKey) {
  const normalizedKey = nextKey || null;
  if (normalizedKey === globeHoverFeatureKey) return false;
  globeHoverFeatureKey = normalizedKey;

  if (GLOBE_HOVER_LEGACY) {
    globeHoverMnemonicFeatureKey = null;
    globeHoverMnemonicAlpha = 0;
    globeHoverMnemonicTargetAlpha = 0;
    setGlobeHoverOverlayOpacity(0);
    queueGlobeHoverOverlayRender();
    return true;
  }

  if (normalizedKey) {
    globeHoverMnemonicFeatureKey = normalizedKey;
    queueGlobeHoverOverlayRender();
    setGlobeHoverMnemonicTarget(GLOBE_HOVER_TARGET_ALPHA);
  } else {
    setGlobeHoverMnemonicTarget(0);
  }
  return true;
}

function onGlobeHover(feature) {
  const nextKey = globeFeatureKey(feature);
  if (!setGlobeHoverFeature(nextKey)) return;
  if (GLOBE_HOVER_LEGACY) refreshGlobeHoverStyles();
}

function onGlobeClick(feature, event) {
  const key = globeFeatureKey(feature);
  if (!key) return;

  let country = globeCountryByFeatureKey.get(key);
  if (currentMode === 'seterra' && seterraTarget && seterraTarget.featureKey === key) {
    country = seterraTarget;
  }
  if (!country) return;
  setGlobeHoverFeature(null);
  if (GLOBE_HOVER_LEGACY) refreshGlobeHoverStyles();
  handleClick(country, event);
}

function syncGlobeViewport() {
  if (!isGlobeReady()) return;
  const width = mapPanel.clientWidth;
  const height = mapPanel.clientHeight;
  if (width > 0 && height > 0) {
    globe.width(width);
    globe.height(height);
  }
}

function computeGlobeOverlayWidth(maxTextureSize) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewportWidth = Math.max(mapPanel.clientWidth || 0, globeContainer.clientWidth || 0, 1024);
  const desiredWidth = Math.round(viewportWidth * dpr * GLOBE_OVERLAY_VIEWPORT_SCALE);
  const hardMax = Math.max(1024, Math.min(GLOBE_OVERLAY_MAX_WIDTH, maxTextureSize || GLOBE_OVERLAY_MAX_WIDTH));
  return Math.max(1024, Math.min(hardMax, Math.max(GLOBE_OVERLAY_MIN_WIDTH, desiredWidth)));
}

function attachGlobeOverlayMesh(mesh, sceneRoot, baseSphere) {
  if (!mesh || !sceneRoot) return;
  if (baseSphere && baseSphere.parent) {
    baseSphere.parent.add(mesh);
    mesh.position.copy(baseSphere.position);
    mesh.quaternion.copy(baseSphere.quaternion);
    mesh.scale.copy(baseSphere.scale);
    return;
  }
  // Fallback alignment used by many globe libs: shift texture space by -90deg.
  mesh.rotation.y = -Math.PI / 2;
  sceneRoot.add(mesh);
}

async function initGlobe() {
  const GlobeCtor = await ensureGlobeGlobal();
  if (!GlobeCtor) throw new Error('Globe.gl is not available');
  const ThreeLib = await ensureThreeGlobal();

  mapWrapper.style.display = 'none';
  globeContainer.style.display = '';
  document.querySelector('.zoom-controls').style.display = 'none';

  const geoResp = await fetch(GLOBE_GEO_FILE);
  const geo = await geoResp.json();
  globeFeatures = (geo.features || []).map(sanitizeGlobeGeometry);
  globeFeatureByKey = new Map(globeFeatures.map(f => [f.properties.key, f]));
  globeCountryByFeatureKey = new Map(COUNTRIES.map(c => [c.featureKey, c]));

  globe = GlobeCtor()(globeContainer)
    .backgroundColor('rgba(0,0,0,0)')
    .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
    .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
    .showAtmosphere(true)
    .atmosphereColor('#7ab5ff')
    .atmosphereAltitude(0.18)
    .polygonAltitude(globePolygonAltitude)
    .polygonCapCurvatureResolution(1)
    .polygonSideColor(() => 'rgba(90,120,150,0)')
    .polygonStrokeColor(() => (GLOBE_BLACK_BORDERS ? 'rgba(0, 0, 0, 0.9)' : 'rgba(140, 180, 220, 0.34)'))
    .polygonsTransitionDuration(0)
    .polygonsData(globeFeatures)
    .polygonCapColor(globeCapColor)
    .onPolygonHover(onGlobeHover)
    .onPolygonClick(onGlobeClick);

  globeContainer.addEventListener('pointerleave', () => {
    setGlobeHoverFeature(null);
    if (GLOBE_HOVER_LEGACY) refreshGlobeHoverStyles();
  });

  globe.controls().enablePan = false;
  globe.controls().minDistance = 170;
  globe.controls().maxDistance = 340;
  globe.controls().autoRotate = false;
  globe.pointOfView(debugPovOrDefault(), 0);
  syncGlobeViewport();

  if (globeResizeObserver) globeResizeObserver.disconnect();
  if (window.ResizeObserver) {
    globeResizeObserver = new ResizeObserver(() => syncGlobeViewport());
    globeResizeObserver.observe(mapPanel);
  } else {
    window.addEventListener('resize', syncGlobeViewport);
  }
  requestAnimationFrame(syncGlobeViewport);

  if (ThreeLib) {
    const renderer = typeof globe.renderer === 'function' ? globe.renderer() : null;
    const maxTextureSize =
      renderer && renderer.capabilities && renderer.capabilities.maxTextureSize
        ? renderer.capabilities.maxTextureSize
        : GLOBE_OVERLAY_MAX_WIDTH;
    const overlayWidth = computeGlobeOverlayWidth(maxTextureSize);
    const overlayHeight = Math.floor(overlayWidth / 2);
    const hoverOverlayWidth = Math.min(overlayWidth, GLOBE_HOVER_OVERLAY_MAX_WIDTH);
    const hoverOverlayHeight = Math.floor(hoverOverlayWidth / 2);
    globeOverlayBaseCanvas = document.createElement('canvas');
    globeOverlayBaseCanvas.width = overlayWidth;
    globeOverlayBaseCanvas.height = overlayHeight;
    globeHoverOverlayCanvas = document.createElement('canvas');
    globeHoverOverlayCanvas.width = hoverOverlayWidth;
    globeHoverOverlayCanvas.height = hoverOverlayHeight;
    globeHoverOverlayLastRects = [];
    globeOverlayBaseDirty = true;

    globeOverlayTexture = new ThreeLib.CanvasTexture(globeOverlayBaseCanvas);
    globeOverlayTexture.premultiplyAlpha = true;
    globeOverlayTexture.generateMipmaps = false;
    globeOverlayTexture.minFilter = ThreeLib.LinearFilter;
    globeOverlayTexture.magFilter = ThreeLib.LinearFilter;
    if (ThreeLib.SRGBColorSpace) {
      globeOverlayTexture.colorSpace = ThreeLib.SRGBColorSpace;
    }
    globeOverlayTexture.anisotropy =
      renderer && renderer.capabilities && typeof renderer.capabilities.getMaxAnisotropy === 'function'
        ? Math.max(1, renderer.capabilities.getMaxAnisotropy())
        : 1;

    globeHoverOverlayTexture = new ThreeLib.CanvasTexture(globeHoverOverlayCanvas);
    globeHoverOverlayTexture.premultiplyAlpha = true;
    globeHoverOverlayTexture.generateMipmaps = false;
    globeHoverOverlayTexture.minFilter = ThreeLib.LinearFilter;
    globeHoverOverlayTexture.magFilter = ThreeLib.LinearFilter;
    if (ThreeLib.SRGBColorSpace) {
      globeHoverOverlayTexture.colorSpace = ThreeLib.SRGBColorSpace;
    }
    globeHoverOverlayTexture.anisotropy = globeOverlayTexture.anisotropy;

    const radiusCandidate = typeof globe.getGlobeRadius === 'function' ? globe.getGlobeRadius() : null;
    const radius =
      Number.isFinite(radiusCandidate) && radiusCandidate > 0 ? radiusCandidate : 100;

    const overlayGeometry = new ThreeLib.SphereGeometry(
      radius * 1.01,
      GLOBE_OVERLAY_SPHERE_WIDTH_SEGMENTS,
      GLOBE_OVERLAY_SPHERE_HEIGHT_SEGMENTS
    );
    globeOverlayMesh = new ThreeLib.Mesh(
      overlayGeometry,
      new ThreeLib.MeshBasicMaterial({
        map: globeOverlayTexture,
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
        depthTest: true
      })
    );
    globeOverlayMesh.renderOrder = 3;

    globeHoverOverlayMaterial = new ThreeLib.MeshBasicMaterial({
      map: globeHoverOverlayTexture,
      transparent: true,
      premultipliedAlpha: true,
      depthWrite: false,
      depthTest: true,
      opacity: 0
    });
    globeHoverOverlayMesh = new ThreeLib.Mesh(overlayGeometry.clone(), globeHoverOverlayMaterial);
    globeHoverOverlayMesh.renderOrder = 4;

    const sceneRoot = globe.scene();
    const baseSphere = findFirstSphereMesh(sceneRoot);
    attachGlobeOverlayMesh(globeOverlayMesh, sceneRoot, baseSphere);
    attachGlobeOverlayMesh(globeHoverOverlayMesh, sceneRoot, baseSphere);
    setGlobeHoverOverlayOpacity(0);
    queueGlobeHoverOverlayRender();
  } else {
    console.warn('THREE global not available; mnemonic image overlay on globe is disabled.');
  }

  renderGlobeOverlayTexture({ baseDirty: true });
  refreshGlobeStyles();
}

// ══════════════════════════════════
// Hit detection & overlays
// ══════════════════════════════════
function countryImgSrc(filename) {
  if (IS_GLOBE_REGION) {
    const country = COUNTRY_BY_FILENAME[filename];
    if (country && country.imageFile) return country.imageFile;
  }
  return `${ASSET_BASE}/countries/${filename}.${IMAGE_EXT}`;
}

function loadHitData() {
  const promises = COUNTRIES.map(c => new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = c.width;
      canvas.height = c.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, c.width, c.height);
      hitCanvases[c.filename] = { canvas, ctx, country: c };
      resolve();
    };
    img.onerror = resolve;
    img.src = countryImgSrc(c.filename);
  }));

  // Load special shapes (e.g. Bolivia shape for hit detection)
  for (const [key, shape] of Object.entries(SPECIAL_SHAPES)) {
    promises.push(new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = shape.width;
        canvas.height = shape.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, shape.width, shape.height);
        hitCanvases[key + '_shape'] = { canvas, ctx };
        resolve();
      };
      img.onerror = resolve;
      img.src = shape.shapeFile;
    }));
  }

  return Promise.all(promises);
}

function createOverlays() {
  COUNTRIES.forEach(c => {
    const img = document.createElement('img');
    img.className = 'country-overlay';
    img.src = countryImgSrc(c.filename);
    img.dataset.country = c.filename;
    img.draggable = false;
    mapWrapper.appendChild(img);
    overlayEls[c.filename] = img;

    const hover = document.createElement('img');
    hover.className = 'hover-highlight';
    hover.dataset.country = c.filename;
    hover.draggable = false;
    // Use special shape for hover if available (unless hitOnly)
    const shape = SPECIAL_SHAPES[c.filename];
    if (shape && !shape.hitOnly) {
      hover.src = shape.shapeFile;
    } else {
      hover.src = countryImgSrc(c.filename);
    }
    mapWrapper.appendChild(hover);
    hoverEls[c.filename] = hover;
  });

  // Add overlay (black contour lines) on top of everything, if available
  const overlayImg = document.createElement('img');
  overlayImg.className = 'map-overlay';
  overlayImg.draggable = false;
  overlayImg.id = 'map-overlay';
  overlayImg.style.display = 'none';
  overlayImg.onload = () => { overlayImg.style.display = ''; };
  overlayImg.onerror = () => overlayImg.remove();
  overlayImg.src = OVERLAY_FILE;
  mapWrapper.appendChild(overlayImg);

  // Pre-sort countries by area (smallest first) for hit testing
  sortedCountries = [...COUNTRIES].sort((a, b) => (a.width * a.height) - (b.width * b.height));

  positionOverlays();
  window.addEventListener('resize', positionOverlays);
}

function processHoverImages() {
  const HOVER_R = 255, HOVER_G = 220, HOVER_B = 50;
  const BORDER_THRESHOLD = 150;

  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = MAP_W;
  mapCanvas.height = MAP_H;
  const mapCtx = mapCanvas.getContext('2d');
  mapCtx.drawImage(baseMap, 0, 0, MAP_W, MAP_H);
  const mapData = mapCtx.getImageData(0, 0, MAP_W, MAP_H).data;

  const raw = new Uint8Array(MAP_W * MAP_H);
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    const mi = i * 4;
    const b = (mapData[mi] + mapData[mi + 1] + mapData[mi + 2]) / 3;
    if (b < BORDER_THRESHOLD || mapData[mi + 3] < 128) raw[i] = 1;
  }

  const borderMask = new Uint8Array(raw);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (borderMask[y * MAP_W + x]) continue;
      const i = y * MAP_W + x;
      if ((x > 0 && raw[i - 1]) ||
          (x < MAP_W - 1 && raw[i + 1]) ||
          (y > 0 && raw[i - MAP_W]) ||
          (y < MAP_H - 1 && raw[i + MAP_W])) {
        borderMask[i] = 1;
      }
    }
  }

  COUNTRIES.forEach(c => {
    const hc = hitCanvases[c.filename];
    if (!hc) return;

    const hitData = hc.ctx.getImageData(0, 0, c.width, c.height).data;
    hitPixelData[c.filename] = hitData;

    // Cache special shape pixel data for hit detection
    const shape = SPECIAL_SHAPES[c.filename];
    if (shape) {
      const shapeHc = hitCanvases[c.filename + '_shape'];
      if (shapeHc) {
        hitPixelData[c.filename + '_shape'] = shapeHc.ctx.getImageData(0, 0, shape.width, shape.height).data;
      }
    }

    // Determine which canvas/coords to use for the hover highlight
    let hoverSource, hoverLeft, hoverTop, hoverW, hoverH;
    if (shape && hitCanvases[c.filename + '_shape']) {
      hoverSource = hitCanvases[c.filename + '_shape'].canvas;
      hoverLeft = shape.left;
      hoverTop = shape.top;
      hoverW = shape.width;
      hoverH = shape.height;
    } else {
      hoverSource = hc.canvas;
      hoverLeft = c.left;
      hoverTop = c.top;
      hoverW = c.width;
      hoverH = c.height;
    }

    const sx = hoverLeft - MAP_LEFT;
    const sy = hoverTop - MAP_TOP;

    const canvas = document.createElement('canvas');
    canvas.width = hoverW;
    canvas.height = hoverH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(hoverSource, 0, 0);

    const pixels = ctx.getImageData(0, 0, hoverW, hoverH);
    const d = pixels.data;

    for (let y = 0; y < hoverH; y++) {
      for (let x = 0; x < hoverW; x++) {
        const mx = sx + x;
        const my = sy + y;
        const ci = (y * hoverW + x) * 4;

        if (mx < 0 || mx >= MAP_W || my < 0 || my >= MAP_H ||
            borderMask[my * MAP_W + mx]) {
          d[ci + 3] = 0;
        } else if (d[ci + 3] > 0) {
          d[ci]     = HOVER_R;
          d[ci + 1] = HOVER_G;
          d[ci + 2] = HOVER_B;
        }
      }
    }

    ctx.putImageData(pixels, 0, 0);
    const hoverEl = hoverEls[c.filename];
    if (hoverEl) hoverEl.src = canvas.toDataURL();
  });
}

function positionOverlays() {
  const mapRect = baseMap.getBoundingClientRect();
  const wrapperRect = mapWrapper.getBoundingClientRect();
  const scale = mapRect.width / MAP_W;
  const offsetX = mapRect.left - wrapperRect.left;
  const offsetY = mapRect.top - wrapperRect.top;

  COUNTRIES.forEach(c => {
    const relLeft = (c.left - MAP_LEFT) * scale;
    const relTop = (c.top - MAP_TOP) * scale;
    const relW = c.width * scale;
    const relH = c.height * scale;

    const oEl = overlayEls[c.filename];
    if (oEl) {
      oEl.style.left = (offsetX + relLeft) + 'px';
      oEl.style.top = (offsetY + relTop) + 'px';
      oEl.style.width = relW + 'px';
      oEl.style.height = relH + 'px';
    }

    const hEl = hoverEls[c.filename];
    if (hEl) {
      const shape = SPECIAL_SHAPES[c.filename];
      if (shape && !shape.hitOnly) {
        const bRelLeft = (shape.left - MAP_LEFT) * scale;
        const bRelTop = (shape.top - MAP_TOP) * scale;
        const bRelW = shape.width * scale;
        const bRelH = shape.height * scale;
        hEl.style.left = (offsetX + bRelLeft) + 'px';
        hEl.style.top = (offsetY + bRelTop) + 'px';
        hEl.style.width = bRelW + 'px';
        hEl.style.height = bRelH + 'px';
      } else {
        hEl.style.left = (offsetX + relLeft) + 'px';
        hEl.style.top = (offsetY + relTop) + 'px';
        hEl.style.width = relW + 'px';
        hEl.style.height = relH + 'px';
      }
    }
  });

  const overlayEl = document.getElementById('map-overlay');
  if (overlayEl) {
    overlayEl.style.left = offsetX + 'px';
    overlayEl.style.top = offsetY + 'px';
    overlayEl.style.width = mapRect.width + 'px';
    overlayEl.style.height = mapRect.height + 'px';
  }
}

function hitTest(clientX, clientY) {
  const mapRect = baseMap.getBoundingClientRect();
  const scale = MAP_W / mapRect.width;
  const mapX = (clientX - mapRect.left) * scale + MAP_LEFT;
  const mapY = (clientY - mapRect.top) * scale + MAP_TOP;
  for (const c of sortedCountries) {
    const shape = SPECIAL_SHAPES[c.filename];
    if (shape) {
      const lx = Math.round(mapX - shape.left), ly = Math.round(mapY - shape.top);
      if (lx < 0 || ly < 0 || lx >= shape.width || ly >= shape.height) continue;
      const data = hitPixelData[c.filename + '_shape'];
      if (!data) continue;
      if (data[((ly * shape.width + lx) * 4) + 3] > 30) return c;
    } else {
      const lx = Math.round(mapX - c.left), ly = Math.round(mapY - c.top);
      if (lx < 0 || ly < 0 || lx >= c.width || ly >= c.height) continue;
      const data = hitPixelData[c.filename];
      if (!data) continue;
      if (data[((ly * c.width + lx) * 4) + 3] > 30) return c;
    }
  }
  return null;
}

function revealCountry(filename) {
  if (IS_GLOBE_REGION) {
    revealed.add(filename);
    justRevealed.add(filename);
    renderGlobeOverlayTexture({ baseDirty: true });
    refreshGlobeStyles();
    return;
  }
  const el = overlayEls[filename];
  if (el) { el.classList.remove('flash-wrong', 'hint-blink', 'hovered'); el.classList.add('visible'); }
  revealed.add(filename);
  justRevealed.add(filename);
  const hoverEl = hoverEls[filename];
  if (hoverEl) hoverEl.classList.remove('active');
}

function flashWrong(filename) {
  if (IS_GLOBE_REGION) {
    const country = COUNTRY_BY_FILENAME[filename];
    if (!country) return;
    const key = country.featureKey;
    globeWrongFlash.add(key);
    refreshGlobeStyles();
    setTimeout(() => {
      globeWrongFlash.delete(key);
      refreshGlobeStyles();
    }, 700);
    return;
  }
  const el = overlayEls[filename];
  if (!el || revealed.has(filename)) return;
  const hoverEl = hoverEls[filename];
  if (hoverEl) hoverEl.classList.remove('active');
  el.classList.add('flash-wrong');
  setTimeout(() => { el.classList.remove('flash-wrong'); }, 1200);
}

function blinkHint(filename) {
  if (IS_GLOBE_REGION) {
    const country = COUNTRY_BY_FILENAME[filename];
    if (!country) return;
    const key = country.featureKey;
    globeHintBlink.add(key);
    refreshGlobeStyles();
    setTimeout(() => {
      globeHintBlink.delete(key);
      refreshGlobeStyles();
    }, 1500);
    return;
  }
  const el = overlayEls[filename];
  if (!el || revealed.has(filename)) return;
  el.classList.remove('hint-blink');
  void el.offsetWidth;
  el.classList.add('hint-blink');
  el.addEventListener('animationend', () => el.classList.remove('hint-blink'), { once: true });
}

function resetOverlays() {
  if (IS_GLOBE_REGION) {
    revealed.clear();
    justRevealed.clear();
    currentHover = null;
    setGlobeHoverFeature(null);
    globeWrongFlash.clear();
    globeHintBlink.clear();
    renderGlobeOverlayTexture({ baseDirty: true });
    refreshGlobeStyles();
    return;
  }
  document.querySelectorAll('.country-overlay').forEach(el => {
    el.classList.remove('visible', 'flash-wrong', 'hint-blink', 'hovered');
  });
  revealed.clear();
  justRevealed.clear();
  currentHover = null;
}

// ══════════════════════
// Hover
// ══════════════════════
let currentHover = null;
const justRevealed = new Set();
let hoverRafPending = false;

function updateHover(e) {
  const hit = hitTest(e.clientX, e.clientY);
  const newHover = hit && !NO_HOVER.has(hit.filename) ? hit.filename : null;
  if (newHover !== currentHover) {
    if (currentHover) {
      hoverEls[currentHover].classList.remove('active');
      overlayEls[currentHover].classList.remove('hovered');
      justRevealed.delete(currentHover);
    }
    if (newHover && !justRevealed.has(newHover)) {
      if (revealed.has(newHover)) {
        overlayEls[newHover].classList.add('hovered');
      } else if (!overlayEls[newHover].classList.contains('flash-wrong')) {
        hoverEls[newHover].classList.add('active');
      }
    }
    currentHover = newHover;
  }

  if (currentMode === 'seterra' && seterraTarget && !seterraLocked) {
    cursorLabel.style.left = e.clientX + 'px';
    cursorLabel.style.top = e.clientY + 'px';
  }

  if (currentMode === 'explore' && cursorLabel.classList.contains('explore-tooltip')) {
    cursorLabel.style.left = e.clientX + 'px';
    cursorLabel.style.top = e.clientY + 'px';
  }
}

// ══════════════════════
// Drag & Click
// ══════════════════════
let isDragging = false, didDrag = false;
let dragStartX = 0, dragStartY = 0, panStartX = 0, panStartY = 0;

function onPointerDown(e) {
  if (e.button !== 0) return;
  if (e.target.closest('.zoom-controls') || e.target.closest('.explore-toggle-buttons')) return;
  e.preventDefault();
  mapPanel.setPointerCapture(e.pointerId);
  isDragging = true;
  didDrag = false;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  panStartX = panX;
  panStartY = panY;
  mapWrapper.classList.add('dragging');
}

function onPointerMove(e) {
  if (currentMode === 'seterra' && seterraTarget) {
    cursorLabel.style.left = e.clientX + 'px';
    cursorLabel.style.top = e.clientY + 'px';
  } else if (currentMode === 'explore' && cursorLabel.style.display === 'block') {
    cursorLabel.style.left = e.clientX + 'px';
    cursorLabel.style.top = e.clientY + 'px';
  }
  if (!isDragging) {
    if (!hoverRafPending) {
      hoverRafPending = true;
      requestAnimationFrame(() => { hoverRafPending = false; updateHover(e); });
    }
    return;
  }
  const dx = e.clientX - dragStartX, dy = e.clientY - dragStartY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDrag = true;
  if (didDrag) {
    panX = panStartX + dx;
    panY = panStartY + dy;
    clampPan();
    applyTransform();
  }
}

function onPointerUp(e) {
  mapWrapper.classList.remove('dragging');
  if (!isDragging) return;
  isDragging = false;
  if (!didDrag) {
    const hit = hitTest(e.clientX, e.clientY);
    if (hit) handleClick(hit, e);
  }
}

function handleClick(c, e) {
  if (currentMode === 'explore') exploreClick(c, e);
  else seterraClick(c);
}

// ══════════════════════
// Explore mode
// ══════════════════════
function showInfoCard(c) {
  activeCountry = c.filename;
  infoName.textContent = c.name;
  infoShape.src = countryImgSrc(c.filename);
  const assoc = IMAGE_ASSOCIATIONS[c.filename];
  infoDesc.innerHTML = (assoc ? `<div class="assoc-box">${escHtml(assoc)}</div>` : '') + escHtml(c.desc);
  infoDefault.style.display = 'none';
  infoCard.classList.add('active');
}

function exploreClick(c, e) {
  if (revealed.has(c.filename)) {
    revealed.delete(c.filename);
    if (IS_GLOBE_REGION) {
      renderGlobeOverlayTexture({ baseDirty: true });
      refreshGlobeStyles();
    } else {
      const overlay = overlayEls[c.filename];
      overlay.classList.remove('visible', 'hovered');
    }
  } else {
    revealCountry(c.filename);
  }
  showInfoCard(c);

  if (e) {
    clearTimeout(exploreTooltipTimer);
    cursorLabel.textContent = c.name;
    cursorLabel.classList.add('explore-tooltip');
    cursorLabel.style.left = e.clientX + 'px';
    cursorLabel.style.top = e.clientY + 'px';
    cursorLabel.style.display = 'block';
    exploreTooltipTimer = setTimeout(hideExploreTooltip, 1000);
  }
  exploredCountEl.textContent = revealed.size;
}

function hideExploreTooltip() {
  clearTimeout(exploreTooltipTimer);
  cursorLabel.style.display = 'none';
  cursorLabel.classList.remove('explore-tooltip');
}

// ══════════════════════
// Seterra mode
// ══════════════════════
function startSeterra() {
  resetOverlays();
  seterraQueue = shuffle([...COUNTRIES]);
  seterraCorrect = 0;
  seterraWrong = 0;
  seterraTotal = COUNTRIES.length;
  seterraLocked = false;
  seterraTargetMisses = 0;
  seterraIsRetry = false;
  seterraMissedCountries.clear();
  seterraStartTime = Date.now();

  seterraGame.classList.add('active');
  seterraDone.classList.remove('active');
  cursorLabel.style.display = IS_GLOBE_REGION ? 'none' : 'block';

  updateSeterraUI();
  nextSeterraTarget();

  clearInterval(seterraTimerInterval);
  seterraTimerInterval = setInterval(updateSeterraTimer, 500);
}

function startSeterraRetry() {
  const missedList = COUNTRIES.filter(c => seterraMissedCountries.has(c.filename));
  if (missedList.length === 0) return;

  resetOverlays();
  if (IS_GLOBE_REGION) {
    COUNTRIES.forEach(c => {
      if (!seterraMissedCountries.has(c.filename)) {
        revealed.add(c.filename);
        justRevealed.add(c.filename);
      }
    });
    renderGlobeOverlayTexture({ baseDirty: true });
    refreshGlobeStyles();
  } else {
    COUNTRIES.forEach(c => {
      if (!seterraMissedCountries.has(c.filename)) revealCountry(c.filename);
    });
  }

  seterraQueue = shuffle([...missedList]);
  seterraCorrect = 0;
  seterraWrong = 0;
  seterraTotal = missedList.length;
  seterraLocked = false;
  seterraTargetMisses = 0;
  seterraIsRetry = true;
  seterraMissedCountries.clear();
  seterraStartTime = Date.now();

  seterraGame.classList.add('active');
  seterraDone.classList.remove('active');
  cursorLabel.style.display = IS_GLOBE_REGION ? 'none' : 'block';

  updateSeterraUI();
  nextSeterraTarget();

  clearInterval(seterraTimerInterval);
  seterraTimerInterval = setInterval(updateSeterraTimer, 500);
}

function nextSeterraTarget() {
  if (seterraQueue.length === 0) {
    endSeterra();
    return;
  }
  seterraTarget = seterraQueue.pop();
  seterraTargetMisses = 0;
  seterraTargetName.textContent = seterraTarget.name;
  if (!IS_GLOBE_REGION) cursorLabel.textContent = seterraTarget.name;
  seterraFeedback.className = 'seterra-feedback';
  seterraFeedback.innerHTML = '';
}

function seterraClick(c) {
  if (!seterraTarget || seterraLocked) return;

  const isCorrect = IS_GLOBE_REGION
    ? c.featureKey === seterraTarget.featureKey
    : c.filename === seterraTarget.filename;

  if (isCorrect) {
    seterraCorrect++;
    seterraTargetMisses = 0;
    revealCountry(seterraTarget.filename);
    seterraFeedback.className = 'seterra-feedback correct-fb';
    const correctAssoc = IMAGE_ASSOCIATIONS[seterraTarget.filename];
    seterraFeedback.innerHTML = `<div class="fb-banner correct-banner">RÄTT!</div><div class="fb-title">${escHtml(seterraTarget.name)}</div>${correctAssoc ? `<div class="assoc-box">${escHtml(correctAssoc)}</div>` : ''}<div class="fb-desc">${escHtml(seterraTarget.desc)}</div>`;
    updateSeterraUI();
    nextSeterraTarget();
  } else {
    seterraWrong++;
    seterraTargetMisses++;
    seterraMissedCountries.add(seterraTarget.filename);
    flashWrong(c.filename);
    seterraFeedback.className = 'seterra-feedback wrong-fb';
    const wrongAssoc = IMAGE_ASSOCIATIONS[c.filename];
    seterraFeedback.innerHTML = `<div class="fb-title">Det var ${escHtml(c.name)}</div>${wrongAssoc ? `<div class="assoc-box">${escHtml(wrongAssoc)}</div>` : ''}<div class="fb-desc">${escHtml(c.desc)}</div>`;
    updateSeterraUI();

    if (seterraTargetMisses >= 3) {
      blinkHint(seterraTarget.filename);
    }

    seterraLocked = true;
    setTimeout(() => { seterraLocked = false; }, 600);
  }
}

function updateSeterraUI() {
  const totalClicks = seterraCorrect + seterraWrong;
  const score = totalClicks > 0 ? Math.round((seterraCorrect / totalClicks) * 100) : 100;
  seterraScoreEl.textContent = score + '%';
  seterraCorrectEl.textContent = seterraCorrect;
  seterraWrongEl.textContent = seterraWrong;
  const pct = Math.round((seterraCorrect / seterraTotal) * 100);
  seterraBar.style.width = pct + '%';
  seterraProgressLabel.textContent = `${seterraCorrect} / ${seterraTotal}`;
}

function updateSeterraTimer() {
  const elapsed = Math.floor((Date.now() - seterraStartTime) / 1000);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  seterraTimeEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
}

function endSeterra() {
  clearInterval(seterraTimerInterval);
  updateSeterraTimer();
  seterraTarget = null;
  cursorLabel.style.display = 'none';

  const totalClicks = seterraCorrect + seterraWrong;
  const score = totalClicks > 0 ? Math.round((seterraCorrect / totalClicks) * 100) : 100;
  seterraElapsed = Math.floor((Date.now() - seterraStartTime) / 1000);
  const m = Math.floor(seterraElapsed / 60);
  const s = seterraElapsed % 60;

  seterraGame.classList.remove('active');
  seterraDone.classList.add('active');
  document.getElementById('seterra-final-score').textContent = score + '%';
  document.getElementById('seterra-final-detail').innerHTML =
    `${seterraCorrect} av ${seterraTotal} länder<br>${seterraWrong} felklick<br>Tid: ${m}:${s.toString().padStart(2, '0')}`;

  const retryBtn = document.getElementById('seterra-retry');
  if (seterraMissedCountries.size > 0) {
    retryBtn.style.display = '';
    retryBtn.textContent = `Öva på felaktiga (${seterraMissedCountries.size} st)`;
  } else {
    retryBtn.style.display = 'none';
  }

  document.getElementById('hs-form').style.display = 'none';
  document.getElementById('hs-saved-msg').style.display = 'none';

  if (!seterraIsRetry) {
    showNameModal(score, m, s);
  } else {
    renderHighscores();
  }
}

// ══════════════════════
// High scores
// ══════════════════════
function getLocalHighscores() {
  try { return JSON.parse(localStorage.getItem(HS_KEY)) || []; }
  catch { return []; }
}

async function getHighscores() {
  const local = getLocalHighscores();

  if (!firebaseDB) return local;
  try {
    const snap = await firebaseDB.ref('highscores/' + HS_KEY).once('value');
    const remote = [];
    snap.forEach(child => { remote.push(child.val()); });

    // Sync: push any local-only entries to Firebase
    const remoteDates = new Set(remote.map(e => e.date));
    const localOnly = local.filter(e => !remoteDates.has(e.date));
    if (localOnly.length > 0) {
      const updates = {};
      for (const e of localOnly) {
        const newKey = firebaseDB.ref('highscores/' + HS_KEY).push().key;
        updates[newKey] = e;
      }
      await firebaseDB.ref('highscores/' + HS_KEY).update(updates);
      remote.push(...localOnly);
    }

    // Merge: start with remote, add any local entries not found in remote
    const seen = new Set(remote.map(e => e.date));
    const merged = [...remote];
    for (const e of local) {
      if (!seen.has(e.date)) merged.push(e);
    }

    merged.sort((a, b) => b.score - a.score || a.time - b.time);
    if (merged.length > 30) merged.length = 30;

    // Cache merged result so offline fallback shows all entries
    localStorage.setItem(HS_KEY, JSON.stringify(merged));

    return merged;
  } catch (e) {
    console.warn('Firebase read failed, using local:', e);
    return local;
  }
}

async function saveHighscore(name, score, time, wrong) {
  const entry = { name, score, time, wrong, date: Date.now() };

  // Always save locally as backup
  const local = getLocalHighscores();
  local.push(entry);
  local.sort((a, b) => b.score - a.score || a.time - b.time);
  if (local.length > 30) local.length = 30;
  localStorage.setItem(HS_KEY, JSON.stringify(local));

  // Save to Firebase
  if (firebaseDB) {
    try {
      await firebaseDB.ref('highscores/' + HS_KEY).push(entry);
      // Trim to top 30: read all, delete excess
      const snap = await firebaseDB.ref('highscores/' + HS_KEY)
        .orderByChild('score').once('value');
      const all = [];
      snap.forEach(child => { all.push({ key: child.key, ...child.val() }); });
      all.sort((a, b) => b.score - a.score || a.time - b.time);
      if (all.length > 30) {
        const removes = {};
        for (let i = 30; i < all.length; i++) removes[all[i].key] = null;
        await firebaseDB.ref('highscores/' + HS_KEY).update(removes);
      }
    } catch (e) {
      console.warn('Firebase write failed:', e);
    }
  }
  return entry;
}

async function renderHighscores(highlightEntry) {
  const container = document.getElementById('highscore-list');
  container.innerHTML = '<div class="hs-empty">Laddar topplista...</div>';

  const list = await getHighscores();

  if (list.length === 0) {
    container.innerHTML = '<div class="hs-empty">Inga sparade resultat ännu.</div>';
    return;
  }

  let html = '<h3>Topp 30</h3><table class="hs-table"><thead><tr><th>#</th><th>Namn</th><th>Poäng</th><th>Tid</th></tr></thead><tbody>';
  list.forEach((e, i) => {
    const m = Math.floor(e.time / 60);
    const s = e.time % 60;
    const isCurrent = highlightEntry && e.date === highlightEntry.date && e.name === highlightEntry.name;
    html += `<tr class="${isCurrent ? 'hs-current' : ''}"><td>${i + 1}</td><td>${escHtml(e.name)}</td><td>${e.score}%</td><td>${m}:${s.toString().padStart(2, '0')}</td></tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ══════════════════════
// Name popup modal
// ══════════════════════
const nameModalOverlay = document.getElementById('name-modal-overlay');
const modalNameInput = document.getElementById('modal-name');

function showNameModal(score, m, s) {
  document.getElementById('modal-score').textContent = score + '%';
  document.getElementById('modal-detail').innerHTML =
    `${seterraCorrect} av ${seterraTotal} länder &bull; ${seterraWrong} fel &bull; ${m}:${s.toString().padStart(2, '0')}`;
  modalNameInput.value = '';
  nameModalOverlay.classList.add('active');
  setTimeout(() => modalNameInput.focus(), 100);
}

function closeNameModal() {
  nameModalOverlay.classList.remove('active');
}

// ══════════════════════
// Mode switching
// ══════════════════════
function switchMode(mode) {
  if (mode === currentMode) return;
  currentMode = mode;

  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));

  if (mode === 'explore') {
    document.getElementById('explore-ui').style.display = '';
    document.getElementById('seterra-ui').style.display = 'none';
    document.getElementById('explore-toggle-buttons').style.display = '';
    hideExploreTooltip();
    clearInterval(seterraTimerInterval);
    seterraTarget = null;
    headerHint.textContent = IS_GLOBE_REGION ? 'Klicka på ett land på jordgloben' : 'Klicka på ett land';
    resetOverlays();
    activeCountry = null;
    infoCard.classList.remove('active');
    infoDefault.style.display = '';
    exploredCountEl.textContent = '0';
  } else {
    document.getElementById('explore-ui').style.display = 'none';
    document.getElementById('seterra-ui').style.display = '';
    document.getElementById('explore-toggle-buttons').style.display = 'none';
    headerHint.textContent = IS_GLOBE_REGION ? 'Klicka på jordgloben där du tror landet är!' : 'Klicka där du tror landet är!';
    startSeterra();
  }

  if (IS_GLOBE_REGION) {
    refreshGlobeStyles();
    renderGlobeOverlayTexture();
  }
}

// ══════════════════════
// Zoom & Transform
// ══════════════════════
function applyTransform() {
  mapWrapper.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  zoomLevelEl.textContent = Math.round(zoom * 100) + '%';
}

function clampPan() {
  const baseW = baseMap.offsetWidth, baseH = baseMap.offsetHeight;
  const panelW = mapPanel.clientWidth, panelH = mapPanel.clientHeight;
  const scaledW = baseW * zoom, scaledH = baseH * zoom;
  const maxX = Math.max(0, (scaledW - panelW) / 2 + panelW * 0.5);
  const maxY = Math.max(0, (scaledH - panelH) / 2 + panelH * 0.5);
  panX = Math.max(-maxX, Math.min(maxX, panX));
  panY = Math.max(-maxY, Math.min(maxY, panY));
}

function setZoom(newZoom, cursorX, cursorY) {
  const oldZoom = zoom;
  zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
  if (zoom === oldZoom) return;
  if (cursorX !== undefined && cursorY !== undefined) {
    const r = mapPanel.getBoundingClientRect();
    const cx = cursorX - r.left - r.width / 2;
    const cy = cursorY - r.top - r.height / 2;
    panX = cx - ((cx - panX) / oldZoom) * zoom;
    panY = cy - ((cy - panY) / oldZoom) * zoom;
  }
  clampPan();
  applyTransform();
}

function onWheel(e) {
  e.preventDefault();
  setZoom(zoom * (e.deltaY > 0 ? 0.9 : 1.1), e.clientX, e.clientY);
}

// ══════════════════════════════════
// Config loading from JSON
// ══════════════════════════════════
async function loadRegionConfig(slug) {
  const resp = await fetch(`assets/${slug}/config.json`);
  const raw = await resp.json();
  const assetBase = `assets/${slug}`;

  if (raw.isGlobe || slug === 'globe') {
    const countries = [];
    const imageAssociations = {};

    for (const c of raw.countries || []) {
      const filename = c.filename || c.featureKey || c.name;
      countries.push({
        name: c.name,
        filename,
        featureKey: c.featureKey,
        imageFile: c.imageFile,
        warpFile: c.warpFile || '',
        warpLeft: c.warpLeft || 0,
        warpTop: c.warpTop || 0,
        warpWidth: c.warpWidth || 0,
        warpHeight: c.warpHeight || 0,
        centerLon: c.centerLon || 0,
        centerLat: c.centerLat || 0,
        desc: c.desc || ''
      });
      if (c.imageAssociation) {
        imageAssociations[filename] = c.imageAssociation;
      }
    }

    return {
      name: raw.name || 'Världen',
      slug,
      isGlobe: true,
      hsKey: raw.hsKey || 'globe-highscores',
      geoFile: `${assetBase}/world.geojson`,
      warpAtlasWidth: raw.warpAtlasWidth || 8192,
      warpAtlasHeight: raw.warpAtlasHeight || 4096,
      assetBase,
      imageExt: 'webp',
      mapFile: '',
      overlayFile: '',
      mapLeft: 0,
      mapTop: 0,
      mapW: 0,
      mapH: 0,
      specialShapes: {},
      countries,
      imageAssociations
    };
  }

  const config = {
    name: raw.name,
    slug: slug,
    isGlobe: false,
    assetBase: assetBase,
    imageExt: 'webp',
    mapFile: `${assetBase}/map.webp`,
    overlayFile: `${assetBase}/overlay.webp`,
    hsKey: raw.hsKey || `${slug}-highscores`,
    mapLeft: raw.mapOffset.left,
    mapTop: raw.mapOffset.top,
    mapW: raw.mapWidth,
    mapH: raw.mapHeight,
    specialShapes: {},
    countries: [],
    imageAssociations: {}
  };

  // Process special shapes from config
  if (raw.specialShapes) {
    for (const [key, shape] of Object.entries(raw.specialShapes)) {
      config.specialShapes[key] = {
        shapeFile: `${assetBase}/${shape.file}`,
        left: shape.left,
        top: shape.top,
        width: shape.width,
        height: shape.height,
        hitOnly: shape.hitOnly || false
      };
    }
  }

  // Process countries
  for (const c of raw.countries) {
    const filename = c.filename || c.file.replace('countries/', '').replace('.webp', '');

    config.countries.push({
      name: c.name,
      filename: filename,
      left: c.left,
      top: c.top,
      width: c.width,
      height: c.height,
      centerX: c.centerX || Math.round(c.left + c.width / 2),
      centerY: c.centerY || Math.round(c.top + c.height / 2),
      desc: c.desc || ''
    });

    if (c.imageAssociation) {
      config.imageAssociations[filename] = c.imageAssociation;
    }
  }

  return config;
}

// ══════════════════════════════════
// Game initialization
// ══════════════════════════════════
async function initGame(config) {
  // Set dynamic globals
  COUNTRIES = config.countries;
  MAP_LEFT = config.mapLeft;
  MAP_TOP = config.mapTop;
  MAP_W = config.mapW;
  MAP_H = config.mapH;
  IMAGE_ASSOCIATIONS = config.imageAssociations;
  HS_KEY = config.hsKey;
  ASSET_BASE = config.assetBase;
  IMAGE_EXT = config.imageExt;
  MAP_FILE = config.mapFile;
  OVERLAY_FILE = config.overlayFile;
  SPECIAL_SHAPES = config.specialShapes;
  IS_GLOBE_REGION = !!config.isGlobe;
  GLOBE_GEO_FILE = config.geoFile || '';
  GLOBE_WARP_ATLAS_WIDTH = config.warpAtlasWidth || 8192;
  GLOBE_WARP_ATLAS_HEIGHT = config.warpAtlasHeight || 4096;
  COUNTRY_BY_FILENAME = Object.fromEntries(COUNTRIES.map(c => [c.filename, c]));

  // Update HTML elements
  document.title = `${config.name} – Jonas geografi`;
  document.querySelector('header h1').textContent = config.name;
  document.querySelectorAll('[data-total]').forEach(el => el.textContent = COUNTRIES.length);
  seterraProgressLabel.textContent = `0 / ${COUNTRIES.length}`;

  // Show game container (hidden if region selector was showing)
  document.getElementById('region-selector').style.display = 'none';
  document.querySelector('.game-container').style.display = '';
  document.querySelector('header').style.display = '';
  document.querySelector('.mode-toggle').style.display = '';
  document.getElementById('header-hint').style.display = '';
  headerHint.textContent = IS_GLOBE_REGION ? 'Klicka på ett land på jordgloben' : 'Klicka på ett land';
  document.body.style.overflow = 'hidden';

  if (IS_GLOBE_REGION) {
    baseMap.removeAttribute('src');
    mapWrapper.style.display = 'none';
    globeContainer.style.display = '';
    document.querySelector('.zoom-controls').style.display = 'none';
    await initGlobe();
  } else {
    globeContainer.style.display = 'none';
    mapWrapper.style.display = '';
    document.querySelector('.zoom-controls').style.display = '';

    // Set map image and wait for it to load
    baseMap.src = MAP_FILE;
    baseMap.alt = config.name + ' karta';
    await new Promise(resolve => {
      if (baseMap.complete && baseMap.naturalWidth > 0) resolve();
      else baseMap.onload = resolve;
    });

    createOverlays();
    await loadHitData();
    processHoverImages();

    // Attach event listeners
    mapPanel.addEventListener('pointerdown', onPointerDown);
    mapPanel.addEventListener('pointermove', onPointerMove);
    mapPanel.addEventListener('pointerup', onPointerUp);
    mapPanel.addEventListener('pointercancel', onPointerUp);
    mapPanel.addEventListener('wheel', onWheel, { passive: false });
  }
}

// ══════════════════════════════════
// Static event listeners
// ══════════════════════════════════
document.getElementById('hs-save').addEventListener('click', async () => {
  const name = document.getElementById('hs-name').value.trim();
  if (!name) return;
  const totalClicks = seterraCorrect + seterraWrong;
  const score = totalClicks > 0 ? Math.round((seterraCorrect / totalClicks) * 100) : 100;
  const entry = await saveHighscore(name, score, seterraElapsed, seterraWrong);
  document.getElementById('hs-form').style.display = 'none';
  document.getElementById('hs-saved-msg').style.display = '';
  await renderHighscores(entry);
});

document.getElementById('hs-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('hs-save').click();
});

document.getElementById('seterra-restart').addEventListener('click', startSeterra);
document.getElementById('seterra-retry').addEventListener('click', startSeterraRetry);

document.getElementById('modal-save').addEventListener('click', async () => {
  const name = modalNameInput.value.trim();
  if (!name) { modalNameInput.focus(); return; }
  const totalClicks = seterraCorrect + seterraWrong;
  const score = totalClicks > 0 ? Math.round((seterraCorrect / totalClicks) * 100) : 100;
  const entry = await saveHighscore(name, score, seterraElapsed, seterraWrong);
  closeNameModal();
  await renderHighscores(entry);
});

modalNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('modal-save').click();
});

document.getElementById('modal-skip').addEventListener('click', () => {
  closeNameModal();
  renderHighscores();
});

nameModalOverlay.addEventListener('click', (e) => {
  if (e.target === nameModalOverlay) {
    closeNameModal();
    renderHighscores();
  }
});

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => switchMode(btn.dataset.mode));
});

document.getElementById('zoom-in').addEventListener('click', () => setZoom(zoom * 1.3));
document.getElementById('zoom-out').addEventListener('click', () => setZoom(zoom / 1.3));

document.querySelectorAll('.explore-toggle-btn').forEach(btn => {
  btn.addEventListener('pointerdown', e => e.stopPropagation());
});

document.getElementById('show-all-btn').addEventListener('click', () => {
  COUNTRIES.forEach(c => revealCountry(c.filename));
  exploredCountEl.textContent = revealed.size;
  if (COUNTRIES.length) showInfoCard(COUNTRIES[0]);
});

document.getElementById('hide-all-btn').addEventListener('click', () => {
  resetOverlays();
  exploredCountEl.textContent = '0';
  activeCountry = null;
  infoCard.classList.remove('active');
  infoDefault.style.display = '';
});

// Jonas high-five (global counter via Firebase)
const jonasImg = document.getElementById('jonas-img');
const highfiveCountEl = document.getElementById('highfive-count');
const highfiveAudio = new Audio('high_five.wav');
const highfiveRef = firebaseDB ? firebaseDB.ref('highfives') : null;

// Load initial count
if (highfiveRef) {
  highfiveRef.on('value', snap => {
    const val = snap.val() || 0;
    highfiveCountEl.textContent = val;
  });
} else {
  highfiveCountEl.textContent = localStorage.getItem('highfive-count') || '0';
}

jonasImg.addEventListener('click', () => {
  highfiveAudio.currentTime = 0;
  highfiveAudio.play();
  jonasImg.src = 'Jonas_2.webp';
  setTimeout(() => { jonasImg.src = 'Jonas_1.webp'; }, 1000);

  if (highfiveRef) {
    highfiveRef.transaction(current => (current || 0) + 1);
  } else {
    const count = parseInt(localStorage.getItem('highfive-count') || '0', 10) + 1;
    localStorage.setItem('highfive-count', count);
    highfiveCountEl.textContent = count;
  }
});

// ══════════════════════════════════
// Region selector helpers
// ══════════════════════════════════
function showRegionSelector() {
  document.getElementById('region-selector').style.display = '';
  document.querySelector('.game-container').style.display = 'none';
  document.querySelector('.mode-toggle').style.display = 'none';
  document.getElementById('header-hint').style.display = 'none';
  document.getElementById('back-btn').style.display = 'none';
  document.querySelector('header h1').textContent = 'Jonas geografi';
  document.title = 'Jonas geografi';
  document.body.style.overflow = 'auto';
}

document.getElementById('back-btn').addEventListener('click', () => {
  history.pushState(null, '', window.location.pathname);
  showRegionSelector();
});

// ══════════════════════════════════
// Bootstrap
// ══════════════════════════════════
(async () => {
  const params = new URLSearchParams(window.location.search);
  const region = params.get('region');

  if (region) {
    try {
      const config = await loadRegionConfig(region);
      await initGame(config);
      document.getElementById('back-btn').style.display = '';
    } catch (e) {
      console.error('Failed to load region:', e);
      showRegionSelector();
    }
  } else {
    showRegionSelector();
  }
})();
