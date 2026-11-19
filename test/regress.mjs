// Regressionssvit för globspelet. Kräver playwright-core + chromium och en
// statisk server på :8099:  npx http-server . -p 8099 -s
// Kör:  TESTV=<dataversion> node test/regress.mjs
import { chromium } from 'playwright-core';
const BASE = process.env.TESTBASE || 'http://127.0.0.1:8099';
const V = process.env.TESTV || '19';
const results = [];
const ok = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
await page.addInitScript("localStorage.setItem('rundtur-klar','1'); localStorage.setItem('kakval','nej'); localStorage.setItem('feedback-tips-klar','1')");
const pageErrors = [];
const reqUrls = [];
page.on('pageerror', e => pageErrors.push(String(e)));
page.on('request', r => reqUrls.push(r.url()));
await page.goto(BASE + '/glob.html?region=world', { waitUntil: 'domcontentloaded' });
await page.waitForFunction("typeof map !== 'undefined' && map && map.loaded && map.loaded()", null, { timeout: 30000 });
const relevantErrors = pageErrors.filter(e => !/firebase/i.test(e));
ok('inga JS-fel vid laddning', relevantErrors.length === 0, relevantErrors.join(' | ').slice(0, 200));
const has = (frag) => reqUrls.some(u => u.includes(frag));
ok(`datafiler v=${V}`, has(`art-regions.json?v=${V}`) && has(`art-markers.json?v=${V}`) && has(`art-borders.json?v=${V}`));
ok('tiles kvar på v=3', has('world.pmtiles?v=3') && !has(`world.pmtiles?v=${V}`));
ok('tileSize 256', (await page.evaluate("map.getSource('art').tileSize")) === 256);
await page.click('#world-start-btn');
await page.waitForTimeout(1500);
await page.evaluate("map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 })");
const malta = await page.evaluate(`(() => {
  const m = markerPts.find(p => p.gid === 2);
  setLand(2, { tackt: true, fel: true, gron: false, tips: false });
  return m ? { lng: m.lng, lat: m.lat } : null;
})()`);
ok('Malta-markör finns', !!malta);
async function grabRow(zoom) {
  await page.evaluate(`(() => {
    map.jumpTo({ center: [${malta.lng}, ${malta.lat}], zoom: ${zoom} });
    return new Promise(res => { map.once('idle', res); setTimeout(res, 8000); });
  })()`);
  await page.waitForTimeout(300);
  const box = await page.locator('canvas').first().boundingBox();
  const buf = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const cx = Math.round(img.width / 2), cy = Math.round(img.height / 2);
    const row = ctx.getImageData(0, cy, img.width, 1).data;
    const red = x => { const r = row[x*4], g = row[x*4+1], b = row[x*4+2];
                       return r > 170 && g < 130 && b < 130; };
    let min = -1, max = -2, run = 0, maxRun = 0;
    for (let x = Math.max(0, cx - 80); x < Math.min(img.width, cx + 80); x++) {
      if (red(x)) { if (min < 0) min = x; max = x; run++; if (run > maxRun) maxRun = run; }
      else run = 0;
    }
    return { extent: max >= min && min >= 0 ? max - min + 1 : 0, maxRun };
  }, buf.toString('base64'));
}
const redBlobWidth = async z => (await grabRow(z)).extent;
const w4 = await redBlobWidth(4);
const w5 = await redBlobWidth(5);
const ratio = w5 / Math.max(w4, 1);
ok('cirkeln geografiskt fast', w4 > 8 && ratio > 1.6 && ratio < 2.4, `z4=${w4} z5=${w5}`);
const w2 = await redBlobWidth(2);
const w3 = await redBlobWidth(3);
const rUt = w3 / Math.max(w2, 1);
ok('ingen minsta-klamp', w2 >= 3 && w2 <= 10 && rUt > 1.4 && rUt < 2.9, `z2=${w2} z3=${w3}`);
const solid = await grabRow(5);
ok('cirkeln helt tät', solid.maxRun >= solid.extent * 0.9 && solid.extent > 20, `${solid.maxRun}/${solid.extent}`);
const hitsAt = (lng, lat) => page.evaluate(
  `map.queryRenderedFeatures(map.project([${lng}, ${lat}]), { layers: ['prickar'] }).length`);
const hitCovered = await hitsAt(malta.lng, malta.lat);
await page.evaluate("setLand(2, { tackt: false, fel: false })");
await page.waitForTimeout(600);
ok('täckt träffbar / avslöjad fri', hitCovered > 0 && (await hitsAt(malta.lng, malta.lat)) === 0);
async function prickHit(gid, lng, lat, zoom) {
  await page.evaluate(`setLand(${gid}, { tackt: true, gron: false, fel: false, tips: false })`);
  await page.evaluate(`(() => {
    map.jumpTo({ center: [${lng}, ${lat}], zoom: ${zoom} });
    return new Promise(res => { map.once('idle', res); setTimeout(res, 8000); });
  })()`);
  await page.waitForTimeout(300);
  const n = await hitsAt(lng, lat);
  await page.evaluate(`setLand(${gid}, { tackt: false })`);
  return n;
}
ok('Ukraina aldrig prick', (await prickHit(1, 31.32, 49.20, 1.4)) === 0 && (await prickHit(1, 31.32, 49.20, 5)) === 0);
// Malta blev emblem i v3-arkivet (konsten har inte öns form) — emblemens
// prick ska tvärtom ALDRIG försvinna, hur långt in man än zoomar
ok('Malta prick z5 och kvar z7 (emblem)', (await prickHit(2, 14.211, 34.342, 5)) > 0 && (await prickHit(2, 14.211, 34.342, 7)) > 0);
ok('Vatikanen prick kvar z7', (await prickHit(36, 12.43, 41.90, 7)) > 0);
async function darkPix(gid, lng, lat, tackt) {
  await page.evaluate(`setLand(${gid}, { tackt: ${tackt}, gron: false, fel: false, tips: false })`);
  await page.evaluate(`(() => {
    map.jumpTo({ center: [${lng}, ${lat}], zoom: 6.2 });
    return new Promise(res => { map.once('idle', res); setTimeout(res, 8000); });
  })()`);
  await page.waitForTimeout(400);
  const box = await page.locator('canvas').first().boundingBox();
  const buf = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const cx = Math.round(img.width / 2), cy = Math.round(img.height / 2);
    const d = ctx.getImageData(cx - 90, cy - 90, 180, 180).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] < 45 && d[i+1] < 45 && d[i+2] < 45 && Math.abs(d[i+2] - d[i]) < 12) n++;
    }
    return n;
  }, buf.toString('base64'));
}
const smT = await darkPix(38, 12.46, 43.94, true);
const smA = await darkPix(38, 12.46, 43.94, false);
ok('San Marino-konturen släcks', smA > 50 && smT < smA * 0.45, `${smT} vs ${smA}`);
const vaT = await darkPix(36, 12.43, 41.90, true);
const vaA = await darkPix(36, 12.43, 41.90, false);
ok('Vatikan-konturen släcks', vaA > 50 && vaT < vaA * 0.45, `${vaT} vs ${vaA}`);
const fr = await page.evaluate(`(() => {
  const f = regionsGj.features.find(f => f.properties.namn === 'Frankrike');
  setLand(f.id, { tackt: true, gron: false });
  return f.id;
})()`);
await page.evaluate(`(() => {
  map.jumpTo({ center: [2.4, 47.0], zoom: 4.5 });
  return new Promise(res => { map.once('idle', res); setTimeout(res, 8000); });
})()`);
await page.waitForTimeout(400);
const hoverProbe = async () => {
  const box = await page.locator('canvas').first().boundingBox();
  const buf = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const cx = Math.round(img.width/2), cy = Math.round(img.height/2);
    const d = ctx.getImageData(cx-60, cy-60, 120, 120).data;
    let dark = 0, n = 0, rs = 0;
    for (let i = 0; i < d.length; i += 4) { n++; rs += d[i]; if (d[i]<100 && d[i+1]<100 && d[i+2]<100) dark++; }
    return { darkFrac: dark/n, avgR: rs/n };
  }, buf.toString('base64'));
};
const utan = await hoverProbe();
await page.evaluate(`setLand(${fr}, { hover: true })`);
await page.waitForTimeout(500);
const med = await hoverProbe();
await page.evaluate(`setLand(${fr}, { hover: false, tackt: false })`);
ok('hover opak utan skuggbild', med.darkFrac <= utan.darkFrac + 0.005 && med.avgR > 200);
await page.evaluate(`switchMode('seterra', true); startSeterra()`);
await page.waitForTimeout(900);
const fb = await page.evaluate(`(() => {
  const t = seterraTarget;
  seterraClick(aktivByGid.get(t.gid));
  const img = seterraFeedback.querySelector('.fb-shape img');
  return { src: img ? img.getAttribute('src') : null, cls: seterraFeedback.className };
})()`);
ok('quizfeedback med bild', !!fb.src && fb.cls.includes('correct-fb'));
const dom = await page.evaluate(`(() => {
  const side = document.querySelector('#info-card .info-side');
  const assoc = document.getElementById('info-assoc');
  const counter = document.querySelector('#info-card .counter');
  const toggle = document.getElementById('info-toggle');
  const order = assoc && toggle && (assoc.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING);
  showInfoCard({ slug: 'test', filename: 'x', gid: 999, name: 'T', assoc: 'M', desc: 'D' });
  const shownWith = assoc.style.display !== 'none';
  showInfoCard({ slug: 'test', filename: 'x', gid: 998, name: 'U', assoc: '', desc: 'D' });
  return { inSide: !!(side && assoc && side.contains(assoc)), counterInCard: !!counter,
           order: !!order, shownWith, hiddenWithout: assoc.style.display === 'none' };
})()`);
ok('infokortet rätt', dom.inSide && dom.order && dom.shownWith && dom.hiddenWithout && dom.counterInCard);
// ── råkade svar vid rotation ──
// ett tryck som roterar globen (eller fångar in en som glider) får aldrig
// räknas som ett landklick; ett vanligt klick måste räknas precis som förr
await page.evaluate(`(() => { switchMode('seterra', true); startSeterra(); })()`);
await page.waitForTimeout(700);
// landmarkörerna ligger mitt i länderna → skärmpunkten fås direkt ur
// projektionen, snabbt nog att användas mitt under en pågående rörelse
const landPunkt = () => page.evaluate(`(() => {
  const cv = map.getCanvas(), r = cv.getBoundingClientRect();
  for (const m of markerPts) {
    if (revealed.has(m.gid)) continue;
    const p = map.project([m.lng, m.lat]);
    if (p.x < 60 || p.x > 640 || p.y < 60 || p.y > cv.clientHeight - 60) continue;
    const h = map.queryRenderedFeatures([p.x, p.y], { layers: ['prickar', 'former', 'cover'] });
    if (h.length && h[0].id === m.gid) return { x: r.left + p.x, y: r.top + p.y };
  }
  return null;
})()`);
const svarAntal = () => page.evaluate('seterraCorrect + seterraWrong');
const stilla = async () => {
  await page.waitForFunction('!map.isMoving() && !seterraLocked', null, { timeout: 10000 });
  await page.waitForTimeout(200);
};
await stilla();
const glidFore = await svarAntal();
// OBS: får inte returnera map-objektet — serialiseringen tar sekunder
await page.evaluate(`(() => { map.easeTo({ center: [map.getCenter().lng + 2, map.getCenter().lat],
                                            duration: 4000, essential: true }); })()`);
await page.waitForTimeout(150);
const glidP = await landPunkt();                       // punkten hämtas i rörelsen
const gledVidKlick = await page.evaluate('map.isMoving()');
await page.mouse.click(glidP.x, glidP.y);
await page.waitForTimeout(500);
ok('klick på glidande glob ger inget svar',
  gledVidKlick && (await svarAntal()) === glidFore, gledVidKlick ? '' : 'globen stod still');
await stilla();
const klickP = await landPunkt();
const klickFore = await svarAntal();
await page.mouse.click(klickP.x, klickP.y);
await page.waitForTimeout(500);
ok('vanligt klick registreras ändå', (await svarAntal()) === klickFore + 1);
try {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await stilla();
  const gP = await landPunkt();
  const gFore = await svarAntal();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: gP.x, y: gP.y }] });
  for (let i = 1; i <= 4; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: gP.x + i * 3, y: gP.y }] });
    await page.waitForTimeout(25);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
  ok('12 px fingerglid ger inget svar', (await svarAntal()) === gFore);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
} catch (e) {
  ok('12 px fingerglid ger inget svar', false, String(e).slice(0, 140));
}

// ── kakrutan: visas utan val, "ja" sparas och rutan kommer inte igen ──
// (PostHog laddas aldrig lokalt — rutan och valet är rena spelet)
try {
  const kp = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  await kp.addInitScript("localStorage.setItem('rundtur-klar','1'); localStorage.setItem('feedback-tips-klar','1')");
  await kp.goto(BASE + '/glob.html', { waitUntil: 'domcontentloaded' });
  await kp.waitForSelector('#kakruta.inne', { timeout: 20000 });
  ok('kakrutan visas utan val', true);
  ok('kakan ligger i handen', await kp.evaluate(
    "document.querySelector('.kak-kaka svg') !== null"));
  await kp.click('#kak-ja');
  await kp.waitForTimeout(700);
  ok('ja-valet sparas', await kp.evaluate("localStorage.getItem('kakval')") === 'ja');
  await kp.goto(BASE + '/glob.html', { waitUntil: 'domcontentloaded' });
  await kp.waitForTimeout(2200);
  ok('rutan kommer inte tillbaka efter val', await kp.evaluate("!document.getElementById('kakruta')"));
  await kp.close();
} catch (e) {
  ok('kakrutan visas utan val', false, String(e).slice(0, 140));
}

// ── turordningen: rundturen går före kakfrågan för nya besökare ──
try {
  const tp = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  await tp.goto(BASE + '/glob.html', { waitUntil: 'domcontentloaded' });   // INGEN rundtur-klar
  await tp.waitForFunction("document.getElementById('intro-overlay').style.display !== 'none'",
    null, { timeout: 40000 });
  await tp.waitForTimeout(1800);   // kakrutans egen fördröjning har passerat
  ok('kakrutan väntar medan rundturen pågår', await tp.evaluate("!document.getElementById('kakruta')"));
  await tp.click('#intro-hoppa');
  await tp.waitForSelector('#kakruta.inne', { timeout: 8000 });
  ok('kakrutan kommer när rundturen hoppats över', true);
  await tp.close();
} catch (e) {
  ok('kakrutan väntar medan rundturen pågår', false, String(e).slice(0, 140));
}

// ── v72: topplistegolv från serverreglerna, tiondelar och placeringsbesked ──
try {
  const sp = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  await sp.addInitScript("localStorage.setItem('rundtur-klar','1'); localStorage.setItem('speltur-klar','1'); localStorage.setItem('kakval','nej'); localStorage.setItem('feedback-tips-klar','1')");
  await sp.goto(BASE + '/glob.html?region=sydamerika', { waitUntil: 'domcontentloaded' });
  // vänta på SPELET, inte kartans idle: på en blixtsnabb lokal server kan
  // förladdningens arkivbyte hålla kartan i evig omritning (når aldrig
  // loaded()) — kontrollerna här behöver bara regiondatan, inte rutorna
  await sp.waitForFunction("document.getElementById('spel-load').style.display === 'none'" +
    " && typeof rimligMinTid === 'function' && typeof HS_KEY === 'string' && HS_KEY.includes('sydamerika')",
    null, { timeout: 30000 });
  // klienten får aldrig vara strängare än database.rules.json — riktiga
  // blixtrundor (Sydamerika 13 s) försvann när golvet låg på 1 s/land
  ok('golvet speglar servern (Sydamerika 10 s)', await sp.evaluate('rimligMinTid()') === 10);
  ok('fmtTid: tiondelar med komma', await sp.evaluate(
    "fmtTid(13.7) === '0:13,7' && fmtTid(13) === '0:13' && fmtTid(83.4) === '1:23,4' && fmtTid(5.96) === '0:06'"));
  // utmaningsknappen ska ligga FÖRE topp 30-listan (ingen hittade den längst ner)
  ok('utmana-knappen ovanför topplistan', await sp.evaluate(`(() => {
    const b = document.getElementById('utmana-btn'), l = document.getElementById('highscore-list');
    return !!b && !!l && !!(b.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING)
      && b.classList.contains('utmana-lyft');
  })()`));
  // simulerad runda: 15,4 s och 9 fel i en region med (injicerade) delar
  await sp.evaluate(`(() => {
    switchMode('seterra', true); startSeterra();
    configCache[aktivSlug] = Object.assign({}, configCache[aktivSlug],
      { delar: [{ id: 'test', namn: 'Testdel', lander: ['Brasilien'] }] });
    seterraStartTime = Date.now() - 15400;
    seterraCorrect = seterraTotal; seterraWrong = 9;
    endSeterra();
  })()`);
  await sp.waitForTimeout(400);
  ok('tiondelar i resultatet', /Tid: 0:15,[34]/.test(
    await sp.evaluate("document.getElementById('seterra-final-detail').textContent")));
  ok('öva-del-tips vid många fel', await sp.evaluate(
    "document.getElementById('ova-del-btn').style.display !== 'none'"));
  await sp.evaluate("document.getElementById('ova-del-btn').click()");
  await sp.waitForTimeout(400);
  ok('öva-del-tips öppnar delväljaren', await sp.evaluate(
    "delOverlay.classList.contains('active')"));
  await sp.evaluate("delOverlay.classList.remove('active')");
  // rundan hamnar under 31 fejkade hundringar → plats-beskedet.
  // (sparaflödet går inte att köra på 127.0.0.1 — debugspärren window.spel
  // stoppar all sparning där — så listorna byggs direkt i lagringen)
  const notis = await sp.evaluate(`(async () => {
    const fejk = [];
    for (let i = 0; i < 31; i++) fejk.push({ name: 'Fejk' + i, score: 100, time: 13, wrong: 0, date: 1700000000000 + i });
    localStorage.setItem('cache-' + HS_KEY, JSON.stringify(fejk));
    const entry = { name: 'Testbarn', score: 59, time: 15.4, wrong: 9, date: Date.now() };
    localStorage.setItem('mina-' + HS_KEY, JSON.stringify([entry]));
    await renderHighscores(entry);
    const el = document.querySelector('#highscore-list .hs-plats');
    return el ? el.textContent : '(ingen notis)';
  })()`);
  ok('placeringsbesked utanför topp 30', /plats 32 av 32/.test(notis), notis.slice(0, 90));
  // under golvet: rundan avvisas men spelaren får veta VARFÖR
  const blixt = await sp.evaluate(`(async () => {
    startSeterra();
    seterraStartTime = Date.now() - 8200;   // 8,2 s < golvet 10 s
    seterraCorrect = seterraTotal; seterraWrong = 3;
    endSeterra();
    const entry = await sparaMedNamn('Testbarn');
    await renderHighscores(entry);
    const el = document.querySelector('#highscore-list .hs-plats');
    return { entry: entry === null, text: el ? el.textContent : '(ingen notis)' };
  })()`);
  ok('blixtrunda under golvet avvisas med besked',
    blixt.entry && /Blixtsnabbt/.test(blixt.text), blixt.text.slice(0, 90));
  await sp.close();
} catch (e) {
  ok('golvet speglar servern (Sydamerika 10 s)', false, String(e).slice(0, 140));
}

// ── v96: Länder/Huvudstäder i quizen (bara svenska sajten) ──
// Huvudstadsrundorna har egna topplistor (prefixet huvudstad-, samma
// tidsgolv), egna medaljer, ingen passtämpel och ingen utmaning
try {
  const INIT_LS = "localStorage.setItem('rundtur-klar','1'); localStorage.setItem('speltur-klar','1'); localStorage.setItem('kakval','nej'); localStorage.setItem('feedback-tips-klar','1')";
  const hp = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  await hp.addInitScript(INIT_LS);
  await hp.goto(BASE + '/glob.html?region=sydamerika', { waitUntil: 'domcontentloaded' });
  await hp.waitForFunction("document.getElementById('spel-load').style.display === 'none'" +
    " && typeof HS_KEY === 'string' && HS_KEY.includes('sydamerika') && HUVUDSTAD.size > 0",
    null, { timeout: 30000 });
  const r = await hp.evaluate(`(() => {
    switchMode('seterra', true);
    const vaxel = document.getElementById('fraga-val');
    const landForst = vaxel.style.display !== 'none' && !huvudstadslage
      && HS_KEY === 'glob-sydamerika-highscores';
    document.querySelector('#fraga-val [data-fraga="huvudstad"]').click();
    const hs = HUVUDSTAD.get(seterraTarget.namnSv);
    const fraga = document.getElementById('seterra-target-name').textContent;
    seterraHintBtn.click();
    const ledtrad = document.getElementById('seterra-hint');
    const em = !!ledtrad.querySelector('em') && ledtrad.classList.contains('hs-ledtrad');
    seterraClick(seterraTarget);
    const fb = seterraFeedback.innerHTML;
    return { landForst, lage: huvudstadslage, key: HS_KEY, sparat: localStorage.getItem('quiz-fraga'),
      fragaOk: !!hs && fraga === hs.huvudstad, em, golv: rimligMinTid(),
      fb: /är huvudst(ad|äder) i/.test(fb) && fb.includes('hs-box') && !fb.includes('fb-desc') };
  })()`);
  ok('huvudstadsväxeln syns och byter läge', r.landForst && r.lage && r.sparat === 'huvudstad', JSON.stringify(r).slice(0, 160));
  ok('huvudstäder: egen topplista, samma golv',
    r.key === 'huvudstad-glob-sydamerika-highscores' && r.golv === 10, r.key);
  ok('huvudstäder: frågar efter huvudstaden', r.fragaOk);
  ok('huvudstäder: ledtråden är huvudstadens regel (kursiv)', r.em);
  ok('huvudstäder: feedback "X är huvudstad i Y"', r.fb);
  // simulerad 100 %-runda
  const slut = await hp.evaluate(`(() => {
    startSeterra();
    seterraStartTime = Date.now() - 30000;
    seterraCorrect = seterraTotal; seterraWrong = 0;
    endSeterra();
    return { medalj: localStorage.getItem('medalj-huvudstad-sydamerika'),
      land: localStorage.getItem('medalj-sydamerika'), resa: localStorage.getItem('varldsresa'),
      utmana: document.getElementById('utmana-btn').style.display,
      diplom: document.getElementById('seterra-diplom').style.display,
      text: document.getElementById('seterra-final-detail').textContent };
  })()`);
  ok('huvudstäder: egen medalj, ingen stämpel eller utmaning',
    slut.medalj === '100' && slut.land === null && slut.resa === null && slut.utmana === 'none'
    && slut.diplom !== 'none' && /13 av 13 huvudstäder/.test(slut.text) && /Passtämpeln/.test(slut.text),
    JSON.stringify(slut).slice(0, 200));
  // tillbaka till Länder: som förut
  const tillbaka = await hp.evaluate(`(() => {
    document.querySelector('#fraga-val [data-fraga="land"]').click();
    return { key: HS_KEY, lage: huvudstadslage, sparat: localStorage.getItem('quiz-fraga'),
      fraga: document.getElementById('seterra-target-name').textContent === seterraTarget.name,
      hitta: document.getElementById('hitta-ord').textContent };
  })()`);
  ok('huvudstäder: tillbaka till Länder', tillbaka.key === 'glob-sydamerika-highscores' && !tillbaka.lage
    && tillbaka.sparat === 'land' && tillbaka.fraga && tillbaka.hitta === 'Hitta detta land:', JSON.stringify(tillbaka));
  await hp.close();
  // USA: ingen växel och inga huvudstadslistor, även med Huvudstäder valt
  const up = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  await up.addInitScript(INIT_LS + "; localStorage.setItem('quiz-fraga','huvudstad')");
  await up.goto(BASE + '/glob.html?region=usa', { waitUntil: 'domcontentloaded' });
  await up.waitForFunction("document.getElementById('spel-load').style.display === 'none'" +
    " && typeof HS_KEY === 'string' && HS_KEY.includes('usa') && COUNTRIES.length >= 50",
    null, { timeout: 60000 });
  const usa = await up.evaluate(`(() => {
    switchMode('seterra', true);
    return { vis: document.getElementById('fraga-val').style.display, lage: huvudstadslage, key: HS_KEY,
      fraga: document.getElementById('seterra-target-name').textContent === seterraTarget.name };
  })()`);
  ok('usa: ingen huvudstadsväxel', usa.vis === 'none' && !usa.lage && usa.key === 'glob-usa-highscores' && usa.fraga,
    JSON.stringify(usa));
  await up.close();
} catch (e) {
  ok('huvudstadsväxeln syns och byter läge', false, String(e).slice(0, 140));
}

