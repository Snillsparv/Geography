// Täckning för den engelska sidan (allusstates): varje svensk text som går
// genom SPRAK.t() i glob-spel.js / kakor.js, och varje data-t*-nyckel i
// glob.html, ska finnas i sprak-en.js (window.SPRAK_EN.strangar) — eller
// stå i test/sprak-senare.txt (texter som bara syns på svenska delar av
// sidan och får vänta). Fångar svenska ändringar som tyst slår sönder
// engelskan: en ändrad svensk text är en ny nyckel.
//
//   node test/sprak-tackning.mjs
//
// Bara node, ingen webbläsare. Nycklarna härleds som SPRAK.oversattDom gör:
// data-t = elementets text (blanksteg hopslagna), data-t-html = innerHTML,
// data-t-<attr> = attributets värde — eller attributvärdet om det inte är
// tomt. Kontrollerar också {platshållare}: det engelska resultatet får inte
// tappa en svensk platshållare eller lämna någon {x} ofylld.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const las = f => readFileSync(path.join(ROT, f), 'utf8');
const fel = [];

// ── SPRAK + SPRAK_EN i en låtsasmiljö för den engelska värden ──
function laddaSprak(host) {
  const skrivet = [];
  const rot = { dataset: {}, lang: '' };
  const ctx = {
    console: { warn() {}, log() {} },
    URLSearchParams,
    location: { hostname: host, search: '' },
    sessionStorage: { getItem: () => null, setItem() {} },
    document: { documentElement: rot, currentScript: { src: 'https://' + host + '/sprak.js?v=X' },
                write: s => skrivet.push(s) },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(las('sprak.js'), ctx, { filename: 'sprak.js' });
  if (ctx.SPRAK.lang !== 'sv') vm.runInContext(las('sprak-en.js'), ctx, { filename: 'sprak-en.js' });
  return { SPRAK: ctx.SPRAK, SPRAK_EN: ctx.SPRAK_EN, skrivet };
}
const en = laddaSprak('allusstates.com');
const sv = laddaSprak('jonasgeografi.se');
if (en.SPRAK.lang !== 'en') fel.push('allusstates.com gav inte engelska');
if (!en.skrivet.some(s => /sprak-en\.js\?v=X/.test(s))) fel.push('sprak.js laddar inte sprak-en.js?v=… på engelska');
if (sv.SPRAK.lang !== 'sv') fel.push('jonasgeografi.se gav inte svenska');
const STR = (en.SPRAK_EN && en.SPRAK_EN.strangar) || {};

// ── nycklar ur JS: t('…') / SPRAK.t('…'), även 'a' + 'b'-skarvade ──
const LITTERAL = /^\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\$]|\\.|\$(?!\{))*`)/;
function jsNycklar(fil) {
  const src = las(fil);
  const ut = [];
  const rx = /(?:\bSPRAK\.|(?<![\w.$]))t\(/g;
  let m;
  while ((m = rx.exec(src))) {
    let i = m.index + m[0].length;
    const delar = [];
    for (;;) {
      const l = LITTERAL.exec(src.slice(i));
      if (!l) break;
      delar.push(l[1]);
      i += l[0].length;
      const plus = /^\s*\+/.exec(src.slice(i));
      if (!plus) break;
      i += plus[0].length;
    }
    if (!delar.length) continue;   // t(variabel) — inte en nyckel
    const rad = src.slice(0, m.index).split('\n').length;
    ut.push({ nyckel: vm.runInNewContext(delar.join(' + ')), var: `${fil}:${rad}` });
  }
  return ut;
}

// ── nycklar ur glob.html: data-t, data-t-html, data-t-<attr> ──
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ouml: 'ö', auml: 'ä',
  aring: 'å', Ouml: 'Ö', Auml: 'Ä', Aring: 'Å', eacute: 'é', mdash: '—', ndash: '–', hellip: '…',
  larr: '←', rarr: '→', minus: '−', rdquo: '”', ldquo: '“', middot: '·', bull: '•', times: '×' };
const avkoda = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (hel, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1));
  if (!(e in ENT)) throw new Error('okänd entitet ' + hel);
  return ENT[e];
});
// som innerHTML serialiserar text: bara & < > och nbsp skrivs som entiteter
const serialiseraText = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
const norm = s => s.replace(/\s+/g, ' ').trim();
const TOMMA = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const attrs = s => {
  const a = {};
  for (const m of s.matchAll(/([\w:-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)) {
    const v = m[2] == null ? '' : m[2].replace(/^["']|["']$/g, '');
    a[m[1].toLowerCase()] = avkoda(v);
  }
  return a;
};
function htmlNycklar(fil) {
  const src = las(fil).replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
  const ut = [];
  const tagRx = /<([a-zA-Z][\w-]*)(\s[^>]*)?>/g;
  let m;
  while ((m = tagRx.exec(src))) {
    const namn = m[1].toLowerCase();
    const a = attrs(m[2] || '');
    if (!Object.keys(a).some(k => k.startsWith('data-t'))) continue;
    const rad = src.slice(0, m.index).split('\n').length;
    const var_ = `${fil}:${rad}`;
    // innehållet fram till matchande sluttagg
    let inre = null;
    if (!TOMMA.has(namn)) {
      const start = m.index + m[0].length;
      const r = new RegExp(`<(/?)${namn}\\b[^>]*>`, 'gi');
      r.lastIndex = start;
      let djup = 1, x;
      while ((x = r.exec(src))) {
        djup += x[1] ? -1 : 1;
        if (!djup) { inre = src.slice(start, x.index); break; }
      }
      if (inre == null) { fel.push(`${var_}: hittar inte </${namn}>`); continue; }
    }
    if ('data-t' in a) {
      const text = inre.replace(/<[^>]*>/g, '');
      ut.push({ nyckel: a['data-t'] || norm(avkoda(text)), var: var_ });
    }
    if ('data-t-html' in a) {
      const html = inre.replace(/(<[^>]*>)|([^<]+)/g, (h, tagg, text) =>
        tagg ? tagg.replace(/^<(\/?)([a-zA-Z][\w-]*)/, (q, s, n) => '<' + s + n.toLowerCase())
             : serialiseraText(avkoda(text)));
      if (/<[a-z][^>]*\s[\w-]+=/i.test(html)) fel.push(`${var_}: data-t-html med attribut i innehållet — ge nyckeln i attributet`);
      ut.push({ nyckel: a['data-t-html'] || norm(html), var: var_, html: true });
    }
    for (const at of ['title', 'placeholder', 'alt', 'aria-label']) {
      if (('data-t-' + at) in a) ut.push({ nyckel: a['data-t-' + at] || norm(a[at] || ''), var: var_ });
    }
  }
  return ut;
}

const senare = new Set(las('test/sprak-senare.txt').split('\n')
  .map(r => r.replace(/\r$/, '')).filter(r => r.trim() && !/^\s*#/.test(r)));

// platshållare som engelskan medvetet utelämnar (nyckel → namn)
const FAR_TAPPA = {
  // delningstexten: sajten heter redan All US States och har bara USA
  '{namn} utmanar dig i {sajt}! {region}: {p} % på {tid} — kan du slå det? {url}': ['region'],
};

const alla = [...jsNycklar('glob-spel.js'), ...jsNycklar('kakor.js'), ...htmlNycklar('glob.html')];
const saknas = new Map();
let antal = 0;
const sedda = new Set();
for (const { nyckel, var: v } of alla) {
  if (!nyckel) { fel.push(`${v}: tom nyckel`); continue; }
  if (sv.SPRAK.t(nyckel) !== nyckel) fel.push(`${v}: svenska t() är inte identitet för ${JSON.stringify(nyckel)}`);
  if (!(nyckel in STR)) {
    if (!senare.has(nyckel)) saknas.set(nyckel, [...(saknas.get(nyckel) || []), v]);
    continue;
  }
  if (sedda.has(nyckel)) continue;
  sedda.add(nyckel);
  antal++;
  // platshållarna: fyll med markörer och se att alla kommer fram
  const ph = [...new Set([...nyckel.matchAll(/\{(\w+)\}/g)].map(x => x[1]))];
  const varden = Object.fromEntries(ph.map(p => [p, '«' + p + '»']));
  for (const prov of [varden, Object.fromEntries(ph.map(p => [p, 1])), Object.fromEntries(ph.map(p => [p, 2]))]) {
    let ut;
    try { ut = en.SPRAK.t(nyckel, ph.length ? prov : undefined); }
    catch (e) { fel.push(`${v}: engelska för ${JSON.stringify(nyckel)} kastar: ${e.message}`); break; }
    if (typeof ut !== 'string') { fel.push(`${v}: engelska för ${JSON.stringify(nyckel)} är ingen text`); break; }
    if (/\{\w+\}/.test(ut)) fel.push(`${v}: ofylld platshållare i engelskan: ${JSON.stringify(ut)}`);
    if (prov === varden) {
      for (const p of ph) if (!(FAR_TAPPA[nyckel] || []).includes(p) && !ut.includes('«' + p + '»')) fel.push(`${v}: engelskan tappar {${p}} i ${JSON.stringify(nyckel)}`);
    }
    if (/[åäöÅÄÖ]/.test(ut.replace(/«\w+»/g, ''))) fel.push(`${v}: svenska bokstäver kvar i engelskan: ${JSON.stringify(ut)}`);
  }
}
for (const k of Object.keys(STR)) {
  if (!alla.some(a => a.nyckel === k)) console.log('(oanvänd engelsk nyckel)', JSON.stringify(k));
}
for (const k of senare) {
  if (k in STR) console.log('(står i sprak-senare.txt men är översatt)', JSON.stringify(k));
}

// ── världens länder: varje region i art-regions.json har ett engelskt namn ──
const regioner = JSON.parse(las('assets/art-regions.json'));
const LN = (en.SPRAK_EN && en.SPRAK_EN.landnamn) || {};
const nycklarLand = [...new Set(regioner.features.map(f => f.properties.key))];
for (const k of nycklarLand) {
  if (!LN[k]) fel.push(`landnamn saknas: ${k}`);
  else if (/[åäöÅÄÖ]/.test(LN[k])) fel.push(`landnamn med svenska bokstäver: ${k} → ${LN[k]}`);
}
for (const k of Object.keys(LN)) if (!nycklarLand.includes(k)) fel.push(`landnamn för okänd region: ${k}`);

for (const [k, v] of saknas) fel.push(`saknar engelska: ${JSON.stringify(k)}  (${v.join(', ')})`);
console.log(`${alla.length} anrop/attribut, ${antal} översatta nycklar, ${senare.size} i sprak-senare.txt, ` +
  `${nycklarLand.length} landnamn`);
if (fel.length) {
  console.log('\nFEL:\n' + [...new Set(fel)].join('\n'));
  process.exit(1);
}
console.log('ok');
