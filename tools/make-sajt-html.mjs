// Den engelska startsidan allusstates.html, genererad ur glob.html.
//
//   node tools/make-sajt-html.mjs           # skriver allusstates.html
//   node tools/make-sajt-html.mjs --check   # felkod 1 om filen saknas eller skulle ändras
//
// Kroppen (all markup och alla skript) är glob.html:s, så sidorna kan inte
// glida isär. Bara huvudet byts: blocket mellan <!-- huvud:start --> och
// <!-- huvud:slut --> i glob.html ersätts med tools/sajter/allusstates-head.html
// (engelsk titel, beskrivning, og-taggar för länkförhandsvisningar, det
// engelska manifestet). <html> får lang="en" och data-sajt="allusstates",
// så sprak.js väljer den engelska sajten oavsett värdnamn, och sprak-en.js
// laddas direkt efter sprak.js med samma ?v.
//
// Filen är inte incheckad (.gitignore): båda GitHub-arbetsflödena kör skriptet
// före deploy, och firebase.json serverar den som / på målet "en". Bara
// node-inbyggda moduler: CI kör inget npm ci.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KALLA = join(ROT, 'glob.html');
const HUVUD = join(ROT, 'tools', 'sajter', 'allusstates-head.html');
const UT = join(ROT, 'allusstates.html');

function fel(s) {
  console.error('make-sajt-html: ' + s);
  process.exit(2);
}

function exaktEn(text, nal, vad) {
  const n = text.split(nal).length - 1;
  if (n !== 1) fel(`${vad} finns ${n} gånger i glob.html (ska vara exakt 1)`);
}

export function bygg(glob, huvud) {
  const START = /[ \t]*<!-- huvud:start[^>]*-->\n?/g;
  const SLUT = /[ \t]*<!-- huvud:slut[^>]*-->\n?/g;
  const s = [...glob.matchAll(START)], e = [...glob.matchAll(SLUT)];
  if (s.length !== 1 || e.length !== 1) fel(`huvud:start/huvud:slut ska finnas exakt en gång (${s.length}/${e.length})`);
  const a = s[0].index, b = e[0].index + e[0][0].length;
  if (b <= a) fel('huvud:slut står före huvud:start');
  let html = glob.slice(0, a) + huvud.replace(/\n?$/, '\n') + glob.slice(b);

  exaktEn(html, '<html lang="sv">', '<html lang="sv">');
  html = html.replace('<html lang="sv">', '<html lang="en" data-sajt="allusstates">');

  const sprak = [...html.matchAll(/<script src="sprak\.js(\?v=[^"]*)?"><\/script>\n?/g)];
  if (sprak.length !== 1) fel(`<script src="sprak.js"> ska finnas exakt en gång (${sprak.length})`);
  const t = sprak[0];
  const slut = t.index + t[0].length;
  const rad = t[0].endsWith('\n') ? '' : '\n';
  const indrag = (/([ \t]*)$/.exec(html.slice(0, t.index)) || ['', ''])[1];
  html = html.slice(0, slut) + rad + indrag + `<script src="sprak-en.js${t[1] || ''}"></script>\n` + html.slice(slut);

  const banner = '<!-- GENERERAD av tools/make-sajt-html.mjs ur glob.html och tools/sajter/allusstates-head.html.\n' +
    '     Ändra i dem och kör skriptet igen, inte här. -->\n';
  exaktEn(html, '<!DOCTYPE html>\n', '<!DOCTYPE html>');
  return html.replace('<!DOCTYPE html>\n', '<!DOCTYPE html>\n' + banner);
}

const html = bygg(readFileSync(KALLA, 'utf8'), readFileSync(HUVUD, 'utf8'));
if (process.argv.includes('--check')) {
  const nu = existsSync(UT) ? readFileSync(UT, 'utf8') : null;
  if (nu !== html) {
    console.error('make-sajt-html: allusstates.html ' + (nu == null ? 'saknas' : 'är inaktuell') + ' (kör node tools/make-sajt-html.mjs)');
    process.exit(1);
  }
  console.log('allusstates.html är aktuell');
} else {
  writeFileSync(UT, html);
  console.log(`allusstates.html: ${html.length} tecken`);
}