// ── v97: Bildquiz + Huvudstäder som på Seterra (klicka på staden) ──
// Vita cirklar där huvudstäderna ligger, landbilderna avslagna från start
// (knapp för att slå på dem), riktiga musklick på globen avgör svaret
try {
  const INIT_LS = "localStorage.setItem('rundtur-klar','1'); localStorage.setItem('speltur-klar','1'); localStorage.setItem('kakval','nej'); localStorage.setItem('feedback-tips-klar','1'); localStorage.setItem('quiz-fraga','huvudstad')";
  const sp = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  await sp.addInitScript(INIT_LS);
  await sp.goto(BASE + '/glob.html?region=sydamerika', { waitUntil: 'domcontentloaded' });
  await sp.waitForFunction("document.getElementById('spel-load').style.display === 'none'" +
    " && typeof HS_KEY === 'string' && HS_KEY.includes('sydamerika') && HUVUDSTAD.size > 0 && !!map.getLayer('stad-mal')",
    null, { timeout: 30000 });
  const start = await sp.evaluate(`(() => {
    switchMode('bildquiz', true);
    const knapp = document.getElementById('stad-bilder-btn');
    return { stad: stadslage, key: HS_KEY, golv: rimligMinTid(), runda: stadRunda.size,
      knapp: knapp.style.display !== 'none' && knapp.textContent.includes('Visa landbilder'),
      tackta: COUNTRIES.every(c => landState(c.gid).tackt),
      hitta: document.getElementById('hitta-ord').textContent,
      fraga: document.getElementById('seterra-target-name').textContent
        === HUVUDSTAD.get(seterraTarget.namnSv).huvudstad };
  })()`);
  await sp.waitForTimeout(200);   // huvudstadDirty väntar en bildruta
  const lager = await sp.evaluate(`(() => ({
    prickar: map.getLayoutProperty('prickar', 'visibility'),
    mal: map.getFilter('stad-mal')[2][1].length }))()`);
  ok('städer: Bildquiz + Huvudstäder klickar på staden',
    start.stad && start.runda === 13 && start.fraga && start.hitta === 'Klicka på huvudstaden:'
    && lager.mal === 13 && lager.prickar === 'none', JSON.stringify({ ...start, ...lager }).slice(0, 200));
  ok('städer: egen topplista, samma golv', start.key === 'huvudstad-stad-glob-sydamerika-highscores' && start.golv === 10, start.key);
  ok('städer: landbilderna avslagna, knappen syns', start.tackta && start.knapp);
  // riktiga klick: kameran över frågans stad, ett fel på en annan stad
  // som syns på kartan, sedan rätt
  const pkt = await sp.evaluate(`(() => {
    const p = stadPunkt.get(seterraTarget.gid);
    map.jumpTo({ center: [p.lng, p.lat], zoom: 3 });
    const r = map.getCanvas().getBoundingClientRect();
    const skarm = g => { const q = stadPunkt.get(g), s = map.project([q.lng, q.lat]);
      return { x: r.left + s.x, y: r.top + s.y }; };
    const mal = skarm(seterraTarget.gid);
    let fel = null;
    for (const g of stadRunda) {
      if (g === seterraTarget.gid) continue;
      const s = skarm(g);
      if (Math.hypot(s.x - mal.x, s.y - mal.y) < 40) continue;
      if (document.elementFromPoint(s.x, s.y) !== map.getCanvas()) continue;
      fel = { ...s, gid: g, namn: HUVUDSTAD.get(aktivByGid.get(g).namnSv).huvudstad };
      break;
    }
    // en punkt i havet/landet långt från alla städer
    return { mal, fel, tom: { x: r.left + 30, y: r.top + r.height - 30 }, gid: seterraTarget.gid };
  })()`);
  await sp.waitForTimeout(300);
  await sp.mouse.click(pkt.tom.x, pkt.tom.y);
  await sp.mouse.click(pkt.fel.x, pkt.fel.y);
  const efterFel = await sp.evaluate(`({ fel: seterraWrong, ratt: seterraCorrect,
    fb: seterraFeedback.textContent,
    rod: !!map.getFeatureState({ source: 'huvudstader', id: ${pkt.fel.gid} }).fel })`);
  ok('städer: klick bredvid räknas inte, fel stad ger felklick',
    efterFel.fel === 1 && efterFel.ratt === 0 && efterFel.rod
    && efterFel.fb.includes('Det var ' + pkt.fel.namn + ', huvudstad'), JSON.stringify(efterFel).slice(0, 200));
  await sp.waitForTimeout(700);   // felklickets spärr
  await sp.mouse.move(pkt.mal.x + 2, pkt.mal.y + 1);
  const hover = await sp.evaluate(`!!map.getFeatureState({ source: 'huvudstader', id: ${pkt.gid} }).hover`);
  await sp.mouse.click(pkt.mal.x + 2, pkt.mal.y + 1);
  const efterRatt = await sp.evaluate(`({ ratt: seterraCorrect, fb: seterraFeedback.textContent,
    avtackt: !landState(${pkt.gid}).tackt && revealed.has(${pkt.gid}),
    svar: map.getFeatureState({ source: 'huvudstader', id: ${pkt.gid} }).svar })`);
  ok('städer: rätt stad avslöjar landet och färgar cirkeln',
    hover && efterRatt.ratt === 1 && efterRatt.avtackt && efterRatt.svar === 2
    && /är huvudst(ad|äder) i/.test(efterRatt.fb), JSON.stringify({ hover, ...efterRatt }).slice(0, 200));
  // dubbelklick och klick på en färdig cirkel: inget nytt svar (grannstaden
  // intill får inte klicket)
  await sp.mouse.click(pkt.mal.x + 2, pkt.mal.y + 1);
  await sp.waitForTimeout(500);
  await sp.mouse.click(pkt.mal.x, pkt.mal.y);
  const efterDubbel = await sp.evaluate(`({ ratt: seterraCorrect, fel: seterraWrong })`);
  ok('städer: klick på en hittad stad räknas inte', efterDubbel.ratt === 1 && efterDubbel.fel === 1,
    JSON.stringify(efterDubbel));
  // landbilderna på mitt i rundan: obesvarade länder visar bilden, och
  // rundan hamnar inte i topplistan
  const bilder = await sp.evaluate(`(() => {
    document.getElementById('stad-bilder-btn').click();
    const pa = COUNTRIES.every(c => !landState(c.gid).tackt);
    const txt = document.getElementById('stad-bilder-btn').textContent;
    seterraStartTime = Date.now() - 30000;
    seterraCorrect = seterraTotal; seterraWrong = 0; seterraQueue = [];
    endSeterra();
    return { pa, txt, med: rundanMedBilder, sparad: autoSparadLofte !== null,
      text: document.getElementById('seterra-final-detail').textContent,
      vidare: document.getElementById('seterra-vidare').textContent };
  })()`);
  ok('städer: landbilderna går att slå på, rundan sparas då inte',
    bilder.pa && bilder.txt.includes('Dölj landbilder') && bilder.med && !bilder.sparad
    && /hamnar inte i topplistan/.test(bilder.text) && /utan cirklar/.test(bilder.vidare),
    JSON.stringify(bilder).slice(0, 220));
  // ny runda utan bilder sparas; tillbaka till Utforska städar kartan
  const igen = await sp.evaluate(`(() => {
    document.getElementById('stad-bilder-btn').click();
    startSeterra();
    const tackta = COUNTRIES.every(c => landState(c.gid).tackt);
    seterraStartTime = Date.now() - 30000;
    seterraCorrect = seterraTotal; seterraWrong = 0; seterraQueue = [];
    endSeterra();
    const sparad = autoSparadLofte !== null;
    const textOk = !/hamnar inte/.test(document.getElementById('seterra-final-detail').textContent);
    switchMode('explore');
    return { tackta, sparad, textOk, stad: stadslage,
      knapp: document.getElementById('stad-bilder-btn').style.display };
  })()`);
  await sp.waitForTimeout(200);
  const utforska = await sp.evaluate(`({ prickar: map.getLayoutProperty('prickar', 'visibility'),
    mal: map.getFilter('stad-mal')[2][1].length, klar: map.getFilter('stad-klar')[2][1].length })`);
  ok('städer: runda utan bilder sparas, Utforska utan cirklar',
    igen.tackta && igen.sparad && igen.textOk && !igen.stad && igen.knapp === 'none'
    && utforska.prickar === 'visible' && utforska.mal === 0 && utforska.klar === 0,
    JSON.stringify({ ...igen, ...utforska }));
  // Klassiskt Quiz + Huvudstäder klickar fortfarande på landet
  const klassisk = await sp.evaluate(`(() => {
    switchMode('seterra', true);
    return { stad: stadslage, lage: huvudstadslage, key: HS_KEY, runda: stadRunda.size,
      knapp: document.getElementById('stad-bilder-btn').style.display,
      hitta: document.getElementById('hitta-ord').textContent };
  })()`);
  ok('städer: Klassiskt Quiz frågar fortfarande efter landet',
    !klassisk.stad && klassisk.lage && klassisk.key === 'huvudstad-glob-sydamerika-highscores'
    && klassisk.runda === 0 && klassisk.knapp === 'none' && klassisk.hitta.startsWith('Hitta landet'),
    JSON.stringify(klassisk));
  await sp.close();
} catch (e) {
  ok('städer: Bildquiz + Huvudstäder klickar på staden', false, String(e).slice(0, 160));
}

// ── v99: huvudstäderna på rätt bild + upptäck städerna i Utforska ──
// Kartan är tecknad: varje huvudstads prick ska ligga på det egna landets
// bild och inte på någon annans (Valletta låg på Sicilien). I Utforska går
// städerna att upptäcka som länderna: vit cirkel, klick visar staden.
try {
  const INIT_LS = "localStorage.setItem('rundtur-klar','1'); localStorage.setItem('speltur-klar','1'); localStorage.setItem('kakval','nej'); localStorage.setItem('feedback-tips-klar','1')";
  const up = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  await up.addInitScript(INIT_LS);
  await up.goto(BASE + '/glob.html?region=sydamerika', { waitUntil: 'domcontentloaded' });
  await up.waitForFunction("document.getElementById('spel-load').style.display === 'none'" +
    " && typeof HS_KEY === 'string' && HS_KEY.includes('sydamerika') && HUVUDSTAD.size > 0 && !!map.getLayer('stad-mal')",
    null, { timeout: 30000 });
  const plats = await up.evaluate(`(() => {
    const inRing = (x, y, r) => { let i2 = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) i2 = !i2; } return i2; };
    const inMp = (x, y, mp) => mp.some(p => inRing(x, y, p[0]) && !p.slice(1).some(h => inRing(x, y, h)));
    const fel = [];
    for (const f of huvudstadGj.features) {
      const [x, y] = f.geometry.coordinates;
      const egen = regionsGj.features.filter(r => r.id === f.id && !r.properties.dekor);
      const annan = regionsGj.features.find(r => r.id !== f.id && inMp(x, y, r.geometry.coordinates));
      if (!egen.some(r => inMp(x, y, r.geometry.coordinates)) || annan)
        fel.push(f.properties.namn + (annan ? ' på ' + annan.properties.namn : ''));
    }
    const malta = huvudstadGj.features.find(f => f.properties.namn === 'Valletta');
    const jakarta = huvudstadGj.features.find(f => f.properties.namn === 'Jakarta');
    return { n: huvudstadGj.features.length, fel, valletta: malta && malta.geometry.coordinates,
      jakarta: jakarta && jakarta.geometry.coordinates };
  })()`);
  // Jakarta: Java är ritad ~2° söder om den riktiga — staden ska ligga på
  // den ritade Java (lat < -7.9), inte på Sumatras östkust
  ok('huvudstäderna ligger på sitt eget lands bild', plats.n >= 200 && plats.fel.length === 0
    && plats.valletta && plats.valletta[1] < 35 && plats.jakarta && plats.jakarta[1] < -7.9,
    JSON.stringify(plats).slice(0, 200));
  const val = await up.evaluate(`(() => {
    const vx = document.getElementById('utforska-val');
    const syns = vx.style.display !== 'none' && !utforskStadLage();
    document.querySelector('#utforska-val [data-utforska="huvudstad"]').click();
    return { syns, lage: utforskStadLage(), sparat: localStorage.getItem('utforska-fraga'),
      ord: document.getElementById('utforsk-ord').textContent,
      tom: document.querySelector('#info-default p').textContent };
  })()`);
  await up.waitForTimeout(200);   // huvudstadDirty väntar en bildruta
  const lager = await up.evaluate(`({ prickar: map.getLayoutProperty('prickar', 'visibility'),
    mal: map.getFilter('stad-mal')[2][1].length })`);
  ok('Utforska: växeln Huvudstäder visar städerna som vita cirklar',
    val.syns && val.lage && val.sparat === 'huvudstad' && val.ord === 'huvudstäder'
    && /vit cirkel/.test(val.tom) && lager.mal === 13 && lager.prickar === 'none', JSON.stringify({ ...val, ...lager }));
  // riktigt klick på en stad mitt på kartan
  const pkt = await up.evaluate(`(() => {
    const c = COUNTRIES.find(x => x.namnSv === 'Bolivia');
    const p = stadPunkt.get(c.gid);
    map.jumpTo({ center: [p.lng, p.lat], zoom: 3 });
    const r = map.getCanvas().getBoundingClientRect(), s = map.project([p.lng, p.lat]);
    return { x: r.left + s.x, y: r.top + s.y, gid: c.gid, tom: { x: r.left + 30, y: r.top + r.height - 30 } };
  })()`);
  await up.waitForTimeout(300);
  await up.mouse.click(pkt.tom.x, pkt.tom.y);
  const efterTom = await up.evaluate('revealed.size');
  await up.mouse.click(pkt.x + 1, pkt.y + 1);
  await up.waitForTimeout(200);
  const upptackt = await up.evaluate(`({ avt: revealed.has(${pkt.gid}),
    kort: document.getElementById('info-card').classList.contains('active'),
    hs: document.getElementById('info-hs-namn').textContent,
    tt: document.getElementById('cursor-label').textContent,
    mal: map.getFilter('stad-mal')[2][1].length,
    etikett: map.getFilter('stad-etikett')[2][1].includes(${pkt.gid}),
    prick: map.getFilter('huvudstad-prick')[2][1].length,
    antal: document.getElementById('explored-count').textContent })`);
  // v102: staden får en vit namnruta (stad-etikett) och cirkeln står kvar;
  // ingen svart prick som i Länder-läget
  ok('Utforska: klick på en stad upptäcker den',
    efterTom === 0 && upptackt.avt && upptackt.kort && upptackt.hs === 'Sucre / La Paz'
    && upptackt.tt.includes('Sucre / La Paz, ') && upptackt.tt.includes('Bolivia') && upptackt.mal === 13
    && upptackt.etikett && upptackt.prick === 0 && upptackt.antal === '1',
    JSON.stringify(upptackt).slice(0, 200));
  await up.mouse.click(pkt.x + 1, pkt.y + 1);
  const dold = await up.evaluate(`({ avt: revealed.has(${pkt.gid}), antal: document.getElementById('explored-count').textContent })`);
  ok('Utforska: ett klick till döljer staden igen', !dold.avt && dold.antal === '1', JSON.stringify(dold));
  // tillbaka till Länder: som förut
  const land = await up.evaluate(`(() => {
    document.querySelector('#utforska-val [data-utforska="land"]').click();
    return { lage: utforskStadLage(), ord: document.getElementById('utforsk-ord').textContent,
      sparat: localStorage.getItem('utforska-fraga') };
  })()`);
  await up.waitForTimeout(200);
  const land2 = await up.evaluate(`({ prickar: map.getLayoutProperty('prickar', 'visibility'),
    mal: map.getFilter('stad-mal')[2][1].length })`);
  ok('Utforska: tillbaka till Länder', !land.lage && land.ord === 'länder' && land.sparat === 'land'
    && land2.prickar === 'visible' && land2.mal === 0, JSON.stringify({ ...land, ...land2 }));
  await up.close();
} catch (e) {
  ok('huvudstäderna ligger på sitt eget lands bild', false, String(e).slice(0, 160));
}

// ── v99b: Utforska + Huvudstäder — granskningens fynd ──
// Rom och Vatikanstaten ligger nästan ovanpå varandra: en upptäckt stad
// (svart prick under den vita cirkeln) får inte stjäla klicket från den
// vita cirkeln. ✨-blinkningen får inte lämna länder gula när man byter
// Länder/Huvudstäder mitt i. Tillbaka till startsidan: förra regionens
// städer ska inte synas bakom 'Hela världen'.
try {
  const INIT_LS = "localStorage.setItem('rundtur-klar','1'); localStorage.setItem('speltur-klar','1'); localStorage.setItem('kakval','nej'); localStorage.setItem('feedback-tips-klar','1'); localStorage.setItem('utforska-fraga','huvudstad')";
  const eu = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  const euFel = [];
  eu.on('pageerror', e => euFel.push(String(e)));
  await eu.addInitScript(INIT_LS);
  await eu.goto(BASE + '/glob.html?region=europa', { waitUntil: 'domcontentloaded' });
  await eu.waitForFunction("document.getElementById('spel-load').style.display === 'none'" +
    " && typeof HS_KEY === 'string' && HS_KEY.includes('europa') && HUVUDSTAD.size > 0 && !!map.getLayer('stad-mal')" +
    " && utforskStadLage()", null, { timeout: 30000 });
  await eu.waitForTimeout(600);
  // Europa frågar först vilken del man vill öva på: stäng den rutan
  await eu.evaluate("document.getElementById('del-overlay').classList.remove('active')");
  const rv = await eu.evaluate(`(() => {
    const hitta = n => COUNTRIES.find(c => (huvudstadFor(c) || {}).huvudstad === n);
    const it = hitta('Rom'), va = hitta('Vatikanstaten');
    const r = map.getCanvas().getBoundingClientRect();
    const sr = map.project([stadPunkt.get(it.gid).lng, stadPunkt.get(it.gid).lat]);
    const sv = map.project([stadPunkt.get(va.gid).lng, stadPunkt.get(va.gid).lat]);
    const D = Math.hypot(sr.x - sv.x, sr.y - sv.y), ritad = stadRadiePx(map.getZoom()) + 2;
    // en punkt bortom Rom, sett från Vatikanen: närmare Rom men inuti
    // Vatikanens ritade cirkel
    const ux = (sr.x - sv.x) / D, uy = (sr.y - sv.y) / D, k = ritad * 0.3;
    return { it: it.gid, va: va.gid, D, ritad, rom: { x: r.left + sr.x, y: r.top + sr.y },
      bortom: { x: r.left + sr.x + ux * k, y: r.top + sr.y + uy * k } };
  })()`);
  await eu.mouse.click(rv.rom.x, rv.rom.y);
  await eu.waitForTimeout(200);
  const forsta = await eu.evaluate(`[revealed.has(${rv.it}), revealed.has(${rv.va})]`);
  await eu.mouse.click(rv.bortom.x, rv.bortom.y);
  await eu.waitForTimeout(200);
  const andra = await eu.evaluate(`[revealed.has(${rv.it}), revealed.has(${rv.va})]`);
  ok('Utforska: en upptäckt stad stjäl inte klicket från den vita cirkeln ovanpå',
    rv.D <= 3 && rv.D < rv.ritad && forsta[0] !== forsta[1] && andra[0] && andra[1],
    JSON.stringify({ D: +rv.D.toFixed(1), ritad: +rv.ritad.toFixed(1), forsta, andra }));
  // v102: upptäckta städer är också vita cirklar. Två städer som går att
  // skilja åt (Wien och Bratislava, ~5 px isär): ett klick till på den
  // hittade döljer den, i stället för att hitta grannen
  const wb = await eu.evaluate(`(() => {
    revealed.clear(); huvudstadDirty();
    const hitta = n => COUNTRIES.find(c => (huvudstadFor(c) || {}).huvudstad === n);
    const w = hitta('Wien'), b = hitta('Bratislava');
    const pw = stadPunkt.get(w.gid), pb = stadPunkt.get(b.gid);
    const avst = () => { const a = map.project([pw.lng, pw.lat]), c = map.project([pb.lng, pb.lat]); return Math.hypot(a.x - c.x, a.y - c.y); };
    map.jumpTo({ center: [pw.lng, pw.lat], zoom: map.getZoom() });
    map.jumpTo({ center: [pw.lng, pw.lat], zoom: map.getZoom() + Math.log2(5 / avst()) });
    const r = map.getCanvas().getBoundingClientRect(), s = map.project([pw.lng, pw.lat]);
    const t = map.project([pb.lng, pb.lat]), D = avst();
    // en punkt inuti Wiens cirkel, 4 px vid sidan om linjen mot Bratislava:
    // närmare Wien (4 px) än Bratislava (~6,4 px), men bara ~2,4 px skillnad
    const off = Math.min(4, (stadRadiePx(map.getZoom()) + 2) * 0.8);
    const nx = -(t.y - s.y) / D, ny = (t.x - s.x) / D;
    return { w: w.gid, b: b.gid, D, off, x: r.left + s.x, y: r.top + s.y,
      sx: r.left + s.x + nx * off, sy: r.top + s.y + ny * off };
  })()`);
  await eu.waitForTimeout(300);
  const wbKlick = async (x, y) => {
    await eu.mouse.click(x, y);
    await eu.waitForTimeout(200);
    return eu.evaluate(`[revealed.has(${wb.w}), revealed.has(${wb.b})]`);
  };
  const wb1 = await wbKlick(wb.x, wb.y);     // mitt på: Wien hittas
  const wb2 = await wbKlick(wb.sx, wb.sy);   // vid sidan om: Wien döljs
  const wb3 = await wbKlick(wb.x, wb.y);     // mitt på: hittas igen
  const wb4 = await wbKlick(wb.x, wb.y);     // mitt på: döljs
  ok('Utforska: ett klick till på en hittad stad döljer den, även bredvid en annan',
    wb.D > 3.5 && wb1[0] && !wb1[1] && !wb2[0] && !wb2[1] && wb3[0] && !wb3[1] && !wb4[0] && !wb4[1],
    JSON.stringify({ D: +wb.D.toFixed(1), off: +wb.off.toFixed(1), wb1, wb2, wb3, wb4 }));
  // ✨ i Länder, byt till Huvudstäder mitt i blinkningen, ✨ igen
  // bytet sker medan länderna är gula (väntar på blinken i sidan själv,
  // så att testet inte hänger på hur snabbt maskinen är)
  const gulaMitti = await eu.evaluate(`(async () => {
    document.querySelector('#utforska-val [data-utforska="land"]').click();
    document.getElementById('blink-kvar-btn').click();
    const gula = () => COUNTRIES.filter(c => landState(c.gid).tips).length;
    for (let i = 0; i < 100 && !gula(); i++) await new Promise(r => setTimeout(r, 10));
    const n = gula();
    document.querySelector('#utforska-val [data-utforska="huvudstad"]').click();
    document.getElementById('blink-kvar-btn').click();
    return n;
  })()`);
  await eu.waitForTimeout(1900);
  const gula = await eu.evaluate('COUNTRIES.filter(c => landState(c.gid).tips).length');
  ok('Utforska: byte Länder/Huvudstäder mitt i ✨ lämnar inga gula länder',
    gulaMitti > 0 && gula === 0, JSON.stringify({ gulaMitti, gula }));
  // tillbaka till startsidan och vidare till Hela världen
  await eu.evaluate('tillbakaTillStart()');
  await eu.waitForTimeout(300);
  await eu.evaluate("gaTillRegion('world')");
  await eu.waitForTimeout(500);
  const varld = await eu.evaluate(`({ lage: utforskStadLage(), slug: aktivSlug,
    mal: map.getFilter('stad-mal')[2][1].length, prickar: map.getLayoutProperty('prickar', 'visibility') })`);
  ok("Utforska: förra regionens städer syns inte bakom 'Hela världen'",
    !varld.lage && varld.mal === 0 && varld.prickar === 'visible', JSON.stringify(varld));
  ok('Utforska + Huvudstäder i Europa utan JS-fel', euFel.length === 0, euFel.join(' | ').slice(0, 160));
  await eu.close();
} catch (e) {
  ok('Utforska: en upptäckt stad stjäl inte klicket från den vita cirkeln ovanpå', false, String(e).slice(0, 160));
}

