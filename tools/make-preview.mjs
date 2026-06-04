#!/usr/bin/env node
// Generate a self-contained overview page (svg-preview.html) showing every
// vectorized country, grouped by region, with a quick text filter.
// References the .svg files by relative path so it works both locally and when
// served (e.g. via raw.githack.com) straight from the repo.
import { readdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const REGIONS = {
  europa: 'Europa', afrika: 'Afrika', asien: 'Asien',
  nordamerika: 'Nordamerika', sydamerika: 'Sydamerika', oceanien: 'Oceanien',
  vastindien: 'Västindien', usa: 'USA', sverige: 'Sverige',
};

const pretty = f => f.replace(/\.svg$/, '').replace(/_/g, ' ')
  .replace(/\b\w/g, c => c.toUpperCase());

let cards = '';
let total = 0;
for (const [slug, name] of Object.entries(REGIONS)) {
  const dir = `assets/${slug}/countries`;
  let files;
  try { files = (await readdir(dir)).filter(f => f.endsWith('.svg') && !f.includes('_shape')); }
  catch { continue; }
  files.sort();
  total += files.length;
  cards += `<section><h2>${name} <span class="count">${files.length}</span></h2><div class="grid">`;
  for (const f of files) {
    const rel = `${dir}/${f}`;
    const kb = Math.round((await stat(rel)).size / 1024);
    cards += `<figure data-name="${pretty(f).toLowerCase()} ${slug}">` +
      `<div class="thumb"><img loading="lazy" src="${rel}" alt="${pretty(f)}"></div>` +
      `<figcaption>${pretty(f)}<span>${kb} KB</span></figcaption></figure>`;
  }
  cards += `</div></section>`;
}

const html = `<!DOCTYPE html>
<html lang="sv"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vektoriserade länder – översikt</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, sans-serif; background: #0f1b2d; color: #cde; }
  header { position: sticky; top: 0; z-index: 5; padding: 16px 20px;
    background: #0f1b2d; border-bottom: 1px solid rgba(255,255,255,.08); }
  h1 { margin: 0 0 4px; font-size: 1.3rem; }
  .sub { color: #5a8aaa; font-size: .85rem; margin-bottom: 12px; }
  #q { width: 100%; max-width: 420px; padding: 10px 14px; border-radius: 999px;
    border: 1px solid rgba(91,191,255,.3); background: rgba(255,255,255,.05);
    color: #cde; font-size: 1rem; }
  main { padding: 12px 20px 60px; }
  h2 { font-size: 1.05rem; margin: 28px 0 12px; color: #7ec8e3;
    border-bottom: 1px solid rgba(255,255,255,.06); padding-bottom: 6px; }
  .count { color: #5a8aaa; font-weight: 400; font-size: .8rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 12px; }
  figure { margin: 0; background: rgba(255,255,255,.03); border-radius: 10px;
    padding: 8px; text-align: center; }
  .thumb { height: 130px; display: flex; align-items: center; justify-content: center;
    background: #fff; border-radius: 8px; overflow: hidden; }
  .thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
  figcaption { font-size: .8rem; margin-top: 6px; line-height: 1.3; }
  figcaption span { display: block; color: #5a8aaa; font-size: .7rem; }
  figure.hide { display: none; }
  section.hide { display: none; }
</style></head>
<body>
<header>
  <h1>Vektoriserade länder</h1>
  <div class="sub">${total} länder · SVG (skalbar, ~3× mindre över nätet än webp)</div>
  <input id="q" type="search" placeholder="Sök land eller region…">
</header>
<main>${cards}</main>
<script>
  const q = document.getElementById('q');
  q.addEventListener('input', () => {
    const t = q.value.trim().toLowerCase();
    for (const sec of document.querySelectorAll('section')) {
      let any = false;
      for (const fig of sec.querySelectorAll('figure')) {
        const hit = !t || fig.dataset.name.includes(t);
        fig.classList.toggle('hide', !hit);
        if (hit) any = true;
      }
      sec.classList.toggle('hide', !any);
    }
  });
</script>
</body></html>`;

await writeFile('svg-preview.html', html);
console.log(`Wrote svg-preview.html (${total} countries).`);
