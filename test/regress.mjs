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