// ── v98: Flaggor som på Seterra (bara svenska sajten) ──
// Med Flaggor valt täcks kartytan av flaggtavlan (flaggtavla.js): en riktig
// flagga (assets/flaggor) per land i rundan. Quizen säger landets NAMN och
// man klickar på rätt flagga; Bildquiz vänder den hittade flaggan till Jonas
// minnesbild (assets/flaggbilder). Utforska har en egen växel
// (#utforska-val: Länder | Huvudstäder | Flaggor, sparad i 'utforska-fraga',
// oberoende av quizens 'quiz-fraga'); med Flaggor visar den tavlan i
// bokstavsordning och ett klick öppnar landets kort (som börjar med Flaggan). Egna
// topplistor (prefixet flagga-), egna medaljer, ingen passtämpel och ingen
// utmaning. Globen ligger kvar under tavlan: inga nya kartlager eller
// källor, inert och utan omritningar (kartaTackt) tills den syns igen.
try {
  const INIT_LS = "localStorage.setItem('rundtur-klar','1'); localStorage.setItem('speltur-klar','1'); localStorage.setItem('kakval','nej'); localStorage.setItem('feedback-tips-klar','1')";
  const fp = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  const fFel = [];
  fp.on('pageerror', e => fFel.push(String(e)));
  await fp.addInitScript(INIT_LS);
  await fp.goto(BASE + '/glob.html?region=sydamerika', { waitUntil: 'domcontentloaded' });
  await fp.waitForFunction("document.getElementById('spel-load').style.display === 'none'" +
    " && typeof HS_KEY === 'string' && HS_KEY.includes('sydamerika') && HUVUDSTAD.size > 0",
    null, { timeout: 30000 });
  const lagerFore = await fp.evaluate("map.getStyle().layers.length + '/' + Object.keys(map.getStyle().sources).length");
  // rutornas ramar och blekning utan övergångar: testet läser slutlägena
  // (övergångarna går på bildrutor, och mjukvaru-GPU:n här är seg)
  await fp.addStyleTag({ content: '#flaggtavla .tavla-kort, #flaggtavla .tavla-flagga { transition: none !important; }' });
  // Utforska: EN växel i landinformationens rubrikrad (v99:s #utforska-val)
  // med Länder, Huvudstäder och Flaggor, på samma rad som rubriken. Quizens
  // #fraga-val står kvar i quizpanelen.
  const utf0 = await fp.evaluate(`(() => {
    const vx = document.getElementById('utforska-val');
    const h = vx.closest('.info-header'), h2 = h.querySelector('h2');
    const hr = h.getBoundingClientRect(), vr = vx.getBoundingClientRect(), tr = h2.getBoundingClientRect();
    return { knappar: [...vx.querySelectorAll('.fraga-btn')].filter(b => b.style.display !== 'none')
        .map(b => b.textContent).join('|'),
      iUtforska: !!vx.closest('#explore-ui'), syns: vx.style.display !== 'none' && vx.offsetHeight > 0,
      aktiv: vx.querySelector('.fraga-btn.active').dataset.utforska, tre: h.classList.contains('tre-val'),
      // ryms: på rubrikens rad, inom panelen, och rubriken kapas inte
      ryms: vr.top < tr.bottom && vr.right <= hr.right && h2.scrollWidth <= h2.clientWidth,
      ensam: document.querySelectorAll('#explore-ui .fraga-val').length === 1,
      fragaIQuiz: !!document.getElementById('fraga-val').closest('#seterra-ui'),
      tavla: document.getElementById('flaggtavla').hidden };
  })()`);
  ok('flaggtavla: Utforska har en växel Länder|Huvudstäder|Flaggor', utf0.knappar === 'Länder|Huvudstäder|Flaggor'
    && utf0.iUtforska && utf0.syns && utf0.aktiv === 'land' && utf0.tre && utf0.ryms && utf0.ensam && utf0.fragaIQuiz
    && utf0.tavla, JSON.stringify(utf0));
  // quizen: tre val; Flaggor ger tavlan med en flagga per land i rundan
  const val = await fp.evaluate(`(async () => {
    window.__kakor = [];
    const kak = window.kakSpara;
    window.kakSpara = (n, p) => { window.__kakor.push([n, p]); kak?.(n, p); };
    switchMode('seterra', true);
    const vx = document.getElementById('fraga-val');
    const knappar = [...vx.querySelectorAll('.fraga-btn')].filter(b => b.style.display !== 'none').map(b => b.textContent);
    document.querySelector('#fraga-val [data-fraga="flagga"]').click();
    await laddaFlaggbilder();
    const t = seterraTarget;
    const tavla = document.getElementById('flaggtavla');
    const rutor = [...tavla.querySelectorAll('.tavla-ruta')];
    const sortera = a => a.sort((x, y) => x - y).join();
    const dold = el => !el || getComputedStyle(el).visibility === 'hidden' || getComputedStyle(el).display === 'none'
      || el.getBoundingClientRect().width === 0;
    const ui = document.getElementById('seterra-ui');
    const fraga = document.getElementById('seterra-target-name');
    return { knappar, iQuiz: !!vx.closest('#seterra-ui'), lage: flagglage, hs: huvudstadslage, key: HS_KEY,
      golv: rimligMinTid(), sparat: localStorage.getItem('quiz-fraga'),
      utforskaOrord: localStorage.getItem('utforska-fraga') === null && villUtforska === 'land' && !utforskaFlaggor,
      kaka: JSON.stringify(window.__kakor.find(k => k[0] === 'fraga_vald')),
      aktiv: vx.querySelector('.fraga-btn.active').dataset.fraga,
      treVal: document.querySelector('#seterra-ui .info-header').classList.contains('tre-val'),
      n: rutor.length, total: COUNTRIES.length,
      sammaLander: sortera(rutor.map(b => +b.dataset.gid)) === sortera(COUNTRIES.map(c => c.gid)),
      tavlaSyns: !tavla.hidden && tavla.getBoundingClientRect().width > 300,
      karta: (getComputedStyle(document.getElementById('map-panel'), '::after').content === 'none' ? 'synlig' : 'täckt'),
      kontroller: dold(document.querySelector('.maplibregl-ctrl-zoom-in')) && dold(document.getElementById('explore-toggle-buttons'))
        && dold(document.querySelector('.maplibregl-ctrl-attrib')),
      // frågan är NAMNET — ingen flagga, emoji eller ruta säger vilken flagga det är
      namn: fraga.textContent === t.name, hitta: document.getElementById('hitta-ord').textContent,
      ingenFlagga: !ui.querySelector('img[src*="assets/flaggor/"]') && !ui.textContent.includes(flagga(t.flaggNamn || t.name))
        && !headerHint.textContent.includes(flagga(t.flaggNamn || t.name)),
      etikett: cursorLabel.textContent === 'Klicka på ' + t.name && cursorLabel.classList.contains('tavla-etikett')
        && !cursorLabel.querySelector('img'),
      rutorTiga: rutor.every(b => b.getAttribute('aria-label') === 'Flagga' && !b.title
        && !b.textContent.trim() && b.querySelector('img').alt === ''),
      knappar2: rutor.every(b => b.tagName === 'BUTTON'),
      forladdat: COUNTRIES.every(c => flaggForladdade.has(flaggSrc(c))),
      // globen under tavlan: varken fokus, tangenter eller omritningar
      inert: document.getElementById('spel-map').inert && kartaTackt,
      // statistiken står överst på tavlan, panelens göms; Visa ledtråd står i frågans block
      status: document.querySelector('#flaggtavla .tavla-status').textContent.replace(/\s+/g, ' ').trim(),
      statusSyns: getComputedStyle(document.querySelector('#flaggtavla .tavla-status')).display === 'flex',
      panelStats: getComputedStyle(document.querySelector('#seterra-game .seterra-stats')).display,
      hintIFragan: !!seterraHintBtn.closest('.seterra-target') };
  })()`);
  ok('flaggtavla: quizens växel har tre val (Länder, Huvudstäder, Flaggor)',
    val.knappar.join('|') === 'Länder|Huvudstäder|Flaggor' && val.iQuiz && val.aktiv === 'flagga' && val.treVal, val.knappar.join('|'));
  ok('flaggtavla: valet sparas och loggas', val.lage && !val.hs && val.sparat === 'flagga' && val.utforskaOrord
    && /"fraga":"flagga"/.test(val.kaka) && /"quiz":"klassisk"/.test(val.kaka), JSON.stringify(val).slice(0, 200));
  ok('flaggtavla: egen topplista, samma golv', val.key === 'flagga-glob-sydamerika-highscores' && val.golv === 10, val.key);
  ok('flaggtavla: tavlan har en flaggknapp per land, kartans knappar göms',
    val.tavlaSyns && val.n === val.total && val.n === 13 && val.sammaLander && val.knappar2
    && val.karta === 'täckt' && val.kontroller && val.forladdat && val.inert,
    JSON.stringify({ n: val.n, s: val.tavlaSyns, k: val.karta, c: val.kontroller, f: val.forladdat, i: val.inert }));
  ok('flaggtavla: siffrorna står på tavlan, Visa ledtråd vid frågan',
    val.statusSyns && /Poäng 100%/.test(val.status) && /Rätt 0/.test(val.status) && /0 \/ 13/.test(val.status)
    && val.panelStats === 'none' && val.hintIFragan, JSON.stringify({ st: val.status, ps: val.panelStats, h: val.hintIFragan }));
  ok('flaggtavla: frågan är landets namn, ingen flagga avslöjar svaret',
    val.namn && val.hitta === 'Klicka på flaggan för:' && val.ingenFlagga && val.etikett && val.rutorTiga,
    JSON.stringify({ namn: val.namn, h: val.hitta, i: val.ingenFlagga, e: val.etikett, r: val.rutorTiga }));
  // globen under tavlan vilar: den täcks i stället för att döljas — en
  // dold WebGL-duk blir aldrig klar med globens felmätning och ritar om
  // varje bildruta (då gick sidan inte ens att ladda om)
  const omritningar = await fp.evaluate(`new Promise(res => setTimeout(() => {
    let n = 0; const h = () => n++; map.on('render', h);
    setTimeout(() => { map.off('render', h); res(n); }, 2000);
  }, 2500))`);
  ok('flaggtavla: globen under tavlan ritar inte om hela tiden', omritningar < 20, omritningar + ' omritningar på 2 s');
  // flaggorna laddar på riktigt
  await fp.waitForFunction("[...document.querySelectorAll('#flaggtavla img.tavla-flagga')].every(i => i.complete)", null, { timeout: 15000 });
  const laddade = await fp.evaluate(`(() => {
    const imgs = [...document.querySelectorAll('#flaggtavla img.tavla-flagga')];
    const h = imgs.map(i => Math.round(i.getBoundingClientRect().height));
    return { ok: imgs.every(i => i.naturalWidth > 0), hojd: h[0], lika: h.every(x => x === h[0]) };
  })()`);
  ok('flaggtavla: flaggorna laddar och är lika höga', laddade.ok && laddade.lika && laddade.hojd >= 80 && laddade.hojd <= 100,
    JSON.stringify(laddade));
  // fel svar med ett riktigt klick: räknas, rutan blir röd, panelen säger
  // vems flaggan var — och visar den flaggans minnesbild
  const felGid = await fp.evaluate("COUNTRIES.find(c => c.gid !== seterraTarget.gid && flaggbildFor(c)?.text).gid");
  const fore = await fp.evaluate("({ gid: seterraTarget.gid, fel: seterraWrong })");
  await fp.click(`#flaggtavla .tavla-ruta[data-gid="${felGid}"]`);
  const fel = await fp.evaluate(`(() => {
    const c = aktivByGid.get(${felGid});
    const fb = seterraFeedback;
    const bild = fb.querySelector('img.flagg-minnesbild');
    return { fel: seterraWrong, kvar: seterraTarget.gid, text: fb.textContent, namn: c.name,
      flagga: !!fb.querySelector('.fb-flagg-titel img.fb-flagga[src="' + flaggSrc(c) + '"]'),
      minne: !!bild && bild.getAttribute('src') === flaggbildSrc(flaggbildFor(c)),
      minneText: fb.textContent.includes(flaggbildFor(c).text), inteLand: !fb.querySelector('.fb-shape, .fb-desc'),
      rod: document.querySelector('#flaggtavla .tavla-ruta[data-gid="${felGid}"]').classList.contains('fel'),
      statusFel: document.querySelector('#flaggtavla .ts-fel b').textContent === String(seterraWrong),
      felRuta: getComputedStyle(document.querySelector('#flaggtavla .tavla-ruta[data-gid="${felGid}"] .tavla-kort')).boxShadow };
  })()`);
  ok('flaggtavla: fel flagga räknas och panelen säger vems den var',
    fel.fel === fore.fel + 1 && fel.kvar === fore.gid && fel.text.includes('Det var') && fel.text.includes(fel.namn)
    && fel.flagga && fel.minne && fel.minneText && fel.inteLand && fel.rod && /224, 82, 82/.test(fel.felRuta) && fel.statusFel,
    JSON.stringify({ ...fel, text: fel.text.slice(0, 60) }).slice(0, 260));
  // svaret står under frågan och panelen skrollar fram det, medan landets
  // namn och Visa ledtråd står kvar överst (inte skymda av något)
  await fp.waitForTimeout(800);   // panelen skrollar mjukt
  const svarSyns = await fp.evaluate(`(() => {
    const p = document.querySelector('#info-panel .info-panel-content').getBoundingClientRect();
    const fb = seterraFeedback.getBoundingClientRect();
    const namn = document.getElementById('seterra-target-name').getBoundingClientRect();
    const fast = document.querySelector('#seterra-game .seterra-target').getBoundingClientRect();
    const synlig = el => { const b = el.getBoundingClientRect();
      const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!e && (e === el || el.contains(e)); };
    return { svar: fb.top >= fast.bottom - 1 && fb.top + 120 <= p.bottom,
      namn: namn.top >= p.top - 1 && synlig(document.getElementById('seterra-target-name')),
      knapp: synlig(seterraHintBtn), sida: document.scrollingElement.scrollTop === 0 };
  })()`);
  ok('flaggtavla: svaret syns under frågan, namnet och Visa ledtråd står kvar', svarSyns.svar && svarSyns.namn
    && svarSyns.knapp && svarSyns.sida, JSON.stringify(svarSyns));
  // ledtråden (på begäran): frågans minnesbild med Jonas HELA text (några
  // minnesbilder har ingen text, t.ex. Franska Guyana: då bara bilden)
  const hint = await fp.evaluate(`(async () => {
    const t = seterraTarget, fb = flaggbildFor(t);
    const box = document.getElementById('seterra-hint');
    const stangd = box.style.display === 'none' && seterraHintBtn.style.display !== 'none';
    seterraHintBtn.click();
    const bild = box.querySelector('img.flagg-minnesbild');
    if (bild && !bild.complete) await new Promise(r => { bild.onload = bild.onerror = r; });
    const br = COUNTRIES.find(c => c.namnSv === 'Brasilien');
    return { stangd, syns: box.style.display !== 'none' && box.classList.contains('flagg-ledtrad'),
      bild: !!bild && bild.naturalWidth > 0 && bild.getAttribute('src') === flaggbildSrc(fb),
      hel: !fb.text || box.textContent.includes(fb.text), lucka: !!box.querySelector('.flagg-lucka'),
      // texter som säger landet står kvar hela nu (frågan är ju namnet)
      brasilien: /BRASILIENS/.test(flaggMinneHtml(br, true)) && !flaggMinneHtml(br, true).includes('flagg-lucka') };
  })()`);
  await fp.waitForTimeout(900);   // rutan poppar in och panelen skrollar
  const hintPlats = await fp.evaluate(`(() => {
    const fast = document.querySelector('#seterra-game .seterra-target').getBoundingClientRect();
    const box = document.getElementById('seterra-hint').getBoundingClientRect();
    const p = document.querySelector('#info-panel .info-panel-content').getBoundingClientRect();
    return { under: box.top >= fast.bottom - 1, iBild: box.top < p.bottom - 100 };
  })()`);
  ok('flaggtavla: ledtråden är minnesbilden med hela texten', hint.stangd && hint.syns && hint.bild && hint.hel
    && !hint.lucka && hint.brasilien && hintPlats.under && hintPlats.iBild, JSON.stringify({ ...hint, ...hintPlats }));
  // rätt svar med ett riktigt klick: grön ram och ✓, namnet under, nästa fråga
  await fp.waitForTimeout(700);   // felklickets spärr
  const rattGid = await fp.evaluate('seterraTarget.gid');
  await fp.click(`#flaggtavla .tavla-ruta[data-gid="${rattGid}"]`);
  await fp.waitForFunction(`(() => { const b = document.querySelector('#flaggtavla .tavla-ruta[data-gid="${rattGid}"]');
    return /46, 158, 68/.test(getComputedStyle(b.querySelector('.tavla-kort')).boxShadow)
      && +getComputedStyle(b.querySelector('.tavla-flagga')).opacity < 0.6; })()`, null, { timeout: 5000 }).catch(() => {});
  const ratt = await fp.evaluate(`(() => {
    const b = document.querySelector('#flaggtavla .tavla-ruta[data-gid="${rattGid}"]');
    const c = aktivByGid.get(${rattGid});
    const fb = seterraFeedback;
    return { ratt: seterraCorrect, nasta: !!seterraTarget && seterraTarget.gid !== ${rattGid},
      // en hittad flagga med minnesbild går att vända: en vanlig knapp
      hittad: b.classList.contains('hittad') && b.classList.contains('vandbar') && !b.hasAttribute('aria-disabled')
        && b.getAttribute('aria-pressed') === 'false' && b.getAttribute('aria-label') === c.name + ', hittad – visa minnesbilden',
      namn: b.querySelector('.tavla-namn').textContent === c.name && b.getAttribute('aria-label').startsWith(c.name),
      ram: getComputedStyle(b.querySelector('.tavla-kort')).boxShadow,
      bock: getComputedStyle(b, '::after').content,
      blek: +getComputedStyle(b.querySelector('.tavla-flagga')).opacity < 0.6,
      text: fb.textContent, cnamn: c.name, flagga: !!fb.querySelector('.fb-flagg-titel img.fb-flagga'),
      minne: !!fb.querySelector('img.flagg-minnesbild'), fragaNy: document.getElementById('seterra-target-name').textContent === seterraTarget.name,
      platt: [...document.querySelectorAll('#flaggtavla .tavla-kort')].every(k => getComputedStyle(k).transformStyle === 'flat'),
      statusRatt: document.querySelector('#flaggtavla .ts-ratt b').textContent === '1' && document.querySelector('#flaggtavla .ts-framsteg').textContent.includes('1 / 13') };
  })()`);
  ok('flaggtavla: rätt flagga markeras (grön ram, ✓, namnet) och nästa fråga kommer',
    ratt.ratt === 1 && ratt.nasta && ratt.hittad && ratt.namn && /46, 158, 68/.test(ratt.ram) && ratt.bock.includes('✓')
    && ratt.blek && ratt.text.includes('RÄTT!') && ratt.text.includes(ratt.cnamn) && ratt.flagga && ratt.minne && ratt.fragaNy
    && ratt.platt && ratt.statusRatt,
    JSON.stringify({ ...ratt, text: undefined }).slice(0, 240));
  // v101: en hittad flagga vänds vid varje klick — Klassiskt Quiz: den
  // bleka flaggan → minnesbilden → den bleka flaggan → … — och det är aldrig
  // ett svar: poäng, tid, räknare, svaret i panelen, frågan och spärren
  // står kvar, och det låter bara ett mjukt klick. Vändningen går också med
  // tangentbordet (Enter på knappen) och medan ett felklick spärrar.
  const VAND_LAGE = `(gid => {
    const b = document.querySelector('#flaggtavla .tavla-ruta[data-gid="' + gid + '"]');
    const kort = b.querySelector('.tavla-kort'), flagga = b.querySelector('.tavla-flagga');
    const minnen = b.querySelectorAll('.tavla-minne'), m = minnen[0];
    return { klass: b.className, vand: b.classList.contains('vand'), klar: b.classList.contains('vand-klar'),
      i3d: b.classList.contains('minne'), pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label'),
      disabled: b.hasAttribute('aria-disabled'), minnen: minnen.length,
      minneSyns: !!m && getComputedStyle(m).display !== 'none', minneData: !!m && m.src.startsWith('data:image/'),
      flaggaSyns: getComputedStyle(flagga).display !== 'none', flaggaHel: +getComputedStyle(flagga).opacity === 1,
      flaggaBlek: +getComputedStyle(flagga).opacity < 0.6, titel: b.title,
      platt: getComputedStyle(kort).transformStyle === 'flat' && getComputedStyle(kort).transform === 'none',
      ram: /46, 158, 68/.test(getComputedStyle(kort).boxShadow), bock: getComputedStyle(b, '::after').content.includes('✓'),
      namn: b.querySelector('.tavla-namn').textContent, pekare: getComputedStyle(b).cursor };
  })`;
  const QUIZ_LAGE = `(() => ({ r: seterraCorrect, f: seterraWrong, t: seterraTarget && seterraTarget.gid, lock: seterraLocked,
    poang: seterraScoreEl.textContent, fb: seterraFeedback.innerHTML.length, fram: seterraProgressLabel.textContent,
    status: document.querySelector('#flaggtavla .tavla-status').textContent }))()`;
  const vantaVila = (pg, gid, minne) => pg.waitForFunction(`(() => { const b = document.querySelector('#flaggtavla .tavla-ruta[data-gid="${gid}"]');
    return !b.classList.contains('minne') && b.classList.contains('vand') === ${minne} && b.classList.contains('vand-klar') === ${minne}; })()`,
    null, { timeout: 8000 }).catch(() => {});
  await fp.waitForTimeout(700);   // (rätt svar spärrar inte, men vänta ut allt)
  await fp.evaluate("window.__ljud = []; window.__spela = spela; spela = t => { window.__ljud.push(t); }");
  const kFore = await fp.evaluate(QUIZ_LAGE);
  await fp.click(`#flaggtavla .tavla-ruta[data-gid="${rattGid}"]`);
  await vantaVila(fp, rattGid, true);
  const kMinne = await fp.evaluate(VAND_LAGE + `(${rattGid})`);
  const kMinneQ = await fp.evaluate(QUIZ_LAGE);
  await fp.click(`#flaggtavla .tavla-ruta[data-gid="${rattGid}"]`);
  await vantaVila(fp, rattGid, false);
  const kFlagga = await fp.evaluate(VAND_LAGE + `(${rattGid})`);
  // tangentbordet: Enter på den hittade flaggan, mitt i ett felklicks spärr
  await fp.evaluate('seterraLocked = true');
  await fp.focus(`#flaggtavla .tavla-ruta[data-gid="${rattGid}"]`);
  await fp.keyboard.press('Enter');
  await vantaVila(fp, rattGid, true);
  const kTangent = await fp.evaluate(VAND_LAGE + `(${rattGid})`);
  const kEfter = await fp.evaluate(QUIZ_LAGE);
  const ljud = await fp.evaluate('window.__ljud.join()');
  await fp.evaluate('spela = window.__spela; seterraLocked = false; document.activeElement.blur()');
  const rattNamn = await fp.evaluate(`aktivByGid.get(${rattGid}).name`);
  const kSamma = q => q.r === kFore.r && q.f === kFore.f && q.t === kFore.t && q.poang === kFore.poang && q.fb === kFore.fb
    && q.fram === kFore.fram && q.status.replace(/Tid \S+/, '') === kFore.status.replace(/Tid \S+/, '');
  ok('flaggtavla: Klassiskt Quiz — en hittad flagga vänds till minnesbilden och tillbaka, utan att räknas',
    kMinne.vand && kMinne.klar && kMinne.minneSyns && kMinne.minneData && !kMinne.flaggaSyns && kMinne.platt && kMinne.minnen === 1
    && kMinne.pressed === 'true' && kMinne.label === rattNamn + ', hittad – visa flaggan' && kMinne.ram && kMinne.bock
    && kMinne.namn === rattNamn && kMinne.pekare === 'pointer' && !kMinne.disabled
    && !kFlagga.vand && !kFlagga.klar && !kFlagga.i3d && kFlagga.flaggaSyns && kFlagga.flaggaBlek && !kFlagga.minneSyns && kFlagga.platt
    && kFlagga.minnen === 1 && kFlagga.pressed === 'false' && kFlagga.label === rattNamn + ', hittad – visa minnesbilden'
    && kFlagga.ram && kFlagga.bock && kFlagga.namn === rattNamn && kFlagga.titel === rattNamn + ' – klicka för att vända'
    && kSamma(kMinneQ) && !kMinneQ.lock && ljud === 'klick,klick,klick',
    JSON.stringify({ kMinne, kFlagga, kFore, kMinneQ, ljud }).slice(0, 400));
  ok('flaggtavla: Enter vänder en hittad flagga, även under felklickets spärr',
    kTangent.vand && kTangent.klar && kTangent.minneSyns && kTangent.minnen === 1 && kTangent.pressed === 'true'
    && kSamma(kEfter) && kEfter.lock === true, JSON.stringify({ kTangent, kEfter }).slice(0, 300));
  const igenKlick = await fp.evaluate('({ r: seterraCorrect, f: seterraWrong })');
  // tre missar på samma fråga: den rätta flaggan blinkar
  for (let i = 0; i < 3; i++) {
    await fp.waitForTimeout(650);
    const g = await fp.evaluate("COUNTRIES.find(c => c.gid !== seterraTarget.gid && !revealed.has(c.gid)).gid");
    await fp.click(`#flaggtavla .tavla-ruta[data-gid="${g}"]`);
  }
  const tips = await fp.evaluate(`(() => ({ missar: seterraTargetMisses, fel: seterraWrong,
    blink: document.querySelector('#flaggtavla .tavla-ruta[data-gid="' + seterraTarget.gid + '"]').classList.contains('tips') }))()`);
  ok('flaggtavla: hittad flagga räknas inte igen, tre missar blinkar den rätta',
    igenKlick.r === 1 && igenKlick.f === 1 && tips.missar === 3 && tips.fel === 4 && tips.blink, JSON.stringify({ igenKlick, tips }));
  // Indonesien/Monaco och Tchad/Rumänien har (nästan) samma flagga: ett
  // klick på tvillingen räknas inte som fel, och frågan står kvar
  const tvilling = await fp.evaluate(`(() => {
    const spar = seterraTarget, fore = seterraWrong;
    seterraLocked = false;
    seterraTarget = { gid: -90, namnSv: 'Indonesien', name: 'Indonesien' };
    seterraClick({ gid: -91, namnSv: 'Monaco', name: 'Monaco' });
    const r = { fel: seterraWrong - fore, kvar: seterraTarget.gid === -90,
      text: seterraFeedback.textContent, flagga: !!seterraFeedback.querySelector('img.fb-flagga'),
      td: flaggTvilling({ gid: 1, namnSv: 'Tchad' }, { gid: 2, namnSv: 'Rumänien' }),
      inte: flaggTvilling({ gid: 1, namnSv: 'Indonesien' }, { gid: 2, namnSv: 'Polen' }) };
    seterraTarget = spar; seterraLocked = false;
    return r;
  })()`);
  ok('flaggtavla: tvillingflaggor (Indonesien/Monaco) räknas inte som fel',
    tvilling.fel === 0 && tvilling.kvar && tvilling.flagga && tvilling.text.includes('Det där var Monacos flagga – nästan likadan som Indonesiens!')
    && tvilling.td && !tvilling.inte, JSON.stringify(tvilling).slice(0, 200));
  // Nordirland använder Storbritanniens flagga och minnesbild, med noten
  const ni = await fp.evaluate(`(() => {
    const c = { namnSv: 'Nordirland', name: 'Nordirland', gid: 0 };
    return { ledtrad: flaggMinneHtml(c, true), kuba: FLAGGBILD.get('Kuba').text };
  })()`);
  ok('flaggtavla: Nordirland visar Storbritanniens bild och noten', /storbritannien\.webp/.test(ni.ledtrad)
    && /Nordirland använder Storbritanniens flagga/.test(ni.ledtrad)
    && ni.kuba === 'En KUBANSK CIGARR med en stor röd glödande spets med en vit gnista.', ni.ledtrad.slice(0, 160));
  // Öva på felaktiga: samma tavla (alla flaggor, samma ordning), bara de
  // missade frågas — en annan flagga är fel
  const retry = await fp.evaluate(`(() => {
    const ordning = () => [...document.querySelectorAll('#flaggtavla .tavla-ruta')].map(b => b.dataset.gid).join();
    const fore = ordning();
    const missade = COUNTRIES.slice(0, 2).map(c => c.gid);
    seterraMissedCountries = new Set(missade);
    startSeterraRetry();
    const rutor = [...document.querySelectorAll('#flaggtavla .tavla-ruta')];
    const r = { samma: ordning() === fore, n: rutor.length, total: COUNTRIES.length,
      farska: rutor.every(b => !b.classList.contains('hittad')), fragor: seterraTotal,
      bara: [seterraTarget.gid, ...seterraQueue.map(c => c.gid)].every(g => missade.includes(g)), key: HS_KEY };
    const annan = COUNTRIES.find(c => !missade.includes(c.gid));
    rutor.find(b => +b.dataset.gid === annan.gid).click();
    r.fel = seterraWrong;
    return r;
  })()`);
  ok('flaggtavla: Öva på felaktiga visar hela tavlan, bara de missade frågas',
    retry.samma && retry.n === retry.total && retry.farska && retry.fragor === 2 && retry.bara && retry.fel === 1,
    JSON.stringify(retry));
  // simulerad 100 %-runda: egen medalj, ingen stämpel, ingen utmaning
  const slut = await fp.evaluate(`(() => {
    startSeterra();
    seterraStartTime = Date.now() - 30000;
    seterraCorrect = seterraTotal; seterraWrong = 0;
    endSeterra();
    return { medalj: localStorage.getItem('medalj-flagga-sydamerika'),
      land: localStorage.getItem('medalj-sydamerika'), hs: localStorage.getItem('medalj-huvudstad-sydamerika'),
      resa: localStorage.getItem('varldsresa'),
      utmana: document.getElementById('utmana-btn').style.display,
      diplom: document.getElementById('seterra-diplom').style.display,
      kaka: JSON.stringify(window.__kakor.filter(k => k[0] === 'quiz_klar').pop()),
      text: document.getElementById('seterra-final-detail').textContent,
      tavla: !document.getElementById('flaggtavla').hidden };
  })()`);
  ok('flaggtavla: egen medalj, ingen stämpel eller utmaning',
    slut.medalj === '100' && slut.land === null && slut.hs === null && slut.resa === null && slut.utmana === 'none'
    && slut.diplom !== 'none' && /13 av 13 flaggor/.test(slut.text) && /"fraga":"flagga"/.test(slut.kaka) && slut.tavla,
    JSON.stringify(slut).slice(0, 220));
  // Bildquiz + Flaggor: tavlan, egen lista, och en hittad flagga vänds till
  // Jonas minnesbild
  const bild = await fp.evaluate(`(() => {
    // firandet och namnrutan efter 100 %-rundan ligger över allt
    if (document.getElementById('celebration-overlay').classList.contains('active'))
      document.getElementById('celebration-close').click();
    nameModalOverlay.classList.remove('active');
    switchMode('bildquiz', true);
    const rutor = document.querySelectorAll('#flaggtavla .tavla-ruta');
    return { lage: flagglage, stad: stadslage, runda: stadRunda.size, key: HS_KEY, n: rutor.length,
      knapp: document.getElementById('stad-bilder-btn').style.display,
      tavla: !document.getElementById('flaggtavla').hidden, gid: seterraTarget.gid,
      harBild: !!flaggbildFor(seterraTarget) };
  })()`);
  if (!bild.harBild) {
    // ett land utan minnesbild (om ett sådant kommer till): ta en fråga som har
    await fp.evaluate(`(() => { const i = seterraQueue.findIndex(c => flaggbildFor(c));
      const k = seterraQueue.splice(i, 1)[0]; seterraQueue.unshift(seterraTarget); seterraQueue.push(k); nextSeterraTarget(); })()`);
  }
  const vandGid = await fp.evaluate('seterraTarget.gid');
  await fp.click(`#flaggtavla .tavla-ruta[data-gid="${vandGid}"]`);
  await fp.waitForFunction(`document.querySelector('#flaggtavla .tavla-ruta[data-gid="${vandGid}"]').classList.contains('vand-klar')`,
    null, { timeout: 10000 }).catch(() => {});
  // minnesbilden ritas ner till rutans storlek (en liten egen bild), och
  // efter vändningen är rutan platt igen (inget eget GPU-lager)
  const vand = await fp.evaluate(`(() => {
    const b = document.querySelector('#flaggtavla .tavla-ruta[data-gid="${vandGid}"]');
    const img = b.querySelector('img.tavla-minne');
    const kort = b.querySelector('.tavla-kort').getBoundingClientRect();
    return { vand: b.classList.contains('vand') && b.classList.contains('hittad'),
      src: !!img && img.dataset.bild === flaggbildSrc(flaggbildFor(aktivByGid.get(${vandGid}))) && img.src.startsWith('data:image/'),
      liten: !!img && img.naturalWidth > 0 && img.naturalWidth <= Math.ceil(kort.width * 2) + 1,
      platt: !b.classList.contains('minne') && getComputedStyle(b.querySelector('.tavla-kort')).transformStyle === 'flat'
        && getComputedStyle(b.querySelector('.tavla-flagga')).display === 'none',
      namn: b.querySelector('.tavla-namn').textContent === aktivByGid.get(${vandGid}).name };
  })()`);
  ok('flaggtavla: Bildquiz vänder hittade flaggor till minnesbilden',
    bild.lage && !bild.stad && bild.runda === 0 && bild.key === 'flagga-bild-glob-sydamerika-highscores' && bild.n === 13
    && bild.knapp === 'none' && bild.tavla && vand.vand && vand.src && vand.liten && vand.platt && vand.namn,
    JSON.stringify({ ...bild, ...vand }));
  // v101: Bildquiz — ett klick på den hittade flaggan vänder fram flaggan
  // (hel, inte blek) och ett till minnesbilden igen: samma lilla bild, som
  // bara ritas en gång. Inget räknas, frågan står kvar.
  await fp.evaluate(`document.querySelector('#flaggtavla .tavla-ruta[data-gid="${vandGid}"] .tavla-minne').__test = 1`);
  const bFore = await fp.evaluate(QUIZ_LAGE);
  await fp.click(`#flaggtavla .tavla-ruta[data-gid="${vandGid}"]`);
  await vantaVila(fp, vandGid, false);
  const bFlagga = await fp.evaluate(VAND_LAGE + `(${vandGid})`);
  const bFlaggaQ = await fp.evaluate(QUIZ_LAGE);
  await fp.click(`#flaggtavla .tavla-ruta[data-gid="${vandGid}"]`);
  await vantaVila(fp, vandGid, true);
  const bMinne = await fp.evaluate(VAND_LAGE + `(${vandGid})`);
  const bMinneQ = await fp.evaluate(QUIZ_LAGE);
  const sammaBild = await fp.evaluate(`document.querySelector('#flaggtavla .tavla-ruta[data-gid="${vandGid}"] .tavla-minne').__test === 1`);
  const vandNamn = await fp.evaluate(`aktivByGid.get(${vandGid}).name`);
  const bSamma = q => q.r === bFore.r && q.f === bFore.f && q.t === bFore.t && q.poang === bFore.poang && q.fb === bFore.fb
    && q.fram === bFore.fram && !q.lock;
  ok('flaggtavla: Bildquiz — en hittad flagga vänds till flaggan och tillbaka, utan att räknas',
    !bFlagga.vand && bFlagga.flaggaSyns && bFlagga.flaggaHel && !bFlagga.minneSyns && bFlagga.platt && bFlagga.minnen === 1
    && bFlagga.pressed === 'false' && bFlagga.label === vandNamn + ', hittad – visa minnesbilden' && bFlagga.ram && bFlagga.bock
    && bFlagga.namn === vandNamn && bMinne.vand && bMinne.klar && bMinne.minneSyns && !bMinne.flaggaSyns && bMinne.platt
    && bMinne.minnen === 1 && sammaBild && bMinne.pressed === 'true' && bMinne.label === vandNamn + ', hittad – visa flaggan'
    && bMinne.ram && bMinne.bock && bSamma(bFlaggaQ) && bSamma(bMinneQ) && bFore.t !== vandGid,
    JSON.stringify({ bFlagga, bMinne, sammaBild, bFore, bFlaggaQ }).slice(0, 400));
  // en ohittad flagga svarar som förut: rätt flagga räknas och vänds
  const nyGid = await fp.evaluate('seterraTarget.gid');
  await fp.click(`#flaggtavla .tavla-ruta[data-gid="${nyGid}"]`);
  await vantaVila(fp, nyGid, true);
  const nySvar = await fp.evaluate(`({ r: seterraCorrect, f: seterraWrong, nasta: !seterraTarget || seterraTarget.gid !== ${nyGid},
    hittad: document.querySelector('#flaggtavla .tavla-ruta[data-gid="${nyGid}"]').classList.contains('hittad') })`);
  const nyVand = await fp.evaluate(VAND_LAGE + `(${nyGid})`);
  ok('flaggtavla: en ohittad flagga svarar som förut (efter vändningarna)',
    nySvar.r === bFore.r + 1 && nySvar.f === bFore.f && nySvar.nasta && nySvar.hittad && nyVand.vand && nyVand.klar,
    JSON.stringify({ nySvar, nyVand: nyVand.klass }));
  // Spela igen bygger en ny tavla: alla rutor på flaggan, inga vända
  const omBygg = await fp.evaluate(`(() => {
    const fore = document.querySelector('#flaggtavla .tavla-ruta');
    document.getElementById('seterra-restart').click();
    const rutor = [...document.querySelectorAll('#flaggtavla .tavla-ruta')];
    return { ny: !rutor.includes(fore) && rutor.length === COUNTRIES.length, r: seterraCorrect,
      orord: rutor.every(b => !b.querySelector('.tavla-minne') && !b.hasAttribute('aria-pressed')
        && !/hittad|vandbar|vand|minne|flagga-igen/.test(b.className) && b.getAttribute('aria-label') === 'Flagga') };
  })()`);
  ok('flaggtavla: Spela igen börjar med alla flaggor ovända', omBygg.ny && omBygg.r === 0 && omBygg.orord, JSON.stringify(omBygg));
  // kompisutmaning: ingen växel och inget flaggläge i quizet, och Utforskas
  // växel har ingen Flaggor-knapp (även med Flaggor valt där)
  const utm = await fp.evaluate(`(() => {
    aktivUtmaning = { id: 'test', data: {}, namn: 'Test' };
    uppdateraHuvudstadslage();
    const r = { vis: document.getElementById('fraga-val').style.display, lage: flagglage, key: HS_KEY,
      tavla: document.getElementById('flaggtavla').hidden };
    villUtforska = 'flagga';          // som om Flaggor var valt i Utforska (inte sparat)
    switchMode('explore', true);
    r.utfFlagga = document.querySelector('#utforska-val [data-utforska="flagga"]').style.display;
    r.utfAktiv = document.querySelector('#utforska-val .fraga-btn.active').dataset.utforska;
    r.utf = utforskaFlaggor || !document.getElementById('flaggtavla').hidden;
    aktivUtmaning = null;
    villUtforska = 'land';
    switchMode('bildquiz', true);
    return r;
  })()`);
  ok('flaggtavla: inte i en kompisutmaning', utm.vis === 'none' && !utm.lage && utm.key === 'bild-glob-sydamerika-highscores'
    && utm.tavla && utm.utfFlagga === 'none' && utm.utfAktiv === 'land' && !utm.utf, JSON.stringify(utm));
  // Flaggor i quizet (sparat i 'quiz-fraga') ändrar inte Utforska: efter
  // omladdning öppnar Utforska på globen med Länder, som förut
  const laddaOm = async () => {
    await fp.reload({ waitUntil: 'domcontentloaded' });
    await fp.waitForFunction("document.getElementById('spel-load').style.display === 'none'" +
      " && typeof HS_KEY === 'string' && HS_KEY.includes('sydamerika') && COUNTRIES.length > 0 && !!map.getLayer('stad-mal')",
      null, { timeout: 30000 });
    await fp.waitForTimeout(300);
  };
  await laddaOm();
  const orord = await fp.evaluate(`({ quiz: localStorage.getItem('quiz-fraga'), utforska: localStorage.getItem('utforska-fraga'),
    val: villUtforska, lage: utforskaFlaggor, tavla: document.getElementById('flaggtavla').hidden,
    aktiv: document.querySelector('#utforska-val .fraga-btn.active').dataset.utforska,
    karta: (getComputedStyle(document.getElementById('map-panel'), '::after').content === 'none' ? 'synlig' : 'täckt'), hint: headerHint.textContent })`);
  ok('flaggtavla: Flaggor i quizet ändrar inte Utforskas val', orord.quiz === 'flagga' && orord.utforska === null
    && orord.val === 'land' && !orord.lage && orord.tavla && orord.aktiv === 'land' && orord.karta === 'synlig'
    && orord.hint === 'Klicka på ett land', JSON.stringify(orord));
  // Flaggor i Utforskas växel: tavlan och inga stadscirklar; valet sparas
  // (och loggas) i 'utforska-fraga', quizens val står kvar
  await fp.evaluate(`(() => { window.__kakor = []; const kak = window.kakSpara;
    window.kakSpara = (n, p) => { window.__kakor.push([n, p]); kak?.(n, p); }; })()`);
  await fp.click('#utforska-val [data-utforska="flagga"]');
  await fp.waitForTimeout(300);
  const utfVal = await fp.evaluate(`({ sparat: localStorage.getItem('utforska-fraga'), quiz: localStorage.getItem('quiz-fraga'),
    lage: utforskaFlaggor, tavla: !document.getElementById('flaggtavla').hidden, stader: map.getFilter('stad-mal')[2][1].length,
    stadLage: utforskStadLage(), aktiv: document.querySelector('#utforska-val .fraga-btn.active').dataset.utforska,
    kaka: JSON.stringify(window.__kakor.find(k => k[0] === 'utforska_vald')) })`);
  ok('flaggtavla: Flaggor i Utforska visar tavlan och inga stadscirklar', utfVal.sparat === 'flagga' && utfVal.quiz === 'flagga'
    && utfVal.lage && utfVal.tavla && utfVal.stader === 0 && !utfVal.stadLage && utfVal.aktiv === 'flagga'
    && /"fraga":"flagga"/.test(utfVal.kaka), JSON.stringify(utfVal));
  // valet ligger kvar efter omladdning — och Utforska öppnar på tavlan
  await laddaOm();
  const utf = await fp.evaluate(`(async () => {
    await laddaFlaggbilder();
    const rutor = [...document.querySelectorAll('#flaggtavla .tavla-ruta')];
    const namn = rutor.map(b => b.querySelector('.tavla-namn').textContent);
    return { sparat: localStorage.getItem('utforska-fraga'), lage: utforskaFlaggor, quiz: flagglage,
      tavla: !document.getElementById('flaggtavla').hidden, stader: map.getFilter('stad-mal')[2][1].length,
      n: rutor.length, alfa: namn.join('|') === [...namn].sort((a, b) => a.localeCompare(b, 'sv')).join('|'),
      // v101: knappen säger att ett klick visar minnesbilden (och vänder flaggan)
      namnOk: rutor.every(b => b.getAttribute('aria-label') === b.querySelector('.tavla-namn').textContent + ' – visa minnesbilden'
        && b.getAttribute('aria-pressed') === 'false' && b.classList.contains('vandbar') && b.textContent.trim()),
      aktiv: document.querySelector('#utforska-val .fraga-btn.active').dataset.utforska,
      hint: headerHint.textContent, karta: (getComputedStyle(document.getElementById('map-panel'), '::after').content === 'none' ? 'synlig' : 'täckt'),
      knappar: getComputedStyle(document.getElementById('explore-toggle-buttons')).display };
  })()`);
  ok("flaggtavla: 'utforska-fraga' = flagga ligger kvar efter omladdning", utf.sparat === 'flagga' && utf.lage && utf.tavla
    && utf.aktiv === 'flagga' && utf.stader === 0, JSON.stringify(utf));
  ok('flaggtavla: Utforska visar tavlan i bokstavsordning med namnen',
    utf.lage && !utf.quiz && utf.tavla && utf.n === 13 && utf.alfa && utf.namnOk && utf.aktiv === 'flagga'
    && utf.hint === 'Klicka på en flagga' && utf.karta === 'täckt' && utf.knappar === 'none', JSON.stringify(utf));
  const brGid = await fp.evaluate("COUNTRIES.find(c => c.namnSv === 'Brasilien').gid");
  await fp.click(`#flaggtavla .tavla-ruta[data-gid="${brGid}"]`);
  await fp.waitForTimeout(300);
  await vantaVila(fp, brGid, true);
  const uVand = await fp.evaluate(VAND_LAGE + `(${brGid})`);
  const kort = await fp.evaluate(`(() => {
    const r = document.getElementById('info-flagga');
    const b = document.querySelector('#flaggtavla .tavla-ruta[data-gid="${brGid}"]');
    const p = document.querySelector('#info-panel .info-panel-content').getBoundingClientRect();
    return { kort: infoCard.classList.contains('active') && document.getElementById('info-name').textContent.includes('Brasilien'),
      vis: r.style.display !== 'none' && r.offsetHeight > 0, flagga: !!r.querySelector('img.flagg-riktig[src*="assets/flaggor/br.svg"]'),
      // Flaggan direkt under namnet, och i bild utan att skrolla
      forst: document.getElementById('info-name').nextElementSibling === r && r.getBoundingClientRect().top < p.bottom - 200,
      minne: !!r.querySelector('img.flagg-minnesbild'), text: r.textContent.includes('BRASILIENS'),
      raknat: document.getElementById('explored-count').textContent, utforskad: utforskade.has(${brGid}),
      bock: b.classList.contains('utforskad') && b.classList.contains('aktiv'),
      stangHint: getComputedStyle(document.querySelector('#info-card .close-hint')).display };
  })()`);
  // v101: flera flaggor kan vara vända samtidigt (Chile också)
  const clGid = await fp.evaluate("COUNTRIES.find(c => c.namnSv === 'Chile').gid");
  await fp.click(`#flaggtavla .tavla-ruta[data-gid="${clGid}"]`);
  await vantaVila(fp, clGid, true);
  const tva = await fp.evaluate(`({ br: document.querySelector('#flaggtavla .tavla-ruta[data-gid="${brGid}"]').classList.contains('vand-klar'),
    cl: document.querySelector('#flaggtavla .tavla-ruta[data-gid="${clGid}"]').classList.contains('vand-klar'),
    raknat: document.getElementById('explored-count').textContent,
    kortCl: document.getElementById('info-name').textContent.includes('Chile') })`);
  // ett klick till på Brasilien döljer inget (kortet står kvar på landet)
  // men vänder tillbaka till flaggan, och räknas inte igen
  await fp.click(`#flaggtavla .tavla-ruta[data-gid="${brGid}"]`);
  await vantaVila(fp, brGid, false);
  const kvar = await fp.evaluate(`({ kort: infoCard.classList.contains('active'), raknat: document.getElementById('explored-count').textContent,
    avtackt: revealed.has(${brGid}), brKort: document.getElementById('info-name').textContent.includes('Brasilien'),
    clVand: document.querySelector('#flaggtavla .tavla-ruta[data-gid="${clGid}"]').classList.contains('vand-klar') })`);
  const uFlagga = await fp.evaluate(VAND_LAGE + `(${brGid})`);
  ok('flaggtavla: en flagga i Utforska öppnar landets kort och räknas som utforskad',
    kort.kort && kort.vis && kort.flagga && kort.forst && kort.minne && kort.text && kort.raknat === '1' && kort.utforskad && kort.bock
    && kort.stangHint === 'none' && kvar.kort && kvar.raknat === '2' && kvar.avtackt && kvar.brKort, JSON.stringify({ ...kort, kvar }));
  ok('flaggtavla: Utforska — klicket vänder flaggan till minnesbilden, nästa klick tillbaka, flera kan vara vända',
    uVand.vand && uVand.klar && uVand.minneSyns && uVand.minneData && !uVand.flaggaSyns && uVand.platt && uVand.minnen === 1
    && uVand.pressed === 'true' && uVand.label === 'Brasilien – visa flaggan' && uVand.namn === 'Brasilien'
    && tva.br && tva.cl && tva.raknat === '2' && tva.kortCl
    && !uFlagga.vand && !uFlagga.klar && uFlagga.flaggaSyns && !uFlagga.minneSyns && uFlagga.platt && uFlagga.minnen === 1
    && uFlagga.pressed === 'false' && uFlagga.label === 'Brasilien – visa minnesbilden' && kvar.clVand,
    JSON.stringify({ uVand, tva, uFlagga: uFlagga.klass, kvar }).slice(0, 400));
  // Länder i Utforska: tillbaka till globen, landet är avtäckt där och
  // räknaren står kvar (Länder och Flaggor upptäcker samma länder); landets
  // kort på globen har också Flaggan
  await fp.click('#utforska-val [data-utforska="land"]');
  const land = await fp.evaluate(`(async () => {
    const r = { tavla: document.getElementById('flaggtavla').hidden, karta: (getComputedStyle(document.getElementById('map-panel'), '::after').content === 'none' ? 'synlig' : 'täckt'),
      knappar: getComputedStyle(document.getElementById('explore-toggle-buttons')).display,
      sparat: localStorage.getItem('utforska-fraga'), quiz: localStorage.getItem('quiz-fraga'), lage: utforskaFlaggor, raknat: document.getElementById('explored-count').textContent,
      avtackt: revealed.has(${brGid}) && !landState(${brGid}).tackt, hint: headerHint.textContent,
      platshallare: document.querySelector('#info-default p').textContent,
      // kartan är nåbar igen och har fått det som hände under tavlan
      inert: document.getElementById('spel-map').inert || kartaTackt,
      synkad: map.getFeatureState({ source: 'regioner', id: ${brGid} }).tackt === false,
      flaggRutaHemma: !!document.getElementById('info-flagga').closest('.info-side'),
      // tavlan gick: Chile är vänd tillbaka till flaggan när den kommer igen
      ovanda: [...document.querySelectorAll('#flaggtavla .tavla-ruta')].every(b => !/(^| )(vand|vand-klar|minne)( |$)/.test(b.className)
        && b.getAttribute('aria-pressed') !== 'true') };
    const ar = COUNTRIES.find(c => c.namnSv === 'Argentina');
    exploreClick(ar, null);
    r.kortFlagga = document.getElementById('info-flagga').style.display !== 'none'
      && !!document.querySelector('#info-flagga img.flagg-riktig[src*="assets/flaggor/ar.svg"]');
    return r;
  })()`);
  ok('flaggtavla: Länder i Utforska ger tillbaka globen (och Utforskas vända flaggor vänds tillbaka)',
    land.tavla && land.karta === 'synlig' && land.knappar !== 'none' && land.sparat === 'land' && land.quiz === 'flagga' && !land.lage
    && land.raknat === '2' && land.avtackt && land.ovanda && land.hint === 'Klicka på ett land' && /på globen/.test(land.platshallare)
    && land.kortFlagga && !land.inert && land.synkad && land.flaggRutaHemma, JSON.stringify(land));
  // Flaggor → Huvudstäder: tavlan försvinner helt (globen är nåbar, inga
  // kvarglömda täcken) och städerna är vita cirklar — ett nytt pass, som i v99
  await fp.click('#utforska-val [data-utforska="flagga"]');
  await fp.waitForTimeout(200);
  await fp.click('#utforska-val [data-utforska="huvudstad"]');
  await fp.waitForTimeout(300);
  const stad = await fp.evaluate(`({ tavla: document.getElementById('flaggtavla').hidden,
    tackt: kartaTackt || document.getElementById('map-panel').classList.contains('tavla-pa') || document.getElementById('spel-map').inert,
    karta: (getComputedStyle(document.getElementById('map-panel'), '::after').content === 'none' ? 'synlig' : 'täckt'), lage: utforskStadLage(), utf: utforskaFlaggor,
    mal: map.getFilter('stad-mal')[2][1].length, prickar: map.getLayoutProperty('prickar', 'visibility'),
    sparat: localStorage.getItem('utforska-fraga'), raknat: document.getElementById('explored-count').textContent,
    avtackt: revealed.size, aktiv: document.querySelector('#utforska-val .fraga-btn.active').dataset.utforska,
    hint: headerHint.textContent, knappar: getComputedStyle(document.getElementById('explore-toggle-buttons')).display })`);
  ok('flaggtavla: Huvudstäder efter Flaggor visar stadscirklarna och ingen tavla', stad.tavla && !stad.tackt
    && stad.karta === 'synlig' && stad.lage && !stad.utf && stad.mal === 13 && stad.prickar === 'none' && stad.sparat === 'huvudstad'
    && stad.raknat === '0' && stad.avtackt === 0 && stad.aktiv === 'huvudstad' && /vit cirkel/.test(stad.hint)
    && stad.knappar !== 'none', JSON.stringify(stad));
  // Huvudstäder → Flaggor mitt i en ✨-blinkning med en upptäckt stad: allt
  // det städas bort innan tavlan kommer (som v99:s byte Länder/Huvudstäder)
  const stadad = await fp.evaluate(`(async () => {
    const c = COUNTRIES.find(x => x.namnSv === 'Bolivia');
    exploreClick(c, null);
    await new Promise(r => setTimeout(r, 200));     // huvudstadDirty väntar en bildruta
    // (v102: en upptäckt stad har en vit namnruta, stad-etikett)
    const fore = revealed.has(c.gid) && map.getFilter('stad-etikett')[2][1].includes(c.gid);
    document.getElementById('blink-kvar-btn').click();
    await new Promise(r => setTimeout(r, 300));
    const blinkar = blinkKvarTimer !== null;
    document.querySelector('#utforska-val [data-utforska="flagga"]').click();
    await new Promise(r => setTimeout(r, 300));
    return { fore, blinkar, timer: blinkKvarTimer === null, avtackt: revealed.size, utforskade: utforskade.size,
      raknat: document.getElementById('explored-count').textContent, kort: infoCard.classList.contains('active'),
      tavla: !document.getElementById('flaggtavla').hidden, mal: map.getFilter('stad-mal')[2][1].length,
      etikett: map.getFilter('stad-etikett')[2][1].length, rad: getComputedStyle(document.getElementById('utforsk-bild-rad')).display,
      tips: COUNTRIES.filter(x => (map.getFeatureState({ source: 'huvudstader', id: x.gid }) || {}).tips).length,
      gula: COUNTRIES.filter(x => landState(x.gid).tips).length, hint: headerHint.textContent };
  })()`);
  ok('flaggtavla: Flaggor efter Huvudstäder städar städernas läge', stadad.fore && stadad.blinkar && stadad.timer
    && stadad.avtackt === 0 && stadad.utforskade === 0 && stadad.raknat === '0' && !stadad.kort && stadad.tavla
    && stadad.mal === 0 && stadad.etikett === 0 && stadad.rad === 'none' && stadad.tips === 0 && stadad.gula === 0
    && stadad.hint === 'Klicka på en flagga', JSON.stringify(stadad));
  // och tillbaka till Länder: globen exakt som i Länder-läget
  await fp.click('#utforska-val [data-utforska="land"]');
  await fp.waitForTimeout(300);
  const landIgen = await fp.evaluate(`({ tavla: document.getElementById('flaggtavla').hidden, karta: (getComputedStyle(document.getElementById('map-panel'), '::after').content === 'none' ? 'synlig' : 'täckt'),
    tackt: kartaTackt || document.getElementById('spel-map').inert, lage: utforskStadLage() || utforskaFlaggor,
    mal: map.getFilter('stad-mal')[2][1].length, prickar: map.getLayoutProperty('prickar', 'visibility'),
    sparat: localStorage.getItem('utforska-fraga'), ord: document.getElementById('utforsk-ord').textContent,
    stang: document.getElementById('stang-ord').textContent, hint: headerHint.textContent,
    tackta: COUNTRIES.every(c => landState(c.gid).tackt && map.getFeatureState({ source: 'regioner', id: c.gid }).tackt) })`);
  ok('flaggtavla: Länder efter Huvudstäder och Flaggor ger globen som förut', landIgen.tavla && landIgen.karta === 'synlig'
    && !landIgen.tackt && !landIgen.lage && landIgen.mal === 0 && landIgen.prickar === 'visible' && landIgen.sparat === 'land'
    && landIgen.ord === 'länder' && landIgen.stang === 'landet' && landIgen.hint === 'Klicka på ett land' && landIgen.tackta,
    JSON.stringify(landIgen));
  // quizen: Utforskas Länder rörde inte quizens val (quizet öppnar på
  // tavlan), och quizens egen Länder-knapp ger tillbaka globen — som förut
  const quizLand = await fp.evaluate(`(() => {
    switchMode('seterra', true);
    const fore = flagglage && !document.getElementById('flaggtavla').hidden;
    document.querySelector('#fraga-val [data-fraga="land"]').click();
    return { fore, sparat: localStorage.getItem('quiz-fraga'), utforska: localStorage.getItem('utforska-fraga'),
      key: HS_KEY, lage: flagglage, tavla: document.getElementById('flaggtavla').hidden,
      karta: (getComputedStyle(document.getElementById('map-panel'), '::after').content === 'none' ? 'synlig' : 'täckt'),
      fraga: document.getElementById('seterra-target-name').textContent === seterraTarget.name,
      etikett: cursorLabel.textContent === seterraTarget.name && !cursorLabel.classList.contains('tavla-etikett'),
      hitta: document.getElementById('hitta-ord').textContent, iQuiz: !!document.getElementById('fraga-val').closest('#seterra-ui') };
  })()`);
  ok('flaggtavla: Länder i quizet ger tillbaka globen', quizLand.fore && quizLand.sparat === 'land' && quizLand.utforska === 'land'
    && quizLand.key === 'glob-sydamerika-highscores' && !quizLand.lage
    && quizLand.tavla && quizLand.karta === 'synlig' && quizLand.fraga && quizLand.etikett && quizLand.hitta === 'Hitta detta land:'
    && quizLand.iQuiz, JSON.stringify(quizLand));
  // och ett riktigt klick på globen räknas som förut (Brasilien mitt i bild)
  const pt = await fp.evaluate(`(async () => {
    const br = COUNTRIES.find(c => c.namnSv === 'Brasilien');
    seterraQueue = seterraQueue.filter(c => c !== br); seterraQueue.push(seterraTarget); seterraQueue.push(br); nextSeterraTarget();
    map.jumpTo({ center: [-51, -10], zoom: 3 });
    await new Promise(res => { map.once('idle', res); setTimeout(res, 8000); });
    const p = map.project([-51, -10]), r = map.getCanvas().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y, ratt: seterraCorrect, gid: br.gid };
  })()`);
  await fp.mouse.move(pt.x - 30, pt.y - 20);
  await fp.mouse.click(pt.x, pt.y);
  await fp.waitForTimeout(300);
  const kartKlick = await fp.evaluate(`({ ratt: seterraCorrect, nasta: seterraTarget && seterraTarget.gid !== ${pt.gid} })`);
  ok('flaggtavla: efter Flaggor svarar ett klick på globen som förut', kartKlick.ratt === pt.ratt + 1 && kartKlick.nasta,
    JSON.stringify({ pt, kartKlick }));
  const lagerEfter = await fp.evaluate("map.getStyle().layers.length + '/' + Object.keys(map.getStyle().sources).length");
  ok('flaggtavla: inga nya kartlager eller källor', lagerFore === lagerEfter, lagerFore + ' → ' + lagerEfter);
  const tur = await fp.evaluate("SPEL_TOUR.map(s => s.text).find(t => /Flaggor/.test(t)) || ''");
  ok('flaggtavla: rundturen beskriver tavlan', /tavla/.test(tur) && /rätt flagga/.test(tur), tur.slice(0, 120));
  // Flaggor-steget pekar på samma knapp som Huvudstäder-steget (Klassiskt
  // Quiz): texten handlar om quizen, inte om Utforskas Flaggor-knapp
  const turEl = await fp.evaluate(`(() => {
    const steg = t => SPEL_TOUR.find(s => s.text && t.test(s.text));
    const hs = steg(/välja Huvudstäder/), fl = steg(/välj Flaggor/);
    const quiz = document.querySelector('.mode-btn[data-mode="seterra"]');
    return { hs: hs.el() === quiz, fl: fl.el() === quiz };
  })()`);
  ok('flaggtavla: rundturens Flaggor-steg pekar på Klassiskt Quiz som Huvudstäder-steget', turEl.hs && turEl.fl, JSON.stringify(turEl));
  ok('flaggtavla: inga JS-fel', fFel.filter(e => !/firebase/i.test(e)).length === 0, fFel.join(' | ').slice(0, 160));
  await fp.close();
  // Hela världen: på väg ut ur en flaggregion (←) och in i världsvalet syns
  // ingen gammal tavla och ingen växel; världsrundan får sin egen tavla.
  // Tvillingflaggan på tavlan räknas inte som fel. Kartans utforska-tooltip
  // ligger inte kvar över tavlan.
  const wp = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  const wFel = [];
  wp.on('pageerror', e => wFel.push(String(e)));
  await wp.addInitScript(INIT_LS + "; localStorage.setItem('quiz-fraga','flagga'); localStorage.setItem('utforska-fraga','flagga')");
  await wp.goto(BASE + '/glob.html?region=sydamerika', { waitUntil: 'domcontentloaded' });
  await wp.waitForFunction("document.getElementById('spel-load').style.display === 'none'" +
    " && typeof HS_KEY === 'string' && HS_KEY.includes('sydamerika') && COUNTRIES.length > 0", null, { timeout: 30000 });
  await wp.waitForTimeout(300);
  const tip = await wp.evaluate(`(() => {
    const fore = !document.getElementById('flaggtavla').hidden;
    document.querySelector('#utforska-val [data-utforska="land"]').click();
    exploreClick(COUNTRIES[0], { clientX: 300, clientY: 300 });
    const tt = cursorLabel.style.display === 'block' && cursorLabel.classList.contains('explore-tooltip');
    document.querySelector('#utforska-val [data-utforska="flagga"]').click();
    return { fore, tt, efter: cursorLabel.style.display === 'none' && !cursorLabel.classList.contains('explore-tooltip') };
  })()`);
  ok('flaggtavla: kartans tooltip ligger inte kvar över tavlan', tip.fore && tip.tt && tip.efter, JSON.stringify(tip));
  await wp.click('#back-btn');
  await wp.waitForTimeout(600);
  await wp.evaluate("gaTillRegion('world')");
  await wp.waitForTimeout(1200);
  const val0 = await wp.evaluate(`({ tavla: document.getElementById('flaggtavla').hidden,
    tackt: document.getElementById('map-panel').classList.contains('tavla-pa') || kartaTackt || document.getElementById('spel-map').inert,
    vx: document.getElementById('utforska-val').style.display, fv: document.getElementById('fraga-val').style.display,
    utf: utforskaFlaggor, slug: aktivSlug,
    overlay: document.getElementById('world-setup-overlay').classList.contains('active'), hint: headerHint.textContent })`);
  ok('flaggtavla: världsvalet efter en flaggregion visar globen, ingen tavla',
    val0.tavla && !val0.tackt && val0.vx === 'none' && val0.fv === 'none' && !val0.utf && !val0.slug && val0.overlay && val0.hint === 'Klicka på ett land',
    JSON.stringify(val0));
  await wp.click('#world-start-btn');
  await wp.waitForFunction("aktivSlug === 'world' && flagglage && document.querySelectorAll('#flaggtavla .tavla-ruta').length === COUNTRIES.length",
    null, { timeout: 30000 }).catch(() => {});
  const varld = await wp.evaluate("({ lage: flagglage, n: document.querySelectorAll('#flaggtavla .tavla-ruta').length, total: COUNTRIES.length, key: HS_KEY })");
  ok('flaggtavla: världsrundan får sin tavla', varld.lage && varld.n === varld.total && varld.n > 0 && /^flagga-/.test(varld.key),
    JSON.stringify(varld));
  // en världsrunda med tvillingarna: frågan Monaco, klick på Indonesiens flagga
  const tv = await wp.evaluate(`(async () => {
    const lista = [];
    for (const slug of WORLD_SLUGS) lista.push(...buildCountries(slug, await loadRegionConfig(slug)));
    const ids = ['Indonesien', 'Monaco', 'Tchad', 'Rumänien', 'Sverige', 'Kenya'].map(n => lista.find(c => c.namnSv === n).gid);
    await startWorld(ids.length, ids);
    const mon = COUNTRIES.find(c => c.namnSv === 'Monaco');
    seterraQueue = seterraQueue.filter(c => c !== mon); seterraQueue.push(seterraTarget); seterraQueue.push(mon); nextSeterraTarget();
    return { n: document.querySelectorAll('#flaggtavla .tavla-ruta').length, t: seterraTarget.namnSv,
      ind: COUNTRIES.find(c => c.namnSv === 'Indonesien').gid };
  })()`);
  await wp.click(`#flaggtavla .tavla-ruta[data-gid="${tv.ind}"]`);
  const tv2 = await wp.evaluate(`({ fel: seterraWrong, t: seterraTarget.namnSv,
    orange: document.querySelector('#flaggtavla .tavla-ruta[data-gid="${tv.ind}"]').classList.contains('tvilling'),
    text: seterraFeedback.textContent })`);
  ok('flaggtavla: tvillingflaggan på tavlan räknas inte som fel', tv.n === 6 && tv.t === 'Monaco' && tv2.fel === 0
    && tv2.t === 'Monaco' && tv2.orange && tv2.text.includes('Det där var Indonesiens flagga – nästan likadan som Monacos!'),
    JSON.stringify({ tv, tv2 }));
  ok('flaggtavla: inga JS-fel i världsrundan', wFel.filter(e => !/firebase/i.test(e)).length === 0, wFel.join(' | ').slice(0, 160));
  await wp.close();
  // Europa: England, Skottland och Wales har fått Jonas minnesbilder —
  // ledtråden och rätt svar visar Englands, och landets kort har Flaggan.
  // Utforskas växel har alla tre valen även här.
  const ep = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  await ep.addInitScript(INIT_LS + "; localStorage.setItem('quiz-fraga','flagga')");
  await ep.goto(BASE + '/glob.html?region=europa', { waitUntil: 'domcontentloaded' });
  await ep.waitForFunction("document.getElementById('spel-load').style.display === 'none'" +
    " && typeof HS_KEY === 'string' && HS_KEY.includes('europa') && COUNTRIES.length > 40", null, { timeout: 40000 });
  const eu = await ep.evaluate(`(async () => {
    document.getElementById('del-overlay')?.classList.remove('active');
    const synliga = sel => [...document.querySelectorAll(sel)].filter(b => b.style.display !== 'none').map(b => b.textContent).join('|');
    const utfKnappar = synliga('#utforska-val .fraga-btn');
    switchMode('seterra', true);
    await laddaFlaggbilder();
    const knappar = synliga('#fraga-val .fraga-btn');
    const tavla = document.getElementById('flaggtavla');
    const eng = COUNTRIES.find(c => c.namnSv === 'England');
    seterraQueue = seterraQueue.filter(c => c !== eng); seterraQueue.push(eng); nextSeterraTarget();
    const hint = document.getElementById('seterra-hint');
    const engBild = 'img.flagg-minnesbild[src^="assets/flaggbilder/england.webp"]';
    const r = { utfKnappar, knappar, key: HS_KEY, lage: flagglage, n: tavla.querySelectorAll('.tavla-ruta').length, total: COUNTRIES.length,
      // alla flaggor ryms på datorn: man ska se hela tavlan på en gång
      ryms: tavla.scrollHeight <= tavla.clientHeight + 1,
      knapp: seterraHintBtn.style.display !== 'none', ni: (FLAGGBILD.get('Nordirland') || {}).bild,
      skWa: ['Skottland', 'Wales'].every(n => new RegExp('flaggbilder/' + n.toLowerCase() + '\\.webp')
        .test(flaggMinneHtml(COUNTRIES.find(c => c.namnSv === n), true))) };
    seterraHintBtn.click();
    r.hint = hint.style.display !== 'none' && !!hint.querySelector(engBild) && hint.textContent.includes(FLAGGBILD.get('England').text);
    tavla.querySelector('.tavla-ruta[data-gid="' + eng.gid + '"]').click();
    r.ratt = !!seterraFeedback.querySelector(engBild)
      && !!seterraFeedback.querySelector('.fb-flagg-titel img.fb-flagga[src="assets/flaggor/gbeng.svg"]');
    r.tre = document.querySelector('#seterra-ui .info-header').classList.contains('tre-val');
    switchMode('explore', true);
    exploreClick(eng, null);
    const ruta = document.getElementById('info-flagga');
    r.kort = ruta.style.display !== 'none' && !!ruta.querySelector(engBild)
      && !!ruta.querySelector('img.flagg-riktig[src="assets/flaggor/gbeng.svg"]');
    return r;
  })()`);
  ok('flaggtavla: Europa ryms på datorn, England har sin minnesbild',
    eu.knappar === 'Länder|Huvudstäder|Flaggor' && eu.utfKnappar === 'Länder|Huvudstäder|Flaggor' && eu.lage
    && eu.key === 'flagga-glob-europa-highscores' && eu.n === eu.total && eu.ryms && eu.knapp && eu.hint && eu.ratt && eu.skWa
    && eu.tre && eu.kort && /storbritannien\.webp$/.test(eu.ni || ''), JSON.stringify(eu));
  // Bildquiz: svaret skrollar panelen, men rubrikraden (Klassiskt Quiz och
  // växeln) står hel eller är helt bortskrollad, aldrig halvt kapad — och
  // svaret syns helt under den fästa frågan
  const rubrikSkroll = await ep.evaluate(`(async () => {
    switchMode('bildquiz', true);
    const vila = ms => new Promise(r => setTimeout(r, ms));
    const rulla = document.querySelector('#seterra-ui').closest('.info-panel-content');
    const hdr = document.querySelector('#seterra-ui > .info-header');
    const mal = document.querySelector('#seterra-game .seterra-target');
    const lagen = [];
    const mat = () => {
      const p = rulla.getBoundingClientRect(), fb = seterraFeedback.getBoundingClientRect();
      const kant = hdr.getBoundingClientRect().bottom - p.top + rulla.scrollTop;
      const s = rulla.scrollTop, max = rulla.scrollHeight - rulla.clientHeight;
      lagen.push({ s: Math.round(s), kant: Math.round(kant), max,
        hel: s < 1 || s >= kant - 1 || max < kant,
        svar: fb.top >= mal.getBoundingClientRect().bottom - 1 && fb.bottom <= p.bottom + 1 });
    };
    for (let i = 0; i < 6; i++) {
      document.querySelector('#flaggtavla .tavla-ruta[data-gid="' + seterraTarget.gid + '"]').click();
      await vila(900);
      mat();
    }
    return lagen;
  })()`);
  ok('flaggtavla: svaret kapar aldrig quizens rubrikrad (dator)',
    rubrikSkroll.every(l => l.hel && l.svar) && rubrikSkroll.some(l => l.s > 0), JSON.stringify(rubrikSkroll));
  await ep.close();
  // USA: ingen växel och inga flagglistor, även med Flaggor valt — och
  // flaggorna hämtas inte ens när man klickar på en delstat
  const up = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  const usaUrl = [];
  up.on('request', r => usaUrl.push(r.url()));
  await up.addInitScript(INIT_LS + "; localStorage.setItem('quiz-fraga','flagga'); localStorage.setItem('utforska-fraga','flagga')");
  await up.goto(BASE + '/glob.html?region=usa', { waitUntil: 'domcontentloaded' });
  await up.waitForFunction("document.getElementById('spel-load').style.display === 'none'" +
    " && typeof HS_KEY === 'string' && HS_KEY.includes('usa') && COUNTRIES.length >= 50",
    null, { timeout: 60000 });
  const usa = await up.evaluate(`(async () => {
    const r = { utfVis: document.getElementById('utforska-val').style.display, utf: utforskaFlaggor,
      utfTavla: document.getElementById('flaggtavla').hidden };
    switchMode('seterra', true);
    Object.assign(r, { vis: document.getElementById('fraga-val').style.display, lage: flagglage, key: HS_KEY,
      fraga: document.getElementById('seterra-target-name').textContent === seterraTarget.name,
      tre: document.querySelector('#seterra-ui .info-header').classList.contains('tre-val'),
      tavla: document.getElementById('flaggtavla').hidden });
    switchMode('explore', true);
    exploreClick(COUNTRIES[0], null);
    await new Promise(res => setTimeout(res, 300));
    r.kort = document.getElementById('info-flagga').style.display;
    return r;
  })()`);
  ok('flaggtavla: usa har ingen växel och ingen tavla', usa.vis === 'none' && usa.utfVis === 'none' && !usa.lage && !usa.utf
    && usa.utfTavla && usa.tavla && usa.key === 'glob-usa-highscores' && usa.fraga && !usa.tre
    && usa.kort === 'none' && !usaUrl.some(u => /flaggbilder|assets\/flaggor\//.test(u)), JSON.stringify(usa));
  await up.close();
  // engelska sajten: inget Flaggor-val, ingen tavla och ingen flaggbilder.json
  const en = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  const enUrl = [];
  en.on('request', r => enUrl.push(r.url()));
  await en.addInitScript(INIT_LS + "; localStorage.setItem('quiz-fraga','flagga'); localStorage.setItem('utforska-fraga','flagga')");
  await en.goto(BASE + '/glob.html?lang=en', { waitUntil: 'domcontentloaded' });
  await en.waitForFunction("typeof aktivSlug !== 'undefined' && aktivSlug === 'usa' && COUNTRIES.length > 0",
    null, { timeout: 60000 });
  const eng = await en.evaluate(`(() => {
    const r0 = { utfVis: document.getElementById('utforska-val').style.display, utfTavla: !document.getElementById('flaggtavla') && window.flaggtavla === null };
    switchMode('seterra', true);
    const h = document.querySelector('#seterra-ui .info-header');
    const r = { ...r0, lang: SPRAK.lang, vis: document.getElementById('fraga-val').style.display, lage: flagglage,
      key: HS_KEY, tavla: !document.getElementById('flaggtavla'),
      // rubriken som förut: ingen tre-val-klass, samma storlek som utforska-panelens
      tre: h.classList.contains('tre-val'), h2: getComputedStyle(h.querySelector('h2')).fontSize,
      pad: getComputedStyle(h).paddingLeft };
    switchMode('explore', true);
    exploreClick(COUNTRIES[0], null);
    r.kort = document.getElementById('info-flagga').style.display;
    r.utfLage = utforskaFlaggor;
    return r;
  })()`);
  ok('flaggtavla: engelska sajten har inget Flaggor-val', eng.lang === 'en' && eng.vis === 'none' && eng.utfVis === 'none'
    && !eng.lage && !eng.utfLage && eng.tavla && eng.utfTavla
    && !eng.key.includes('flagga') && eng.kort === 'none' && !enUrl.some(u => /flaggbilder|assets\/flaggor\//.test(u))
    && !eng.tre && eng.h2 === '16px' && eng.pad === '24px',
    JSON.stringify(eng));
  await en.close();
  // startsidan på mobilen: medaljerna packas i ordningen Länder,
  // Huvudstäder, Flaggor utan luckor och når inte filmknappen
  const mp = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mp.addInitScript(INIT_LS + "; ['europa','afrika'].forEach(r => { localStorage.setItem('medalj-' + r, '100');"
    + " localStorage.setItem('medalj-huvudstad-' + r, '95'); localStorage.setItem('medalj-flagga-' + r, '75'); });"
    + " localStorage.setItem('medalj-flagga-asien', '100');");
  await mp.goto(BASE + '/glob.html', { waitUntil: 'domcontentloaded' });
  await mp.waitForFunction("document.body.classList.contains('startlage') && document.querySelector('.start-knappar .medalj-flagga')",
    null, { timeout: 20000 });
  const med = await mp.evaluate(() => {
    const knapp = r => document.querySelector(`.start-knappar a[href="?region=${r}"]`);
    const r = {};
    for (const reg of ['europa', 'afrika', 'asien']) {
      const a = knapp(reg);
      const span = a.querySelector('.medalj-flagga');
      const fl = span.getBoundingClientRect();
      const vid = a.querySelector('.knapp-video').getBoundingClientRect();
      // den lilla flaggan (::after) börjar vid 62 % och är ungefär 1,2 em bred
      const hoger = fl.left + fl.width * 0.62 + parseFloat(getComputedStyle(span, '::after').fontSize) * 1.2;
      r[reg] = { left: Math.round(fl.left - a.getBoundingClientRect().left), luft: Math.round(vid.left - hoger) };
    }
    r.tavla = getComputedStyle(document.getElementById('flaggtavla')).display;
    return r;
  });
  ok('flaggtavla: medaljerna packas och når inte filmknappen (390 px)',
    med.asien.left === -8 && ['europa', 'afrika', 'asien'].every(r => med[r].luft >= 0) && med.tavla === 'none', JSON.stringify(med));
  await mp.close();
  // mobilen (390 px): tavlan ligger ovanför bottenpanelen och skrollar, och
  // landets namn står kvar i bild även när ledtråden skrollat panelen
  const mq = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mFel = [];
  mq.on('pageerror', e => mFel.push(String(e)));
  await mq.addInitScript(INIT_LS + "; localStorage.setItem('quiz-fraga', 'flagga')");
  await mq.goto(BASE + '/glob.html?region=europa', { waitUntil: 'domcontentloaded' });
  await mq.waitForFunction("document.getElementById('spel-load').style.display === 'none'" +
    " && typeof HS_KEY === 'string' && HS_KEY.includes('europa') && COUNTRIES.length > 40", null, { timeout: 40000 });
  // Utforskas växel med tre val ryms i rubrikraden bredvid rubriken, även
  // på smala mobiler (344 px: Galaxy Z Folds yttre skärm, 320 px: minsta).
  // Knapparna är låga, men en osynlig kant ovanför och under tar emot
  // fingret (rubrikraden blir inte högre).
  const RUBRIK_MAT = `(sel => {
    const vx = document.querySelector(sel), h = vx.closest('.info-header'), h2 = h.querySelector('h2');
    const vr = vx.getBoundingClientRect(), tr = h2.getBoundingClientRect(), hr = h.getBoundingClientRect();
    const b = vx.querySelector('.fraga-btn.active'), br = b.getBoundingClientRect();
    const traff = y => { const e = document.elementFromPoint(br.left + br.width / 2, y); return !!e && (e === b || b.contains(e)); };
    return { knappar: [...vx.querySelectorAll('.fraga-btn')].filter(b => b.style.display !== 'none').map(b => b.textContent).join('|'),
      rad: vr.top < tr.bottom && vr.left >= tr.right, inom: vr.right <= innerWidth - 8,
      helRubrik: h2.scrollWidth <= h2.clientWidth, sidled: document.documentElement.scrollWidth <= innerWidth,
      kant: traff(br.top - 5) && traff(br.bottom + 4) && br.top - 6 >= hr.top && br.bottom + 6 <= hr.bottom };
  })`;
  await mq.evaluate("document.getElementById('del-overlay')?.classList.remove('active')");
  const mobVal = {};
  for (const w of [390, 360, 344, 341, 320]) {
    await mq.setViewportSize({ width: w, height: 844 });
    await mq.waitForTimeout(200);
    mobVal[w] = await mq.evaluate(RUBRIK_MAT + "('#utforska-val')");
  }
  await mq.setViewportSize({ width: 390, height: 844 });
  await mq.waitForTimeout(200);
  ok('flaggtavla: Utforskas tre val ryms i rubrikraden på mobilen (390, 360, 344, 341 och 320 px)',
    Object.values(mobVal).every(v => v.knappar === 'Länder|Huvudstäder|Flaggor' && v.rad && v.inom && v.helRubrik && v.sidled && v.kant),
    JSON.stringify(mobVal));
  const mob = await mq.evaluate(`(async () => {
    document.getElementById('del-overlay')?.classList.remove('active');
    switchMode('seterra', true);
    await laddaFlaggbilder();
    const vila = ms => new Promise(r => setTimeout(r, ms));
    const synlig = el => {
      const b = el.getBoundingClientRect();
      const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return !!e && (e === el || el.contains(e));
    };
    const tavla = document.getElementById('flaggtavla');
    const panel = document.getElementById('info-panel').getBoundingClientRect();
    const tb = tavla.getBoundingClientRect();
    const h = Math.round(document.querySelector('#flaggtavla .tavla-flagga').getBoundingClientRect().height);
    const r = { skrollar: tavla.scrollHeight > tavla.clientHeight + 20, ovanfor: tb.bottom <= panel.top + 1 && tb.top >= 0,
      bredd: tb.left >= 0 && tb.right <= innerWidth, h, etikett: getComputedStyle(cursorLabel).display,
      sidled: document.documentElement.scrollWidth <= innerWidth,
      // panelen är högre i flaggläget (svaret med minnesbild och text)
      panelH: Math.round(panel.height) > innerHeight * 0.36 };
    tavla.scrollTop = 400;
    await vila(100);
    r.skrollat = tavla.scrollTop > 0;
    // en fråga med minnesbild: namnet syns direkt (och i sidhuvudet, som
    // syns på liggande mobil), sedan ett fel på tavlan och ledtråden
    const i = seterraQueue.findIndex(c => flaggbildFor(c));
    const k = seterraQueue.splice(i, 1)[0]; seterraQueue.unshift(seterraTarget); seterraQueue.push(k); nextSeterraTarget();
    const fore = seterraTarget;
    r.namnStart = synlig(document.getElementById('seterra-target-name'));
    r.sidhuvud = headerHint.innerHTML === 'Klicka på flaggan för <b>' + escHtml(fore.name) + '</b>';
    document.querySelector('#flaggtavla .tavla-ruta[data-gid="' + COUNTRIES.find(c => c.gid !== fore.gid && flaggbildFor(c)).gid + '"]').click();
    await vila(900);
    const fb = seterraFeedback.getBoundingClientRect(), fast = document.querySelector('#seterra-game .seterra-target').getBoundingClientRect();
    r.svarEfterFel = seterraWrong === 1 && fb.top >= fast.bottom - 1 && fb.top < document.getElementById('info-panel').getBoundingClientRect().bottom - 150;
    r.knappEfterFel = synlig(seterraHintBtn) && synlig(document.getElementById('seterra-target-name'));
    await vila(700);
    seterraHintBtn.click();
    await vila(1200);
    r.ledtradSyns = synlig(document.getElementById('seterra-hint'));
    r.namnEfterLedtrad = synlig(document.getElementById('seterra-target-name'))
      && document.getElementById('seterra-target-name').textContent === fore.name;
    document.querySelector('#flaggtavla .tavla-ruta[data-gid="' + fore.gid + '"]').click();
    await vila(400);
    r.ny = !!seterraTarget && seterraTarget.gid !== fore.gid;
    r.namnNasta = synlig(document.getElementById('seterra-target-name'));
    return r;
  })()`);
  ok('flaggtavla: mobilen — tavlan skrollar ovanför panelen och namnet syns (390 px)',
    mob.skrollar && mob.skrollat && mob.ovanfor && mob.bredd && mob.h >= 48 && mob.h <= 64 && mob.etikett === 'none' && mob.sidled
    && mob.panelH && mob.namnStart && mob.sidhuvud && mob.svarEfterFel && mob.knappEfterFel
    && mob.ledtradSyns && mob.namnEfterLedtrad && mob.ny && mob.namnNasta, JSON.stringify(mob));
  // v101: pekskärmen — ett tryck på den hittade flaggan vänder den
  // (Klassiskt Quiz: till minnesbilden) och ett till tillbaka, utan svar
  const tGid = await mq.evaluate("document.querySelector('#flaggtavla .tavla-ruta.hittad.vandbar')?.dataset.gid");
  await mq.waitForTimeout(700);   // (ett tryck strax efter svaret hör till svaret, som ett dubbeltryck)
  const tFore = await mq.evaluate('({ r: seterraCorrect, f: seterraWrong, t: seterraTarget && seterraTarget.gid })');
  await mq.tap(`#flaggtavla .tavla-ruta[data-gid="${tGid}"]`);
  await vantaVila(mq, tGid, true);
  const tMinne = await mq.evaluate(VAND_LAGE + `(${tGid})`);
  await mq.waitForTimeout(100);
  await mq.tap(`#flaggtavla .tavla-ruta[data-gid="${tGid}"]`);
  await vantaVila(mq, tGid, false);
  const tFlagga = await mq.evaluate(VAND_LAGE + `(${tGid})`);
  const tEfter = await mq.evaluate('({ r: seterraCorrect, f: seterraWrong, t: seterraTarget && seterraTarget.gid })');
  ok('flaggtavla: mobilen — ett tryck vänder en hittad flagga och ett till tillbaka',
    !!tGid && tMinne.vand && tMinne.klar && tMinne.minneSyns && tMinne.pressed === 'true' && !tFlagga.vand && tFlagga.flaggaSyns
    && !tFlagga.minneSyns && tFlagga.pressed === 'false' && tMinne.minnen === 1 && tFlagga.minnen === 1
    && JSON.stringify(tFore) === JSON.stringify(tEfter), JSON.stringify({ tGid, tMinne: tMinne.klass, tFlagga: tFlagga.klass, tFore, tEfter }));
  // quizens växel (Klassiskt Quiz + tre val) på samma bredder; panelen
  // skrollas upp så att rubrikraden syns
  await mq.waitForTimeout(600);
  await mq.evaluate("document.querySelector('#seterra-ui').closest('.info-panel-content').scrollTop = 0");
  const mobQuiz = {};
  for (const w of [390, 360, 344, 341, 320]) {
    await mq.setViewportSize({ width: w, height: 844 });
    await mq.waitForTimeout(200);
    mobQuiz[w] = await mq.evaluate(RUBRIK_MAT + "('#fraga-val')");
  }
  await mq.setViewportSize({ width: 390, height: 844 });
  ok('flaggtavla: quizens tre val ryms i rubrikraden på mobilen (390, 360, 344, 341 och 320 px)',
    Object.values(mobQuiz).every(v => v.knappar === 'Länder|Huvudstäder|Flaggor' && v.rad && v.inom && v.helRubrik && v.sidled && v.kant),
    JSON.stringify(mobQuiz));
  ok('flaggtavla: inga JS-fel på mobilen', mFel.filter(e => !/firebase/i.test(e)).length === 0, mFel.join(' | ').slice(0, 160));
  await mq.close();
} catch (e) {
  ok('flaggtavla: quizens växel har tre val (Länder, Huvudstäder, Flaggor)', false, String(e).slice(0, 200));
}

// ── v101: vändningen med riktiga övergångar ──
// Ovan är tavlans övergångar avstängda; här går de som hos Jonas. Ett
// dubbelklick eller dubbeltryck är ett klick: klicket som hittade flaggan
// vänder inte tillbaka (Bildquiz behåller minnesbilden, som i v100), och
// två snabba klick på en hittad flagga vänder den en gång. Ett klick mitt
// i en vändning vänder tillbaka därifrån. Efteråt finns inget 3D-läge kvar
// och en enda minnesbild per ruta. Klassiskt Quiz: den bleka flaggan är
// blek medan den vänds bort och när den vänds tillbaka. Tipset om
// vändningen, ↻ vid hovring, förritade minnesbilder, en tavla som växer,
// klick innan flaggbilder.json kommit och en minnesbild som inte gick att
// hämta.
try {
  const INIT_V = "localStorage.setItem('rundtur-klar','1'); localStorage.setItem('speltur-klar','1'); localStorage.setItem('kakval','nej'); localStorage.setItem('feedback-tips-klar','1')";
  const RUTA = gid => `#flaggtavla .tavla-ruta[data-gid="${gid}"]`;
  const LAGE = `(gid => {
    const b = document.querySelector('#flaggtavla .tavla-ruta[data-gid="' + gid + '"]');
    const f = b.querySelector('.tavla-flagga');
    return { klass: b.className, vand: b.classList.contains('vand'), klar: b.classList.contains('vand-klar'),
      i3d: b.classList.contains('minne') || b.classList.contains('direkt'), igen: b.classList.contains('flagga-igen'),
      hittad: b.classList.contains('hittad'), pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label'),
      titel: b.title, minnen: b.querySelectorAll('.tavla-minne').length, op: +getComputedStyle(f).opacity,
      vil: b.vilMinne, ikon: getComputedStyle(b.querySelector('.tavla-kort'), '::after').content };
  })`;
  // vänta tills rutan vilar på den sidan (en vändning tar 700 ms)
  const vantaSida = (pg, gid, minne) => pg.waitForFunction(`(() => {
    const b = document.querySelector('#flaggtavla .tavla-ruta[data-gid="${gid}"]');
    return !b.classList.contains('minne') && b.classList.contains('vand') === ${minne} && b.classList.contains('vand-klar') === ${minne}; })()`,
    null, { timeout: 8000 }).catch(() => {});
  const TAVLA = `(() => { const rutor = [...document.querySelectorAll('#flaggtavla .tavla-ruta')];
    return { kvar3d: rutor.filter(b => /(^| )(minne|direkt)( |$)/.test(b.className)).length,
      dubbla: rutor.filter(b => b.querySelectorAll('.tavla-minne').length > 1).length,
      osynk: rutor.filter(b => b.classList.contains('vandbar') && (b.getAttribute('aria-pressed') === 'true') !== b.classList.contains('vand')).length,
      halv: rutor.filter(b => b.classList.contains('vand') !== b.classList.contains('vand-klar')).length }; })()`;
  const RAKNARE = `({ r: seterraCorrect, f: seterraWrong, t: seterraTarget && seterraTarget.gid })`;
  // nästa fråga är ett land med minnesbild
  const MED_BILD = `(() => { if (!flaggbildFor(seterraTarget)) { const i = seterraQueue.findIndex(c => flaggbildFor(c));
    const k = seterraQueue.splice(i, 1)[0]; seterraQueue.unshift(seterraTarget); seterraQueue.push(k); nextSeterraTarget(); }
    return seterraTarget.gid; })()`;
  const mitt = async (pg, gid) => { const r = await pg.locator(RUTA(gid)).boundingBox(); return [r.x + r.width / 2, r.y + r.height * 0.4]; };
  const rp = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  const rFel = [];
  rp.on('pageerror', e => rFel.push(String(e)));
  await rp.addInitScript(INIT_V + "; localStorage.setItem('quiz-fraga','flagga')");
  await rp.goto(BASE + '/glob.html?region=sydamerika', { waitUntil: 'domcontentloaded' });
  await rp.waitForFunction("document.getElementById('spel-load').style.display === 'none'" +
    " && typeof HS_KEY === 'string' && HS_KEY.includes('sydamerika') && COUNTRIES.length > 0", null, { timeout: 30000 });
  await rp.evaluate("(async () => { switchMode('bildquiz', true); await laddaFlaggbilder(); })()");
  await rp.waitForTimeout(300);
  // Bildquiz: ett dubbelklick på rätt flagga — svaret räknas en gång och
  // minnesbilden står kvar (v101 vände tillbaka till den bleka flaggan)
  const d1 = await rp.evaluate(MED_BILD);
  const dFore = await rp.evaluate(RAKNARE);
  const vinkFore = await rp.evaluate("document.querySelector('#flaggtavla .tavla-vink').classList.contains('syns')");
  await rp.dblclick(RUTA(d1));
  const vink = await rp.evaluate(`(() => { const v = document.querySelector('#flaggtavla .tavla-vink');
    return { syns: v.classList.contains('syns'), text: v.textContent, pe: getComputedStyle(v).pointerEvents }; })()`);
  await rp.waitForFunction(`document.querySelector('${RUTA(d1)}').classList.contains('vand-klar')`, null, { timeout: 8000 }).catch(() => {});
  await rp.waitForTimeout(400);
  const dEfter = await rp.evaluate(LAGE + `(${d1})`);
  const dRakn = await rp.evaluate(RAKNARE);
  ok('flaggvändning: dubbelklick på rätt flagga i Bildquiz — minnesbilden står kvar, svaret räknas en gång',
    dEfter.vand && dEfter.klar && !dEfter.i3d && dEfter.pressed === 'true' && dEfter.minnen === 1
    && dRakn.r === dFore.r + 1 && dRakn.f === dFore.f, JSON.stringify({ dEfter, dFore, dRakn }));
  ok('flaggvändning: tipset om vändningen kommer när den första flaggan hittats',
    !vinkFore && vink.syns && vink.text === 'Klicka på en hittad flagga för att vända den' && vink.pe === 'none', JSON.stringify({ vinkFore, vink }));
  // ett andra klick 60 ms efter svaret hör också till svaret (dubbeltryck)
  const d2 = await rp.evaluate(MED_BILD);
  const [x2, y2] = await mitt(rp, d2);
  await rp.mouse.move(x2, y2);
  await rp.waitForTimeout(250);
  const ikonOhittad = await rp.evaluate(LAGE + `(${d2})`);
  await rp.mouse.click(x2, y2);
  await rp.waitForTimeout(60);
  await rp.mouse.click(x2, y2);
  await rp.waitForFunction(`document.querySelector('${RUTA(d2)}').classList.contains('vand-klar')`, null, { timeout: 8000 }).catch(() => {});
  await rp.waitForTimeout(400);
  const d2Efter = await rp.evaluate(LAGE + `(${d2})`);
  const d2Rakn = await rp.evaluate(RAKNARE);
  // ett klick efter en stund vänder fram flaggan (hel), utan att räknas
  await rp.mouse.click(x2, y2);
  await rp.waitForTimeout(150);
  await vantaSida(rp, d2, false);
  const d2Flagga = await rp.evaluate(LAGE + `(${d2})`);
  const vinkEfter = await rp.evaluate("document.querySelector('#flaggtavla .tavla-vink').classList.contains('syns')");
  // två klick 150 ms isär (ett dubbelklick): en vändning, till minnesbilden
  await rp.waitForTimeout(500);
  await rp.mouse.click(x2, y2);
  await rp.waitForTimeout(150);
  await rp.mouse.click(x2, y2);
  await rp.waitForTimeout(200);
  await vantaSida(rp, d2, true);
  const d2Dubbel = await rp.evaluate(LAGE + `(${d2})`);
  // ett klick mitt i en vändning vänder tillbaka därifrån
  await rp.waitForTimeout(500);
  await rp.mouse.click(x2, y2);
  await rp.waitForTimeout(450);
  const iLuften = await rp.evaluate(LAGE + `(${d2})`);
  await rp.mouse.click(x2, y2);
  await rp.waitForTimeout(200);
  await vantaSida(rp, d2, true);
  const d2Tillbaka = await rp.evaluate(LAGE + `(${d2})`);
  // många snabba klick: rutan kommer till vila på en sida, utan 3D-läge
  await rp.waitForTimeout(500);
  for (let i = 0; i < 7; i++) { await rp.mouse.click(x2, y2); await rp.waitForTimeout(90); }
  await rp.waitForTimeout(1200);
  const tavla1 = await rp.evaluate(TAVLA);
  const d2Slut = await rp.evaluate(RAKNARE);
  const d2Namn = await rp.evaluate(`aktivByGid.get(${d2}).name`);
  ok('flaggvändning: Bildquiz — ett klick strax efter svaret vänder inte tillbaka, ett klick senare vänder fram flaggan (hel)',
    d2Efter.vand && d2Efter.klar && d2Efter.minnen === 1 && d2Rakn.r === dRakn.r + 1 && d2Rakn.f === dRakn.f
    && !d2Flagga.vand && !d2Flagga.i3d && d2Flagga.igen && d2Flagga.op === 1 && d2Flagga.pressed === 'false' && d2Flagga.minnen === 1
    && d2Flagga.titel === d2Namn + ' – klicka för att vända' && !vinkEfter
    && ikonOhittad.ikon === 'none' && d2Efter.ikon === '"↻"',
    JSON.stringify({ d2Efter, d2Rakn, d2Flagga, vinkEfter, ikon: ikonOhittad.ikon }).slice(0, 500));
  ok('flaggvändning: dubbelklick på en hittad flagga vänder en gång, ett klick mitt i vändningen vänder tillbaka',
    d2Dubbel.vand && d2Dubbel.klar && d2Dubbel.pressed === 'true' && iLuften.i3d && !iLuften.vand
    && d2Tillbaka.vand && d2Tillbaka.klar && !d2Tillbaka.i3d && d2Tillbaka.minnen === 1
    && tavla1.kvar3d === 0 && tavla1.dubbla === 0 && tavla1.osynk === 0 && tavla1.halv === 0
    && d2Slut.r === d2Rakn.r && d2Slut.f === d2Rakn.f && d2Slut.t === d2Rakn.t,
    JSON.stringify({ d2Dubbel: d2Dubbel.klass, iLuften: iLuften.klass, d2Tillbaka: d2Tillbaka.klass, tavla1, d2Slut, d2Rakn }));
  // Klassiskt Quiz: dubbelklick på rätt flagga vänder inte; minnesbilden
  // ritas i förväg; den bleka flaggan är blek medan den vänds bort och när
  // den vänds tillbaka (som de andra hittade). Tipset kommer inte igen.
  await rp.evaluate("switchMode('seterra', true)");
  await rp.waitForTimeout(300);
  const k1 = await rp.evaluate(MED_BILD);
  await rp.dblclick(RUTA(k1));
  const kVink = await rp.evaluate("document.querySelector('#flaggtavla .tavla-vink').classList.contains('syns')");
  await rp.waitForTimeout(900);
  const kSvar = await rp.evaluate(LAGE + `(${k1})`);
  await rp.waitForFunction(`!!document.querySelector('${RUTA(k1)} .tavla-minne')`, null, { timeout: 6000 }).catch(() => {});
  const kForritad = await rp.evaluate(`!!document.querySelector('${RUTA(k1)} .tavla-minne')`);
  await rp.click(RUTA(k1));
  await rp.waitForTimeout(90);
  const kBort = await rp.evaluate(LAGE + `(${k1})`);
  await vantaSida(rp, k1, true);
  const kMinne = await rp.evaluate(LAGE + `(${k1})`);
  await rp.waitForTimeout(200);
  await rp.click(RUTA(k1));
  await rp.waitForTimeout(200);
  await vantaSida(rp, k1, false);
  const kTillbaka = await rp.evaluate(LAGE + `(${k1})`);
  ok('flaggvändning: Klassiskt Quiz — dubbelklick vänder inte, minnesbilden förritad, flaggan blek åt båda hållen',
    kSvar.hittad && !kSvar.vand && !kSvar.i3d && kSvar.op < 0.6 && kSvar.pressed === 'false' && !kVink && kForritad
    && kBort.i3d && kBort.op < 0.6 && kMinne.vand && kMinne.klar && kMinne.minnen === 1
    && !kTillbaka.vand && !kTillbaka.igen && kTillbaka.op < 0.6 && kTillbaka.pressed === 'false' && kTillbaka.minnen === 1,
    JSON.stringify({ kSvar, kVink, kForritad, kBort: [kBort.klass, kBort.op], kMinne: kMinne.klass, kTillbaka: [kTillbaka.klass, kTillbaka.op] }).slice(0, 500));
  // Utforska (mindre fönster): ett dubbelklick öppnar kortet, räknas en
  // gång och vänder flaggan en gång; pekaren på en flagga ritar minnesbilden
  // i förväg
  await rp.setViewportSize({ width: 1000, height: 650 });
  await rp.evaluate("switchMode('explore', true)");
  await rp.click('#utforska-val [data-utforska="flagga"]');
  await rp.waitForTimeout(400);
  const u1 = await rp.evaluate("COUNTRIES.find(c => c.namnSv === 'Peru').gid");
  const uFore = await rp.evaluate("document.getElementById('explored-count').textContent");
  await rp.dblclick(RUTA(u1));
  await rp.waitForFunction(`document.querySelector('${RUTA(u1)}').classList.contains('vand-klar')`, null, { timeout: 8000 }).catch(() => {});
  await rp.waitForTimeout(400);
  const uEfter = await rp.evaluate(LAGE + `(${u1})`);
  const uKort = await rp.evaluate(`({ kort: infoCard.classList.contains('active') && document.getElementById('info-name').textContent.includes('Peru'),
    raknat: document.getElementById('explored-count').textContent, utforskad: utforskade.has(${u1}) })`);
  const u2 = await rp.evaluate("COUNTRIES.find(c => c.namnSv === 'Chile').gid");
  const [ux, uy] = await mitt(rp, u2);
  await rp.mouse.move(ux, uy);
  await rp.waitForFunction(`!!document.querySelector('${RUTA(u2)} .tavla-minne')`, null, { timeout: 6000 }).catch(() => {});
  const uForritad = await rp.evaluate(`({ minne: !!document.querySelector('${RUTA(u2)} .tavla-minne'), utforskad: utforskade.has(${u2}) })`);
  ok('flaggvändning: Utforska — dubbelklick öppnar kortet, räknas en gång och vänder en gång',
    uEfter.vand && uEfter.klar && uEfter.pressed === 'true' && uEfter.label === 'Peru – visa flaggan' && uEfter.minnen === 1
    && uKort.kort && uKort.utforskad && +uKort.raknat === +uFore + 1, JSON.stringify({ uEfter: uEfter.klass, uKort, uFore }));
  ok('flaggvändning: Utforska — pekaren på en flagga ritar minnesbilden i förväg (inget klick, inget räknat)',
    uForritad.minne && !uForritad.utforskad, JSON.stringify(uForritad));
  // en tavla som växer: minnesbilden som syns ritas om större (samma bild)
  await rp.click(RUTA(u2));
  await vantaSida(rp, u2, true);
  const fore = await rp.evaluate(`(() => { const m = document.querySelector('${RUTA(u2)} .tavla-minne'); m.__test = 1;
    return { w: m.naturalWidth, h: parseFloat(getComputedStyle(document.getElementById('flaggtavla')).getPropertyValue('--h')) }; })()`);
  await rp.setViewportSize({ width: 1600, height: 1000 });
  await rp.waitForFunction(`document.querySelector('${RUTA(u2)} .tavla-minne').naturalWidth > ${fore.w}`, null, { timeout: 8000 }).catch(() => {});
  const efter = await rp.evaluate(`(() => { const b = document.querySelector('${RUTA(u2)}'), ms = b.querySelectorAll('.tavla-minne');
    return { w: ms[0].naturalWidth, n: ms.length, samma: ms[0].__test === 1, kort: b.querySelector('.tavla-kort').getBoundingClientRect().width,
      h: parseFloat(getComputedStyle(document.getElementById('flaggtavla')).getPropertyValue('--h')), klar: b.classList.contains('vand-klar') }; })()`);
  ok('flaggvändning: en tavla som växer ritar om minnesbilden som syns',
    efter.h > fore.h * 1.15 && efter.w > fore.w && efter.w >= Math.round(efter.kort) && efter.n === 1 && efter.samma && efter.klar,
    JSON.stringify({ fore, efter }));
  const tavla2 = await rp.evaluate(TAVLA);
  ok('flaggvändning: inget 3D-läge eller dubbla minnesbilder kvar, inga JS-fel',
    tavla2.kvar3d === 0 && tavla2.dubbla === 0 && tavla2.osynk === 0 && tavla2.halv === 0
    && rFel.filter(e => !/firebase/i.test(e)).length === 0, JSON.stringify(tavla2) + ' ' + rFel.join(' | ').slice(0, 160));
  await rp.close();
  // Långsam uppkoppling (servicearbetaren av, så att vägarna nedan gäller):
  // klick innan flaggbilder.json kommit räknas — ett klick vänder när den
  // kommer, två är tillbaka på flaggan. En minnesbild som inte gick att
  // hämta: nästa klick försöker igen och vänder (inget klick går förlorat).
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 750 }, serviceWorkers: 'block' });
  const sp = await ctx.newPage();
  const sFel = [];
  sp.on('pageerror', e => sFel.push(String(e)));
  let slapp;
  const jsonVantar = new Promise(r => { slapp = r; });
  await sp.route('**/assets/flaggbilder.json*', async route => { await jsonVantar; await route.continue(); });
  let blockera = '';
  await sp.route('**/assets/flaggbilder/**', route => (blockera && route.request().url().includes(blockera) ? route.abort() : route.continue()));
  await sp.addInitScript(INIT_V + "; localStorage.setItem('utforska-fraga','flagga')");
  await sp.goto(BASE + '/glob.html?region=sydamerika', { waitUntil: 'domcontentloaded' });
  await sp.waitForFunction("document.getElementById('spel-load').style.display === 'none' && COUNTRIES.length > 0"
    + " && document.querySelectorAll('#flaggtavla .tavla-ruta').length === COUNTRIES.length", null, { timeout: 30000 });
  await sp.waitForTimeout(300);
  const [ar, bo, cl] = await sp.evaluate("['Argentina', 'Bolivia', 'Chile'].map(n => COUNTRIES.find(c => c.namnSv === n).gid)");
  const innan = await sp.evaluate(`({ tom: FLAGGBILD.size === 0, vandbar: document.querySelectorAll('#flaggtavla .tavla-ruta.vandbar').length })`);
  await sp.click(RUTA(ar));
  await sp.click(RUTA(bo));
  await sp.waitForTimeout(500);
  await sp.click(RUTA(bo));
  await sp.waitForTimeout(300);
  slapp();
  await sp.waitForFunction(`FLAGGBILD.size > 0`, null, { timeout: 10000 }).catch(() => {});
  await vantaSida(sp, ar, true);
  await sp.waitForTimeout(800);
  const vAr = await sp.evaluate(LAGE + `(${ar})`), vBo = await sp.evaluate(LAGE + `(${bo})`);
  ok('flaggvändning: klick innan flaggbilder.json kommit räknas (ett: minnesbilden, två: flaggan)',
    innan.tom && innan.vandbar === 0 && vAr.vand && vAr.klar && vAr.pressed === 'true'
    && !vBo.vand && !vBo.i3d && vBo.pressed === 'false' && /vandbar/.test(vBo.klass),
    JSON.stringify({ innan, vAr: vAr.klass, vBo: vBo.klass }));
  blockera = await sp.evaluate("FLAGGBILD.get('Chile').bild.split('/').pop()");
  await sp.click(RUTA(cl));
  await sp.waitForTimeout(1200);
  const misslyckad = await sp.evaluate(LAGE + `(${cl})`);
  blockera = '';
  await sp.waitForTimeout(300);
  await sp.click(RUTA(cl));
  await sp.waitForTimeout(200);
  await vantaSida(sp, cl, true);
  const igen = await sp.evaluate(LAGE + `(${cl})`);
  ok('flaggvändning: en minnesbild som inte gick att hämta — nästa klick vänder',
    !misslyckad.vand && !misslyckad.i3d && misslyckad.vil === false && misslyckad.minnen === 0
    && igen.vand && igen.klar && igen.minnen === 1 && igen.pressed === 'true'
    && sFel.filter(e => !/firebase/i.test(e)).length === 0,
    JSON.stringify({ misslyckad: [misslyckad.klass, misslyckad.vil, misslyckad.minnen], igen: igen.klass, fel: sFel.slice(0, 2) }));
  await ctx.close();
} catch (e) {
  ok('flaggvändning: med riktiga övergångar', false, String(e).slice(0, 200));
}

