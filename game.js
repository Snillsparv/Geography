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
let GLOBE_POLYGON_GEO_FILE = '';
let GLOBE_WARP_ATLAS_WIDTH = 8192;
let GLOBE_WARP_ATLAS_HEIGHT = 4096;
let GLOBE_WARP_VERSION = '';
let COUNTRY_BY_FILENAME = {};
const URL_PARAMS = new URLSearchParams(window.location.search);
const DEBUG_SHOW_ALL_GLOBE = URL_PARAMS.get('debug_all_globe') === '1';
const DEBUG_GLOBE_CLIP_PARAM = URL_PARAMS.get('debug_clip');
const DEBUG_GLOBE_CLIP_FORCE_ON = DEBUG_GLOBE_CLIP_PARAM === '1';
const DEBUG_GLOBE_CLIP_FORCE_OFF = DEBUG_GLOBE_CLIP_PARAM === '0';
// `debug_raw_unclipped=1` lets us inspect the pre-warp globe overlay: no warp files, no polygon clipping.
const DEBUG_RAW_UNCLIPPED = URL_PARAMS.get('debug_raw_unclipped') === '1';
// Keep legacy param for compatibility, but do not disable warps with it anymore.
const DEBUG_NO_EDGE_PULL_PARAM = URL_PARAMS.get('debug_no_edge_pull') === '1';
const DEBUG_DISABLE_GLOBE_WARP = DEBUG_RAW_UNCLIPPED || URL_PARAMS.get('debug_no_warp') === '1';
const GLOBE_WARP_CROP_MODE_PARAM = normalizeGlobeCropMode(
  URL_PARAMS.get('globe_crop') || URL_PARAMS.get('globe_crop_mode')
);
const GLOBE_WARP_CROP_MODE_GLOBAL = normalizeGlobeCropMode(
  window.GLOBE_WARP_CROP_MODE || window.GLOBE_CROP_MODE
);
const GLOBE_WARP_CROP_MODE_OVERRIDE =
  GLOBE_WARP_CROP_MODE_GLOBAL || GLOBE_WARP_CROP_MODE_PARAM;
// `globe_hover_legacy=1` keeps previous polygon-hover behavior.
const GLOBE_HOVER_LEGACY = URL_PARAMS.get('globe_hover_legacy') === '1';
const GLOBE_WHITE_UNCLICKED_MODE =
  URL_PARAMS.get('globe_white_unclicked') === '1' ||
  URL_PARAMS.get('globe_white_fill') === '1';
const GLOBE_BLACK_BORDERS =
  URL_PARAMS.get('globe_black_borders') === '1' ||
  URL_PARAMS.get('globe_border_black') === '1';
const GLOBE_POLYGON_STROKE_ENABLED = readUrlBooleanParam(
  ['globe_polygon_stroke', 'globe_poly_stroke'],
  true
);
const GLOBE_POLYGON_STROKE_OVERLAY_PREFERRED = readUrlBooleanParam(
  ['globe_polygon_stroke_overlay', 'globe_poly_stroke_overlay'],
  true
);
const GLOBE_POLYGON_STROKE_OVERLAY_WIDTH = readUrlNumberParam(
  ['globe_polygon_stroke_overlay_width', 'globe_poly_stroke_overlay_width'],
  1.15,
  0.2,
  4
);
const GLOBE_POLYGON_STROKE_EQUALIZE_COAST = readUrlBooleanParam(
  ['globe_polygon_stroke_equalize_coast', 'globe_border_equalize_coast'],
  true
);
const GLOBE_POLYGON_STROKE_CONTRAST = readUrlBooleanParam(
  ['globe_polygon_stroke_contrast', 'globe_border_contrast'],
  true
);
const GLOBE_POLYGON_STROKE_OUTER_SCALE = readUrlNumberParam(
  ['globe_polygon_stroke_outer_scale', 'globe_border_outer_scale'],
  1.9,
  0.5,
  6
);
const GLOBE_POLYGON_STROKE_INNER_SCALE = readUrlNumberParam(
  ['globe_polygon_stroke_inner_scale', 'globe_border_inner_scale'],
  0.95,
  0.2,
  4
);
const GLOBE_STROKE_MAIN_GEO = readUrlBooleanParam(
  ['globe_stroke_main_geo', 'globe_border_main_geo'],
  true
);
const GLOBE_POLYGON_SIDE_ENABLED = readUrlBooleanParam(
  ['globe_polygon_side', 'globe_poly_side'],
  false
);
const GLOBE_UNCLICKED_FILL_VISIBLE = readUrlBooleanParam(
  ['globe_unclicked_fill', 'globe_unrevealed_fill'],
  false
);
const GLOBE_UNCLICKED_FILL_ALPHA = readUrlNumberParam(
  ['globe_unclicked_fill_alpha', 'globe_poly_fill_alpha'],
  0.65,
  0,
  1
);
const GLOBE_UNCLICKED_FILL_OVERLAY_PREFERRED = readUrlBooleanParam(
  ['globe_unclicked_fill_overlay', 'globe_poly_fill_overlay'],
  true
);
const GLOBE_PROFILE_MODE = normalizeGlobeProfileMode(
  URL_PARAMS.get('globe_profile_mode') || URL_PARAMS.get('globe_layers_mode')
);
const GLOBE_LAYER_VISIBILITY = resolveGlobeLayerVisibility();
const GLOBE_LAYER_BASE = GLOBE_LAYER_VISIBILITY.base;
const GLOBE_LAYER_POLYGONS = GLOBE_LAYER_VISIBILITY.polygons;
const GLOBE_LAYER_MNEMONICS = GLOBE_LAYER_VISIBILITY.mnemonics;
const GLOBE_PROFILE_ENABLED = readUrlBooleanParam(
  ['globe_profile', 'debug_globe_profile', 'debug_perf'],
  false
);
const GLOBE_PROFILE_DUMP_DOM = readUrlBooleanParam(
  ['globe_profile_dump', 'debug_profile_dump'],
  false
);
const GLOBE_PROFILE_WARMUP_MS = readUrlNumberParam(
  ['globe_profile_warmup_ms', 'debug_profile_warmup_ms'],
  2000,
  0,
  60000
);
const GLOBE_PROFILE_SAMPLE_MS = readUrlNumberParam(
  ['globe_profile_sample_ms', 'debug_profile_sample_ms'],
  8000,
  250,
  120000
);
const GLOBE_PROFILE_ROTATE = readUrlBooleanParam(
  ['globe_profile_rotate', 'debug_profile_rotate'],
  true
);
const GLOBE_PROFILE_LABEL = (URL_PARAMS.get('globe_profile_label') || '').trim();
const GLOBE_PRELOAD_MNEMONIC_IMAGES = readUrlBooleanParam(
  ['globe_preload_mnemonics', 'globe_preload_images'],
  true
);
const GLOBE_PRELOAD_MNEMONIC_BLOCKING = readUrlBooleanParam(
  ['globe_preload_blocking', 'globe_preload_wait'],
  false
);
const GLOBE_POLYGON_CURVATURE_RESOLUTION = readUrlNumberParam(
  ['globe_polygon_curvature_res', 'globe_poly_curve_res'],
  18,
  1,
  30
);
const GLOBE_POLYGON_FORCE_MAIN_GEO = readUrlBooleanParam(
  ['globe_polygon_main_geo', 'globe_polygon_full_geo'],
  GLOBE_UNCLICKED_FILL_VISIBLE
);
const GLOBE_POINTER_MODE = (() => {
  const raw = (URL_PARAMS.get('globe_pointer_mode') || URL_PARAMS.get('globe_pointer') || '').trim().toLowerCase();
  if (raw === 'legacy' || raw === 'globe') return 'legacy';
  return 'cpu';
})();
const GLOBE_USE_CPU_POINTER = GLOBE_POINTER_MODE !== 'legacy';
const GLOBE_CPU_HIT_SIMPLIFIED = readUrlBooleanParam(
  ['globe_hit_simplified', 'globe_hit_light'],
  true
);
const DEBUG_GLOBE_POV = {
  lat: Number(URL_PARAMS.get('debug_pov_lat')),
  lng: Number(URL_PARAMS.get('debug_pov_lng')),
  altitude: Number(URL_PARAMS.get('debug_pov_alt'))
};

let GLOBE_WARP_CROP_MODE = GLOBE_WARP_CROP_MODE_OVERRIDE || 'mnemonic';

if (DEBUG_NO_EDGE_PULL_PARAM) {
  console.info('debug_no_edge_pull is deprecated in renderer; use debug_no_warp=1 for raw image preview.');
}

function debugPovOrDefault() {
  const lat = Number.isFinite(DEBUG_GLOBE_POV.lat) ? DEBUG_GLOBE_POV.lat : 20;
  const lng = Number.isFinite(DEBUG_GLOBE_POV.lng) ? DEBUG_GLOBE_POV.lng : 10;
  const altitude = Number.isFinite(DEBUG_GLOBE_POV.altitude) ? DEBUG_GLOBE_POV.altitude : 1.9;
  return { lat, lng, altitude };
}

function normalizeGlobeCropMode(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (value === 'geographic' || value === 'geo' || value === 'geometry') return 'geographic';
  if (value === 'mnemonic' || value === 'drawing' || value === 'art') return 'mnemonic';
  return null;
}

function normalizeGlobeProfileMode(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (value === 'all' || value === 'full' || value === 'default') return 'all';
  if (value === 'globe' || value === 'earth' || value === 'globe-only' || value === 'earth-only') {
    return 'globe-only';
  }
  if (value === 'mnemonics' || value === 'mnemonic' || value === 'drawing' || value === 'mnemonics-only') {
    return 'mnemonics-only';
  }
  if (value === 'polygons' || value === 'polygon' || value === 'poly' || value === 'polygons-only') {
    return 'polygons-only';
  }
  return null;
}

function readUrlBooleanParam(names, fallbackValue) {
  const keys = Array.isArray(names) ? names : [names];
  for (const key of keys) {
    const raw = URL_PARAMS.get(key);
    if (raw === null) continue;
    const value = raw.trim().toLowerCase();
    if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
    if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
  }
  return fallbackValue;
}

function readUrlNumberParam(names, fallbackValue, min = -Infinity, max = Infinity) {
  const keys = Array.isArray(names) ? names : [names];
  for (const key of keys) {
    const raw = URL_PARAMS.get(key);
    if (raw === null || raw.trim() === '') continue;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) continue;
    return Math.min(max, Math.max(min, parsed));
  }
  return fallbackValue;
}

function resolveGlobeLayerVisibility() {
  // Keep globe base + mnemonics + border-ready polygon data enabled by default.
  // Heavy interaction hit-testing is still CPU-side via lat/lng against features.
  let defaults = { base: true, polygons: true, mnemonics: true };
  if (GLOBE_PROFILE_MODE === 'globe-only') defaults = { base: true, polygons: false, mnemonics: false };
  else if (GLOBE_PROFILE_MODE === 'mnemonics-only') defaults = { base: false, polygons: false, mnemonics: true };
  else if (GLOBE_PROFILE_MODE === 'polygons-only') defaults = { base: false, polygons: true, mnemonics: false };

  return {
    base: readUrlBooleanParam(['globe_layer_base', 'globe_base'], defaults.base),
    polygons: readUrlBooleanParam(['globe_layer_polygons', 'globe_polygons'], defaults.polygons),
    mnemonics: readUrlBooleanParam(['globe_layer_mnemonics', 'globe_mnemonics'], defaults.mnemonics)
  };
}

