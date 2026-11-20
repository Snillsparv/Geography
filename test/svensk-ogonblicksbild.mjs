// Ögonblicksbild av den svenska globsidan: det som syns och hämtas på
// startsidan, i USA och i Europa, med ett skriptat quiz och speltur.
// Språkstödet (sprak.js) får inte ändra något av det på svenska — kör
// före och efter en ändring och jämför:
//
//   node test/svensk-ogonblicksbild.mjs > fore.json        (på gamla koden)
//   node test/svensk-ogonblicksbild.mjs --jamfor fore.json (på nya koden)
//
// Startar en egen statisk server (med range requests för pmtiles) och
// stänger av all extern trafik (Firebase, typsnitt), så att resultatet bara
// beror på koden. Math.random är seedad: quizordningen blir densamma.
//
// --lang en kör i stället en röktest av den engelska sidan (?lang=en).
import { createServer } from 'node:http';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flagga = n => { const i = argv.indexOf(n); return i >= 0 ? (argv[i + 1] || true) : null; };
const JAMFOR = flagga('--jamfor');
const LANG = flagga('--lang') || 'sv';

const req = createRequire(import.meta.url);
let pw;
try { pw = req('playwright'); } catch { pw = req('playwright-core'); }

// ── statisk server ──
const TYPER = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg' };
const server = createServer((rq, rs) => {
  const p = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
  const fil = path.join(ROT, p === '/' ? 'glob.html' : p);
  if (!fil.startsWith(ROT)) { rs.writeHead(403); return rs.end(); }
  let st;
  try { st = statSync(fil); if (!st.isFile()) throw 0; } catch { rs.writeHead(404); return rs.end(); }
  const typ = TYPER[path.extname(fil)] || 'application/octet-stream';
  const r = /bytes=(\d+)-(\d*)/.exec(rq.headers.range || '');
  if (r) {
    const a = +r[1], b = r[2] ? Math.min(+r[2], st.size - 1) : st.size - 1;
    rs.writeHead(206, { 'Content-Type': typ, 'Content-Range': `bytes ${a}-${b}/${st.size}`,
      'Content-Length': b - a + 1, 'Accept-Ranges': 'bytes' });
    return createReadStream(fil, { start: a, end: b }).pipe(rs);
  }
  rs.writeHead(200, { 'Content-Type': typ, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
  createReadStream(fil).pipe(rs);
});
await new Promise(res => server.listen(0, '127.0.0.1', res));
const BAS = 'http://127.0.0.1:' + server.address().port;

const browser = await pw.chromium.launch({
  executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

// seedad slump + inga sparade val från tidigare körningar
const INIT = (ls) => `(() => {
  let s = 12345;
  Math.random = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
  ${Object.entries(ls).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n')}
})()`;
const BAS_LS = { 'rundtur-klar': '1', 'kakval': 'nej', 'feedback-tips-klar': '1', 'speltur-klar': '1' };

// tider och tidsberoende siffror varierar mellan körningar
const norm = s => String(s ?? '')
  .replace(/\d+:\d\d([,.]\d)?/g, 'T')
  .replace(/(version )\d+/g, '$1N')
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const normUrl = u => {
  const x = new URL(u);
  return x.pathname + x.search.replace(/([?&]v=)\d+/g, '$1N');
};

async function oppna(sokvag, ls = BAS_LS) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const fel = [], urls = new Set(), trasiga = new Set();
  page.on('pageerror', e => fel.push(String(e.message || e)));
  page.on('response', r => {
    const u = r.url();
    if (u.startsWith(BAS) && r.status() >= 400 && !/\/sprak(-\w+)?\.js/.test(u)) trasiga.add(r.status() + ' ' + normUrl(u));
  });
  await ctx.route('**/*', rt => {
    const u = rt.request().url();
    if (!u.startsWith(BAS)) return rt.abort();
    const p = new URL(u).pathname;
    if (!/\/sprak(-\w+)?\.js$/.test(p)) urls.add(normUrl(u));
    return rt.continue();
  });
  await page.addInitScript(INIT(ls));
  await page.goto(BAS + sokvag, { waitUntil: 'domcontentloaded' });
  // startsidans glob snurrar (map.loaded() blir aldrig sant) — stilen räcker
  await page.waitForFunction("typeof map !== 'undefined' && map && map.isStyleLoaded()", null, { timeout: 60000 });
  return { ctx, page, fel, urls, trasiga };
}
const vanta = ms => new Promise(r => setTimeout(r, ms));
const text = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return e ? e.innerText : null; }, sel);

async function region(slug) {
  const { ctx, page, fel, urls, trasiga } = await oppna('/glob.html?region=' + slug);
  await page.waitForFunction(s => typeof aktivSlug !== 'undefined' && aktivSlug === s && COUNTRIES.length > 0, slug, { timeout: 60000 });
  await vanta(1500);
  const ut = {};
  ut.lang = await page.evaluate(() => document.documentElement.lang);
  ut.titel = await page.title();
  ut.hsKey = await page.evaluate(() => HS_KEY);
  // tidsformatet (tiondelarnas skiljetecken) — tiderna i texterna normaliseras bort
  ut.fmtTid = await page.evaluate(() => [fmtTid(12.3), fmtTid(75), fmtTid(600.9)]);
  ut.antal = await page.evaluate(() => COUNTRIES.length);
  ut.namn = await page.evaluate(() => COUNTRIES.map(c => c.name));
  ut.sida = norm(await page.evaluate(() => document.body.innerText));
  // utforska: klick på tre länder (infokort + pekaretikett)
  ut.utforska = [];
  for (const i of [0, 7, 19]) {
    ut.utforska.push(norm(await page.evaluate(i => {
      const c = COUNTRIES[i % COUNTRIES.length];
      exploreClick(c, { clientX: 300, clientY: 300 });
      return document.querySelector('.info-panel').innerText + '\n--\n' + cursorLabel.innerText +
        '\n--\n' + document.getElementById('info-shape').getAttribute('src');
    }, i)));
  }
  await page.evaluate(() => { infoToggle.click(); });
  ut.infoUtfalld = norm(await text(page, '.info-panel'));
  // originalkartan (dold i menyn men nåbar): bildquiz med tre rätta svar
  // (svarssilhuetter), sen tillbaka till utforska — bilderna ska komma tillbaka
  await page.evaluate(() => setView('orig'));
  await page.waitForFunction(() => Object.keys(origOverlayEls).length > 0, null, { timeout: 30000 });
  await vanta(2500);
  await page.evaluate(() => switchMode('bildquiz'));
  ut.hsKeyBild = await page.evaluate(() => HS_KEY);
  for (let i = 0; i < 3; i++) {
    await page.waitForFunction(() => !!seterraTarget && !seterraLocked, null, { timeout: 20000 });
    await page.evaluate(() => handleMapClick(seterraTarget.gid, null));
    await vanta(400);
  }
  ut.origSvar = await page.evaluate(() => Object.entries(origOverlayEls)
    .filter(([, e]) => e.dataset.svar).map(([k, e]) => k + ' ' + e.dataset.svar).sort());
  await page.evaluate(() => switchMode('explore'));
  await vanta(800);
  ut.origBilder = await page.evaluate(() => Object.entries(origOverlayEls)
    .map(([k, e]) => k + ' ' + e.getAttribute('src') + (e.classList.contains('visible') ? ' synlig' : '')).sort());
  ut.origOverlay = await page.evaluate(() => { const o = document.getElementById('orig-overlay'); return o ? o.getAttribute('src') : null; });
  await page.evaluate(() => setView('glob'));
  await vanta(800);
  // klassiskt quiz: ett fel, ett klick utanför regionen, sen alla rätt
  await page.evaluate(() => switchMode('seterra'));
  await page.waitForFunction(() => !!seterraTarget, null, { timeout: 20000 });
  ut.quizStart = norm(await page.evaluate(() => document.body.innerText));
  ut.felKlick = norm(await page.evaluate(() => {
    const fel = COUNTRIES.find(c => c.gid !== seterraTarget.gid);
    handleMapClick(fel.gid, null);
    return seterraFeedback.innerText;
  }));
  await page.waitForFunction(() => !seterraLocked, null, { timeout: 10000 });
  await vanta(300);
  ut.utanforKlick = norm(await page.evaluate(() => {
    const f = regionsGj.features.find(f2 => !aktivByGid.has(f2.id) && f2.properties.namn &&
      ['Kanada', 'Mexiko', 'Ryssland', 'Marocko'].includes(f2.properties.namn));
    if (!f) return '(inget grannland)';
    handleMapClick(f.id, null);
    return seterraFeedback.innerText;
  }));
  for (let varv = 0; varv < 400; varv++) {
    const klar = await page.evaluate(() => {
      if (seterraDone.classList.contains('active')) return true;
      if (seterraTarget && !seterraLocked) handleMapClick(seterraTarget.gid, null);
      return false;
    });
    if (klar) break;
    await vanta(60);
  }
  await vanta(1500);
  ut.ratt = norm(await page.evaluate(() => seterraFeedback.innerText));
  ut.klar = norm(await page.evaluate(() => document.body.innerText));
  // en runda till utan fel: diplomet (datumets siffror bort)
  await page.evaluate(() => { const b = document.getElementById('modal-skip'); if (b && b.offsetParent) b.click(); });
  await vanta(500);
  await page.evaluate(() => document.getElementById('seterra-restart').click());
  await page.waitForFunction(() => !!seterraTarget, null, { timeout: 20000 });
  for (let varv = 0; varv < 400; varv++) {
    const klar = await page.evaluate(() => {
      if (seterraDone.classList.contains('active')) return true;
      if (seterraTarget && !seterraLocked) handleMapClick(seterraTarget.gid, null);
      return false;
    });
    if (klar) break;
    await vanta(60);
  }
  await vanta(1500);
  await page.evaluate(() => { const b = document.getElementById('modal-skip'); if (b && b.offsetParent) b.click(); });
  await vanta(300);
  ut.perfekt = norm(await page.evaluate(() => document.querySelector('#seterra-done') ? document.querySelector('#seterra-done').innerText : seterraDone.innerText));
  ut.diplom = norm(await page.evaluate(() => {
    const b = document.getElementById('seterra-diplom');
    if (!b || b.style.display === 'none') return '(inget diplom)';
    b.click();
    const d = document.getElementById('diplom-datum');
    return document.getElementById('diplom-modal').innerText.replace(d.textContent, d.textContent.replace(/\d+/g, 'N'));
  }));
  ut.fel = fel.filter(e => !/firebase/i.test(e));
  ut.trasiga = [...trasiga].sort();
  ut.urls = [...urls].sort();
  await ctx.close();
  return ut;
}

async function startsida() {
  const { ctx, page, fel, urls } = await oppna('/glob.html');
  // laddskärmen (med sina roterande tips) ska vara borta
  await page.waitForFunction(() => { const s = document.getElementById('ladd-skarm'); return !s || s.style.display === 'none'; }, null, { timeout: 60000 });
  await vanta(1000);
  const ut = {
    lang: await page.evaluate(() => document.documentElement.lang),
    titel: await page.title(),
    sida: norm(await page.evaluate(() => document.body.innerText)),
    fel: fel.filter(e => !/firebase/i.test(e)),
    urls: [...urls].sort(),
  };
  await ctx.close();
  return ut;
}

async function speltur(sokvag) {
  const ls = { ...BAS_LS }; delete ls['speltur-klar'];
  const { ctx, page, fel } = await oppna(sokvag, ls);
  await page.waitForFunction(() => document.getElementById('intro-overlay') &&
    document.getElementById('intro-overlay').style.display !== 'none', null, { timeout: 30000 });
  const steg = [];
  for (let i = 0; i < 20; i++) {
    const t = await page.evaluate(() => {
      const o = document.getElementById('intro-overlay');
      if (o.style.display === 'none') return null;
      return o.innerText;
    });
    if (t == null) break;
    steg.push(norm(t));
    await page.evaluate(() => nastaSteg());
    await vanta(150);
  }
  await ctx.close();
  return { steg, fel: fel.filter(e => !/firebase/i.test(e)) };
}

let ut;
if (LANG === 'en') {
  // ── röktest av engelska sidan (förhandsvisning på localhost) ──
  const { ctx, page, fel, urls } = await oppna('/glob.html?lang=en');
  await page.waitForFunction(() => typeof aktivSlug !== 'undefined' && aktivSlug === 'usa' && COUNTRIES.length > 0, null, { timeout: 60000 });
  await vanta(1500);
  ut = {
    sajt: await page.evaluate(() => SPRAK.id),
    lang: await page.evaluate(() => document.documentElement.lang),
    titel: await page.title(),
    hsKey: await page.evaluate(() => HS_KEY),
    startlage: await page.evaluate(() => document.body.classList.contains('startlage')),
    tillbakaSyns: await page.evaluate(() => getComputedStyle(document.getElementById('back-btn')).display !== 'none'),
    namn: await page.evaluate(() => COUNTRIES.map(c => c.name)),
    sida: norm(await page.evaluate(() => document.body.innerText)),
    // hela världsarkivet (45 MB) ska aldrig förladdas här
    forladdning: await page.evaluate(() => forladdningStartad),
    saknas: await page.evaluate(() => [...SPRAK.saknade]),
    fel: fel.filter(e => !/firebase/i.test(e)),
    urls: [...urls].sort(),
  };
  await ctx.close();
  ut.tur = await speltur('/glob.html?lang=en');
} else {
  ut = { start: await startsida(), usa: await region('usa'), europa: await region('europa'), tur: await speltur('/glob.html?region=usa') };
}
await browser.close();
server.close();

const json = JSON.stringify(ut, null, 1);
if (JAMFOR) {
  const fore = JSON.parse(readFileSync(JAMFOR, 'utf8'));
  const skillnader = [];
  const jmf = (a, b, p) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a)) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) jmf(a[k], b[k], p + '.' + k);
    } else if (Array.isArray(a) && Array.isArray(b) && p.endsWith('urls')) {
      const A = new Set(a), B = new Set(b);
      skillnader.push(p + ': bara före ' + JSON.stringify(a.filter(x => !B.has(x))) +
        ', bara efter ' + JSON.stringify(b.filter(x => !A.has(x))));
    } else skillnader.push(p + ':\n  före:  ' + String(JSON.stringify(a)).slice(0, 600) + '\n  efter: ' + String(JSON.stringify(b)).slice(0, 600));
  };
  jmf(fore, ut, '');
  if (skillnader.length) { console.log('SKILLNAD\n' + skillnader.join('\n')); process.exit(1); }
  console.log('IDENTISK');
} else {
  console.log(json);
}