// ── v102: Utforska + Huvudstäder som på GeoGuessr ──
// En upptäckt stad får en vit namnruta bredvid cirkeln, landbilderna är
// avslagna från start och slås på med en egen knapp (alla eller inga), och
// quizets etikett vid pekaren är en vit "Klicka på <stad>"-ruta.
try {
  const INIT_LS = "localStorage.setItem('rundtur-klar','1'); localStorage.setItem('speltur-klar','1'); localStorage.setItem('kakval','nej'); localStorage.setItem('feedback-tips-klar','1'); localStorage.setItem('utforska-fraga','huvudstad'); localStorage.setItem('quiz-fraga','huvudstad')";
  const gg = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  const ggFel = [];
  gg.on('pageerror', e => ggFel.push(String(e)));
  await gg.addInitScript(INIT_LS);
  await gg.goto(BASE + '/glob.html?region=sydamerika', { waitUntil: 'domcontentloaded' });
  await gg.waitForFunction("document.getElementById('spel-load').style.display === 'none'" +
    " && HUVUDSTAD.size > 0 && !!map.getLayer('stad-etikett') && utforskStadLage()", null, { timeout: 30000 });
  await gg.waitForTimeout(800);
  const tackta = 'COUNTRIES.filter(c => landState(c.gid).tackt).length';
  const start = await gg.evaluate(`({ rad: getComputedStyle(document.getElementById('utforsk-bild-rad')).display,
    knapp: document.getElementById('utforsk-bilder-btn').textContent.trim(), tackt: ${tackta}, n: COUNTRIES.length,
    hinder: map.getFilter('stad-hinder')[2][1].length, ring: map.getFilter('stad-ring')[2][1].length })`);
  ok('Utforska + Huvudstäder: landbilderna avslagna från start', start.rad !== 'none'
    && start.knapp.includes('Visa landbilder') && start.tackt === start.n && start.hinder === start.n
    && start.ring === start.n, JSON.stringify(start));
  // riktigt klick på Lima: namnrutan ritas, landet står kvar täckt
  const lima = await gg.evaluate(`(() => {
    const c = COUNTRIES.find(x => x.namnSv === 'Peru');
    const r = map.getCanvas().getBoundingClientRect(), p = stadPunkt.get(c.gid), s = map.project([p.lng, p.lat]);
    return { x: r.left + s.x, y: r.top + s.y, gid: c.gid };
  })()`);
  await gg.mouse.move(lima.x, lima.y);
  await gg.waitForTimeout(150);
  const pekar = await gg.evaluate(`!!map.getFeatureState({ source: 'huvudstader', id: ${lima.gid} }).hover`);
  await gg.mouse.click(lima.x, lima.y);
  await gg.waitForTimeout(1200);       // namnrutan placeras vid nästa bildruta
  const upp = await gg.evaluate(`({ avt: revealed.has(${lima.gid}), tackt: !!landState(${lima.gid}).tackt,
    etikett: map.getFilter('stad-etikett')[2][1], bild: map.hasImage('etikett-vit'),
    ritad: map.queryRenderedFeatures({ layers: ['stad-etikett'] }).map(f => f.properties.namn) })`);
  ok('Utforska + Huvudstäder: upptäckt stad får en vit namnruta, landet står täckt',
    pekar && upp.avt && upp.tackt && upp.etikett.length === 1 && upp.etikett[0] === lima.gid && upp.bild
    && upp.ritad.includes('Lima'), JSON.stringify({ pekar, ...upp }));
  // namnrutans åtta lägen (sidorna och hörnen) får aldrig krocka med
  // stadens egen cirkel (stad-hinder): prova vart och ett för sig
  const lagen = [];
  const allaLagen = await gg.evaluate(`map.getLayoutProperty('stad-etikett', 'text-variable-anchor-offset')`);
  const kamera = await gg.evaluate(`({ center: map.getCenter().toArray(), zoom: map.getZoom() })`);
  for (const z of [4, 8]) for (let i = 0; i < allaLagen.length; i += 2) {
    await gg.evaluate(`(() => { const p = stadPunkt.get(${lima.gid}); map.jumpTo({ center: [p.lng, p.lat], zoom: ${z} });
      map.setLayoutProperty('stad-etikett', 'text-variable-anchor-offset', ${JSON.stringify(allaLagen.slice(i, i + 2))}); })()`);
    await gg.waitForTimeout(450);
    if (!(await gg.evaluate(`map.queryRenderedFeatures({ layers: ['stad-etikett'] }).length`))) lagen.push(z + ':' + allaLagen[i]);
  }
  await gg.evaluate(`map.setLayoutProperty('stad-etikett', 'text-variable-anchor-offset', ${JSON.stringify(allaLagen)});
    map.jumpTo(${JSON.stringify(kamera)})`);
  await gg.waitForTimeout(300);
  ok('Utforska + Huvudstäder: namnrutan kan ligga på alla åtta sidor om staden',
    allaLagen.length === 16 && lagen.length === 0, JSON.stringify(lagen));
  // knappen: alla bilder på; upptäckterna rörs inte; ett klick döljer
  // staden men landets bild står kvar
  await gg.click('#utforsk-bilder-btn');
  await gg.waitForTimeout(100);
  const pa = await gg.evaluate(`({ tackt: ${tackta}, knapp: document.getElementById('utforsk-bilder-btn').textContent.trim(),
    aktiv: document.getElementById('utforsk-bilder-btn').classList.contains('pa'), rev: revealed.size })`);
  await gg.mouse.click(lima.x, lima.y);
  await gg.waitForTimeout(150);
  const dold = await gg.evaluate(`({ avt: revealed.has(${lima.gid}), tackt: !!landState(${lima.gid}).tackt,
    etikett: map.getFilter('stad-etikett')[2][1].length })`);
  ok('Utforska + Huvudstäder: Visa landbilder visar alla bilder, upptäckterna står kvar',
    pa.tackt === 0 && pa.knapp.includes('Dölj landbilder') && pa.aktiv && pa.rev === 1
    && !dold.avt && !dold.tackt && dold.etikett === 0, JSON.stringify({ ...pa, dold }));
  // visa/dölj alla följer knappen för bilderna
  const alla = await gg.evaluate(`(() => {
    document.getElementById('hide-all-btn').click();
    const efterDolj = { rev: revealed.size, tackt: ${tackta} };
    document.getElementById('utforsk-bilder-btn').click();
    document.getElementById('show-all-btn').click();
    return { efterDolj, rev: revealed.size, tackt: ${tackta}, n: COUNTRIES.length };
  })()`);
  await gg.waitForTimeout(150);
  const alla2 = await gg.evaluate(`map.getFilter('stad-etikett')[2][1].length`);
  ok('Utforska + Huvudstäder: visa/dölj alla rör inte landbilderna',
    alla.efterDolj.rev === 0 && alla.efterDolj.tackt === 0 && alla.rev === alla.n && alla.tackt === alla.n
    && alla2 === alla.n, JSON.stringify({ ...alla, alla2 }));
  // bilderna på + Länder och tillbaka: valet står kvar; Länder som förut
  const vx = await gg.evaluate(`(() => {
    document.getElementById('utforsk-bilder-btn').click();
    document.querySelector('#utforska-val [data-utforska="land"]').click();
    const land = { rad: getComputedStyle(document.getElementById('utforsk-bild-rad')).display, tackt: ${tackta} };
    document.querySelector('#utforska-val [data-utforska="huvudstad"]').click();
    return { land, tackt: ${tackta}, rev: revealed.size };
  })()`);
  ok('Utforska + Huvudstäder: bildvalet följer med mellan Länder och Huvudstäder',
    vx.land.rad === 'none' && vx.land.tackt === start.n && vx.tackt === 0 && vx.rev === 0, JSON.stringify(vx));
  // quizet: vit "Klicka på <stad>"-ruta vid pekaren; Länder som förut
  await gg.evaluate("document.querySelector('.mode-btn[data-mode=\"bildquiz\"]').click()");
  await gg.waitForTimeout(400);
  const quiz = await gg.evaluate(`({ stadslage, cls: document.getElementById('cursor-label').className,
    txt: document.getElementById('cursor-label').textContent, mal: seterraTarget && huvudstadFor(seterraTarget).huvudstad })`);
  await gg.evaluate(`document.querySelector('#fraga-val [data-fraga="land"]').click()`);
  await gg.waitForTimeout(400);
  const quizLand = await gg.evaluate(`({ cls: document.getElementById('cursor-label').className })`);
  ok('Bildquiz + Huvudstäder: vit "Klicka på"-ruta vid pekaren',
    quiz.stadslage && quiz.cls.includes('gg-etikett') && quiz.txt === 'Klicka på ' + quiz.mal
    && !quizLand.cls.includes('gg-etikett'), JSON.stringify({ quiz, quizLand }));
  ok('Utforska + Huvudstäder i GeoGuessr-stil utan JS-fel', ggFel.length === 0, ggFel.join(' | ').slice(0, 160));
  await gg.close();
} catch (e) {
  ok('Utforska + Huvudstäder: landbilderna avslagna från start', false, String(e).slice(0, 160));
}