function appendVersionQuery(url, version) {
  if (!url || !version) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${encodeURIComponent(version)}`;
}

function resolveConfigAssetPath(rawPath, assetBase, fallbackRelativePath = '') {
  const configured =
    typeof rawPath === 'string' && rawPath.trim()
      ? rawPath.trim()
      : fallbackRelativePath;
  if (!configured) return '';
  if (
    configured.startsWith('http://') ||
    configured.startsWith('https://') ||
    configured.startsWith('/')
  ) {
    return configured;
  }
  return `${assetBase}/${configured}`;
}

function shouldClipGlobeToGeography() {
  // Globe mnemonics are always rendered art-first (no geographic clipping).
  // Keep this unconditional so no URL/debug flag can accidentally re-enable
  // hard border clipping.
  return false;
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
const infoHeaderTitle = document.querySelector('.info-header h2');
const infoName = document.getElementById('info-name');
const infoShape = document.getElementById('info-shape');
const infoDesc = document.getElementById('info-desc');
const exploredCountEl = document.getElementById('explored-count');

function syncGlobeInfoPanelState() {
  document.body.classList.toggle(
    'globe-info-card-active',
    IS_GLOBE_REGION && infoCard.classList.contains('active')
  );
  if (infoHeaderTitle) {
    infoHeaderTitle.textContent =
      IS_GLOBE_REGION && infoCard.classList.contains('active') && infoName.textContent
        ? infoName.textContent
        : 'Landinformation';
  }
}

function clearExploreSelection() {
  activeCountry = null;
  infoCard.classList.remove('active');
  infoDefault.style.display = '';
  syncGlobeInfoPanelState();
}

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
let globePolygonFeatures = [];
let globePolygonFeatureByKey = new Map();
let globeFeatureByKey = new Map();
let globeCountryByFeatureKey = new Map();
let globeFeatureBounds = new Map();
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
let globeHoverTransitionPendingKey = null;
let globeFeatureLookupGrid = null;
let globeHoverFeatureLookupGrid = null;
let globeFeatureLookupSeen = new WeakMap();
let globeFeatureLookupToken = 1;
let globeWrongFlash = new Set();
let globeHintBlink = new Set();
let globeImageCache = new Map();
let globeImageAlphaBoundsCache = new Map();
let globeCountryFillColorCache = new Map();
let globeImageColorCache = new Map();
let globeCountryForCoordsCaches = {
  hit: null,
  hover: null
};
let globeGeographicPickAtlas = null;
let globeOverlayImagePreloadPromise = null;
let globeInfoImagePreloadPromise = null;
let globeProjectedFeatureCache = new WeakMap();
let globeHoverOverlayRectCache = new WeakMap();
let globeOverlayRenderedRevealed = new Set();
let globeOverlayIncrementalPromise = null;
let globeOverlayPendingIncrementalReveals = new Set();
let globeOverlayBuildMsLast = 0;
let globeOverlayBuildMsSamples = [];
let globeOverlayAttachRetryFrames = 0;
let globeStrokeTopologyCache = null;
let globeProfileRaf = null;
let globeProfileState = null;
let globeProfileLastResult = null;
let globeHitFeatures = [];
let globeHoverHitFeatures = [];
let globePointerMoveRaf = null;
let globePointerSample = null;
let globePointerLastHoverSample = null;
let globePointerDownSample = null;
let globePointerInteractionReleaseRaf = null;
let globePointerDragged = false;
let globeFillOverlayEnabled = false;
let globeStrokeOverlayEnabled = false;
const globeProfileWaiters = [];
const externalScriptPromises = new Map();
const GLOBE_OVERLAY_MAX_WIDTH = readUrlNumberParam(
  ['globe_overlay_max_width', 'globe_overlay_max'],
  8192,
  2048,
  8192
);
const GLOBE_OVERLAY_MIN_WIDTH = readUrlNumberParam(
  ['globe_overlay_min_width', 'globe_overlay_min'],
  8192,
  1024,
  GLOBE_OVERLAY_MAX_WIDTH
);
const GLOBE_OVERLAY_VIEWPORT_SCALE = readUrlNumberParam(
  ['globe_overlay_scale', 'globe_overlay_viewport_scale'],
  3.2,
  1.2,
  4
);
const GLOBE_OVERLAY_DRAW_CHUNK = readUrlNumberParam(
  ['globe_overlay_chunk', 'globe_overlay_chunk_size'],
  24,
  1,
  256
);
const GLOBE_OVERLAY_COOPERATIVE = readUrlBooleanParam(
  ['globe_overlay_cooperative', 'globe_overlay_chunk_yield'],
  true
);
const GLOBE_OVERLAY_INCREMENTAL_REVEAL = readUrlBooleanParam(
  ['globe_overlay_incremental_reveal', 'globe_overlay_incremental'],
  true
);
const GLOBE_HOVER_OVERLAY_MAX_WIDTH = Math.round(readUrlNumberParam(
  ['globe_hover_overlay_max_width', 'globe_hover_overlay_max'],
  3072,
  1024,
  8192
));
const GLOBE_PICK_ATLAS_ENABLED = readUrlBooleanParam(
  ['globe_pick_atlas', 'globe_geo_pick_atlas', 'globe_pick_geo'],
  true
);
const GLOBE_PICK_ATLAS_WIDTH = Math.round(readUrlNumberParam(
  ['globe_pick_atlas_width', 'globe_pick_width'],
  4096,
  1024,
  8192
));
const GLOBE_PICK_ATLAS_HEIGHT = Math.max(
  256,
  Math.round(GLOBE_PICK_ATLAS_WIDTH / 2)
);
const GLOBE_HOVER_LOOKUP_CACHE_ENABLED = readUrlBooleanParam(
  ['globe_hover_lookup_cache', 'globe_hover_cache'],
  true
);
const GLOBE_HOVER_LOOKUP_CACHE_LAT_STEP = readUrlNumberParam(
  ['globe_hover_lookup_cache_lat', 'globe_hover_cache_lat'],
  1,
  0.125,
  20
);
const GLOBE_HOVER_LOOKUP_CACHE_LNG_STEP = readUrlNumberParam(
  ['globe_hover_lookup_cache_lng', 'globe_hover_cache_lng'],
  1,
  0.125,
  20
);
const GLOBE_HOVER_LOOKUP_CACHE_LAT_CELLS = Math.max(
  1,
  Math.ceil(180 / GLOBE_HOVER_LOOKUP_CACHE_LAT_STEP)
);
const GLOBE_HOVER_LOOKUP_CACHE_LNG_CELLS = Math.max(
  1,
  Math.ceil(360 / GLOBE_HOVER_LOOKUP_CACHE_LNG_STEP)
);
const GLOBE_HOVER_GRID_LAT_STEP = readUrlNumberParam(
  ['globe_hover_grid_lat', 'globe_hover_cpu_grid_lat'],
  10,
  2,
  45
);
const GLOBE_HOVER_GRID_LNG_STEP = readUrlNumberParam(
  ['globe_hover_grid_lng', 'globe_hover_cpu_grid_lng'],
  10,
  2,
  90
);
const GLOBE_HOVER_MOVE_MIN_PX = readUrlNumberParam(
  ['globe_hover_min_px', 'globe_hover_move_px'],
  0,
  0,
  20
);
const GLOBE_POINTER_DRAG_DISTANCE_PX2 = 36;
const GLOBE_HOVER_TINT_COLOR = 'rgba(255, 232, 48, 1)';
const GLOBE_PICK_ATLAS_SAMPLE_HIT = 1;
const GLOBE_PICK_ATLAS_SAMPLE_MISS = 2;
const GLOBE_PICK_ATLAS_SAMPLE_FALLBACK = 3;
const GLOBE_HOVER_LOOKUP_CACHE_MISS = '§globe_hover_cache_miss§';
const GLOBE_MNEMONIC_OVERLAY_RENDER_ORDER = 1000;
const GLOBE_HOVER_MNEMONIC_OVERLAY_RENDER_ORDER = 1001;
const GLOBE_OVERLAY_SPHERE_WIDTH_SEGMENTS = Math.round(readUrlNumberParam(
  ['globe_overlay_sphere_width_segments', 'globe_overlay_segments_w'],
  96,
  32,
  160
));
const GLOBE_OVERLAY_SPHERE_HEIGHT_SEGMENTS = Math.round(readUrlNumberParam(
  ['globe_overlay_sphere_height_segments', 'globe_overlay_segments_h'],
  64,
  24,
  120
));
const GLOBE_OVERLAY_RADIUS_SCALE = readUrlNumberParam(
  ['globe_overlay_radius_scale', 'globe_overlay_radius'],
  1.0006,
  1,
  1.02
);
const GLOBE_HOVER_FADE_MS = 200;
const GLOBE_HOVER_SWITCH_TOTAL_FADE_MS = 80;
const GLOBE_HOVER_SWITCH_PHASE_FADE_MS = Math.max(
  20,
  Math.round(GLOBE_HOVER_SWITCH_TOTAL_FADE_MS / 2)
);
const GLOBE_HOVER_TARGET_ALPHA = 0.62;
let globeHoverMnemonicAlpha = 0;
let globeHoverMnemonicTargetAlpha = 0;
let globeHoverMnemonicFadeFrom = 0;
let globeHoverMnemonicFadeStart = 0;
let globeHoverMnemonicFadeDurationMs = GLOBE_HOVER_FADE_MS;
let globeHoverMnemonicRaf = null;
// Keep polygon caps clearly above the earth surface to avoid depth fighting
// artifacts ("holes"/flicker) on some GPUs.
const GLOBE_POLY_ALT_BASE = readUrlNumberParam(
  ['globe_polygon_alt_base', 'globe_poly_alt_base'],
  0.0012,
  0,
  0.08
);
const GLOBE_POLY_ALT_REVEALED = readUrlNumberParam(
  ['globe_polygon_alt_revealed', 'globe_poly_alt_revealed'],
  GLOBE_POLY_ALT_BASE,
  0,
  0.08
);
const GLOBE_POLY_ALT_ACTIVE = readUrlNumberParam(
  ['globe_polygon_alt_active', 'globe_poly_alt_active'],
  Math.max(GLOBE_POLY_ALT_REVEALED + 0.0008, GLOBE_POLY_ALT_REVEALED * 1.8),
  0,
  0.12
);
const GLOBE_UNDERFILL_PARAM = URL_PARAMS.get('debug_underfill');
const GLOBE_UNDERFILL_FORCE_ON = GLOBE_UNDERFILL_PARAM === '1';
const GLOBE_UNDERFILL_FORCE_OFF = GLOBE_UNDERFILL_PARAM === '0';
const GLOBE_UNDERFILL_AUTO_KEYS = new Set(['RUS', 'CAN', 'KAZ', 'CHL', 'SOM']);
const GLOBE_IGNORE_HOLES_FEATURE_KEYS = new Set(['SOM', 'RUS']);
// Somalia's generated warp file currently has visible dropout artifacts.
// Keep warp placement behavior, but render from the source mnemonic image.
const GLOBE_SOURCE_IMAGE_IN_WARP_SLOT_FEATURE_KEYS = new Set(['SOM']);
let globeResizeObserver = null;
const globeMissingImageWarned = new Set();
const GLOBE_TRANSPARENT_PIXEL_DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

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

function projectedFeaturePolygons(feature, width, height, ignoreHoles = false) {
  if (!feature || !feature.geometry) return [];
  let cache = globeProjectedFeatureCache.get(feature);
  if (!cache || cache.width !== width || cache.height !== height) {
    const geometry = feature.geometry;
    const sourcePolygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    const polygons = [];
    if (Array.isArray(sourcePolygons)) {
      for (const polygon of sourcePolygons) {
        if (!Array.isArray(polygon) || polygon.length === 0) continue;
        const rings = [];
        for (const ring of polygon) {
          const projected = projectedRing(ring, width, height);
          if (projected.length >= 3) rings.push(projected);
        }
        if (rings.length > 0) polygons.push(rings);
      }
    }
    cache = { width, height, polygons, noHoles: null };
    globeProjectedFeatureCache.set(feature, cache);
  }
  if (!ignoreHoles) return cache.polygons;
  if (!cache.noHoles) {
    cache.noHoles = cache.polygons
      .map(rings => (rings.length > 0 ? [rings[0]] : []))
      .filter(rings => rings.length > 0);
  }
  return cache.noHoles;
}

function yieldOverlayBuildWork() {
  if (!GLOBE_OVERLAY_COOPERATIVE) return Promise.resolve();
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
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

function shouldUseGlobeOverlayTexture() {
  return GLOBE_LAYER_MNEMONICS || globeFillOverlayEnabled || globeStrokeOverlayEnabled;
}

function globeUnclickedFillColor() {
  return GLOBE_WHITE_UNCLICKED_MODE
    ? 'rgba(255, 255, 255, 0.92)'
    : `rgba(88, 115, 140, ${GLOBE_UNCLICKED_FILL_ALPHA})`;
}

function fillCountryFeature(ctx, feature, width, height, fillStyle) {
  if (!feature || !feature.geometry) return;
  const ignoreHoles = GLOBE_IGNORE_HOLES_FEATURE_KEYS.has(feature?.properties?.key);
  const polygons = projectedFeaturePolygons(feature, width, height, ignoreHoles);
  if (!polygons || polygons.length === 0) return;

  ctx.save();
  ctx.fillStyle = fillStyle;
  for (const polygon of polygons) {
    if (!polygon || polygon.length === 0) continue;
    ctx.beginPath();
    for (const ring of polygon) {
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

function drawGlobeUnclickedFillOverlay(ctx, width, height) {
  if (!globeFillOverlayEnabled) return;
  const fillStyle = globeUnclickedFillColor();
  const sourceFeatures = globePolygonFeatures.length > 0 ? globePolygonFeatures : globeFeatures;
  for (const feature of sourceFeatures) {
    const key = globeFeatureKey(feature);
    if (!key) continue;
    const country = globeCountryByFeatureKey.get(key);
    const isRevealed = country ? revealed.has(country.filename) : false;
    if (isRevealed) continue;
    fillCountryFeature(ctx, feature, width, height, fillStyle);
  }
}

function drawGlobeStrokeOverlay(ctx, width, height) {
  if (!globeStrokeOverlayEnabled) return;
  const sourceFeatures = globeStrokeSourceFeatures();
  drawGlobeFeatureStrokes(ctx, sourceFeatures, width, height, sourceFeatures);
}

function globeStrokeSourceFeatures() {
  return GLOBE_STROKE_MAIN_GEO && globeFeatures.length > 0
    ? globeFeatures
    : (globePolygonFeatures.length > 0 ? globePolygonFeatures : globeFeatures);
}

function defaultGlobeStrokeStyle() {
  return GLOBE_BLACK_BORDERS ? 'rgba(0, 0, 0, 0.9)' : 'rgba(140, 180, 220, 0.34)';
}

function globeStrokePasses() {
  if (!GLOBE_POLYGON_STROKE_CONTRAST || GLOBE_BLACK_BORDERS) {
    return [{ style: defaultGlobeStrokeStyle(), widthScale: 1 }];
  }
  // Two-tone cartographic stroke: dark casing + lighter core keeps borders
  // readable across both bright deserts and dark oceans/forest.
  return [
    { style: 'rgba(18, 30, 46, 0.62)', widthScale: GLOBE_POLYGON_STROKE_OUTER_SCALE },
    { style: 'rgba(198, 222, 246, 0.60)', widthScale: GLOBE_POLYGON_STROKE_INNER_SCALE }
  ];
}

function featureStrokeId(feature, fallbackIndex = -1) {
  const key = globeFeatureKey(feature);
  if (key) return key;
  return fallbackIndex >= 0 ? `__idx_${fallbackIndex}` : null;
}

function strokeSegmentKey(a, b) {
  if (!a || !b) return null;
  const ax = Math.round(a[0]);
  const ay = Math.round(a[1]);
  const bx = Math.round(b[0]);
  const by = Math.round(b[1]);
  if (ax === bx && ay === by) return null;
  const pa = `${ax},${ay}`;
  const pb = `${bx},${by}`;
  return pa < pb ? `${pa}|${pb}` : `${pb}|${pa}`;
}

function getGlobeStrokeTopology(features, width, height) {
  if (!features || features.length === 0) return null;
  if (
    globeStrokeTopologyCache &&
    globeStrokeTopologyCache.features === features &&
    globeStrokeTopologyCache.width === width &&
    globeStrokeTopologyCache.height === height
  ) {
    return globeStrokeTopologyCache;
  }

  const edgeCounts = new Map();
  const featureEdges = new Map();

  for (let featureIndex = 0; featureIndex < features.length; featureIndex++) {
    const feature = features[featureIndex];
    if (!feature || !feature.geometry) continue;
    const featureId = featureStrokeId(feature, featureIndex);
    if (!featureId) continue;

    const ignoreHoles = GLOBE_IGNORE_HOLES_FEATURE_KEYS.has(feature?.properties?.key);
    const polygons = projectedFeaturePolygons(feature, width, height, ignoreHoles);
    if (!polygons || polygons.length === 0) continue;

    const edges = [];
    for (const polygon of polygons) {
      if (!polygon || polygon.length === 0) continue;
      for (const ring of polygon) {
        if (!ring || ring.length < 2) continue;
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i];
          const b = ring[(i + 1) % ring.length];
          const key = strokeSegmentKey(a, b);
          if (!key) continue;
          edges.push(key);
          edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
        }
      }
    }
    featureEdges.set(featureId, edges);
  }

  const coastByFeature = new Map();
  for (const [featureId, edges] of featureEdges) {
    const coast = new Set();
    for (const edgeKey of edges) {
      if ((edgeCounts.get(edgeKey) || 0) === 1) coast.add(edgeKey);
    }
    if (coast.size > 0) coastByFeature.set(featureId, coast);
  }

  globeStrokeTopologyCache = {
    features,
    width,
    height,
    coastByFeature
  };
  return globeStrokeTopologyCache;
}

function strokeGlobeCoastFeatures(
  ctx,
  features,
  topologyFeatures,
  width,
  height,
  strokeStyle,
  lineWidth = GLOBE_POLYGON_STROKE_OVERLAY_WIDTH
) {
  if (!ctx || !features || features.length === 0) return;
  const topology = getGlobeStrokeTopology(topologyFeatures || features, width, height);
  if (!topology || !topology.coastByFeature || topology.coastByFeature.size === 0) return;

  ctx.save();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  let hasSegments = false;

  for (let featureIndex = 0; featureIndex < features.length; featureIndex++) {
    const feature = features[featureIndex];
    if (!feature || !feature.geometry) continue;
    const featureId = featureStrokeId(feature, featureIndex);
    const coastEdges = featureId ? topology.coastByFeature.get(featureId) : null;
    if (!coastEdges || coastEdges.size === 0) continue;

    const ignoreHoles = GLOBE_IGNORE_HOLES_FEATURE_KEYS.has(feature?.properties?.key);
    const polygons = projectedFeaturePolygons(feature, width, height, ignoreHoles);
    if (!polygons || polygons.length === 0) continue;

    for (const polygon of polygons) {
      if (!polygon || polygon.length === 0) continue;
      for (const ring of polygon) {
        if (!ring || ring.length < 2) continue;
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i];
          const b = ring[(i + 1) % ring.length];
          const key = strokeSegmentKey(a, b);
          if (!key || !coastEdges.has(key)) continue;
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          hasSegments = true;
        }
      }
    }
  }

  if (hasSegments) ctx.stroke();
  ctx.restore();
}

function drawGlobeFeatureStrokes(ctx, features, width, height, topologyFeatures = features) {
  const passes = globeStrokePasses();
  for (const pass of passes) {
    const lineWidth = GLOBE_POLYGON_STROKE_OVERLAY_WIDTH * pass.widthScale;
    strokeGlobeFeatures(
      ctx,
      features,
      width,
      height,
      pass.style,
      lineWidth
    );
    // Interior borders are naturally drawn twice (shared by two countries).
    // Repeat coast-only edges once more so coastlines match that visual weight.
    if (GLOBE_POLYGON_STROKE_EQUALIZE_COAST) {
      strokeGlobeCoastFeatures(ctx, features, topologyFeatures, width, height, pass.style, lineWidth);
    }
  }
}

function strokeGlobeFeatures(ctx, features, width, height, strokeStyle, lineWidth = GLOBE_POLYGON_STROKE_OVERLAY_WIDTH) {
  if (!ctx || !features || features.length === 0) return;
  ctx.save();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  for (const feature of features) {
    if (!feature || !feature.geometry) continue;
    const ignoreHoles = GLOBE_IGNORE_HOLES_FEATURE_KEYS.has(feature?.properties?.key);
    const polygons = projectedFeaturePolygons(feature, width, height, ignoreHoles);
    if (!polygons || polygons.length === 0) continue;

    for (const polygon of polygons) {
      if (!polygon || polygon.length === 0) continue;
      ctx.beginPath();
      for (const ring of polygon) {
        for (let i = 0; i < ring.length; i++) {
          const [x, y] = ring[i];
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
      }
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawCountryImageClippedToFeature(ctx, image, feature, width, height) {
  if (!feature || !feature.geometry || !image) return;
  const ignoreHoles = GLOBE_IGNORE_HOLES_FEATURE_KEYS.has(feature?.properties?.key);
  const polygons = projectedFeaturePolygons(feature, width, height, ignoreHoles);
  if (!polygons || polygons.length === 0) return;

  for (const polygon of polygons) {
    if (!polygon || polygon.length === 0) continue;
    const outer = polygon[0];
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

    if (!shouldClipGlobeToGeography()) {
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
    for (const ring of polygon) {
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
    img.onload = () => {
      // Decode eagerly so first draw/click does not block on lazy decode.
      if (typeof img.decode === 'function') {
        img.decode().catch(() => undefined).finally(() => resolve(img));
        return;
      }
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  globeImageCache.set(url, promise);
  return promise;
}

function prefetchGlobeInfoImageForCountry(country) {
  if (!country || !country.filename) return;
  const url = countryImgSrc(country.filename);
  if (!url) return;
  loadGlobeImage(url).catch(() => undefined);
}

function buildGlobeOverlayDrawItem(country) {
  const featureKey = country?.featureKey || '';
  const hasWarpPlacement = !!(country.warpWidth && country.warpHeight);
  const useSourceInWarpSlot =
    hasWarpPlacement && GLOBE_SOURCE_IMAGE_IN_WARP_SLOT_FEATURE_KEYS.has(featureKey);
  const useWarpFile =
    !DEBUG_DISABLE_GLOBE_WARP &&
    !!(country.warpFile && country.warpWidth && country.warpHeight) &&
    !useSourceInWarpSlot;
  const useWarpPlacement = useWarpFile || useSourceInWarpSlot;
  const warpUrl = useWarpFile ? appendVersionQuery(country.warpFile, GLOBE_WARP_VERSION) : '';
  return {
    country,
    isWarp: useWarpPlacement,
    isWarpFile: useWarpFile,
    url: useWarpFile ? warpUrl : countryImgSrc(country.filename)
  };
}

function preloadGlobeOverlayImages() {
  if (!GLOBE_LAYER_MNEMONICS) return Promise.resolve();
  if (globeOverlayImagePreloadPromise) return globeOverlayImagePreloadPromise;
  const drawItems = COUNTRIES.map(buildGlobeOverlayDrawItem);
  globeOverlayImagePreloadPromise = Promise.all(drawItems.map(item => loadGlobeImage(item.url)))
    .then(() => undefined)
    .catch(error => {
      // Allow retry after transient failures.
      globeOverlayImagePreloadPromise = null;
      throw error;
    });
  return globeOverlayImagePreloadPromise;
}

function preloadGlobeInfoPanelImages() {
  if (!IS_GLOBE_REGION) return Promise.resolve();
  if (globeInfoImagePreloadPromise) return globeInfoImagePreloadPromise;
  const urls = COUNTRIES
    .map(country => countryImgSrc(country.filename))
    .filter(Boolean);
  globeInfoImagePreloadPromise = Promise.all(urls.map(loadGlobeImage))
    .then(() => undefined)
    .catch(error => {
      // Allow retry after transient failures.
      globeInfoImagePreloadPromise = null;
      throw error;
    });
  return globeInfoImagePreloadPromise;
}

function drawWarpImageClippedToFeature(ctx, image, feature, width, height, dx, dy, dw, dh) {
  if (!image) return;

  const drawWrapped = () => {
    for (const shift of [-width, 0, width]) {
      ctx.drawImage(image, dx + shift, dy, dw, dh);
    }
  };

  if (!shouldClipGlobeToGeography() || !feature || !feature.geometry) {
    drawWrapped();
    return;
  }

  const ignoreHoles = GLOBE_IGNORE_HOLES_FEATURE_KEYS.has(feature?.properties?.key);
  const polygons = projectedFeaturePolygons(feature, width, height, ignoreHoles);
  if (!polygons || polygons.length === 0) {
    drawWrapped();
    return;
  }
  let clippedAny = false;

  for (const polygon of polygons) {
    if (!polygon || polygon.length === 0) continue;
    clippedAny = true;
    ctx.save();
    ctx.beginPath();
    for (const ring of polygon) {
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
      ctx.clip();
    }
    drawWrapped();
    ctx.restore();
  }

  if (!clippedAny) drawWrapped();
}

function drawGlobeCountryItem(ctx, item, image, feature, width, height, sx, sy) {
  if (!item || !item.country || !image || !feature) return;
  const country = item.country;
  if (item.isWarp) {
    const dx = (country.warpLeft || 0) * sx;
    const dy = (country.warpTop || 0) * sy;
    const dw = (country.warpWidth || image.width) * sx;
    const dh = (country.warpHeight || image.height) * sy;
    drawWarpImageClippedToFeature(ctx, image, feature, width, height, dx, dy, dw, dh);
    return;
  }
  drawCountryImageClippedToFeature(ctx, image, feature, width, height);
}

function drawSingleCountryOntoGlobeOverlayBaseWithImage(
  ctx,
  country,
  item,
  image,
  feature,
  width,
  height,
  sx,
  sy
) {
  if (!ctx || !country || !item || !feature) return false;
  if (!image) {
    const missKey = country.featureKey || country.filename || 'unknown-country';
    if (!globeMissingImageWarned.has(missKey)) {
      globeMissingImageWarned.add(missKey);
      console.warn('Missing globe image for country:', missKey, item.url);
    }
    fillCountryFeature(ctx, feature, width, height, fallbackCountryFillColor(country));
    return true;
  }

  if (shouldUseGlobeUnderfill(country, item)) {
    const fillColor = countryFillColor(country, image, item.url);
    fillCountryFeature(ctx, feature, width, height, fillColor);
  }
  if (globeStrokeOverlayEnabled) {
    // Keep polygon strokes behind the mnemonic texture.
    drawGlobeFeatureStrokes(ctx, [feature], width, height, globeStrokeSourceFeatures());
  }
  drawGlobeCountryItem(ctx, item, image, feature, width, height, sx, sy);
  return true;
}

async function drawSingleCountryOntoGlobeOverlayBase(ctx, country, width, height, sx, sy) {
  if (!ctx || !country) return false;
  const feature = globeFeatureByKey.get(country.featureKey);
  if (!feature) return false;
  const item = buildGlobeOverlayDrawItem(country);
  const image = await loadGlobeImage(item.url);
  return drawSingleCountryOntoGlobeOverlayBaseWithImage(
    ctx,
    country,
    item,
    image,
    feature,
    width,
    height,
    sx,
    sy
  );
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
  drawGlobeUnclickedFillOverlay(ctx, width, height);
  // Keep polygon texture overlays beneath mnemonics.
  drawGlobeStrokeOverlay(ctx, width, height);

  if (!GLOBE_LAYER_MNEMONICS && !globeStrokeOverlayEnabled) {
    return token === globeOverlayBaseRenderToken;
  }

  if (GLOBE_LAYER_MNEMONICS) {
    const visibleCountries = DEBUG_SHOW_ALL_GLOBE
      ? COUNTRIES
      : COUNTRIES.filter(c => revealed.has(c.filename));
    const drawEntries = visibleCountries
      .map(country => {
        const feature = globeFeatureByKey.get(country.featureKey);
        if (!feature) return null;
        return {
          country,
          feature,
          item: buildGlobeOverlayDrawItem(country)
        };
      })
      .filter(Boolean);
    const images = await Promise.all(drawEntries.map(entry => loadGlobeImage(entry.item.url)));
    if (token !== globeOverlayBaseRenderToken) return false;
    const sx = width / GLOBE_WARP_ATLAS_WIDTH;
    const sy = height / GLOBE_WARP_ATLAS_HEIGHT;
    for (let idx = 0; idx < drawEntries.length; idx++) {
      const entry = drawEntries[idx];
      drawSingleCountryOntoGlobeOverlayBaseWithImage(
        ctx,
        entry.country,
        entry.item,
        images[idx],
        entry.feature,
        width,
        height,
        sx,
        sy
      );

      if ((idx + 1) % GLOBE_OVERLAY_DRAW_CHUNK === 0 && idx + 1 < drawEntries.length) {
        await yieldOverlayBuildWork();
        if (token !== globeOverlayBaseRenderToken) return false;
      }
    }
    globeOverlayRenderedRevealed = new Set(visibleCountries.map(country => country.filename));
  } else {
    globeOverlayRenderedRevealed.clear();
  }
  globeOverlayIncrementalPromise = null;
  return token === globeOverlayBaseRenderToken;
}

function composeGlobeOverlayTexture() {
  if (!isGlobeReady() || !globeOverlayTexture) return;
  globeOverlayTexture.needsUpdate = true;
}

function setGlobeHoverOverlayOpacity(alpha) {
  if (!globeHoverOverlayMaterial) return;
  const clamped = Math.max(0, Math.min(GLOBE_HOVER_TARGET_ALPHA, alpha));
  globeHoverOverlayMaterial.opacity = clamped;
  if (globeHoverOverlayMesh) {
    // Skip rendering the hover overlay mesh entirely when fully transparent.
    globeHoverOverlayMesh.visible = clamped > 0.001;
  }
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
  const cached = globeHoverOverlayRectCache.get(feature);
  if (cached && cached.width === width && cached.height === height && Array.isArray(cached.rects)) {
    return cached.rects;
  }
  const polygons = projectedFeaturePolygons(feature, width, height, true);
  if (!polygons || polygons.length === 0) return [{ x: 0, y: 0, w: width, h: height }];

  const rects = [];
  for (const polygon of polygons) {
    if (!polygon || polygon.length === 0) continue;
    const outer = polygon[0];
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
  const result = rects.length > 0 ? rects : [{ x: 0, y: 0, w: width, h: height }];
  globeHoverOverlayRectCache.set(feature, { width, height, rects: result });
  return result;
}

function hoverOverlayRectsForWarpMnemonic(country, image, width, height, sx, sy) {
  if (!country) return [{ x: 0, y: 0, w: width, h: height }];
  const imgW = (image && (image.naturalWidth || image.width)) || 0;
  const imgH = (image && (image.naturalHeight || image.height)) || 0;
  const dx = (country.warpLeft || 0) * sx;
  const dy = (country.warpTop || 0) * sy;
  const dw = Math.max(1, (country.warpWidth || imgW || 1) * sx);
  const dh = Math.max(1, (country.warpHeight || imgH || 1) * sy);
  const rects = [];
  for (const shift of [-width, 0, width]) {
    pushHoverRect(rects, dx + shift, dy, dw, dh, width, height);
  }
  return rects.length > 0 ? rects : [{ x: 0, y: 0, w: width, h: height }];
}

function hoverOverlayRectsForMnemonicItem(country, item, image, feature, width, height, sx, sy) {
  if (!feature) return [{ x: 0, y: 0, w: width, h: height }];
  if (item && item.isWarp && !shouldClipGlobeToGeography()) {
    return hoverOverlayRectsForWarpMnemonic(country, image, width, height, sx, sy);
  }
  return hoverOverlayRectsForFeature(feature, width, height);
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

  const country = globeCountryByFeatureKey.get(hoverKey);
  const canTintMnemonicImage =
    !!country && (DEBUG_SHOW_ALL_GLOBE || revealed.has(country.filename));

  if (!canTintMnemonicImage) {
    globeHoverOverlayLastRects = hoverOverlayRectsForFeature(feature, width, height);
    if (country) {
      fillCountryFeature(
        ctx,
        feature,
        width,
        height,
        'rgba(255, 232, 48, 0.72)'
      );
    } else {
      fillCountryFeature(
        ctx,
        feature,
        width,
        height,
        'rgba(255, 232, 48, 0.62)'
      );
    }
    globeHoverOverlayTexture.needsUpdate = true;
    return;
  }

  const item = buildGlobeOverlayDrawItem(country);
  const image = await loadGlobeImage(item.url);
  if (token !== globeHoverOverlayRenderToken) return;
  const sx = width / GLOBE_WARP_ATLAS_WIDTH;
  const sy = height / GLOBE_WARP_ATLAS_HEIGHT;
  const rects = hoverOverlayRectsForMnemonicItem(
    country,
    item,
    image,
    feature,
    width,
    height,
    sx,
    sy
  );

  if (image) {
    ctx.save();
    drawGlobeCountryItem(ctx, item, image, feature, width, height, sx, sy);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = GLOBE_HOVER_TINT_COLOR;
    for (const rect of rects) {
      if (!rect) continue;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
    ctx.restore();
    globeHoverOverlayLastRects = rects;
  } else {
    fillCountryFeature(ctx, feature, width, height, 'rgba(255, 232, 48, 1)');
    globeHoverOverlayLastRects = rects;
  }
  globeHoverOverlayTexture.needsUpdate = true;
}

function queueGlobeHoverOverlayRender() {
  if (!GLOBE_LAYER_MNEMONICS) return;
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
  if (!shouldUseGlobeOverlayTexture()) {
    globeOverlayRenderQueued = false;
    return;
  }
  if (globeOverlayRenderInProgress) return;
  globeOverlayRenderInProgress = true;

  try {
    while (globeOverlayRenderQueued) {
      globeOverlayRenderQueued = false;
      if (!isGlobeReady() || !globeOverlayTexture || !globeOverlayBaseCanvas) continue;
      if (!globeOverlayBaseDirty) continue;

      globeOverlayBaseDirty = false;
      const buildStarted = performance.now();
      const rebuilt = await rebuildGlobeOverlayBase();
      if (rebuilt) {
        globeOverlayBuildMsLast = performance.now() - buildStarted;
        globeOverlayBuildMsSamples.push(globeOverlayBuildMsLast);
        if (globeOverlayBuildMsSamples.length > 24) globeOverlayBuildMsSamples.shift();
      }
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
  if (!shouldUseGlobeOverlayTexture()) return;
  if (options.baseDirty) globeOverlayBaseDirty = true;
  globeOverlayRenderQueued = true;
  if (globeOverlayRenderRaf !== null || globeOverlayRenderInProgress) return;
  globeOverlayRenderRaf = requestAnimationFrame(processGlobeOverlayRenderQueue);
}

function globeOverlayDependsOnRevealState() {
  if (!shouldUseGlobeOverlayTexture()) return false;
  if (GLOBE_LAYER_MNEMONICS) return true;
  if (globeFillOverlayEnabled && GLOBE_UNCLICKED_FILL_VISIBLE) return true;
  return false;
}

function markGlobeOverlayDirtyForRevealState() {
  if (!globeOverlayDependsOnRevealState()) return;
  globeOverlayPendingIncrementalReveals.clear();
  if (globeOverlayIncrementalPromise) {
    // Invalidate in-flight incremental draws before falling back to full rebuild.
    globeOverlayBaseRenderToken += 1;
  }
  globeOverlayIncrementalPromise = null;
  renderGlobeOverlayTexture({ baseDirty: true });
}

function canIncrementallyRevealOnGlobeOverlay(filename) {
  if (!GLOBE_OVERLAY_INCREMENTAL_REVEAL) return false;
  if (!GLOBE_LAYER_MNEMONICS) return false;
  if (DEBUG_SHOW_ALL_GLOBE) return false;
  if (globeFillOverlayEnabled || GLOBE_UNCLICKED_FILL_VISIBLE) return false;
  if (!isGlobeReady() || !globeOverlayBaseCanvas || !globeOverlayTexture) return false;
  if (globeOverlayBaseDirty || globeOverlayRenderQueued || globeOverlayRenderInProgress || globeOverlayRenderRaf !== null) {
    return false;
  }
  if (globeOverlayIncrementalPromise) return false;
  if (!revealed.has(filename)) return false;
  if (globeOverlayRenderedRevealed.has(filename)) return false;
  return true;
}

function canQueueIncrementalRevealOnGlobeOverlay(filename) {
  if (!GLOBE_OVERLAY_INCREMENTAL_REVEAL) return false;
  if (!GLOBE_LAYER_MNEMONICS) return false;
  if (DEBUG_SHOW_ALL_GLOBE) return false;
  if (globeFillOverlayEnabled || GLOBE_UNCLICKED_FILL_VISIBLE) return false;
  if (!isGlobeReady() || !globeOverlayBaseCanvas || !globeOverlayTexture) return false;
  if (globeOverlayBaseDirty || globeOverlayRenderQueued || globeOverlayRenderInProgress || globeOverlayRenderRaf !== null) {
    return false;
  }
  if (!globeOverlayIncrementalPromise) return false;
  if (!revealed.has(filename)) return false;
  if (globeOverlayRenderedRevealed.has(filename)) return false;
  return true;
}

function flushPendingIncrementalGlobeReveals() {
  if (globeOverlayIncrementalPromise) return false;
  if (globeOverlayPendingIncrementalReveals.size === 0) return false;
  for (const filename of Array.from(globeOverlayPendingIncrementalReveals)) {
    globeOverlayPendingIncrementalReveals.delete(filename);
    if (!revealed.has(filename) || globeOverlayRenderedRevealed.has(filename)) continue;
    if (canIncrementallyRevealOnGlobeOverlay(filename)) {
      return tryIncrementalRevealOnGlobeOverlay(filename);
    }
    return false;
  }
  return false;
}

function tryIncrementalRevealOnGlobeOverlay(filename) {
  if (!canIncrementallyRevealOnGlobeOverlay(filename)) {
    if (canQueueIncrementalRevealOnGlobeOverlay(filename)) {
      globeOverlayPendingIncrementalReveals.add(filename);
      return true;
    }
    return false;
  }
  globeOverlayPendingIncrementalReveals.delete(filename);
  const country = COUNTRY_BY_FILENAME[filename];
  if (!country || !country.featureKey) return false;
  const ctx = globeOverlayBaseCanvas.getContext('2d');
  if (!ctx) return false;
  const width = globeOverlayBaseCanvas.width;
  const height = globeOverlayBaseCanvas.height;
  const sx = width / GLOBE_WARP_ATLAS_WIDTH;
  const sy = height / GLOBE_WARP_ATLAS_HEIGHT;
  const token = ++globeOverlayBaseRenderToken;

  globeOverlayIncrementalPromise = (async () => {
    const drawn = await drawSingleCountryOntoGlobeOverlayBase(ctx, country, width, height, sx, sy);
    if (!drawn) return false;
    if (token !== globeOverlayBaseRenderToken) return false;
    if (!isGlobeReady() || !globeOverlayTexture || !globeOverlayBaseCanvas) return false;
    globeOverlayRenderedRevealed.add(filename);
    composeGlobeOverlayTexture();
    return true;
  })()
    .catch(error => {
      console.warn('Incremental globe overlay reveal failed:', error);
      return false;
    })
    .then(success => {
      globeOverlayIncrementalPromise = null;
      if (success) {
        flushPendingIncrementalGlobeReveals();
        return;
      }
      markGlobeOverlayDirtyForRevealState();
    });

  return true;
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

function hasRenderableGlobeGeometry(feature) {
  if (!feature || !feature.geometry) return false;
  const geometry = feature.geometry;
  const coords = geometry.coordinates;
  if (!Array.isArray(coords)) return false;
  if (geometry.type === 'Polygon') {
    return coords.some(ring => Array.isArray(ring) && ring.length >= 3);
  }
  if (geometry.type === 'MultiPolygon') {
    return coords.some(poly =>
      Array.isArray(poly) &&
      poly.some(ring => Array.isArray(ring) && ring.length >= 3)
    );
  }
  return false;
}

async function loadGlobeFeatureSet(url, label) {
  if (!url) return [];
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    console.warn(`Failed loading ${label} GeoJSON (${url}):`, error);
    return [];
  }
  if (!response || !response.ok) {
    const status = response ? `${response.status} ${response.statusText}`.trim() : 'unknown status';
    console.warn(`Failed loading ${label} GeoJSON (${url}): ${status}`);
    return [];
  }
  let geo;
  try {
    geo = await response.json();
  } catch (error) {
    console.warn(`Invalid JSON in ${label} GeoJSON (${url}):`, error);
    return [];
  }
  const features = Array.isArray(geo?.features) ? geo.features : [];
  return features
    .map(sanitizeGlobeGeometry)
    .filter(hasRenderableGlobeGeometry);
}

function globeGeometryPolygons(feature) {
  if (!feature || !feature.geometry) return [];
  const geometry = feature.geometry;
  if (geometry.type === 'Polygon') return [geometry.coordinates || []];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates || [];
  return [];
}

function normalizeLng(lng) {
  let value = Number(lng);
  if (!Number.isFinite(value)) return 0;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

function normalizeLngNear(lng, referenceLng) {
  let value = normalizeLng(lng);
  while (value - referenceLng > 180) value -= 360;
  while (value - referenceLng < -180) value += 360;
  return value;
}

function pointInLngLatRing(testLng, testLat, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  const x = normalizeLng(testLng);
  const y = testLat;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i];
    const pj = ring[j];
    if (!Array.isArray(pi) || !Array.isArray(pj)) continue;

    const xi = normalizeLngNear(pi[0], x);
    const yi = Number(pi[1]);
    const xj = normalizeLngNear(pj[0], x);
    const yj = Number(pj[1]);
    if (!Number.isFinite(yi) || !Number.isFinite(yj)) continue;

    const intersects = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function featureContainsLngLat(feature, lng, lat) {
  if (!hasRenderableGlobeGeometry(feature)) return false;
  const polygons = globeGeometryPolygons(feature);
  const ignoreHoles = GLOBE_IGNORE_HOLES_FEATURE_KEYS.has(feature?.properties?.key);

  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) continue;
    const outer = polygon[0];
    if (!pointInLngLatRing(lng, lat, outer)) continue;
    if (ignoreHoles) return true;

    let insideHole = false;
    for (let i = 1; i < polygon.length; i++) {
      if (pointInLngLatRing(lng, lat, polygon[i])) {
        insideHole = true;
        break;
      }
    }
    if (!insideHole) return true;
  }

  return false;
}

function globeCountryForCoordsCacheKey(lat, lng360) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng360)) return null;
  const clampedLat = Math.max(-90, Math.min(90, lat));
  const latIdx = Math.min(
    GLOBE_HOVER_LOOKUP_CACHE_LAT_CELLS - 1,
    Math.max(0, Math.floor((clampedLat + 90) / GLOBE_HOVER_LOOKUP_CACHE_LAT_STEP))
  );
  const lngWrapped = ((lng360 % 360) + 360) % 360;
  const lngIdx = Math.min(
    GLOBE_HOVER_LOOKUP_CACHE_LNG_CELLS - 1,
    Math.max(0, Math.floor(lngWrapped / GLOBE_HOVER_LOOKUP_CACHE_LNG_STEP))
  );
  return latIdx * GLOBE_HOVER_LOOKUP_CACHE_LNG_CELLS + lngIdx;
}

function globeCountryForCoordsUncached(lat, lng, features) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const normalizedLng = normalizeLng(lng);
  const normalizedLng360 = normalizedLng < 0 ? normalizedLng + 360 : normalizedLng;

  let candidateFeatures = features;
  const useGrid =
    features === globeHitFeatures || features === globeHoverHitFeatures;
  if (useGrid) {
    const lookupGrid =
      features === globeHoverHitFeatures ? globeHoverFeatureLookupGrid : globeFeatureLookupGrid;
    if (lookupGrid) {
      candidateFeatures = featuresForPointFromLookupGrid(lookupGrid, normalizedLng360, lat);
      if (!candidateFeatures || candidateFeatures.length === 0) candidateFeatures = features;
    }
  }

  const token = ++globeFeatureLookupToken;
  if (token > 1e9) {
    globeFeatureLookupSeen = new WeakMap();
    globeFeatureLookupToken = 1;
  }

  for (const feature of candidateFeatures) {
    if (!feature) continue;
    if (useGrid) {
      const seenToken = globeFeatureLookupSeen.get(feature);
      if (seenToken === token) continue;
      globeFeatureLookupSeen.set(feature, token);
    }
    const bounds = globeFeatureBounds.get(feature);
    if (bounds && !pointWithinFeatureBounds(normalizedLng360, lat, bounds)) continue;
    if (!featureContainsLngLat(feature, normalizedLng, lat)) continue;
    const key = globeFeatureKey(feature);
    if (!key) continue;
    const country = globeCountryByFeatureKey.get(key);
    if (country) return country;
  }
  return null;
}

function globeCountryForCoords(lat, lng, features = globeHitFeatures) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const normalizedLng = normalizeLng(lng);
  const normalizedLng360 = normalizedLng < 0 ? normalizedLng + 360 : normalizedLng;
  const useAtlas =
    GLOBE_PICK_ATLAS_ENABLED &&
    (features === globeHitFeatures || features === globeHoverHitFeatures);
  if (useAtlas) {
    const atlasSample = globeCountryFromGeographicPickAtlas(lat, normalizedLng360);
    if (atlasSample.type === GLOBE_PICK_ATLAS_SAMPLE_HIT) return atlasSample.country;
    if (atlasSample.type === GLOBE_PICK_ATLAS_SAMPLE_MISS) return null;
  }
  const useCache =
    GLOBE_HOVER_LOOKUP_CACHE_ENABLED &&
    (features === globeHitFeatures || features === globeHoverHitFeatures);
  let cache = null;
  if (useCache) {
    cache = features === globeHoverHitFeatures ? globeCountryForCoordsCaches.hover : globeCountryForCoordsCaches.hit;
  }
  const cacheKey = useCache ? globeCountryForCoordsCacheKey(lat, normalizedLng360) : null;
  if (cache && cacheKey !== null) {
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      if (cached === GLOBE_HOVER_LOOKUP_CACHE_MISS) {
        // Keep cache for misses disabled in strict mode to avoid stale false negatives
        // due to coarse cache cells near borders.
        cache.delete(cacheKey);
      } else {
        const cachedFeature = cached ? globeFeatureByKey.get(cached) : null;
        if (cachedFeature) {
          const bounds = globeFeatureBounds.get(cachedFeature);
          if (!bounds || pointWithinFeatureBounds(normalizedLng360, lat, bounds)) {
            if (featureContainsLngLat(cachedFeature, normalizedLng, lat)) {
              return globeCountryByFeatureKey.get(cached);
            }
          }
        }
        cache.delete(cacheKey);
      }
    }
  }

  const country = globeCountryForCoordsUncached(lat, normalizedLng, features);
  if (cache && cacheKey !== null) {
    if (country) {
      cache.set(cacheKey, country.featureKey || globeFeatureKey(country));
      return country;
    } else {
      cache.delete(cacheKey);
    }
  }

  return country;
}

function globeFeatureKey(feature) {
  return feature?.properties?.key || null;
}

function featuresForPointFromLookupGrid(grid, lng360, lat) {
  if (!grid || !grid.cells || !grid.latStep || !grid.lngStep) return null;
  if (!Number.isFinite(lng360) || !Number.isFinite(lat)) return null;
  const clampedLat = Math.max(-90, Math.min(90, lat));
  const latIdx = Math.floor((clampedLat + 90) / grid.latStep);
  const lngWrapped = ((lng360 % 360) + 360) % 360;
  const lngIdx = Math.floor(lngWrapped / grid.lngStep);
  const safeLatIdx = Math.max(0, Math.min(grid.latCellCount - 1, latIdx));
  const safeLngIdx = Math.max(0, Math.min(grid.lngCellCount - 1, lngIdx));
  const key = safeLatIdx * grid.lngCellCount + safeLngIdx;
  return grid.cells.get(key) || null;
}

function clampGridIndex(value, min, max, step) {
  const idx = Math.floor(value / step);
  if (idx < min) return min;
  if (idx > max) return max;
  return idx;
}

function buildGlobeFeatureLookupGrid(features) {
  const latStep = Math.max(2, Math.floor(GLOBE_HOVER_GRID_LAT_STEP));
  const lngStep = Math.max(2, Math.floor(GLOBE_HOVER_GRID_LNG_STEP));
  const latCellCount = Math.max(1, Math.ceil(180 / latStep));
  const lngCellCount = Math.max(1, Math.ceil(360 / lngStep));
  const cells = new Map();

  const addToCell = (latIdx, lngIdx, feature) => {
    if (latIdx < 0 || latIdx >= latCellCount || lngIdx < 0 || lngIdx >= lngCellCount) return;
    const key = latIdx * lngCellCount + lngIdx;
    const bucket = cells.get(key);
    if (bucket) {
      bucket.push(feature);
    } else {
      cells.set(key, [feature]);
    }
  };

  const addLngRange = (feature, latMin, latMax, minLng, maxLng) => {
    const clampedMinLat = Math.max(-90, Math.min(90, latMin));
    const clampedMaxLat = Math.max(-90, Math.min(90, latMax));
    if (clampedMinLat >= clampedMaxLat) return;
    const latIdxStart = clampGridIndex(clampedMinLat + 90, 0, latCellCount - 1, latStep);
    const latIdxEnd = clampGridIndex(clampedMaxLat - 0.0001 + 90, 0, latCellCount - 1, latStep);

    const normalizedMinLng = ((minLng % 360) + 360) % 360;
    const normalizedMaxLng = ((maxLng % 360) + 360) % 360;
    const lngIdxStart = clampGridIndex(normalizedMinLng, 0, lngCellCount - 1, lngStep);
    const lngIdxEnd = clampGridIndex(normalizedMaxLng, 0, lngCellCount - 1, lngStep);

    for (let latIdx = latIdxStart; latIdx <= latIdxEnd; latIdx++) {
      if (lngIdxStart <= lngIdxEnd) {
        for (let lngIdx = lngIdxStart; lngIdx <= lngIdxEnd; lngIdx++) {
          addToCell(latIdx, lngIdx, feature);
        }
      } else {
        for (let lngIdx = 0; lngIdx <= lngIdxEnd; lngIdx++) addToCell(latIdx, lngIdx, feature);
        for (let lngIdx = lngIdxStart; lngIdx < lngCellCount; lngIdx++) addToCell(latIdx, lngIdx, feature);
      }
    }
  };

  if (!Array.isArray(features)) {
    return { latStep, lngStep, latCellCount, lngCellCount, cells };
  }

  for (const feature of features) {
    const bounds = globeFeatureBounds.get(feature);
    if (!bounds) continue;
    if (!Number.isFinite(bounds.minLat) || !Number.isFinite(bounds.maxLat)) continue;
    if (bounds.wrap) {
      addLngRange(
        feature,
        bounds.minLat,
        bounds.maxLat,
        bounds.minLng,
        359.9999
      );
      addLngRange(
        feature,
        bounds.minLat,
        bounds.maxLat,
        0,
        bounds.maxLng
      );
    } else {
      addLngRange(
        feature,
        bounds.minLat,
        bounds.maxLat,
        bounds.minLng,
        bounds.maxLng
      );
    }
  }

  return { latStep, lngStep, latCellCount, lngCellCount, cells };
}

function featureLatLngBounds(feature) {
  if (!feature || !feature.geometry) return null;
  const polygons = globeGeometryPolygons(feature);
  const longitudes = [];
  const latitudes = [];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) continue;
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length === 0) continue;
      for (const point of ring) {
        if (!Array.isArray(point) || point.length < 2) continue;
        const lng = Number(point[0]);
        const lat = Number(point[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        const normalized = normalizeLng(lng);
        longitudes.push(normalized < 0 ? normalized + 360 : normalized);
        latitudes.push(lat);
      }
    }
  }

  if (longitudes.length === 0 || latitudes.length === 0) return null;

  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);

  const sortedLngs = [...longitudes].sort((a, b) => a - b);
  const first = sortedLngs[0];
  const last = sortedLngs[sortedLngs.length - 1];
  const directSpan = last - first;
  if (directSpan <= 180) {
    return {
      wrap: false,
      minLat,
      maxLat,
      minLng: first,
      maxLng: last
    };
  }

  let largestGap = -1;
  let gapStartIdx = 0;
  for (let i = 0; i < sortedLngs.length - 1; i++) {
    const gap = sortedLngs[i + 1] - sortedLngs[i];
    if (gap > largestGap) {
      largestGap = gap;
      gapStartIdx = i;
    }
  }
  const wrapGap = (first + 360) - last;
  if (wrapGap > largestGap) {
    largestGap = wrapGap;
    gapStartIdx = sortedLngs.length - 1;
  }

  const insideStart = sortedLngs[(gapStartIdx + 1) % sortedLngs.length];
  const insideEnd = sortedLngs[gapStartIdx] + (gapStartIdx === sortedLngs.length - 1 ? 360 : 0);
  return {
    wrap: true,
    minLat,
    maxLat,
    minLng: insideStart,
    maxLng: insideEnd % 360
  };
}

function pointWithinFeatureBounds(lng360, lat, bounds) {
  if (!bounds) return true;
  if (lat < bounds.minLat || lat > bounds.maxLat) return false;
  if (!bounds.wrap) {
    return lng360 >= bounds.minLng && lng360 <= bounds.maxLng;
  }
  return lng360 >= bounds.minLng || lng360 <= bounds.maxLng;
}

function buildGlobeGeographicPickAtlas(features) {
  if (!GLOBE_PICK_ATLAS_ENABLED) return null;
  if (!Array.isArray(features) || features.length === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = GLOBE_PICK_ATLAS_WIDTH;
  canvas.height = GLOBE_PICK_ATLAS_HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const featureKeyByColor = new Map();
  const seenFeatureKeys = new Set();
  let colorId = 1;

  for (const feature of features) {
    const featureKey = globeFeatureKey(feature);
    if (!featureKey || seenFeatureKeys.has(featureKey)) continue;
    if (!globeCountryByFeatureKey.has(featureKey)) continue;
    if (colorId > 0x00ffffff) break;

    const r = colorId & 255;
    const g = (colorId >> 8) & 255;
    const b = (colorId >> 16) & 255;
    const color = r | (g << 8) | (b << 16);
    featureKeyByColor.set(color, featureKey);
    seenFeatureKeys.add(featureKey);
    fillCountryFeature(ctx, feature, canvas.width, canvas.height, `rgb(${r}, ${g}, ${b})`);
    colorId++;
  }

  let imageData;
  try {
    imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch (error) {
    console.warn('Unable to build globe geographic pick atlas:', error);
    return null;
  }

  const atlas = {
    width: canvas.width,
    height: canvas.height,
    data: imageData,
    featureKeyByColor
  };
  const validation = validateGlobeGeographicPickAtlas(atlas);
  if (!validation.ok) {
    console.warn(`Disabled geographic globe pick atlas: ${validation.reason}`);
    return null;
  }
  return atlas;
}

function sampleGlobeGeographicPickAtlas(atlas, lat, lng360) {
  if (!atlas || !atlas.data) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng360)) return null;
  const clampedLat = Math.max(-90, Math.min(90, lat));
  const lngWrapped = ((lng360 % 360) + 360) % 360;
  const x = Math.min(
    atlas.width - 1,
    Math.max(0, Math.floor((lngWrapped / 360) * atlas.width))
  );
  const y = Math.min(
    atlas.height - 1,
    Math.max(0, Math.floor(((90 - clampedLat) / 180) * atlas.height))
  );
  const idx = (y * atlas.width + x) * 4;
  if (idx < 0 || idx + 3 >= atlas.data.length) return null;
  const alpha = atlas.data[idx + 3];
  const color = atlas.data[idx] |
    (atlas.data[idx + 1] << 8) |
    (atlas.data[idx + 2] << 16);
  return {
    alpha,
    featureKey: atlas.featureKeyByColor.get(color) || null
  };
}

function validateGlobeGeographicPickAtlas(atlas) {
  if (!atlas || !atlas.data || !atlas.featureKeyByColor) {
    return { ok: false, reason: 'atlas has no data' };
  }

  let checks = 0;
  let matches = 0;
  for (const country of COUNTRIES) {
    const featureKey = country?.featureKey;
    const lat = Number(country?.centerLat);
    const lng = Number(country?.centerLon);
    if (!featureKey || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const normalizedLng = normalizeLng(lng);
    const lng360 = normalizedLng < 0 ? normalizedLng + 360 : normalizedLng;
    const sample = sampleGlobeGeographicPickAtlas(atlas, lat, lng360);
    if (!sample || sample.alpha < 250) continue;
    checks++;
    if (sample.featureKey === featureKey) matches++;
  }

  if (checks < 24) {
    return { ok: false, reason: `too few validation samples (${checks})` };
  }
  const ratio = matches / checks;
  if (ratio < 0.75) {
    return {
      ok: false,
      reason: `center match ratio too low (${matches}/${checks}, ${(ratio * 100).toFixed(1)}%)`
    };
  }
  return { ok: true };
}

function globeCountryFromGeographicPickAtlas(lat, lng360) {
  const atlas = globeGeographicPickAtlas;
  if (!atlas || !atlas.data) {
    return { type: GLOBE_PICK_ATLAS_SAMPLE_FALLBACK, country: null };
  }
  const sample = sampleGlobeGeographicPickAtlas(atlas, lat, lng360);
  if (!sample) {
    return { type: GLOBE_PICK_ATLAS_SAMPLE_MISS, country: null };
  }
  if (sample.alpha <= 0) {
    // Definite ocean/background pixel.
    return { type: GLOBE_PICK_ATLAS_SAMPLE_MISS, country: null };
  }
  // Antialiased border pixels can be mixed; keep CPU fallback for precision there.
  if (sample.alpha < 250) {
    return { type: GLOBE_PICK_ATLAS_SAMPLE_FALLBACK, country: null };
  }
  const country = sample.featureKey ? globeCountryByFeatureKey.get(sample.featureKey) || null : null;
  if (!country) {
    return { type: GLOBE_PICK_ATLAS_SAMPLE_MISS, country: null };
  }
  return { type: GLOBE_PICK_ATLAS_SAMPLE_HIT, country };
}

function isSphereMesh(node) {
  return !!(
    node &&
    node.isMesh &&
    node.geometry &&
    typeof node.geometry.type === 'string' &&
    node.geometry.type.toLowerCase().includes('sphere')
  );
}

function findFirstSphereMesh(root) {
  if (!root) return null;
  const stack = [root];
  let fallbackSphere = null;
  while (stack.length > 0) {
    const node = stack.pop();
    if (node?.userData?.isGlobeOverlay) continue;
    if (isSphereMesh(node)) {
      // Prefer the actual globe surface mesh when available.
      if (node.__globeObjType === 'globe') return node;
      if (!fallbackSphere) fallbackSphere = node;
    }
    if (node && node.children && node.children.length) {
      for (let i = 0; i < node.children.length; i++) stack.push(node.children[i]);
    }
  }
  return fallbackSphere;
}

function installRaycastGuards(root) {
  if (!root) return;
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.children && node.children.length > 0) {
      for (let i = 0; i < node.children.length; i++) stack.push(node.children[i]);
    }
    if (typeof node.raycast !== 'function') continue;
    if (node.__raycastGuardInstalled) continue;

    const originalRaycast = node.raycast;
    node.raycast = function guardedRaycast(raycaster, intersects) {
      const geometry = this && this.geometry;
      if (geometry) {
        const index = geometry.index;
        const pos = geometry.attributes && geometry.attributes.position;
        if (index && typeof index.count !== 'number') return;
        if (!index && (!pos || typeof pos.count !== 'number')) return;
      }
      try {
        return originalRaycast.call(this, raycaster, intersects);
      } catch (error) {
        if (!this.__raycastGuardWarned) {
          this.__raycastGuardWarned = true;
          const name = this && (this.name || this.type || this.constructor?.name || 'Object3D');
          console.warn('Skipped failing raycast target:', name, error);
        }
      }
    };
    node.__raycastGuardInstalled = true;
  }
}

function shouldUseGlobeUnderfill(country, item) {
  if (GLOBE_UNDERFILL_FORCE_ON) return true;
  if (GLOBE_UNDERFILL_FORCE_OFF) return false;
  if (!item || !item.isWarp || !item.isWarpFile) return false;
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
  if (!GLOBE_UNCLICKED_FILL_VISIBLE) return 'rgba(0, 0, 0, 0)';
  if (globeFillOverlayEnabled) return 'rgba(0, 0, 0, 0)';
  return globeUnclickedFillColor();
}

function globeVisiblePolygonFeatures() {
  if (!GLOBE_LAYER_POLYGONS) return [];
  if (globePolygonFeatures.length === 0) return [];
  const forceAllPolygonsVisible =
    (GLOBE_UNCLICKED_FILL_VISIBLE && !globeFillOverlayEnabled) ||
    (GLOBE_POLYGON_STROKE_ENABLED && !globeStrokeOverlayEnabled) ||
    GLOBE_POLYGON_SIDE_ENABLED;
  if (forceAllPolygonsVisible) return globePolygonFeatures;

  const keys = new Set();
  for (const key of globeHintBlink) keys.add(key);
  for (const key of globeWrongFlash) keys.add(key);
  if (GLOBE_HOVER_LEGACY && globeHoverFeatureKey) keys.add(globeHoverFeatureKey);
  if (keys.size === 0) return [];

  const visible = [];
  for (const key of keys) {
    const feature = globePolygonFeatureByKey.get(key);
    if (feature) visible.push(feature);
  }
  return visible;
}

function refreshGlobePolygonsData() {
  if (!isGlobeReady() || !GLOBE_LAYER_POLYGONS) return;
  globe.polygonsData(globeVisiblePolygonFeatures());
}

function refreshGlobeStyles() {
  if (!isGlobeReady() || !GLOBE_LAYER_POLYGONS) return;
  refreshGlobePolygonsData();
  globe.polygonCapColor(globeCapColor);
  globe.polygonAltitude(globePolygonAltitude);
}

function refreshGlobeHoverStyles() {
  if (!isGlobeReady() || !GLOBE_LAYER_POLYGONS) return;
  refreshGlobePolygonsData();
  globe.polygonCapColor(globeCapColor);
}

function maybeApplyPendingGlobeHoverTransition() {
  if (GLOBE_HOVER_LEGACY) return false;
  if (!globeHoverTransitionPendingKey) return false;
  if (globeHoverMnemonicAlpha > 0.001 || globeHoverMnemonicTargetAlpha > 0.001) return false;
  const nextKey = globeHoverTransitionPendingKey;
  globeHoverTransitionPendingKey = null;
  globeHoverMnemonicFeatureKey = nextKey;
  queueGlobeHoverOverlayRender();
  return true;
}

function setGlobeHoverMnemonicTarget(targetAlpha, durationMs = GLOBE_HOVER_FADE_MS) {
  if (!GLOBE_LAYER_MNEMONICS) {
    globeHoverMnemonicAlpha = 0;
    globeHoverMnemonicTargetAlpha = 0;
    globeHoverMnemonicFadeDurationMs = GLOBE_HOVER_FADE_MS;
    return;
  }
  const clampedDuration = Math.max(16, Number.isFinite(durationMs) ? durationMs : GLOBE_HOVER_FADE_MS);
  const clampedTarget = Math.max(0, Math.min(GLOBE_HOVER_TARGET_ALPHA, targetAlpha));
  const targetUnchanged = Math.abs(clampedTarget - globeHoverMnemonicTargetAlpha) < 0.001;
  const alphaAtTarget = Math.abs(globeHoverMnemonicAlpha - clampedTarget) < 0.001;
  if (targetUnchanged && (globeHoverMnemonicRaf !== null || alphaAtTarget)) {
    if (clampedTarget <= 0.001 && alphaAtTarget) {
      if (maybeApplyPendingGlobeHoverTransition()) {
        setGlobeHoverMnemonicTarget(GLOBE_HOVER_TARGET_ALPHA, GLOBE_HOVER_SWITCH_PHASE_FADE_MS);
      } else if (!globeHoverFeatureKey) {
        globeHoverMnemonicFeatureKey = null;
        queueGlobeHoverOverlayRender();
      }
    }
    return;
  }

  globeHoverMnemonicFadeFrom = globeHoverMnemonicAlpha;
  globeHoverMnemonicTargetAlpha = clampedTarget;
  globeHoverMnemonicFadeDurationMs = clampedDuration;
  globeHoverMnemonicFadeStart = 0;

  if (Math.abs(globeHoverMnemonicFadeFrom - globeHoverMnemonicTargetAlpha) < 0.001) {
    globeHoverMnemonicAlpha = globeHoverMnemonicTargetAlpha;
    setGlobeHoverOverlayOpacity(globeHoverMnemonicAlpha);
    if (globeHoverMnemonicTargetAlpha <= 0.001) {
      if (maybeApplyPendingGlobeHoverTransition()) {
        setGlobeHoverMnemonicTarget(GLOBE_HOVER_TARGET_ALPHA, GLOBE_HOVER_SWITCH_PHASE_FADE_MS);
      } else if (!globeHoverFeatureKey) {
        globeHoverMnemonicFeatureKey = null;
        queueGlobeHoverOverlayRender();
      }
    }
    return;
  }

  if (globeHoverMnemonicRaf !== null) return;

  const tick = now => {
    if (!globeHoverMnemonicFadeStart) globeHoverMnemonicFadeStart = now;
    const elapsed = now - globeHoverMnemonicFadeStart;
    const t = Math.min(1, elapsed / globeHoverMnemonicFadeDurationMs);
    const eased = t * (2 - t);
    globeHoverMnemonicAlpha =
      globeHoverMnemonicFadeFrom +
      (globeHoverMnemonicTargetAlpha - globeHoverMnemonicFadeFrom) * eased;
    setGlobeHoverOverlayOpacity(globeHoverMnemonicAlpha);

    if (t >= 1 || Math.abs(globeHoverMnemonicTargetAlpha - globeHoverMnemonicAlpha) < 0.001) {
      globeHoverMnemonicAlpha = globeHoverMnemonicTargetAlpha;
      setGlobeHoverOverlayOpacity(globeHoverMnemonicAlpha);
      if (globeHoverMnemonicTargetAlpha <= 0.001) {
        if (maybeApplyPendingGlobeHoverTransition()) {
          globeHoverMnemonicRaf = null;
          setGlobeHoverMnemonicTarget(GLOBE_HOVER_TARGET_ALPHA, GLOBE_HOVER_SWITCH_PHASE_FADE_MS);
          return;
        }
        if (!globeHoverFeatureKey) {
          globeHoverMnemonicFeatureKey = null;
          queueGlobeHoverOverlayRender();
        }
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
  if (normalizedKey) {
    const country = globeCountryByFeatureKey.get(normalizedKey);
    if (country) prefetchGlobeInfoImageForCountry(country);
  }
  globeHoverFeatureKey = normalizedKey;

  if (GLOBE_HOVER_LEGACY) {
    globeHoverTransitionPendingKey = null;
    globeHoverMnemonicFeatureKey = null;
    globeHoverMnemonicAlpha = 0;
    globeHoverMnemonicTargetAlpha = 0;
    setGlobeHoverOverlayOpacity(0);
    queueGlobeHoverOverlayRender();
    return true;
  }

  if (!normalizedKey) {
    globeHoverTransitionPendingKey = null;
    setGlobeHoverMnemonicTarget(0, GLOBE_HOVER_FADE_MS);
    return true;
  }

  if (!globeHoverMnemonicFeatureKey || globeHoverMnemonicFeatureKey === normalizedKey) {
    globeHoverTransitionPendingKey = null;
    if (globeHoverMnemonicFeatureKey !== normalizedKey) {
      globeHoverMnemonicFeatureKey = normalizedKey;
      queueGlobeHoverOverlayRender();
    }
    setGlobeHoverMnemonicTarget(GLOBE_HOVER_TARGET_ALPHA, GLOBE_HOVER_FADE_MS);
    return true;
  }

  // 3D-specific behavior: keep country-to-country fade very short.
  globeHoverTransitionPendingKey = normalizedKey;
  setGlobeHoverMnemonicTarget(0, GLOBE_HOVER_SWITCH_PHASE_FADE_MS);
  return true;
}

function isGlobePointerInteractionDrag(event) {
  if (globePointerDragged) return true;
  if (!globePointerDownSample || !event) return false;
  const clientX = event.clientX;
  const clientY = event.clientY;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
  const dx = clientX - globePointerDownSample.clientX;
  const dy = clientY - globePointerDownSample.clientY;
  return dx * dx + dy * dy > GLOBE_POINTER_DRAG_DISTANCE_PX2;
}

function onGlobeHover(feature) {
  if (globePointerDragged) return;
  const nextKey = globeFeatureKey(feature);
  if (!setGlobeHoverFeature(nextKey)) return;
  if (GLOBE_HOVER_LEGACY) refreshGlobeHoverStyles();
}

function onGlobeClick(feature, event) {
  const key = globeFeatureKey(feature);
  if (!key) return;
  if (isGlobePointerInteractionDrag(event)) return;

  let country = globeCountryByFeatureKey.get(key);
  if (currentMode === 'seterra' && seterraTarget && seterraTarget.featureKey === key) {
    country = seterraTarget;
  }
  if (!country) return;
  setGlobeHoverFeature(null);
  if (GLOBE_HOVER_LEGACY) refreshGlobeHoverStyles();
  handleClick(country, event);
  if (globePointerInteractionReleaseRaf !== null) {
    cancelAnimationFrame(globePointerInteractionReleaseRaf);
    globePointerInteractionReleaseRaf = null;
  }
  globePointerDownSample = null;
  globePointerDragged = false;
}

function onGlobeSurfaceClick(coords, event) {
  if (isGlobePointerInteractionDrag(event)) return;
  if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) {
    setGlobeHoverFeature(null);
    if (GLOBE_HOVER_LEGACY) refreshGlobeHoverStyles();
    clearExploreSelection();
    return;
  }
  const country = globeCountryForCoords(coords.lat, coords.lng);
  if (!country) return;
  setGlobeHoverFeature(null);
  if (GLOBE_HOVER_LEGACY) refreshGlobeHoverStyles();
  handleClick(country, event);
  if (globePointerInteractionReleaseRaf !== null) {
    cancelAnimationFrame(globePointerInteractionReleaseRaf);
    globePointerInteractionReleaseRaf = null;
  }
  globePointerDownSample = null;
  globePointerDragged = false;
}

function globeCoordsFromClientPosition(clientX, clientY) {
  if (!isGlobeReady() || typeof globe.toGlobeCoords !== 'function') return null;
  const rect = globeContainer.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const coords = globe.toGlobeCoords(x, y);
  if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return null;
  return coords;
}

function updateGlobeHoverFromClientPosition(clientX, clientY) {
  if (globePointerDragged) return;
  const coords = globeCoordsFromClientPosition(clientX, clientY);
  const country = coords ? globeCountryForCoords(coords.lat, coords.lng, globeHoverHitFeatures) : null;
  const nextKey = country ? country.featureKey : null;
  if (!setGlobeHoverFeature(nextKey)) return;
  if (GLOBE_HOVER_LEGACY) refreshGlobeHoverStyles();
}

function onGlobeContainerPointerDown(event) {
  if (!isGlobeReady()) return;
  globePointerDownSample = { clientX: event.clientX, clientY: event.clientY };
  globePointerLastHoverSample = { clientX: event.clientX, clientY: event.clientY };
  globePointerDragged = false;
  if (globePointerInteractionReleaseRaf !== null) {
    cancelAnimationFrame(globePointerInteractionReleaseRaf);
    globePointerInteractionReleaseRaf = null;
  }
}

function onGlobeContainerPointerMove(event) {
  if (!isGlobeReady()) return;
  if (globePointerLastHoverSample) {
    const dx = event.clientX - globePointerLastHoverSample.clientX;
    const dy = event.clientY - globePointerLastHoverSample.clientY;
    const minDelta = GLOBE_HOVER_MOVE_MIN_PX;
    if (minDelta > 0 && dx * dx + dy * dy < minDelta * minDelta) return;
  }

  if (globePointerDownSample) {
    const dx = event.clientX - globePointerDownSample.clientX;
    const dy = event.clientY - globePointerDownSample.clientY;
    if (dx * dx + dy * dy > GLOBE_POINTER_DRAG_DISTANCE_PX2) globePointerDragged = true;
  }

  if (!GLOBE_USE_CPU_POINTER) return;

  if (globePointerDragged) {
    if (globePointerMoveRaf !== null) {
      cancelAnimationFrame(globePointerMoveRaf);
      globePointerMoveRaf = null;
    }
    globePointerSample = null;
    return;
  }

  globePointerSample = { clientX: event.clientX, clientY: event.clientY };
  if (globePointerMoveRaf !== null) return;
  globePointerMoveRaf = requestAnimationFrame(() => {
    globePointerMoveRaf = null;
    const sample = globePointerSample;
    globePointerSample = null;
    globePointerLastHoverSample = sample;
    if (!sample) return;
    updateGlobeHoverFromClientPosition(sample.clientX, sample.clientY);
  });
}

function onGlobeContainerPointerUp() {
  if (!isGlobeReady()) return;
  globePointerLastHoverSample = null;
  if (globePointerInteractionReleaseRaf !== null) {
    cancelAnimationFrame(globePointerInteractionReleaseRaf);
  }
  globePointerInteractionReleaseRaf = requestAnimationFrame(() => {
    globePointerDownSample = null;
    globePointerDragged = false;
    globePointerInteractionReleaseRaf = null;
  });
}

function onGlobeContainerPointerCancel() {
  if (!isGlobeReady()) return;
  globePointerLastHoverSample = null;
  if (globePointerInteractionReleaseRaf !== null) {
    cancelAnimationFrame(globePointerInteractionReleaseRaf);
  }
  globePointerInteractionReleaseRaf = requestAnimationFrame(() => {
    globePointerDownSample = null;
    globePointerDragged = false;
    globePointerInteractionReleaseRaf = null;
  });
}

function onGlobeContainerClick(event) {
  if (!GLOBE_USE_CPU_POINTER || !isGlobeReady()) return;
  if (globePointerDragged) {
    globePointerDragged = false;
    return;
  }
  const coords = globeCoordsFromClientPosition(event.clientX, event.clientY);
  onGlobeSurfaceClick(coords, event);
}

function installGlobeCpuPointerHandlers() {
  globeContainer.removeEventListener('pointerdown', onGlobeContainerPointerDown);
  globeContainer.removeEventListener('pointermove', onGlobeContainerPointerMove);
  globeContainer.removeEventListener('pointerup', onGlobeContainerPointerUp);
  globeContainer.removeEventListener('pointercancel', onGlobeContainerPointerCancel);
  globeContainer.removeEventListener('click', onGlobeContainerClick);
  globeContainer.addEventListener('pointerdown', onGlobeContainerPointerDown, { passive: true });
  globeContainer.addEventListener('pointermove', onGlobeContainerPointerMove, { passive: true });
  globeContainer.addEventListener('pointerup', onGlobeContainerPointerUp, { passive: true });
  globeContainer.addEventListener('pointercancel', onGlobeContainerPointerCancel, { passive: true });
  if (GLOBE_USE_CPU_POINTER) {
    globeContainer.addEventListener('click', onGlobeContainerClick, { passive: true });
  }
}

function removeGlobeCpuPointerHandlers() {
  globeContainer.removeEventListener('pointerdown', onGlobeContainerPointerDown);
  globeContainer.removeEventListener('pointermove', onGlobeContainerPointerMove);
  globeContainer.removeEventListener('pointerup', onGlobeContainerPointerUp);
  globeContainer.removeEventListener('pointercancel', onGlobeContainerPointerCancel);
  globeContainer.removeEventListener('click', onGlobeContainerClick);
}

function syncGlobeViewport() {
  if (!isGlobeReady()) return;
  const width = globeContainer.clientWidth || mapPanel.clientWidth;
  const height = globeContainer.clientHeight || mapPanel.clientHeight;
  if (width > 0 && height > 0) {
    globe.width(width);
    globe.height(height);
  }
  const sceneRoot = typeof globe.scene === 'function' ? globe.scene() : null;
  const baseSphere = findFirstSphereMesh(sceneRoot);
  let attachedAll = true;
  if (sceneRoot && baseSphere) {
    if (globeOverlayMesh) attachGlobeOverlayMesh(globeOverlayMesh, sceneRoot, baseSphere);
    if (globeHoverOverlayMesh) attachGlobeOverlayMesh(globeHoverOverlayMesh, sceneRoot, baseSphere);
  } else if (globeOverlayMesh || globeHoverOverlayMesh) {
    attachedAll = false;
  }
  if (!attachedAll && globeOverlayAttachRetryFrames < 240) {
    globeOverlayAttachRetryFrames += 1;
    requestAnimationFrame(syncGlobeViewport);
  }
}

function computeGlobeOverlayWidth(maxTextureSize) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const viewportWidth = Math.max(mapPanel.clientWidth || 0, globeContainer.clientWidth || 0, 1024);
  const desiredWidth = Math.round(viewportWidth * dpr * GLOBE_OVERLAY_VIEWPORT_SCALE);
  const hardMax = Math.max(1024, Math.min(GLOBE_OVERLAY_MAX_WIDTH, maxTextureSize || GLOBE_OVERLAY_MAX_WIDTH));
  return Math.max(1024, Math.min(hardMax, Math.max(GLOBE_OVERLAY_MIN_WIDTH, desiredWidth)));
}

function percentile(values, p) {
  if (!values || values.length === 0) return 0;
  if (values.length === 1) return values[0];
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

function globeRendererInfoSnapshot() {
  if (!isGlobeReady() || typeof globe.renderer !== 'function') return null;
  const renderer = globe.renderer();
  const renderInfo = renderer?.info?.render;
  if (!renderInfo) return null;
  return {
    calls: renderInfo.calls || 0,
    triangles: renderInfo.triangles || 0,
    points: renderInfo.points || 0,
    lines: renderInfo.lines || 0
  };
}

function notifyGlobeProfileWaiters(result) {
  while (globeProfileWaiters.length > 0) {
    const resolve = globeProfileWaiters.shift();
    resolve(result);
  }
}

function publishGlobeProfileResult(result) {
  globeProfileLastResult = result;
  window.__globeProfileLast = result;
  document.documentElement.dataset.globeProfileDone = '1';

  if (GLOBE_PROFILE_DUMP_DOM) {
    let el = document.getElementById('globe-profile-report');
    if (!el) {
      el = document.createElement('pre');
      el.id = 'globe-profile-report';
      el.style.display = 'none';
      document.body.appendChild(el);
    }
    el.textContent = JSON.stringify(result);
  }

  console.table([{
    label: result.label,
    fps_avg: result.fpsAvg.toFixed(1),
    frame_ms_avg: result.frameMsAvg.toFixed(2),
    frame_ms_p95: result.frameMsP95.toFixed(2),
    frame_ms_max: result.frameMsMax.toFixed(2),
    overlay_build_ms_last: result.overlayBuildMsLast.toFixed(2)
  }]);
  console.info('[globe-profile]', result);
  notifyGlobeProfileWaiters(result);
}

function stopGlobeFrameProfile() {
  if (globeProfileRaf !== null) {
    cancelAnimationFrame(globeProfileRaf);
    globeProfileRaf = null;
  }
  if (globeProfileState) globeProfileState.running = false;
}

function startGlobeFrameProfile(options = {}) {
  if (!IS_GLOBE_REGION) return null;
  if (!globe) {
    requestAnimationFrame(() => startGlobeFrameProfile(options));
    return { deferred: true };
  }
  stopGlobeFrameProfile();

  const warmupMs = Number.isFinite(options.warmupMs)
    ? Math.max(0, options.warmupMs)
    : GLOBE_PROFILE_WARMUP_MS;
  const sampleMs = Number.isFinite(options.sampleMs)
    ? Math.max(250, options.sampleMs)
    : GLOBE_PROFILE_SAMPLE_MS;

  const label = (() => {
    if (typeof options.label === 'string' && options.label.trim()) return options.label.trim();
    if (GLOBE_PROFILE_LABEL) return GLOBE_PROFILE_LABEL;
    if (GLOBE_PROFILE_MODE) return GLOBE_PROFILE_MODE;
    return 'custom';
  })();

  const state = {
    running: true,
    startedTs: null,
    lastTs: null,
    warmupMs,
    sampleMs,
    label,
    frameTimes: []
  };
  globeProfileState = state;
  document.documentElement.dataset.globeProfileDone = '0';

  const tick = now => {
    if (!state.running) return;
    if (state.startedTs === null) {
      state.startedTs = now;
      state.lastTs = now;
      globeProfileRaf = requestAnimationFrame(tick);
      return;
    }

    const dt = now - state.lastTs;
    state.lastTs = now;
    const elapsed = now - state.startedTs;

    if (elapsed >= state.warmupMs && elapsed <= state.warmupMs + state.sampleMs && Number.isFinite(dt) && dt > 0) {
      state.frameTimes.push(dt);
    }

    if (elapsed >= state.warmupMs + state.sampleMs) {
      state.running = false;
      globeProfileRaf = null;
      const frameTimes = state.frameTimes;
      const frameCount = frameTimes.length;
      const totalFrameMs = frameTimes.reduce((sum, value) => sum + value, 0);
      const frameMsAvg = frameCount > 0 ? totalFrameMs / frameCount : 0;
      const fpsAvg = frameMsAvg > 0 ? 1000 / frameMsAvg : 0;
      const overlayBuildMsAvg = globeOverlayBuildMsSamples.length
        ? globeOverlayBuildMsSamples.reduce((sum, value) => sum + value, 0) / globeOverlayBuildMsSamples.length
        : 0;
      publishGlobeProfileResult({
        label,
        warmupMs,
        sampleMs,
        frameCount,
        fpsAvg,
        frameMsAvg,
        frameMsP50: percentile(frameTimes, 0.5),
        frameMsP95: percentile(frameTimes, 0.95),
        frameMsMax: frameTimes.length ? Math.max(...frameTimes) : 0,
        overlayBuildMsLast: globeOverlayBuildMsLast,
        overlayBuildMsAvg,
        overlayBuildSamples: globeOverlayBuildMsSamples.length,
        layers: {
          base: GLOBE_LAYER_BASE,
          polygons: GLOBE_LAYER_POLYGONS,
          mnemonics: GLOBE_LAYER_MNEMONICS
        },
        renderer: globeRendererInfoSnapshot(),
        timestamp: new Date().toISOString()
      });
      return;
    }

    globeProfileRaf = requestAnimationFrame(tick);
  };

  globeProfileRaf = requestAnimationFrame(tick);
  return { warmupMs, sampleMs, label };
}

function installGlobeProfileApi() {
  window.__globeProfile = {
    config: {
      enabled: GLOBE_PROFILE_ENABLED,
      warmupMs: GLOBE_PROFILE_WARMUP_MS,
      sampleMs: GLOBE_PROFILE_SAMPLE_MS,
      rotate: GLOBE_PROFILE_ROTATE,
      layers: {
        base: GLOBE_LAYER_BASE,
        polygons: GLOBE_LAYER_POLYGONS,
        mnemonics: GLOBE_LAYER_MNEMONICS
      }
    },
    start: startGlobeFrameProfile,
    stop: stopGlobeFrameProfile,
    last: () => globeProfileLastResult,
    waitForDone: () => new Promise(resolve => {
      if (globeProfileLastResult) {
        resolve(globeProfileLastResult);
      } else {
        globeProfileWaiters.push(resolve);
      }
    })
  };
}

function maybeAutoStartGlobeProfile() {
  if (!GLOBE_PROFILE_ENABLED) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      startGlobeFrameProfile({
        warmupMs: GLOBE_PROFILE_WARMUP_MS,
        sampleMs: GLOBE_PROFILE_SAMPLE_MS
      });
    });
  });
}

installGlobeProfileApi();

function attachGlobeOverlayMesh(mesh, sceneRoot, baseSphere) {
  if (!mesh || !sceneRoot) return;
  if (baseSphere) {
    if (mesh.parent !== baseSphere) baseSphere.add(mesh);
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);
    return;
  }
  // Fallback alignment used by many globe libs: shift texture space by -90deg.
  mesh.rotation.y = -Math.PI / 2;
  sceneRoot.add(mesh);
}

async function initGlobe() {
  const GlobeCtor = await ensureGlobeGlobal();
  if (!GlobeCtor) throw new Error('Globe.gl is not available');
  const wantsFillOverlay =
    GLOBE_LAYER_POLYGONS &&
    GLOBE_UNCLICKED_FILL_VISIBLE &&
    GLOBE_UNCLICKED_FILL_OVERLAY_PREFERRED;
  const wantsStrokeOverlay =
    GLOBE_LAYER_POLYGONS &&
    GLOBE_POLYGON_STROKE_ENABLED &&
    GLOBE_POLYGON_STROKE_OVERLAY_PREFERRED;
  const needsThreeOverlay = GLOBE_LAYER_MNEMONICS || wantsFillOverlay || wantsStrokeOverlay;
  const ThreeLib = needsThreeOverlay ? await ensureThreeGlobal() : null;
  globeFillOverlayEnabled = !!(wantsFillOverlay && ThreeLib);
  globeStrokeOverlayEnabled = !!(wantsStrokeOverlay && ThreeLib);

  stopGlobeFrameProfile();
  globeProfileLastResult = null;
  globeOverlayBuildMsLast = 0;
  globeOverlayBuildMsSamples = [];
  globeOverlayTexture = null;
  globeOverlayMesh = null;
  globeOverlayBaseCanvas = null;
  globeHoverOverlayCanvas = null;
  globeHoverOverlayTexture = null;
  globeHoverOverlayMesh = null;
  globeHoverOverlayMaterial = null;
  globeFillOverlayEnabled = !!(wantsFillOverlay && ThreeLib);
  globeStrokeOverlayEnabled = !!(wantsStrokeOverlay && ThreeLib);
  globeOverlayBaseDirty = true;
  globeOverlayRenderQueued = false;
  globeHoverOverlayRenderQueued = false;
  globeHoverTransitionPendingKey = null;
  globeHitFeatures = [];
  globeHoverHitFeatures = [];
  globeFeatureLookupGrid = null;
  globeHoverFeatureLookupGrid = null;
  globeCountryForCoordsCaches = {
    hit: new Map(),
    hover: new Map()
  };
  globeGeographicPickAtlas = null;
  globeFeatureLookupSeen = new WeakMap();
  globeFeatureLookupToken = 1;
  globeFeatureBounds = new Map();
  globePolygonFeatures = [];
  globePolygonFeatureByKey = new Map();
  globeOverlayImagePreloadPromise = null;
  globeProjectedFeatureCache = new WeakMap();
  globeHoverOverlayRectCache = new WeakMap();
  globeStrokeTopologyCache = null;
  globeOverlayRenderedRevealed = new Set();
  globeOverlayIncrementalPromise = null;
  globeOverlayAttachRetryFrames = 0;
  globePointerSample = null;
  globePointerLastHoverSample = null;
  globePointerDownSample = null;
  globePointerDragged = false;
  if (globePointerMoveRaf !== null) {
    cancelAnimationFrame(globePointerMoveRaf);
    globePointerMoveRaf = null;
  }

  mapWrapper.style.display = 'none';
  globeContainer.style.display = '';
  document.querySelector('.zoom-controls').style.display = '';

  const allFeatures = await loadGlobeFeatureSet(GLOBE_GEO_FILE, 'main');
  if (allFeatures.length === 0) {
    throw new Error(`No renderable features found in GeoJSON: ${GLOBE_GEO_FILE}`);
  }
  globeFeatureByKey = new Map(allFeatures.map(f => [f.properties?.key, f]).filter(([key]) => !!key));
  globeFeatures = allFeatures;
  allFeatures.forEach(feature => globeFeatureBounds.set(feature, featureLatLngBounds(feature)));
  globeFeatureLookupGrid = buildGlobeFeatureLookupGrid(globeFeatures);

  const knownKeys = new Set(globeFeatureByKey.keys());
  const canUseDedicatedPolygonGeo =
    !!GLOBE_POLYGON_GEO_FILE && GLOBE_POLYGON_GEO_FILE !== GLOBE_GEO_FILE;
  let dedicatedPolygonFeatures = [];
  if (canUseDedicatedPolygonGeo) {
    const candidateFeatures = await loadGlobeFeatureSet(GLOBE_POLYGON_GEO_FILE, 'polygon');
    dedicatedPolygonFeatures = candidateFeatures.filter(feature => {
      const key = globeFeatureKey(feature);
      return !!key && knownKeys.has(key);
    });
    if (candidateFeatures.length > 0 && dedicatedPolygonFeatures.length === 0) {
      console.warn('Polygon GeoJSON had no matching feature keys; using main geometry.');
    }
  }

  globeHitFeatures = allFeatures;
  globeHoverHitFeatures =
    GLOBE_CPU_HIT_SIMPLIFIED && dedicatedPolygonFeatures.length > 0
      ? dedicatedPolygonFeatures
      : allFeatures;
  if (GLOBE_CPU_HIT_SIMPLIFIED && dedicatedPolygonFeatures.length > 0) {
    globeHoverFeatureLookupGrid = buildGlobeFeatureLookupGrid(globeHoverHitFeatures);
  } else {
    globeHoverFeatureLookupGrid = globeFeatureLookupGrid;
  }

  globeCountryByFeatureKey = new Map(COUNTRIES.map(c => [c.featureKey, c]));
  globeGeographicPickAtlas = buildGlobeGeographicPickAtlas(globeHitFeatures);
  if (GLOBE_PICK_ATLAS_ENABLED && !globeGeographicPickAtlas) {
    console.warn('Geographic globe pick atlas unavailable; using CPU-only hit testing.');
  }
  const globeTextureUrl = GLOBE_LAYER_BASE
    ? 'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg'
    : GLOBE_TRANSPARENT_PIXEL_DATA_URL;
  const bumpTextureUrl = GLOBE_LAYER_BASE
    ? 'https://unpkg.com/three-globe/example/img/earth-topology.png'
    : GLOBE_TRANSPARENT_PIXEL_DATA_URL;
  let polygonData = [];
  if (GLOBE_LAYER_POLYGONS) {
    if (dedicatedPolygonFeatures.length > 0 && !GLOBE_POLYGON_FORCE_MAIN_GEO) {
      polygonData = dedicatedPolygonFeatures;
    } else {
      polygonData = allFeatures;
    }
  }
  globePolygonFeatures = polygonData;
  globePolygonFeatureByKey = new Map(
    globePolygonFeatures
      .map(feature => [globeFeatureKey(feature), feature])
      .filter(([key]) => !!key)
  );

  globe = GlobeCtor()(globeContainer)
    .backgroundColor('rgba(0,0,0,0)')
    .globeImageUrl(globeTextureUrl)
    .bumpImageUrl(bumpTextureUrl)
    .showAtmosphere(GLOBE_LAYER_BASE)
    .atmosphereColor('#7ab5ff')
    .atmosphereAltitude(0.18)
    .polygonAltitude(globePolygonAltitude)
    .polygonCapCurvatureResolution(GLOBE_POLYGON_CURVATURE_RESOLUTION)
    .polygonSideColor(() => (GLOBE_POLYGON_SIDE_ENABLED ? 'rgba(90,120,150,0.18)' : null))
    .polygonStrokeColor(() =>
      GLOBE_POLYGON_STROKE_ENABLED && !globeStrokeOverlayEnabled
        ? (GLOBE_BLACK_BORDERS ? 'rgba(0, 0, 0, 0.9)' : 'rgba(140, 180, 220, 0.34)')
        : null
    )
    .polygonsTransitionDuration(0)
    .polygonsData([])
    .polygonCapColor(globeCapColor)
    .onGlobeClick(onGlobeSurfaceClick);

  if (!GLOBE_USE_CPU_POINTER) {
    globe.onPolygonHover(onGlobeHover).onPolygonClick(onGlobeClick);
  }

  if (typeof globe.enablePointerInteraction === 'function') {
    globe.enablePointerInteraction(!GLOBE_USE_CPU_POINTER);
  }
  installGlobeCpuPointerHandlers();

  try {
    const sceneRoot = typeof globe.scene === 'function' ? globe.scene() : null;
    installRaycastGuards(sceneRoot);
  } catch (error) {
    console.warn('Unable to install globe raycast guards:', error);
  }

  globeContainer.addEventListener('pointerleave', () => {
    setGlobeHoverFeature(null);
    if (GLOBE_HOVER_LEGACY) refreshGlobeHoverStyles();
    if (globePointerMoveRaf !== null) {
      cancelAnimationFrame(globePointerMoveRaf);
      globePointerMoveRaf = null;
    }
    globePointerSample = null;
    globePointerLastHoverSample = null;
  });

  globe.controls().enablePan = false;
  globe.controls().minDistance = 170;
  globe.controls().maxDistance = 340;
  globe.controls().autoRotate = GLOBE_PROFILE_ENABLED ? GLOBE_PROFILE_ROTATE : false;
  if (GLOBE_PROFILE_ENABLED && GLOBE_PROFILE_ROTATE) {
    globe.controls().autoRotateSpeed = 0.35;
  }
  globe.pointOfView(debugPovOrDefault(), 0);
  syncGlobeViewport();

  if (globeResizeObserver) globeResizeObserver.disconnect();
  if (window.ResizeObserver) {
    globeResizeObserver = new ResizeObserver(() => syncGlobeViewport());
    globeResizeObserver.observe(mapPanel);
    globeResizeObserver.observe(globeContainer);
  } else {
    window.addEventListener('resize', syncGlobeViewport);
  }
  requestAnimationFrame(syncGlobeViewport);

  if (ThreeLib && (GLOBE_LAYER_MNEMONICS || globeFillOverlayEnabled || globeStrokeOverlayEnabled)) {
    const renderer = typeof globe.renderer === 'function' ? globe.renderer() : null;
    const maxTextureSize =
      renderer && renderer.capabilities && renderer.capabilities.maxTextureSize
        ? renderer.capabilities.maxTextureSize
        : GLOBE_OVERLAY_MAX_WIDTH;
    const overlayWidth = computeGlobeOverlayWidth(maxTextureSize);
    const overlayHeight = Math.floor(overlayWidth / 2);
    globeOverlayBaseCanvas = document.createElement('canvas');
    globeOverlayBaseCanvas.width = overlayWidth;
    globeOverlayBaseCanvas.height = overlayHeight;
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

    const radiusCandidate = typeof globe.getGlobeRadius === 'function' ? globe.getGlobeRadius() : null;
    const radius =
      Number.isFinite(radiusCandidate) && radiusCandidate > 0 ? radiusCandidate : 100;

    const overlayGeometry = new ThreeLib.SphereGeometry(
      radius * GLOBE_OVERLAY_RADIUS_SCALE,
      GLOBE_OVERLAY_SPHERE_WIDTH_SEGMENTS,
      GLOBE_OVERLAY_SPHERE_HEIGHT_SEGMENTS
    );
    globeOverlayMesh = new ThreeLib.Mesh(
      overlayGeometry,
      new ThreeLib.MeshBasicMaterial({
        map: globeOverlayTexture,
        transparent: true,
        premultipliedAlpha: true,
        depthTest: false,
        depthWrite: false
      })
    );
    globeOverlayMesh.userData.isGlobeOverlay = true;
    globeOverlayMesh.renderOrder = GLOBE_MNEMONIC_OVERLAY_RENDER_ORDER;

    const sceneRoot = globe.scene();
    const baseSphere = findFirstSphereMesh(sceneRoot);
    attachGlobeOverlayMesh(globeOverlayMesh, sceneRoot, baseSphere);
    installRaycastGuards(sceneRoot);

    if (GLOBE_LAYER_MNEMONICS) {
      const hoverOverlayWidth = Math.min(overlayWidth, GLOBE_HOVER_OVERLAY_MAX_WIDTH);
      const hoverOverlayHeight = Math.floor(hoverOverlayWidth / 2);
      globeHoverOverlayCanvas = document.createElement('canvas');
      globeHoverOverlayCanvas.width = hoverOverlayWidth;
      globeHoverOverlayCanvas.height = hoverOverlayHeight;
      globeHoverOverlayTexture = new ThreeLib.CanvasTexture(globeHoverOverlayCanvas);
      globeHoverOverlayTexture.premultiplyAlpha = true;
      globeHoverOverlayTexture.generateMipmaps = false;
      globeHoverOverlayTexture.minFilter = ThreeLib.LinearFilter;
      globeHoverOverlayTexture.magFilter = ThreeLib.LinearFilter;
      if (ThreeLib.SRGBColorSpace) {
        globeHoverOverlayTexture.colorSpace = ThreeLib.SRGBColorSpace;
      }
      globeHoverOverlayTexture.anisotropy = globeOverlayTexture.anisotropy;

      globeHoverOverlayMaterial = new ThreeLib.MeshBasicMaterial({
        map: globeHoverOverlayTexture,
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
        depthTest: false,
        opacity: 0
      });
      globeHoverOverlayMesh = new ThreeLib.Mesh(overlayGeometry.clone(), globeHoverOverlayMaterial);
      globeHoverOverlayMesh.userData.isGlobeOverlay = true;
      globeHoverOverlayMesh.renderOrder = GLOBE_HOVER_MNEMONIC_OVERLAY_RENDER_ORDER;
      attachGlobeOverlayMesh(globeHoverOverlayMesh, sceneRoot, baseSphere);
      setGlobeHoverOverlayOpacity(0);
      queueGlobeHoverOverlayRender();
    }
  } else if (!ThreeLib) {
    if (needsThreeOverlay) {
      console.warn('THREE global not available; globe overlay textures are disabled.');
    }
  } else {
    console.info('Globe image overlays are disabled by URL flags.');
  }

  if (GLOBE_LAYER_MNEMONICS && GLOBE_PRELOAD_MNEMONIC_IMAGES) {
    const preloadPromise = preloadGlobeOverlayImages();
    if (GLOBE_PRELOAD_MNEMONIC_BLOCKING) {
      try {
        await preloadPromise;
      } catch (error) {
        console.warn('Failed to preload globe mnemonic images:', error);
      }
    } else {
      preloadPromise.catch(error => {
        console.warn('Failed to preload globe mnemonic images:', error);
      });
    }

    const infoPreloadPromise = preloadGlobeInfoPanelImages();
    infoPreloadPromise.catch(error => {
      console.warn('Failed to preload globe info images:', error);
    });
  }

  if (shouldUseGlobeOverlayTexture()) {
    renderGlobeOverlayTexture({ baseDirty: true });
  }
  refreshGlobeStyles();
  maybeAutoStartGlobeProfile();
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
    if (!tryIncrementalRevealOnGlobeOverlay(filename)) {
      markGlobeOverlayDirtyForRevealState();
    }
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
    markGlobeOverlayDirtyForRevealState();
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
  if (IS_GLOBE_REGION) prefetchGlobeInfoImageForCountry(c);
  infoShape.src = countryImgSrc(c.filename);
  const assoc = IMAGE_ASSOCIATIONS[c.filename];
  infoDesc.innerHTML = (assoc ? `<div class="assoc-box">${escHtml(assoc)}</div>` : '') + escHtml(c.desc);
  infoDefault.style.display = 'none';
  infoCard.classList.add('active');
  syncGlobeInfoPanelState();
}

function exploreClick(c, e) {
  if (revealed.has(c.filename)) {
    revealed.delete(c.filename);
    if (IS_GLOBE_REGION) {
      markGlobeOverlayDirtyForRevealState();
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
    markGlobeOverlayDirtyForRevealState();
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
  const exploreToggleButtons = document.getElementById('explore-toggle-buttons');

  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));

  if (mode === 'explore') {
    document.getElementById('explore-ui').style.display = '';
    document.getElementById('seterra-ui').style.display = 'none';
    if (exploreToggleButtons) exploreToggleButtons.style.display = '';
    hideExploreTooltip();
    clearInterval(seterraTimerInterval);
    seterraTarget = null;
    headerHint.textContent = IS_GLOBE_REGION ? 'Klicka på ett land på jordgloben' : 'Klicka på ett land';
    resetOverlays();
    clearExploreSelection();
    exploredCountEl.textContent = '0';
  } else {
    document.getElementById('explore-ui').style.display = 'none';
    document.getElementById('seterra-ui').style.display = '';
    if (exploreToggleButtons) exploreToggleButtons.style.display = 'none';
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
    const geoFile = resolveConfigAssetPath(raw.geoFile, assetBase, 'world.geojson');
    const polygonGeoFile = resolveConfigAssetPath(
      raw.polygonGeoFile,
      assetBase,
      'world.render.geojson'
    );

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
      geoFile,
      polygonGeoFile,
      warpAtlasWidth: raw.warpAtlasWidth || 8192,
      warpAtlasHeight: raw.warpAtlasHeight || 4096,
      warpCropMode: raw.warpCropMode || 'mnemonic',
      warpVersion: raw.warpVersion || '',
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
  GLOBE_POLYGON_GEO_FILE = config.polygonGeoFile || '';
  GLOBE_WARP_ATLAS_WIDTH = config.warpAtlasWidth || 8192;
  GLOBE_WARP_ATLAS_HEIGHT = config.warpAtlasHeight || 4096;
  GLOBE_WARP_VERSION = config.warpVersion || '';
  const configCropMode = normalizeGlobeCropMode(config.warpCropMode);
  GLOBE_WARP_CROP_MODE = GLOBE_WARP_CROP_MODE_OVERRIDE || configCropMode || 'mnemonic';
  COUNTRY_BY_FILENAME = Object.fromEntries(COUNTRIES.map(c => [c.filename, c]));
  document.body.classList.toggle('is-globe-region', IS_GLOBE_REGION);

  // Update HTML elements
  document.title = `${config.name} – Jonas geografi`;
  document.querySelector('header h1').textContent = config.name;
  document.querySelectorAll('[data-total]').forEach(el => el.textContent = COUNTRIES.length);
  seterraProgressLabel.textContent = `0 / ${COUNTRIES.length}`;
  syncGlobeInfoPanelState();

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
    document.querySelector('.zoom-controls').style.display = '';
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

const showAllBtn = document.getElementById('show-all-btn');
if (showAllBtn) {
  showAllBtn.addEventListener('click', () => {
    COUNTRIES.forEach(c => revealCountry(c.filename));
    exploredCountEl.textContent = revealed.size;
    if (COUNTRIES.length) showInfoCard(COUNTRIES[0]);
  });
}

const hideAllBtn = document.getElementById('hide-all-btn');
if (hideAllBtn) {
  hideAllBtn.addEventListener('click', () => {
    resetOverlays();
    exploredCountEl.textContent = '0';
    clearExploreSelection();
  });
}

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
  document.body.classList.remove('is-globe-region');
  document.body.classList.remove('globe-info-card-active');
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
      window.__regionLoadError = String(e && e.stack ? e.stack : e);
      showRegionSelector();
    }
  } else {
    showRegionSelector();
  }
})();
