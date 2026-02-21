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
  if (e.target.closest('.zoom-controls')) return;
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
