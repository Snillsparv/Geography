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
await page.addInitScript("localStorage.setItem('rundtur-klar','1')");
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
ok('tiles kvar på v=2', has('world.pmtiles?v=2') && !has(`world.pmtiles?v=${V}`));
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
ok('Malta prick z5, borta z7', (await prickHit(2, 14.211, 34.342, 5)) > 0 && (await prickHit(2, 14.211, 34.342, 7)) === 0);
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
const fails = results.filter(r => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} godkända`);
await browser.close();
process.exit(fails.length ? 1 : 0);
