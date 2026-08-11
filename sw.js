// Service worker för Jonas geografi: gör spelet installerbart och spelbart
// OFFLINE. Strategi:
//  - kartarkivet (world.pmtiles): hela filen cachas när bakgrunds-
//    nedladdningen sker; range-förfrågningar skivas ur den cachade blobben
//    så att strömningen funkar helt utan nät
//  - versionerade filer (?v=N) och assets: cache först (immutabla per URL)
//  - HTML: nätet först med cache som reserv (uppdateringar slår igenom,
//    offline funkar ändå)
const CACHE = 'geografi-v1';
const TILE_CACHE = 'geografi-tiles-3';   // bumpas när world.pmtiles bakas om

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k !== CACHE && k !== TILE_CACHE) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

// hela pmtiles-arkiven i minnet för snabb skivning, ETT blob per arkivfil —
// world- och usa-arkivet får ALDRIG dela blob (skivor ur fel arkiv = trasiga
// kartrutor som ser ut som cacheblandning)
const arkivBlobar = new Map();   // pathname → blob

async function hanteraTiles(req) {
  const cache = await caches.open(TILE_CACHE);
  const nyckel = new URL(req.url); nyckel.search = '';   // en kopia oavsett ?v
  const bk = nyckel.pathname;
  const range = req.headers.get('range');
  if (!range) {
    // hela arkivet (förladdningen): hämta, cacha, returnera
    try {
      const svar = await fetch(req);
      if (svar.ok) {
        cache.put(nyckel, svar.clone());
        arkivBlobar.delete(bk);   // ny version → glöm gamla blobben
      }
      return svar;
    } catch (e) {
      const cachad = await cache.match(nyckel);
      if (cachad) return cachad;
      throw e;
    }
  }
  // range-förfrågan: skiva ur cachen om vi har hela arkivet
  const cachad = await cache.match(nyckel);
  if (cachad) {
    let blob = arkivBlobar.get(bk);
    if (!blob) { blob = await cachad.blob(); arkivBlobar.set(bk, blob); }
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    if (m) {
      const start = +m[1];
      const slut = m[2] ? Math.min(+m[2], blob.size - 1) : blob.size - 1;
      return new Response(blob.slice(start, slut + 1), {
        status: 206,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Range': `bytes ${start}-${slut}/${blob.size}`,
          'Content-Length': String(slut - start + 1),
          'Accept-Ranges': 'bytes',
        },
      });
    }
  }
  return fetch(req);   // inget cachat än — strömma från nätet som vanligt
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // kartarkiven (world + usa) kan ligga på raw.githubusercontent (förhands-
  // länkar) eller samma host (Firebase/produktion). BÅDA måste gå via
  // range-hanteringen — den generiska cachegrenen förstår inte ranges
  if (url.pathname.endsWith('.pmtiles')) {
    e.respondWith(hanteraTiles(e.request));
    return;
  }
  if (url.origin !== location.origin) return;   // firebase/gstatic osv går förbi

  if (url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname.endsWith('/')) {
    // HTML: nätet först, cache som reserv (offline)
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const svar = await fetch(e.request);
        if (svar.ok) cache.put(e.request, svar.clone());
        return svar;
      } catch (err) {
        const cachad = await cache.match(e.request, { ignoreSearch: true });
        if (cachad) return cachad;
        throw err;
      }
    })());
    return;
  }
  // allt annat lokalt (versionerade skript/data, bilder, ljud, vendor):
  // cache först — nya versioner får nya URL:er via ?v=N
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cachad = await cache.match(e.request);
    if (cachad) return cachad;
    const svar = await fetch(e.request);
    if (svar.ok && (svar.type === 'basic' || svar.type === 'default')) {
      cache.put(e.request, svar.clone());
    }
    return svar;
  })());
});
