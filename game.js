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

// ══════════════════════════════════
// DOM references
// ══════════════════════════════════
const mapPanel = document.querySelector('.map-panel');
const mapWrapper = document.getElementById('map-wrapper');
const baseMap = document.getElementById('base-map');
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
const markerEls = {};
const revealed = new Set();
const NO_HOVER = new Set();
let sortedCountries = [];
let currentMode = 'explore';
let isWorldTest = false;
let worldPhase = 'hub';

// Zoom & Pan
let zoom = 1, panX = 0, panY = 0;
const MIN_ZOOM = 0.5, MAX_ZOOM = 5;

// Explore state
let activeCountry = null;
let exploreTooltipTimer = null;

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

// ══════════════════════════════════
// Hit detection & overlays
// ══════════════════════════════════
function countryImgSrc(filename) {
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

    const shape = SPECIAL_SHAPES[c.filename];
    const hover = document.createElement('img');
    hover.className = 'hover-highlight';
    hover.dataset.country = c.filename;
    hover.draggable = false;
    if (shape && shape.hitOnly) {
      // No hover image for hitOnly — we use a marker dot instead
    } else if (shape) {
      hover.src = shape.shapeFile;
    } else {
      hover.src = countryImgSrc(c.filename);
    }
    mapWrapper.appendChild(hover);
    hoverEls[c.filename] = hover;

    // Create hover marker dot for hitOnly shapes
    if (shape && shape.hitOnly) {
      const marker = document.createElement('div');
      marker.className = 'hit-marker';
      mapWrapper.appendChild(marker);
      markerEls[c.filename] = marker;
    }
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
  if (!createOverlays._resizeListenerAdded) {
    window.addEventListener('resize', positionOverlays);
    createOverlays._resizeListenerAdded = true;
  }
}

function processHoverImages(mapImageOverride) {
  const HOVER_R = 255, HOVER_G = 220, HOVER_B = 50;
  const BORDER_THRESHOLD = 150;

  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = MAP_W;
  mapCanvas.height = MAP_H;
  const mapCtx = mapCanvas.getContext('2d');
  mapCtx.drawImage(mapImageOverride || baseMap, 0, 0, MAP_W, MAP_H);
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

    // Skip hover highlight generation for hitOnly shapes (pointer cursor only)
    if (shape && shape.hitOnly) return;

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

    // Position hit-marker at center of shape
    const mEl = markerEls[c.filename];
    if (mEl) {
      const shape = SPECIAL_SHAPES[c.filename];
      const cx = (shape.left + shape.width / 2 - MAP_LEFT) * scale;
      const cy = (shape.top + shape.height / 2 - MAP_TOP) * scale;
      mEl.style.left = (offsetX + cx) + 'px';
      mEl.style.top = (offsetY + cy) + 'px';
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
  const el = overlayEls[filename];
  if (el) { el.classList.remove('flash-wrong', 'hint-blink', 'hovered'); el.classList.add('visible'); }
  revealed.add(filename);
  justRevealed.add(filename);
  const hoverEl = hoverEls[filename];
  if (hoverEl) hoverEl.classList.remove('active');
}

function flashWrong(filename) {
  const el = overlayEls[filename];
  if (!el || revealed.has(filename)) return;
  const hoverEl = hoverEls[filename];
  if (hoverEl) hoverEl.classList.remove('active');
  el.classList.add('flash-wrong');
  setTimeout(() => { el.classList.remove('flash-wrong'); }, 1200);
}

function blinkHint(filename) {
  const el = overlayEls[filename];
  if (!el || revealed.has(filename)) return;
  el.classList.remove('hint-blink');
  void el.offsetWidth;
  el.classList.add('hint-blink');
  el.addEventListener('animationend', () => el.classList.remove('hint-blink'), { once: true });
}

function resetOverlays() {
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
      if (markerEls[currentHover]) markerEls[currentHover].classList.remove('active');
      justRevealed.delete(currentHover);
    }
    if (newHover && !justRevealed.has(newHover)) {
      const isHitOnly = SPECIAL_SHAPES[newHover] && SPECIAL_SHAPES[newHover].hitOnly;
      if (revealed.has(newHover)) {
        overlayEls[newHover].classList.add('hovered');
      } else if (isHitOnly) {
        if (markerEls[newHover]) markerEls[newHover].classList.add('active');
      } else if (!overlayEls[newHover].classList.contains('flash-wrong')) {
        hoverEls[newHover].classList.add('active');
      }
    }
    currentHover = newHover;
  }
  mapPanel.style.cursor = newHover ? 'pointer' : '';

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
  if (e.target.closest('.zoom-controls') || e.target.closest('.explore-toggle-buttons') || e.target.closest('.world-back-bar')) return;
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
  if (isWorldTest && worldPhase === 'region') {
    worldSeterraClick(c);
    return;
  }
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
  const overlay = overlayEls[c.filename];
  if (revealed.has(c.filename)) {
    overlay.classList.remove('visible', 'hovered');
    revealed.delete(c.filename);
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
  cursorLabel.style.display = 'block';

  updateSeterraUI();
  nextSeterraTarget();

  clearInterval(seterraTimerInterval);
  seterraTimerInterval = setInterval(updateSeterraTimer, 500);
}

