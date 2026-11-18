// Huvudstädernas plats PÅ KONSTEN. Kartbilderna är tecknade, inte exakta:
// Sicilien är ritad så stor att den täcker det riktiga Malta (Maltas bild
// är ett emblem längre söderut), Vatikanens emblem täcker Rom, och många
// kuststäder hamnar strax ute i havet. En huvudstad vars riktiga punkt inte
// ligger på det egna landets bild (art-regions.json), eller som ligger på
// ett annat lands bild, flyttas till närmaste punkt en bit in på den egna
// bilden. Emblemländerna (badge) får emblemets mittpunkt (art-markers.json).
// Resultatet skrivs som "karta": [lon, lat] i assets/huvudstader.json; den
// riktiga punkten (lat/lon) lämnas orörd.
// Rutnätssökningen bryr sig inte om VILKEN ö punkten hamnar på: Java är
// ritad nästan två grader söder om den riktiga, så närmaste punkt för
// Jakarta blev Sumatras östkust. Sådana läggs för hand i FOR_HAND nedan.
// En flytt längre än VARNA_KM som inte är ett emblem eller handlagd
// skrivs ut med en varning: titta på den på kartan.
//   node tools/huvudstad-platser.mjs            skriver om filen
//   node tools/huvudstad-platser.mjs --torrt    listar bara flyttarna
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const las = f => JSON.parse(fs.readFileSync(path.join(ROT, f), 'utf8'));
const TORRT = process.argv.includes('--torrt');
// land → [lon, lat] på rätt del av landets bild (kontrolleras nedan)
const FOR_HAND = {
  Indonesien: [106.9, -8.25],      // Jakarta på den ritade Javas norra kust
};
// Längre flyttar än så här (som inte är emblem) kollas för hand. Kollade
// 2026-11-18: Malabo hamnar på fastlandet (Bioko är inte ritad) och
// El Aaiún strax innanför Västsaharas ritade nordgräns.
const VARNA_KM = 50;
const KOLLADE = new Set(['Ekvatorialguinea', 'Västsahara']);
const hsFil = path.join(ROT, 'assets/huvudstader.json');
const hs = JSON.parse(fs.readFileSync(hsFil, 'utf8'));
const regioner = las('assets/art-regions.json').features;
const markorer = las('assets/art-markers.json').features;
const gidAv = new Map(markorer.filter(f => f.geometry.type === 'Point').map(f => [f.properties.namn, f.id]));
const punktAv = new Map(markorer.filter(f => f.geometry.type === 'Point').map(f => [f.id, f.geometry.coordinates]));