// ── v103: huvudstädernas GeoGuessr-läge (v102) och flaggtavlan (v100–v101) ihop ──
// Utforskas växel har tre val (villUtforska). "Visa landbilder"
// (utforskBilder, #utforsk-bild-rad) hör bara till Huvudstäder och rör
// aldrig Länder eller Flaggor. Ett byte till eller från Huvudstäder är ett
// nytt pass (alla länder täckta, räknaren noll); Länder ⇄ Flaggor behåller
// passet. Bildvalet står kvar mellan passen (som i v102), och flaggtavlan
// med vändningen fungerar som förut efter Huvudstäder med bilderna på.
try {
  const INIT_LS = "localStorage.setItem('rundtur-klar','1'); localStorage.setItem('speltur-klar','1'); localStorage.setItem('kakval','nej'); localStorage.setItem('feedback-tips-klar','1')";
  const hf = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  const hfFel = [];
  hf.on('pageerror', e => hfFel.push(String(e)));
  await hf.addInitScript(INIT_LS);
  const laddad = async () => {
    await hf.waitForFunction("document.getElementById('spel-load').style.display === 'none'" +
      " && HUVUDSTAD.size > 0 && COUNTRIES.length > 0 && !!map.getLayer('stad-etikett') && currentMode === 'explore'",
      null, { timeout: 30000 });
    await hf.waitForTimeout(500);
  };
  await hf.goto(BASE + '/glob.html?region=sydamerika', { waitUntil: 'domcontentloaded' });
  await laddad();
  await hf.evaluate('laddaFlaggbilder()');
  await hf.addStyleTag({ content: '#flaggtavla .tavla-kort, #flaggtavla .tavla-flagga { transition: none !important; }' });
  // allt som avgör vad Utforska visar: valet, raden, bilderna (tillståndet
  // och det globen ritar — det senare bara när tavlan inte täcker den)
  const HF = `(() => ({
    val: villUtforska, visar: utforskVal(), stad: utforskStadLage(), flaggor: utforskaFlaggor,
    rad: getComputedStyle(document.getElementById('utforsk-bild-rad')).display,
    knapp: document.getElementById('utforsk-bilder-btn').textContent.trim(), bilder: utforskBilder,
    aktiv: document.querySelector('#utforska-val .fraga-btn.active').dataset.utforska,
    tavla: !document.getElementById('flaggtavla').hidden, tacktKarta: kartaTackt,
    n: COUNTRIES.length, tackt: COUNTRIES.filter(c => landState(c.gid).tackt).length,
    ritadTackt: kartaTackt ? -1 : COUNTRIES.filter(c => map.getFeatureState({ source: 'regioner', id: c.gid }).tackt).length,
    avtackta: COUNTRIES.filter(c => !landState(c.gid).tackt).map(c => c.namnSv).sort().join(','),
    rev: [...revealed].map(g => aktivByGid.get(g).namnSv).sort().join(','), utforskade: utforskade.size,
    raknat: document.getElementById('explored-count').textContent,
    etikett: map.getFilter('stad-etikett')[2][1].length, mal: map.getFilter('stad-mal')[2][1].length,
    vanda: [...document.querySelectorAll('#flaggtavla .tavla-ruta.vand, #flaggtavla .tavla-ruta.vand-klar')].length,
    bockar: [...document.querySelectorAll('#flaggtavla .tavla-ruta.utforskad')].length,
    kort: infoCard.classList.contains('active') ? document.getElementById('info-name').textContent : '' }))()`;
  const lage = async () => { await hf.waitForTimeout(250); return hf.evaluate(HF); };
  const vaxla = async v => { await hf.click(`#utforska-val [data-utforska="${v}"]`); return lage(); };
  const gidFor = namn => hf.evaluate(`COUNTRIES.find(c => c.namnSv === ${JSON.stringify(namn)}).gid`);
  const RUTA = gid => `#flaggtavla .tavla-ruta[data-gid="${gid}"]`;
  const vantaVila = (gid, minne) => hf.waitForFunction(`(() => { const b = document.querySelector('${RUTA(gid)}');
    return !b.classList.contains('minne') && b.classList.contains('vand') === ${minne} && b.classList.contains('vand-klar') === ${minne}; })()`,
    null, { timeout: 8000 }).catch(() => {});
  const vandFlagga = async (gid, minne) => {
    await hf.click(RUTA(gid));
    await vantaVila(gid, minne);
    await hf.waitForTimeout(450);      // ett klick till är inte resten av ett dubbelklick
    return hf.evaluate(`(() => { const b = document.querySelector('${RUTA(gid)}');
      return { klar: b.classList.contains('vand-klar'), pressed: b.getAttribute('aria-pressed') }; })()`);
  };
  // raden syns bara i Huvudstäder
  const land0 = await lage();
  const hs0 = await vaxla('huvudstad');
  const fl0 = await vaxla('flagga');
  const land1 = await vaxla('land');
  ok('v103: raden Visa landbilder syns i Huvudstäder, inte i Länder eller Flaggor',
    land0.aktiv === 'land' && land0.rad === 'none' && hs0.aktiv === 'huvudstad' && hs0.stad && hs0.rad !== 'none'
    && hs0.knapp.endsWith('Visa landbilder') && fl0.aktiv === 'flagga' && fl0.flaggor && fl0.tavla && fl0.rad === 'none'
    && land1.aktiv === 'land' && land1.rad === 'none' && !land1.tavla,
    JSON.stringify([land0, hs0, fl0, land1].map(x => [x.aktiv, x.rad, x.tavla])));
  // Huvudstäder: en upptäckt stad och landbilderna på — alla länder avtäckta
  await vaxla('huvudstad');
  await hf.evaluate("exploreClick(COUNTRIES.find(c => c.namnSv === 'Peru'), null)");
  await hf.click('#utforsk-bilder-btn');
  const hsPa = await lage();
  ok('v103: Huvudstäder med landbilderna på (start för bytena)', hsPa.stad && hsPa.bilder && hsPa.knapp.endsWith('Dölj landbilder')
    && hsPa.tackt === 0 && hsPa.ritadTackt === 0 && hsPa.rev === 'Peru' && hsPa.raknat === '1' && hsPa.etikett === 1
    && hsPa.mal === hsPa.n, JSON.stringify(hsPa));
  // → Flaggor: ett nytt pass, alla länder täckta under tavlan (bildvalet
  // står kvar men rör inte Flaggor), inga städer kvar
  const flPa = await vaxla('flagga');
  ok('v103: Huvudstäder (bilderna på) → Flaggor: nytt pass, alla länder täckta, inga städer',
    flPa.flaggor && flPa.tavla && flPa.tacktKarta && flPa.rad === 'none' && flPa.bilder && flPa.tackt === flPa.n
    && flPa.rev === '' && flPa.utforskade === 0 && flPa.raknat === '0' && flPa.etikett === 0 && flPa.mal === 0
    && flPa.vanda === 0 && flPa.bockar === 0 && flPa.kort === '', JSON.stringify(flPa));
  // flaggtavlan och vändningen som förut: Brasilien vänds fram och tillbaka,
  // Chile vänds; två länder upptäckta
  const br = await gidFor('Brasilien'), cl = await gidFor('Chile'), ar = await gidFor('Argentina');
  const brMinne = await vandFlagga(br, true);
  const brKort = await lage();
  const brFlagga = await vandFlagga(br, false);
  const clMinne = await vandFlagga(cl, true);
  const flTva = await lage();
  ok('v103: Flaggor efter Huvudstäder med bilderna på — kortet, räknaren och vändningen fungerar',
    brMinne.klar && brMinne.pressed === 'true' && /Brasilien/.test(brKort.kort) && brKort.raknat === '1'
    && !brFlagga.klar && brFlagga.pressed === 'false' && clMinne.klar && flTva.raknat === '2' && flTva.bockar === 2
    && flTva.rev === 'Brasilien,Chile' && flTva.tackt === flTva.n - 2 && flTva.vanda === 1 && flTva.bilder,
    JSON.stringify({ brMinne, brFlagga, clMinne, flTva }));
  // → Länder: samma pass, globen visar just de två länderna (bilderna
  // följer upptäckterna, inte knappen); ett klick på globen räknas vidare
  const landPa = await vaxla('land');
  await hf.evaluate(`exploreClick(aktivByGid.get(${ar}), null)`);
  const landTre = await lage();
  ok('v103: Flaggor → Länder: samma pass, bara de upptäckta länderna avtäckta på globen',
    !landPa.tavla && !landPa.tacktKarta && landPa.rad === 'none' && landPa.raknat === '2' && landPa.rev === 'Brasilien,Chile'
    && landPa.avtackta === 'Brasilien,Chile' && landPa.ritadTackt === landPa.n - 2 && landPa.etikett === 0 && landPa.mal === 0
    && landTre.raknat === '3' && landTre.avtackta === 'Argentina,Brasilien,Chile' && landTre.ritadTackt === landTre.n - 3,
    JSON.stringify({ landPa, landTre: [landTre.raknat, landTre.avtackta, landTre.ritadTackt] }));
  // → Huvudstäder: ett nytt pass; bildvalet står kvar (alla bilder), och
  // knappen slår av dem igen
  const hsIgen = await vaxla('huvudstad');
  await hf.click('#utforsk-bilder-btn');
  const hsAv = await lage();
  await hf.click('#utforsk-bilder-btn');
  const hsPaIgen = await lage();
  ok('v103: Länder → Huvudstäder: nytt pass, bildvalet står kvar och knappen styr alla bilder',
    hsIgen.stad && hsIgen.rad !== 'none' && hsIgen.bilder && hsIgen.knapp.endsWith('Dölj landbilder') && hsIgen.tackt === 0
    && hsIgen.ritadTackt === 0 && hsIgen.rev === '' && hsIgen.utforskade === 0 && hsIgen.raknat === '0' && hsIgen.etikett === 0
    && hsIgen.mal === hsIgen.n && hsAv.tackt === hsAv.n && hsAv.ritadTackt === hsAv.n && hsAv.knapp.endsWith('Visa landbilder')
    && hsPaIgen.tackt === 0 && hsPaIgen.ritadTackt === 0, JSON.stringify({ hsIgen, av: [hsAv.tackt, hsAv.ritadTackt, hsAv.knapp] }));
  // Flaggor igen (bilderna på): tavlan börjar ovänd, vändningen fungerar;
  // tillbaka i Länder är bara det upptäckta landet avtäckt
  const flIgen = await vaxla('flagga');
  const brIgen = await vandFlagga(br, true);
  const brIgenTillbaka = await vandFlagga(br, false);
  const flEfter = await lage();
  const landEfter = await vaxla('land');
  ok('v103: Huvudstäder → Flaggor igen: tavlan ovänd, vändningen fungerar, Länder visar bara det upptäckta',
    flIgen.tavla && flIgen.vanda === 0 && flIgen.bockar === 0 && flIgen.tackt === flIgen.n && flIgen.raknat === '0'
    && brIgen.klar && !brIgenTillbaka.klar && flEfter.raknat === '1' && flEfter.bockar === 1
    && landEfter.avtackta === 'Brasilien' && landEfter.ritadTackt === landEfter.n - 1 && landEfter.raknat === '1'
    && landEfter.rad === 'none', JSON.stringify({ flIgen, brIgen, brIgenTillbaka, landEfter }));
  // 'utforska-fraga' = land, huvudstad och flagga kommer tillbaka efter
  // omladdning (och ett okänt värde blir Länder). Bildvalet sparas inte
  // mellan sidladdningar: bilderna är avslagna från start.
  const aterstallt = {};
  for (const v of ['land', 'huvudstad', 'flagga', 'okänt']) {
    await hf.evaluate(`localStorage.setItem('utforska-fraga', ${JSON.stringify(v)})`);
    await hf.reload({ waitUntil: 'domcontentloaded' });
    await laddad();
    const s = await hf.evaluate(HF);
    const pressed = await hf.evaluate(`[...document.querySelectorAll('#utforska-val .fraga-btn')].map(b => b.dataset.utforska + '=' + b.getAttribute('aria-pressed')).join(',')`);
    aterstallt[v] = { ...s, pressed };
  }
  const { land: lsL, huvudstad: lsH, flagga: lsF, 'okänt': lsX } = aterstallt;
  ok("v103: 'utforska-fraga' land, huvudstad och flagga återställs efter omladdning",
    lsL.val === 'land' && lsL.aktiv === 'land' && !lsL.stad && !lsL.flaggor && !lsL.tavla && lsL.rad === 'none'
    && lsL.pressed === 'land=true,huvudstad=false,flagga=false'
    && lsH.val === 'huvudstad' && lsH.aktiv === 'huvudstad' && lsH.stad && !lsH.tavla && lsH.rad !== 'none' && !lsH.bilder
    && lsH.tackt === lsH.n && lsH.knapp.endsWith('Visa landbilder') && lsH.mal === lsH.n
    && lsH.pressed === 'land=false,huvudstad=true,flagga=false'
    && lsF.val === 'flagga' && lsF.aktiv === 'flagga' && lsF.flaggor && lsF.tavla && lsF.rad === 'none' && lsF.mal === 0
    && lsF.pressed === 'land=false,huvudstad=false,flagga=true'
    && lsX.val === 'land' && lsX.aktiv === 'land' && !lsX.tavla && lsX.rad === 'none',
    JSON.stringify(Object.fromEntries(Object.entries(aterstallt).map(([k, s]) => [k, [s.val, s.aktiv, s.rad, s.tavla, s.pressed]]))));
  // Bildquiz: städernas vita "Klicka på"-ruta (gg-etikett) och flaggtavlans
  // (tavla-etikett) blandas aldrig när man växlar mellan dem
  await hf.evaluate("document.querySelector('.mode-btn[data-mode=\"bildquiz\"]').click()");
  await hf.waitForTimeout(400);
  const etikett = () => hf.evaluate(`({ cls: document.getElementById('cursor-label').className,
    txt: document.getElementById('cursor-label').textContent, stad: stadslage, flagga: flagglage,
    mal: seterraTarget && seterraTarget.name, hs: seterraTarget && (huvudstadFor(seterraTarget) || {}).huvudstad })`);
  const fraga = async v => { await hf.click(`#fraga-val [data-fraga="${v}"]`); await hf.waitForTimeout(400); return etikett(); };
  const qH = await fraga('huvudstad'), qF = await fraga('flagga'), qH2 = await fraga('huvudstad'), qL = await fraga('land');
  const har = (e, k) => e.cls.split(/\s+/).includes(k);
  ok('v103: Bildquiz — Huvudstäders vita ruta och flaggtavlans etikett blandas inte',
    qH.stad && har(qH, 'gg-etikett') && !har(qH, 'tavla-etikett') && qH.txt === 'Klicka på ' + qH.hs
    && qF.flagga && har(qF, 'tavla-etikett') && !har(qF, 'gg-etikett') && qF.txt === 'Klicka på ' + qF.mal
    && qH2.stad && har(qH2, 'gg-etikett') && !har(qH2, 'tavla-etikett')
    && !qL.stad && !qL.flagga && !har(qL, 'gg-etikett') && !har(qL, 'tavla-etikett'),
    JSON.stringify({ qH, qF, qH2, qL }).slice(0, 400));
  ok('v103: huvudstäder och flaggor ihop utan JS-fel', hfFel.filter(e => !/firebase/i.test(e)).length === 0,
    hfFel.join(' | ').slice(0, 160));
  await hf.close();
} catch (e) {
  ok('v103: raden Visa landbilder syns i Huvudstäder, inte i Länder eller Flaggor', false, String(e).slice(0, 200));
}