function startSeterraRetry() {
  const missedList = COUNTRIES.filter(c => seterraMissedCountries.has(c.filename));
  if (missedList.length === 0) return;

  resetOverlays();
  COUNTRIES.forEach(c => {
    if (!seterraMissedCountries.has(c.filename)) revealCountry(c.filename);
  });

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
  cursorLabel.style.display = 'block';

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
  cursorLabel.textContent = seterraTarget.name;
  seterraFeedback.className = 'seterra-feedback';
  seterraFeedback.innerHTML = '';
}

function seterraClick(c) {
  if (!seterraTarget || seterraLocked) return;

  if (c.filename === seterraTarget.filename) {
    seterraCorrect++;
    seterraTargetMisses = 0;
    revealCountry(c.filename);
    seterraFeedback.className = 'seterra-feedback correct-fb';
    const correctAssoc = IMAGE_ASSOCIATIONS[c.filename];
    seterraFeedback.innerHTML = `<div class="fb-banner correct-banner">RÄTT!</div><div class="fb-title">${escHtml(c.name)}</div>${correctAssoc ? `<div class="assoc-box">${escHtml(correctAssoc)}</div>` : ''}<div class="fb-desc">${escHtml(c.desc)}</div>`;
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
    headerHint.textContent = 'Klicka på ett land';
    resetOverlays();
    activeCountry = null;
    infoCard.classList.remove('active');
    infoDefault.style.display = '';
    exploredCountEl.textContent = '0';
  } else {
    document.getElementById('explore-ui').style.display = 'none';
    document.getElementById('seterra-ui').style.display = '';
    document.getElementById('explore-toggle-buttons').style.display = 'none';
    headerHint.textContent = 'Klicka där du tror landet är!';
    startSeterra();
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

  const config = {
    name: raw.name,
    slug: slug,
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

  // Update HTML elements
  document.title = `${config.name} – Jonas geografi`;
  document.querySelector('header h1').textContent = config.name;
  document.querySelectorAll('[data-total]').forEach(el => el.textContent = COUNTRIES.length);
  seterraProgressLabel.textContent = `0 / ${COUNTRIES.length}`;

  // Set map image and wait for it to load
  baseMap.src = MAP_FILE;
  baseMap.alt = config.name + ' karta';
  await new Promise(resolve => {
    if (baseMap.complete && baseMap.naturalWidth > 0) resolve();
    else baseMap.onload = resolve;
  });

  // Show game container (hidden if region selector was showing)
  document.getElementById('region-selector').style.display = 'none';
  document.querySelector('.game-container').style.display = '';
  document.querySelector('header').style.display = '';
  document.querySelector('.mode-toggle').style.display = '';
  document.getElementById('header-hint').style.display = '';
  document.body.style.overflow = 'hidden';

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

document.getElementById('seterra-restart').addEventListener('click', () => {
  if (isWorldTest) startWorldTest();
  else startSeterra();
});
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
  document.getElementById('world-back-bar').style.display = 'none';
  document.querySelector('header h1').textContent = 'Jonas geografi';
  document.title = 'Jonas geografi';
  document.body.style.overflow = 'auto';
  if (isWorldTest) {
    clearInterval(worldTimerInterval);
    mapPanel.removeEventListener('pointerdown', worldPointerDown);
    mapPanel.removeEventListener('pointermove', worldPointerMove);
    mapPanel.removeEventListener('pointerup', worldPointerUp);
    mapPanel.removeEventListener('pointercancel', worldPointerUp);
    cleanupMapWrapper();
  }
  isWorldTest = false;
}

document.getElementById('back-btn').addEventListener('click', () => {
  if (isWorldTest && worldPhase === 'region') {
    showWorldHub();
    return;
  }
  history.pushState(null, '', window.location.pathname);
  showRegionSelector();
});

// ══════════════════════════════════
// World Test
// ══════════════════════════════════
let worldConfigs = {};
let worldQuestions = [];
let worldQueueIndex = 0;
let worldCorrect = 0;
let worldWrong = 0;
let worldTotal = 0;
let worldStartTime = 0;
let worldTimerInterval = null;
// worldPhase: 'hub' | 'region' | 'done' (declared at top with isWorldTest)
let worldTarget = null;       // current question { country, region }
let worldTargetRegion = null;  // slug of region we're currently viewing
let worldMissedCountries = new Set();
let worldContinentMisses = 0;
let worldMapPixelData = null;
let worldMapW = 0, worldMapH = 0;
let worldLocked = false;
let worldHoverEls = {};       // continent slug → img element for hover highlights
let currentWorldHover = null; // currently hovered continent slug

const WORLD_SLUGS = ['europa', 'afrika', 'asien', 'nordamerika', 'sydamerika', 'oceanien', 'vastindien'];

const CONTINENT_COLORS = [
  { slug: 'nordamerika', name: 'Nordamerika', r: 220, g: 42, b: 44 },
  { slug: 'sydamerika', name: 'Sydamerika', r: 66, g: 160, b: 63 },
  { slug: 'europa', name: 'Europa', r: 35, g: 117, b: 172 },
  { slug: 'afrika', name: 'Afrika', r: 229, g: 120, b: 33 },
  { slug: 'asien', name: 'Asien', r: 246, g: 198, b: 10 },
  { slug: 'oceanien', name: 'Oceanien', r: 131, g: 47, b: 129 },
  { slug: 'vastindien', name: 'Västindien', r: 39, g: 213, b: 250 },
];

// Countries that exist in multiple regions — either region is correct
const CROSS_REGION_COUNTRIES = {
  turkiet: ['europa', 'asien'],
  papua_nya_guinea: ['asien', 'oceanien']
};

function detectContinent(px, py) {
  if (!worldMapPixelData) return null;
  const idx = (py * worldMapW + px) * 4;
  const r = worldMapPixelData[idx], g = worldMapPixelData[idx + 1], b = worldMapPixelData[idx + 2];

  // Skip background (white/light)
  if (r > 200 && g > 200 && b > 200) return null;

  let best = null, bestDist = Infinity;
  for (const c of CONTINENT_COLORS) {
    const dist = (r - c.r) ** 2 + (g - c.g) ** 2 + (b - c.b) ** 2;
    if (dist < bestDist) { bestDist = dist; best = c; }
  }
  if (bestDist > 12000) return null;

  return best;
}

function sampleWorldQuestions(total) {
  const entries = WORLD_SLUGS.map(slug => ({
    slug,
    countries: shuffle([...worldConfigs[slug].countries])
  }));
  const totalCountries = entries.reduce((s, e) => s + e.countries.length, 0);

  // Cap at total available
  if (total > totalCountries) total = totalCountries;

  // Largest remainder method for proportional allocation
  const raw = entries.map(e => {
    const exact = (e.countries.length / totalCountries) * total;
    return { ...e, exact, count: Math.floor(exact) };
  });
  let allocated = raw.reduce((s, r) => s + r.count, 0);
  raw.map((r, i) => ({ i, rem: r.exact - r.count }))
    .sort((a, b) => b.rem - a.rem)
    .forEach(r => { if (allocated < total) { raw[r.i].count++; allocated++; } });

  const questions = [];
  for (const r of raw) {
    for (let i = 0; i < Math.min(r.count, r.countries.length); i++) {
      const country = r.countries[i];
      const altRegions = CROSS_REGION_COUNTRIES[country.filename];
      questions.push({
        country,
        region: r.slug,
        altRegions: altRegions || null,
        wrongCounted: false,
        found: false
      });
    }
  }
  return shuffle(questions);
}

function cleanupMapWrapper() {
  // In world test mode, detach DOM elements back to their cache
  if (isWorldTest && worldTargetRegion && worldRegionCache[worldTargetRegion]) {
    const cache = worldRegionCache[worldTargetRegion];
    cache.domElements.forEach(el => el.remove());
  } else {
    // Remove all dynamically created elements from mapWrapper
    mapWrapper.querySelectorAll('.country-overlay, .hover-highlight, .hit-marker, .map-overlay').forEach(el => el.remove());
  }
  // Clear globals
  for (const k in hitCanvases) delete hitCanvases[k];
  for (const k in hitPixelData) delete hitPixelData[k];
  for (const k in overlayEls) delete overlayEls[k];
  for (const k in hoverEls) delete hoverEls[k];
  for (const k in markerEls) delete markerEls[k];
  sortedCountries = [];
  revealed.clear();
  justRevealed.clear();
  currentHover = null;
  NO_HOVER.clear();
}

const worldRegionCache = {};

async function preloadWorldRegions() {
  // Pre-fetch all map images in parallel
  const mapImages = {};
  await Promise.all(WORLD_SLUGS.map(slug => new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { mapImages[slug] = img; resolve(); };
    img.onerror = resolve;
    img.src = worldConfigs[slug].mapFile;
  })));

  const totalRegions = WORLD_SLUGS.length;
  for (let i = 0; i < totalRegions; i++) {
    const slug = WORLD_SLUGS[i];
    const config = worldConfigs[slug];
    headerHint.textContent = `Laddar ${config.name}... (${i + 1}/${totalRegions})`;
    const loadBar = document.getElementById('world-loading-bar');
    if (loadBar) loadBar.style.width = `${Math.round(((i + 1) / totalRegions) * 100)}%`;

    // Set globals for this region
    COUNTRIES = config.countries;
    MAP_LEFT = config.mapLeft;
    MAP_TOP = config.mapTop;
    MAP_W = config.mapW;
    MAP_H = config.mapH;
    IMAGE_ASSOCIATIONS = config.imageAssociations;
    ASSET_BASE = config.assetBase;
    IMAGE_EXT = config.imageExt;
    MAP_FILE = config.mapFile;
    OVERLAY_FILE = config.overlayFile;
    SPECIAL_SHAPES = config.specialShapes;

    // Use pre-fetched map image as base map
    baseMap.src = config.mapFile;
    await new Promise(resolve => {
      if (baseMap.complete && baseMap.naturalWidth > 0) resolve();
      else baseMap.onload = resolve;
    });

    createOverlays();
    await loadHitData();
    processHoverImages(mapImages[slug]);

    // Cache all state for this region
    const domEls = [...mapWrapper.querySelectorAll('.country-overlay, .hover-highlight, .hit-marker, .map-overlay')];
    worldRegionCache[slug] = {
      overlayEls: { ...overlayEls },
      hoverEls: { ...hoverEls },
      markerEls: { ...markerEls },
      hitPixelData: { ...hitPixelData },
      sortedCountries: [...sortedCountries],
      noHover: new Set(NO_HOVER),
      domElements: domEls
    };

    // Detach DOM elements (keep in cache)
    domEls.forEach(el => el.remove());

    // Clear globals for next iteration
    for (const k in hitCanvases) delete hitCanvases[k];
    for (const k in hitPixelData) delete hitPixelData[k];
    for (const k in overlayEls) delete overlayEls[k];
    for (const k in hoverEls) delete hoverEls[k];
    for (const k in markerEls) delete markerEls[k];
    sortedCountries = [];
    NO_HOVER.clear();
  }
}