// ringar i lokal plan projektion (x = lon·cos(lat0), y = lat) — avstånd i "grader"
function inRing(x, y, r) {
  let inne = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inne = !inne;
  }
  return inne;
}
const inMulti = (lon, lat, mp) => mp.some(poly => inRing(lon, lat, poly[0]) && !poly.slice(1).some(h => inRing(lon, lat, h)));
function avstTillKant(lon, lat, mp, k) {
  let min = Infinity;
  for (const poly of mp) for (const r of poly) for (let i = 1; i < r.length; i++) {
    const ax = r[i - 1][0] * k, ay = r[i - 1][1], bx = r[i][0] * k, by = r[i][1], px = lon * k, py = lat;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < min) min = d;
  }
  return min;
}
const bbox = mp => {
  let a = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of mp) for (const [x, y] of poly[0]) a = [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)];
  return a;
};
const km = (lon1, lat1, lon2, lat2) => {
  const R = 6371, r = Math.PI / 180, dl = (lat2 - lat1) * r, dn = (lon2 - lon1) * r;
  const a = Math.sin(dl / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

const flyttar = [];
for (const h of hs.huvudstader) {
  delete h.karta;
  const gid = gidAv.get(h.land);
  if (gid === undefined) continue;
  const egna = regioner.filter(f => f.id === gid && !f.properties.dekor);
  if (!egna.length) continue;
  const egen = egna.flatMap(f => f.geometry.coordinates);
  const andra = regioner.filter(f => f.id !== gid);
  const paAnnan = (lon, lat) => andra.find(f => inMulti(lon, lat, f.geometry.coordinates));
  const pa = inMulti(h.lon, h.lat, egen), annan = paAnnan(h.lon, h.lat);
  if (pa && !annan) continue;
  const k = Math.cos(h.lat * Math.PI / 180);
  let ny = null;
  const badge = egna.some(f => f.properties.badge);
  const mitt = punktAv.get(gid);
  const hand = FOR_HAND[h.land];
  if (hand) {
    if (!inMulti(hand[0], hand[1], egen) || paAnnan(hand[0], hand[1])) throw new Error('FOR_HAND-punkten ligger inte på ' + h.land + 's egen bild');
    ny = hand;
  } else if (badge && mitt && inMulti(mitt[0], mitt[1], egen) && !paAnnan(mitt[0], mitt[1])) {
    ny = mitt;
  } else {
    // rutnät över egna bilden: punkter på bilden, inte på någon annans, en
    // bit in från kanten — den närmast den riktiga punkten vinner
    const [x0, y0, x1, y1] = bbox(egen);
    const steg = Math.max(Math.max(x1 - x0, y1 - y0) / 400, 0.004);
    const kand = [];
    for (let y = y0; y <= y1; y += steg) for (let x = x0; x <= x1; x += steg) {
      if (!inMulti(x, y, egen)) continue;
      kand.push([x, y, Math.hypot((x - h.lon) * k, y - h.lat)]);
    }
    kand.sort((a, b) => a[2] - b[2]);
    // tjockleken nära den riktiga punkten avgör hur långt in vi går
    const nara = kand.slice(0, 4000);
    let tjock = 0;
    for (const c of nara) { c[3] = avstTillKant(c[0], c[1], egen, k); tjock = Math.max(tjock, c[3]); }
    const inset = Math.min(0.08, tjock * 0.5);
    const bast = nara.find(c => c[3] >= inset && !paAnnan(c[0], c[1]));
    if (bast) ny = [bast[0], bast[1]];
  }
  if (!ny) { console.warn('ingen plats hittad för', h.land); continue; }
  h.karta = [+ny[0].toFixed(4), +ny[1].toFixed(4)];
  flyttar.push({ land: h.land, stad: h.huvudstad, km: Math.round(km(h.lon, h.lat, ny[0], ny[1])),
    varfor: !pa ? (annan ? 'på ' + annan.properties.namn : 'utanför') : 'på ' + annan.properties.namn, badge, hand: !!hand });
}
flyttar.sort((a, b) => b.km - a.km);
for (const f of flyttar) console.log(`${String(f.km).padStart(4)} km  ${f.stad} (${f.land})  ${f.varfor}${f.badge ? ' [emblem]' : ''}${f.hand ? ' [för hand]' : ''}`);
const okollade = flyttar.filter(f => f.km > VARNA_KM && !f.badge && !f.hand && !KOLLADE.has(f.land));
for (const f of okollade) console.warn(`VARNING: ${f.stad} (${f.land}) flyttas ${f.km} km — kolla att den hamnar på rätt del av landet`);
console.log(flyttar.length, 'flyttade av', hs.huvudstader.length);
if (!TORRT) {
  // Filten är skriven av Python (indrag 1, "42.0"): ändra bara karta-raderna
  // så att resten av filen står orörd. En karta-rad läggs direkt efter
  // landets "lon"-rad.
  let txt = fs.readFileSync(hsFil, 'utf8').replace(/\n {3}"karta": \[[^\]]*\],?(?=\n)/g, '');
  for (const h of hs.huvudstader) {
    if (!h.karta) continue;
    const i = txt.indexOf('"land": ' + JSON.stringify(h.land) + ',');
    if (i < 0) throw new Error('hittar inte ' + h.land);
    const re = /("lon": -?[\d.]+)(,?)\n/y;
    const j = txt.indexOf('"lon": ', i);
    re.lastIndex = j;
    const m = re.exec(txt);
    if (!m) throw new Error('ingen lon-rad för ' + h.land);
    const rad = `${m[1]},\n   "karta": [${h.karta[0]}, ${h.karta[1]}]${m[2]}\n`;
    txt = txt.slice(0, j) + rad + txt.slice(j + m[0].length);
  }
  fs.writeFileSync(hsFil, txt);
}