// ── v72: lärarsidan + lärarlänken på startsidan ──
try {
  const lp = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  const lFel = [];
  lp.on('pageerror', e => lFel.push(String(e)));
  await lp.goto(BASE + '/larare.html', { waitUntil: 'domcontentloaded' });
  await lp.waitForSelector('#kakruta.inne', { timeout: 15000 });
  ok('lärarsidan visar kakfrågan direkt (ingen rundtur)', true);
  ok('lärarsidan utan JS-fel', lFel.filter(e => !/firebase/i.test(e)).length === 0,
    lFel.join(' | ').slice(0, 120));
  await lp.close();
  const st = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  await st.addInitScript("localStorage.setItem('rundtur-klar','1'); localStorage.setItem('kakval','nej'); localStorage.setItem('feedback-tips-klar','1')");
  await st.goto(BASE + '/glob.html', { waitUntil: 'domcontentloaded' });
  await st.waitForFunction("document.body.classList.contains('startlage')", null, { timeout: 20000 });
  ok('lärarlänken syns i startläget', await st.evaluate(
    "getComputedStyle(document.querySelector('.larare-lank')).display === 'block'"));
  await st.close();
} catch (e) {
  ok('lärarsidan visar kakfrågan direkt (ingen rundtur)', false, String(e).slice(0, 140));
}