function generateContinentHovers() {
  // Create highlight overlay images for each continent from world map pixel data
  if (!worldMapPixelData) return;

  // Group all continent slugs (vastindien now has its own color on the map)
  const continentSlugs = CONTINENT_COLORS.map(c => c.slug);

  for (const slug of continentSlugs) {
    const canvas = document.createElement('canvas');
    canvas.width = worldMapW;
    canvas.height = worldMapH;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(worldMapW, worldMapH);
    const data = imgData.data;

    for (let y = 0; y < worldMapH; y++) {
      for (let x = 0; x < worldMapW; x++) {
        const idx = (y * worldMapW + x) * 4;
        const r = worldMapPixelData[idx], g = worldMapPixelData[idx + 1], b = worldMapPixelData[idx + 2];

        if (r > 200 && g > 200 && b > 200) continue; // skip background

        let pixelContinent = null;
        let bestDist = Infinity;
        for (const c of CONTINENT_COLORS) {
          const dist = (r - c.r) ** 2 + (g - c.g) ** 2 + (b - c.b) ** 2;
          if (dist < bestDist) { bestDist = dist; pixelContinent = c; }
        }
        if (bestDist > 12000 || !pixelContinent) continue;

        if (pixelContinent.slug === slug) {
          // White highlight pixel
          data[idx] = 255;
          data[idx + 1] = 255;
          data[idx + 2] = 255;
          data[idx + 3] = 180;
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);

    const img = new Image();
    img.src = canvas.toDataURL();
    img.className = 'continent-hover';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.position = 'absolute';
    img.style.left = '0';
    img.style.top = '0';
    img.style.pointerEvents = 'none';
    img.style.opacity = '0';
    img.style.mixBlendMode = 'screen';
    img.style.transition = 'opacity 0.15s';
    worldHoverEls[slug] = img;
  }
}

function attachContinentHovers() {
  for (const slug in worldHoverEls) {
    mapWrapper.appendChild(worldHoverEls[slug]);
  }
}

function detachContinentHovers() {
  for (const slug in worldHoverEls) {
    worldHoverEls[slug].remove();
    worldHoverEls[slug].style.opacity = '0';
  }
  currentWorldHover = null;
}

function showWorldSetup() {
  const overlay = document.getElementById('world-setup-overlay');
  overlay.classList.add('active');
}

function beginWorldGame(count) {
  const overlay = document.getElementById('world-setup-overlay');
  overlay.classList.remove('active');

  // Sample questions
  worldQuestions = sampleWorldQuestions(count);
  worldTotal = worldQuestions.length;

  // Set up seterra UI for world test
  document.getElementById('explore-ui').style.display = 'none';
  document.getElementById('seterra-ui').style.display = '';
  seterraGame.classList.add('active');
  seterraDone.classList.remove('active');
  currentMode = 'seterra';

  // Start timer
  worldStartTime = Date.now();
  clearInterval(worldTimerInterval);
  worldTimerInterval = setInterval(updateWorldTimer, 500);

  showWorldHub();
  nextWorldQuestion();
}

async function startWorldTest() {
  isWorldTest = true;
  worldPhase = 'hub';
  worldQueueIndex = 0;
  worldCorrect = 0;
  worldWrong = 0;
  worldContinentMisses = 0;
  worldMissedCountries.clear();
  worldLocked = false;

  // Show loading state
  document.getElementById('region-selector').style.display = 'none';
  document.querySelector('.game-container').style.display = '';
  document.querySelector('header').style.display = '';
  document.querySelector('.mode-toggle').style.display = 'none';
  document.getElementById('header-hint').style.display = '';
  document.getElementById('back-btn').style.display = '';
  document.getElementById('explore-toggle-buttons').style.display = 'none';
  document.body.style.overflow = 'hidden';

  headerHint.textContent = 'Laddar världstest...';
  document.querySelector('header h1').textContent = 'Världstest';
  document.title = 'Världstest – Jonas geografi';

  // Show setup overlay immediately (with loading indicator)
  document.getElementById('world-setup-loading').style.display = '';
  document.getElementById('world-setup-ready').style.display = 'none';
  document.getElementById('world-loading-bar').style.width = '0%';
  showWorldSetup();

  // Load all region configs
  const configs = await Promise.all(WORLD_SLUGS.map(s => loadRegionConfig(s)));
  WORLD_SLUGS.forEach((s, i) => worldConfigs[s] = configs[i]);

  // Pre-load all regions (overlays, hit data, hover images)
  await preloadWorldRegions();

  // Load world map image and generate pixel data
  await loadWorldMap();

  // Generate continent hover highlights
  generateContinentHovers();

  // Loading done — show count selector
  document.getElementById('world-setup-loading').style.display = 'none';
  document.getElementById('world-setup-ready').style.display = '';
}

// Setup overlay: count selection
document.getElementById('world-count-buttons').addEventListener('click', e => {
  const btn = e.target.closest('button[data-count]');
  if (!btn) return;
  document.querySelectorAll('#world-count-buttons button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
});

document.getElementById('world-start-btn').addEventListener('click', () => {
  const activeBtn = document.querySelector('#world-count-buttons button.active');
  const count = activeBtn ? parseInt(activeBtn.dataset.count) : 50;
  beginWorldGame(count);
});

async function loadWorldMap() {
  const worldMapUrl = 'assets/world/map.webp';
  if (baseMap.src.endsWith(worldMapUrl) && baseMap.complete && baseMap.naturalWidth > 0) {
    // Already loaded
  } else {
    baseMap.src = worldMapUrl;
    await new Promise(resolve => {
      if (baseMap.complete && baseMap.naturalWidth > 0) resolve();
      else baseMap.onload = resolve;
    });
  }

  // Create pixel data for continent detection
  const canvas = document.createElement('canvas');
  worldMapW = baseMap.naturalWidth;
  worldMapH = baseMap.naturalHeight;
  canvas.width = worldMapW;
  canvas.height = worldMapH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(baseMap, 0, 0);
  worldMapPixelData = ctx.getImageData(0, 0, worldMapW, worldMapH).data;
}

function showWorldHub() {
  worldPhase = 'hub';

  // Clean up region overlays BEFORE nulling worldTargetRegion (cache needs it)
  cleanupMapWrapper();
  worldTargetRegion = null;

  // Detach ALL event listeners to avoid duplicates
  mapPanel.removeEventListener('pointerdown', onPointerDown);
  mapPanel.removeEventListener('pointermove', onPointerMove);
  mapPanel.removeEventListener('pointerup', onPointerUp);
  mapPanel.removeEventListener('pointercancel', onPointerUp);
  mapPanel.removeEventListener('wheel', onWheel);
  mapPanel.removeEventListener('pointerdown', worldPointerDown);
  mapPanel.removeEventListener('pointermove', worldPointerMove);
  mapPanel.removeEventListener('pointerup', worldPointerUp);
  mapPanel.removeEventListener('pointercancel', worldPointerUp);

  // Show world map
  baseMap.src = 'assets/world/map.webp';
  baseMap.alt = 'Världskarta';

  // Reset zoom/pan
  zoom = 1; panX = 0; panY = 0;
  applyTransform();

  document.querySelector('header h1').textContent = 'Världstest';
  headerHint.textContent = 'Klicka på rätt världsdel!';
  document.getElementById('world-back-bar').style.display = 'none';
  document.getElementById('explore-toggle-buttons').style.display = 'none';

  // Attach continent hover overlays
  attachContinentHovers();

  // Attach world map click and scroll handler
  mapPanel.addEventListener('pointerdown', worldPointerDown);
  mapPanel.addEventListener('pointermove', worldPointerMove);
  mapPanel.addEventListener('pointerup', worldPointerUp);
  mapPanel.addEventListener('pointercancel', worldPointerUp);
  mapPanel.addEventListener('wheel', onWheel, { passive: false });

  // Show cursor label with target
  if (worldTarget) {
    cursorLabel.textContent = worldTarget.country.name;
    cursorLabel.style.display = 'block';
  }
}

let worldDragStart = null;
let worldDidDrag = false;
function worldPointerDown(e) {
  if (e.button !== 0) return;
  if (e.target.closest('.world-back-bar')) return;
  e.preventDefault();
  mapPanel.setPointerCapture(e.pointerId);
  worldDragStart = { x: e.clientX, y: e.clientY };
  worldDidDrag = false;
}

function worldPointerMove(e) {
  // Update cursor label position
  if (cursorLabel.style.display === 'block') {
    cursorLabel.style.left = e.clientX + 'px';
    cursorLabel.style.top = e.clientY + 'px';
  }

  // Pan if dragging
  if (worldDragStart) {
    const dx = e.clientX - worldDragStart.x;
    const dy = e.clientY - worldDragStart.y;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      worldDidDrag = true;
      panX += dx;
      panY += dy;
      worldDragStart = { x: e.clientX, y: e.clientY };
      applyTransform();
      return;
    }
  }

  // Hover highlight: detect continent under cursor
  const mapRect = baseMap.getBoundingClientRect();
  const scaleX = worldMapW / mapRect.width;
  const scaleY = worldMapH / mapRect.height;
  const px = Math.round((e.clientX - mapRect.left) * scaleX);
  const py = Math.round((e.clientY - mapRect.top) * scaleY);

  if (px >= 0 && px < worldMapW && py >= 0 && py < worldMapH) {
    const c = detectContinent(px, py);
    mapPanel.style.cursor = c ? 'pointer' : '';

    // Show/hide continent hover highlight
    const slug = c ? c.slug : null;
    if (slug !== currentWorldHover) {
      if (currentWorldHover && worldHoverEls[currentWorldHover]) {
        worldHoverEls[currentWorldHover].style.opacity = '0';
      }
      if (slug && worldHoverEls[slug]) {
        worldHoverEls[slug].style.opacity = '0.5';
      }
      currentWorldHover = slug;
    }
  } else {
    mapPanel.style.cursor = '';
    if (currentWorldHover && worldHoverEls[currentWorldHover]) {
      worldHoverEls[currentWorldHover].style.opacity = '0';
    }
    currentWorldHover = null;
  }
}

function worldPointerUp(e) {
  if (!worldDragStart && !worldDidDrag) return;
  const wasDrag = worldDidDrag;
  worldDragStart = null;
  worldDidDrag = false;

  // Ignore drags
  if (wasDrag) return;
  if (worldLocked || !worldTarget) return;

  const mapRect = baseMap.getBoundingClientRect();
  const scaleX = worldMapW / mapRect.width;
  const scaleY = worldMapH / mapRect.height;
  const px = Math.round((e.clientX - mapRect.left) * scaleX);
  const py = Math.round((e.clientY - mapRect.top) * scaleY);

  if (px < 0 || px >= worldMapW || py < 0 || py >= worldMapH) return;

  const clicked = detectContinent(px, py);
  if (!clicked) return;

  // Free navigation: always enter the clicked continent (no wrong penalty here)
  detachContinentHovers();
  enterWorldRegion(clicked.slug);
}

async function enterWorldRegion(slug) {
  worldPhase = 'region';
  worldTargetRegion = slug;

  // Remove world map handlers
  mapPanel.removeEventListener('pointerdown', worldPointerDown);
  mapPanel.removeEventListener('pointermove', worldPointerMove);
  mapPanel.removeEventListener('pointerup', worldPointerUp);
  mapPanel.removeEventListener('pointercancel', worldPointerUp);
  mapPanel.removeEventListener('wheel', onWheel);

  const config = worldConfigs[slug];
  const cache = worldRegionCache[slug];

  // Set globals for this region
  COUNTRIES = config.countries;
  MAP_LEFT = config.mapLeft;
  MAP_TOP = config.mapTop;
  MAP_W = config.mapW;
  MAP_H = config.mapH;
  IMAGE_ASSOCIATIONS = config.imageAssociations;
  ASSET_BASE = config.assetBase;
  IMAGE_EXT = config.imageExt;
  MAP_FILE = config.mapFile;
  OVERLAY_FILE = config.overlayFile;
  SPECIAL_SHAPES = config.specialShapes;

  // Load base map and wait for it to render (needed for correct overlay positioning)
  baseMap.src = MAP_FILE;
  await new Promise(resolve => {
    if (baseMap.complete && baseMap.naturalWidth > 0) resolve();
    else baseMap.onload = resolve;
  });

  // Reset zoom/pan
  zoom = 1; panX = 0; panY = 0;
  applyTransform();

  // Restore cached DOM elements and state
  cache.domElements.forEach(el => mapWrapper.appendChild(el));
  Object.assign(overlayEls, cache.overlayEls);
  Object.assign(hoverEls, cache.hoverEls);
  Object.assign(markerEls, cache.markerEls);
  Object.assign(hitPixelData, cache.hitPixelData);
  sortedCountries = cache.sortedCountries;
  cache.noHover.forEach(v => NO_HOVER.add(v));

  positionOverlays();

  // Reveal countries the player has already found in this region
  revealed.clear();
  for (const q of worldQuestions) {
    if (q.found && (q.region === slug || (q.altRegions && q.altRegions.includes(slug)))) {
      revealCountry(q.country.filename);
    }
  }

  // Attach region event listeners
  mapPanel.addEventListener('pointerdown', onPointerDown);
  mapPanel.addEventListener('pointermove', onPointerMove);
  mapPanel.addEventListener('pointerup', onPointerUp);
  mapPanel.addEventListener('pointercancel', onPointerUp);
  mapPanel.addEventListener('wheel', onWheel, { passive: false });

  // Clear any leftover seterra feedback from world hub
  seterraFeedback.className = 'seterra-feedback';
  seterraFeedback.innerHTML = '';

  // Show back bar
  const regionName = config.name;
  document.querySelector('header h1').textContent = regionName;
  headerHint.textContent = 'Hitta landet på kartan!';
  document.getElementById('world-back-bar').style.display = '';
  document.getElementById('world-region-label').textContent = regionName;

  // Set up as seterra target within this region
  seterraTarget = worldTarget.country;
  seterraTargetName.textContent = worldTarget.country.name;
  cursorLabel.textContent = worldTarget.country.name;
  cursorLabel.style.display = 'block';
  seterraTargetMisses = 0;
}

function nextWorldQuestion() {
  if (worldQueueIndex >= worldQuestions.length) {
    endWorldTest();
    return;
  }
  worldTarget = worldQuestions[worldQueueIndex];
  seterraTargetName.textContent = worldTarget.country.name;
  cursorLabel.textContent = worldTarget.country.name;
  cursorLabel.style.display = 'block';
  seterraFeedback.className = 'seterra-feedback';
  seterraFeedback.innerHTML = '';
  seterraTargetMisses = 0;
  updateWorldUI();
}

function worldSeterraClick(c) {
  if (!worldTarget || seterraLocked || worldPhase !== 'region') return;

  // Check if the clicked country is the target
  // For cross-region countries, the target may exist in multiple regions
  const isCorrect = c.filename === worldTarget.country.filename ||
    (worldTarget.altRegions && worldTarget.altRegions.includes(worldTargetRegion) &&
     c.filename === worldTarget.country.filename);

  if (isCorrect) {
    // Correct!
    worldCorrect++;
    worldTarget.found = true;
    revealCountry(c.filename);

    const assoc = IMAGE_ASSOCIATIONS[c.filename];
    seterraFeedback.className = 'seterra-feedback correct-fb';
    seterraFeedback.innerHTML = `<div class="fb-banner correct-banner">RÄTT!</div><div class="fb-title">${escHtml(c.name)}</div>${assoc ? `<div class="assoc-box">${escHtml(assoc)}</div>` : ''}<div class="fb-desc">${escHtml(c.desc)}</div>`;

    worldQueueIndex++;
    updateWorldUI();

    // Always go back to world hub for next question
    seterraLocked = true;
    setTimeout(() => {
      seterraLocked = false;
      showWorldHub();
      nextWorldQuestion();
    }, 1200);
  } else {
    // Wrong country — count as wrong and move to next question
    worldWrong++;
    worldMissedCountries.add(worldTarget.country.filename);
    flashWrong(c.filename);

    const assoc = IMAGE_ASSOCIATIONS[c.filename];
    seterraFeedback.className = 'seterra-feedback wrong-fb';
    seterraFeedback.innerHTML = `<div class="fb-banner wrong-banner">FEL!</div><div class="fb-title">${escHtml(worldTarget.country.name)}</div><div class="fb-desc">Det var ${escHtml(c.name)}</div>`;

    worldQueueIndex++;
    updateWorldUI();

    // Go back to world hub with next question
    seterraLocked = true;
    setTimeout(() => {
      seterraLocked = false;
      showWorldHub();
      nextWorldQuestion();
    }, 1200);
  }
}

function updateWorldUI() {
  // Score = (total - wrong) / total * 100 (max one wrong per country)
  const score = worldTotal > 0 ? Math.round(((worldTotal - worldWrong) / worldTotal) * 100) : 100;
  seterraScoreEl.textContent = score + '%';
  seterraCorrectEl.textContent = worldCorrect;
  seterraWrongEl.textContent = worldWrong;
  const answered = worldCorrect + worldWrong;
  const pct = Math.round((answered / worldTotal) * 100);
  seterraBar.style.width = pct + '%';
  seterraProgressLabel.textContent = `${answered} / ${worldTotal}`;
}

function updateWorldTimer() {
  const elapsed = Math.floor((Date.now() - worldStartTime) / 1000);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  seterraTimeEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
}

function endWorldTest() {
  clearInterval(worldTimerInterval);
  worldPhase = 'done';
  worldTarget = null;
  cursorLabel.style.display = 'none';

  // Remove any remaining event listeners
  mapPanel.removeEventListener('pointerdown', worldPointerDown);
  mapPanel.removeEventListener('pointermove', worldPointerMove);
  mapPanel.removeEventListener('pointerup', worldPointerUp);
  mapPanel.removeEventListener('pointercancel', worldPointerUp);

  const score = worldTotal > 0 ? Math.round(((worldTotal - worldWrong) / worldTotal) * 100) : 100;
  const elapsed = Math.floor((Date.now() - worldStartTime) / 1000);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;

  seterraGame.classList.remove('active');
  seterraDone.classList.add('active');
  document.getElementById('seterra-final-score').textContent = score + '%';
  document.getElementById('seterra-final-detail').innerHTML =
    `${worldCorrect} av ${worldTotal} länder<br>${worldWrong} fel<br>Tid: ${m}:${s.toString().padStart(2, '0')}`;

  document.getElementById('world-back-bar').style.display = 'none';
  headerHint.textContent = '';

  // High score handling
  HS_KEY = 'world-highscores';
  seterraCorrect = worldCorrect;
  seterraWrong = worldWrong;
  seterraTotal = worldTotal;
  seterraElapsed = elapsed;
  seterraMissedCountries = worldMissedCountries;
  seterraIsRetry = false;

  const retryBtn = document.getElementById('seterra-retry');
  retryBtn.style.display = 'none';

  document.getElementById('hs-form').style.display = 'none';
  document.getElementById('hs-saved-msg').style.display = 'none';

  if (score === 100 && worldTotal >= 50) {
    showCelebration(elapsed, m, s);
  } else {
    showNameModal(score, m, s);
  }
}

// ── Confetti engine ──
function startConfetti(canvas) {
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const colors = ['#ff4444', '#ffdd00', '#44bb44', '#4488ff', '#ff44ff', '#ff8800', '#00ddff', '#ffd700'];
  const pieces = [];
  for (let i = 0; i < 200; i++) {
    pieces.push({
      x: Math.random() * canvas.width,
      y: Math.random() * -canvas.height,
      w: 6 + Math.random() * 8,
      h: 4 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      speed: 1.5 + Math.random() * 3,
      drift: (Math.random() - 0.5) * 1.5,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.15,
    });
  }
  let running = true;
  function draw() {
    if (!running) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of pieces) {
      p.y += p.speed;
      p.x += p.drift;
      p.rot += p.rotSpeed;
      if (p.y > canvas.height) { p.y = -10; p.x = Math.random() * canvas.width; }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    requestAnimationFrame(draw);
  }
  draw();
  return () => { running = false; ctx.clearRect(0, 0, canvas.width, canvas.height); };
}

function showCelebration(elapsed, m, s) {
  const overlay = document.getElementById('celebration-overlay');
  document.getElementById('celebration-detail').innerHTML =
    `${worldCorrect} av ${worldTotal} länder &bull; 0 fel &bull; ${m}:${s.toString().padStart(2, '0')}`;
  overlay.classList.add('active');

  // Start confetti rain
  const confettiCanvas = document.getElementById('confetti-canvas');
  const stopConfetti = startConfetti(confettiCanvas);

  // Play celebration music
  const celebMusic = new Audio('CELEBRATION.mp3');
  celebMusic.loop = true;
  celebMusic.volume = 0.7;
  celebMusic.play().catch(() => {});

  // Jonas high-five animation
  const jonasEl = document.getElementById('celebration-jonas-img');
  let toggle = false;
  const jonasInterval = setInterval(() => {
    toggle = !toggle;
    jonasEl.src = toggle ? 'Jonas_2.webp' : 'Jonas_1.webp';
  }, 300);

  // Play high-five sound repeatedly
  const celebAudio = new Audio('high_five.wav');
  celebAudio.play().catch(() => {});
  const soundInterval = setInterval(() => {
    celebAudio.currentTime = 0;
    celebAudio.play().catch(() => {});
  }, 800);

  const closeBtn = document.getElementById('celebration-close');
  const closeFn = () => {
    clearInterval(jonasInterval);
    clearInterval(soundInterval);
    stopConfetti();
    celebMusic.pause();
    celebMusic.currentTime = 0;
    overlay.classList.remove('active');
    jonasEl.src = 'Jonas_1.webp';
    closeBtn.removeEventListener('click', closeFn);

    // Now show name modal
    showNameModal(100, m, s);
  };
  closeBtn.addEventListener('click', closeFn);
}

document.getElementById('world-back-btn').addEventListener('click', () => {
  showWorldHub();
});

// ══════════════════════════════════
// Bootstrap
// ══════════════════════════════════
(async () => {
  const params = new URLSearchParams(window.location.search);
  const region = params.get('region');

  if (region === 'world') {
    try {
      await startWorldTest();
    } catch (e) {
      console.error('Failed to start world test:', e);
      showRegionSelector();
    }
  } else if (region) {
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