// ── v76: namnvakten — webbadresser och fula ord på topplistorna ──
try {
  const vp = await browser.newPage({ viewport: { width: 1100, height: 750 } });
  await vp.addInitScript("localStorage.setItem('rundtur-klar','1'); localStorage.setItem('speltur-klar','1'); localStorage.setItem('kakval','nej'); localStorage.setItem('feedback-tips-klar','1')");
  await vp.goto(BASE + '/glob.html?region=sydamerika', { waitUntil: 'domcontentloaded' });
  await vp.waitForFunction("document.getElementById('spel-load').style.display === 'none'" +
    " && typeof olampligtNamn === 'function'", null, { timeout: 30000 });
  ok('namnvakten känner igen adresser och trick', await vp.evaluate(`
    olampligtNamn('watchdominion.org') && olampligtNamn('www punkt com')
    && olampligtNamn('WWW.KOLLA') && olampligtNamn('kolla.se') && olampligtNamn('http://x')
    && olampligtNamn('namn@skola.se') && olampligtNamn('n1ggaslicker') && olampligtNamn('Knarktiggarn')`));
  ok('namnvakten friar riktiga namn', await vp.evaluate(`
    !olampligtNamn('Kalle') && !olampligtNamn('J.R') && !olampligtNamn('bajs')
    && !olampligtNamn('Nico') && !olampligtNamn('Gustav Stegeby')`));
  // olämpliga poster i molnlistan varken visas eller tar topp 30-platser
  const html = await vp.evaluate(`(async () => {
    localStorage.setItem('cache-' + HS_KEY, JSON.stringify([
      { name: 'watchdominion.org', score: 100, time: 13, wrong: 0, date: 1700000000001 },
      { name: 'Ella', score: 100, time: 14, wrong: 0, date: 1700000000002 },
    ]));
    await renderHighscores();
    return document.getElementById('highscore-list').innerHTML;
  })()`);
  ok('olämplig post släpps inte in i listan', !html.includes('watchdominion') && html.includes('Ella'));
  // sparandet vägrar vänligt: namnmodalen efter en runda
  await vp.evaluate(`(() => {
    switchMode('seterra', true); startSeterra();
    seterraStartTime = Date.now() - 15400;
    seterraCorrect = seterraTotal; seterraWrong = 9;
    endSeterra();
  })()`);
  await vp.waitForTimeout(400);
  await vp.fill('#modal-name', 'www.exempel.se');
  await vp.click('#modal-save');
  await vp.waitForTimeout(400);
  ok('sparandet vägrar webbadress som namn', await vp.evaluate(`
    nameModalOverlay.classList.contains('active')
    && document.getElementById('modal-name').placeholder.includes('annat namn')
    && document.getElementById('modal-name').value === ''`));
  await vp.close();
} catch (e) {
  ok('namnvakten känner igen adresser och trick', false, String(e).slice(0, 140));
}

const fails = results.filter(r => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} godkända`);
await browser.close();
process.exit(fails.length ? 1 : 0);
