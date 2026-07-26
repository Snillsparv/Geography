// ══════════════════════════════════════════════════════════════════════
// Jonas geografi på JORDGLOBEN — samma spelmekanik som originalsidan
// (Utforska + Klassiskt Quiz + Världstest), men kartan är MapLibre-globen
// med de förbakade kartrutorna, och länderna är klickytorna ur
// assets/art-regions.json. I regionläge är resten av världen grön;
// regionens länder är täckta ("konturkarta") och avslöjar sin bild när
// man hittar dem. Platt karta (Robinson) finns som alternativ vy.
// ══════════════════════════════════════════════════════════════════════

const GRON = '#2e9e44';        // resten av världen i regionläge
const TACK = '#f2ead8';        // "papper" över oupptäckta länder
const GUL = '#ffdc32';         // ledtrådsblink / cirkelhover
const LJUSGRON = '#5fca77';    // hover på grönt land — lyser upp, helt opakt
const HOVERGUL = '#ffe9a8';    // hover på täckt land — ljust och OPAKT (bilden avslöjas först vid klick)
const ROD = '#e05252';         // felklick
// kvitto i bildquizet: hur många försök landet tog. Landformen målas HELT
// i kvittofärgen — bilden är redan avklarad och färgen är facit.
// index = antal försök (1 = rätt direkt), 4 täcker även fler försök
const SVAR_FARG = [null, '#1f7a3c', '#ffdc32', '#ff8c2e', '#e05252'];

const WORLD_SLUGS = ['europa', 'afrika', 'asien', 'nordamerika', 'sydamerika', 'oceanien', 'vastindien'];
const KAMERA = {
  world: { center: [10, 25], zoom: 1.4 },
  europa: { center: [15, 54], zoom: 2.6 },
  afrika: { center: [17, 1], zoom: 2.1 },
  asien: { center: [88, 40], zoom: 1.9 },
  nordamerika: { center: [-95, 45], zoom: 1.9 },
  sydamerika: { center: [-60, -22], zoom: 2.2 },
  oceanien: { center: [150, -22], zoom: 2.2 },
  vastindien: { center: [-71, 18], zoom: 3.4 },
};

// ── DOM ──
const mapPanel = document.getElementById('map-panel');
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
const seterraHintBtn = document.getElementById('seterra-hint-btn');
const seterraHintBox = document.getElementById('seterra-hint');

// ── Speltillstånd ──
let regionsGj = null;             // art-regions.json (alla klickytor)
let featureByFilename = new Map();// filnamn → feature
let featureByGid = new Map();     // gid → feature (för prickklick m.m.)
let COUNTRIES = [];               // aktiva (spelbara) länder i vald region/test
let aktivByGid = new Map();       // gid → country
let IMAGE_ASSOCIATIONS = {};
let HS_KEY = '';
let HS_BAS = '';               // grundnyckel; bildquizet får egen rekordlista
let bildlage = false;          // bildquiz: konsten synlig, hittade länder blir gröna
let aktivSlug = '';            // aktuell region (slug eller 'world')
let aktivRegionNamn = '';
function uppdateraHsKey() { HS_KEY = (bildlage ? 'bild-' : '') + HS_BAS; }
let ASSET_BASE = '';
let currentMode = 'explore';
let isWorldTest = false;
let aktivUtmaning = null;      // { id, data, namn } — pågående kompisutmaning
let map = null;
const revealed = new Set();       // gid
let activeCountry = null;
let exploreTooltipTimer = null;

let seterraQueue = [];
let seterraTarget = null;
let seterraCorrect = 0, seterraWrong = 0, seterraTotal = 0;
let seterraSvit = 0;   // rätta svar i rad — konfetti vid var femte
let seterraStartTime = 0, seterraTimerInterval = null;
let seterraLocked = false, seterraTargetMisses = 0, seterraElapsed = 0;
let seterraMissedCountries = new Set();
let seterraIsRetry = false;
let currentHintText = '';

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ══════════════════════════════════════════════════
// Landtillstånd: gid → {gron, tackt, hover, fel, tips}
// Speglas till MapLibre feature-state och plattkartan.
// ══════════════════════════════════════════════════
const tillstand = new Map();
function setLand(gid, patch) {
  const t = tillstand.get(gid) || {};
  Object.assign(t, patch);
  tillstand.set(gid, t);
  if (map) {
    try {
      map.setFeatureState({ source: 'regioner', id: gid }, t);
      map.setFeatureState({ source: 'markorer', id: gid }, t);
      map.setFeatureState({ source: 'borders', id: gid }, t);
    } catch (e) { /* källan inte laddad än — tillståndet ligger i tillstand-mappen */ }
  }
  flatDirty();
  origApplyState(gid, t);
}
function landState(gid) { return tillstand.get(gid) || {}; }

function revealCountry(gid) {
  revealed.add(gid);
  setLand(gid, { tackt: false, hover: false, fel: false, tips: false });
}
function coverCountry(gid) {
  revealed.delete(gid);
  // quizens markeringar nollas också — gron hängde annars kvar från
  // bildquizet in i nästa läge, så det såg ut som att gamla rundan
  // fortsatte fast en ny börjat
  setLand(gid, { tackt: true, svar: 0, gron: false });
}
function flashWrong(gid) {
  if (revealed.has(gid)) return;
  setLand(gid, { fel: true, hover: false });
  setTimeout(() => setLand(gid, { fel: false }), 1200);
}
// pekskärmar får en förlåtande tryckyta runt de små prickarna — musen en
// mindre (tunna öar som Kuba är svåra att pricka exakt även med pekare)
const TRYCKMARGINAL = matchMedia('(pointer: coarse)').matches ? 10 : 4;

function blinkHint(gid) {
  if (revealed.has(gid)) return;
  let n = 0;
  const iv = setInterval(() => {
    setLand(gid, { tips: n % 2 === 0 });
    if (++n >= 6) { clearInterval(iv); setLand(gid, { tips: false }); }
  }, 260);
}
function resetOverlays() {
  for (const c of COUNTRIES) coverCountry(c.gid);
  revealed.clear();
  flatDirty();
}

// ══════════════════════════════════
// Dataladdning
// ══════════════════════════════════
// ?v=N på alla resurser som ändras vid deploy: mobilwebbläsare och CDN:er
// cachar hårt, och en gammal glob-spel.js mot nya datafiler gav trasiga
// halvlägen (döda flikar/klick). V bumpas i EN konstant här och i
// glob.html:s skriptreferens — aldrig fler handbumpade URL:er.
const V = '54';
// På *.githack.com (förhandslänkar) klarar proxyn varken stora filer eller
// range-requests pålitligt — datafilerna hämtas då direkt från GitHubs
// råfilsserver (206 + CORS verifierat). /ägare/repo/gren läses ur sidans URL.
const RAW_BAS = (() => {
  if (!/\.githack\.com$/.test(location.hostname)) return '';
  const p = location.pathname.split('/');   // ['', ägare, repo, …gren, 'glob.html']
  return p.length >= 4 ? 'https://raw.githubusercontent.com/' + p.slice(1, -1).join('/') + '/' : '';
})();
const dataUrl = f => RAW_BAS + f;
async function fetchJson(path) {
  const r = await fetch(dataUrl(path));
  if (!r.ok) throw new Error(path + ' → HTTP ' + r.status);
  return r.json();
}
// v3: arkivet bakades om (Kaspiska havets gula flisor bort, Iran fick
// pupiller). Både URL:en OCH service workerns cachenamn måste bytas —
// annars serverar den gamla rutor för evigt.
const TILE_URL = dataUrl('tiles/world.pmtiles?v=3');
let pmArchive = null;   // hela arkivet i minnet (fylls i bakgrunden)
let pmStream = null;    // strömmande instans tills nedladdningen är klar
let protocol = null;    // maplibre-pmtiles-protokollet (sätts i initMap)
function pmSource() {
  if (pmArchive) return pmArchive;
  if (!pmStream) pmStream = new pmtiles.PMTiles(TILE_URL);
  return pmStream;
}
// Hela arkivet (≈45 MB) hämtas i BAKGRUNDEN: spelet startar direkt med
// range requests (bara de rutor som syns laddas — en handfull för en
// region) och växlar till minnesversionen när nedladdningen är klar, så
// att globen sedan snurrar utan att rutor laddar i kanterna.
// Hela 45 MB-arkivet förladdas först när besökaren visar ENGAGEMANG —
// varje nyfiken förbiflygare ska inte kosta full bandbredd. Återbesökare
// har arkivet gratis i service workerns cache och förladdar direkt.
let forladdningStartad = false;
function startaForladdning() {
  if (forladdningStartad) return;
  forladdningStartad = true;
  const ansl = navigator.connection || {};
  const sparsam = !!ansl.saveData || /(^|-)2g$/.test(ansl.effectiveType || '');
  if (sparsam) return;   // datasnåla lägen strömmar alltid på begäran
  preloadTiles(p => {
    const procent = document.getElementById('ladd-procent');
    const text = p < 1 ? `Målar jordgloben … ${Math.round(p * 100)} %` : '';
    if (procent && !document.getElementById('ladd-skarm').classList.contains('klar')) {
      procent.textContent = text || 'Nästan klart …';
    }
    const el = document.querySelector('.start-hint');
    if (el && document.body.classList.contains('startlage')) {
      el.textContent = text || 'Snurra på jordgloben — och klicka på en världsdel för att börja träna!';
    }
  });
}

async function preloadTiles(onProgress) {
  try {
    const resp = await fetch(TILE_URL);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const total = +resp.headers.get('Content-Length') || 0;
    const reader = resp.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (total && onProgress) onProgress(got / total);
    }
    const buf = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { buf.set(c, o); o += c.length; }
    pmArchive = new pmtiles.PMTiles({
      getKey: () => TILE_URL,
      getBytes: async (offset, length) => ({ data: buf.buffer.slice(offset, offset + length) }),
    });
    if (protocol) protocol.add(pmArchive);   // efterföljande rutor tas ur minnet
  } catch (e) {
    console.warn('Bakgrundsladdningen misslyckades – fortsätter strömma.', e);
  }
}

async function loadRegions() {
  regionsGj = await fetchJson('assets/art-regions.json?v=' + V);
  for (const f of regionsGj.features) {
    // dekordelar (Malaysias ögon/spröt i havet) delar id med sitt land men
    // huvudfeaturen ska äga uppslagen
    if (f.properties.dekor) continue;
    featureByFilename.set(f.properties.key.split('/')[1], f);
    featureByGid.set(f.id, f);
  }
}

// ── Startsidan: klick på en världsdel på globen öppnar dess träningsläge ──
// nyckelns prefix (europa/ukraina → europa) pekar ut världsdelen; bara
// riktiga regioner räknas (Grönland/Antarktis m.fl. har inga spellägen)
function startRegionSlug(gid) {
  const f = featureByGid.get(gid);
  const slug = f && f.properties.key.split('/')[0];
  return slug && KAMERA[slug] && slug !== 'world' ? slug : null;
}
const regionGidsCache = new Map();
function regionGids(slug) {
  if (!regionGidsCache.has(slug)) {
    regionGidsCache.set(slug, regionsGj.features
      .filter(f => !f.properties.dekor && f.properties.key.split('/')[0] === slug)
      .map(f => f.id));
  }
  return regionGidsCache.get(slug);
}
// hover-glansen på hela världsdelen sätts DIREKT i kartans feature-state
// (inte via setLand): den är flyktig och ska inte fastna i speltillståndet
let startHoverSlug = null;
function sattStartHover(slug, pa) {
  if (!slug || !map) return;
  for (const gid of regionGids(slug)) {
    try { map.setFeatureState({ source: 'regioner', id: gid }, { hover: pa }); } catch (e) {}
  }
}
function slappStartHover() {
  sattStartHover(startHoverSlug, false);
  startHoverSlug = null;
}

// Markörerna: badge-ländernas RIKTIGA former + alla länders mittpunkter.
// De överritade småstaternas bilder har inte landets form — när ett sådant
// land är täckt döljs bilden med havsfärg och man ser i stället den riktiga
// formen och en klickbar prick (ring för utspridda ö-nationer).
let markersGj = { type: 'FeatureCollection', features: [] };
let markerPts = [];             // {gid, lng, lat, omfang, spridd, _vis}
async function loadMarkers() {
  try {
    markersGj = await fetchJson('assets/art-markers.json?v=' + V);
    markerPts = markersGj.features
      .filter(f => f.geometry.type === 'Point')
      .map(f => ({ gid: f.id, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
                   omfang: f.properties.omfang, smal: f.properties.smal,
                   badge: f.properties.badge ? 1 : 0, tackradie: f.properties.tackradie,
                   spridd: f.properties.spridd ? 1 : 0, _vis: null }));
  } catch (e) { console.warn('kunde inte läsa art-markers.json', e); }
}

// Cirkeln har FAST storlek på kartan (geografiskt förankrad — den zoomar
// med kartan i stället för att krympa relativt den), med en minsta
// skärmstorlek så den alltid syns och går att trycka på utzoomat.
// ALLA cirklar har samma absoluta storlek på kartan — de zoomar med
// exakt som geografin, ingen minsta skärmstorlek som blåser upp dem
// utzoomat. Helt opaka: inget land ska skymta igenom.
const CIRKEL_GRAD = 0.6;   // radie i grader
// pricken finns bara på länder som är för små för att ses vid aktuell zoom
// (under så här många skärmpixlar) — större länder klarar sig utan. Spridda
// ö-nationer har alltid sin cirkel: atollerna syns aldrig hur man än zoomar.
const PRICK_SYNS_PX = 18;
// avlånga länder (Kuba! Gambia!) är "stora" på längden men bara några pixlar
// tjocka och går inte att träffa ändå — smal (tjockleken ur artgeometrin,
// yta/längsta axel) ger dem prick tills de är tjocka nog att tryckas på,
// så länge de inte redan dominerar vyn på längden
// 5,2 px: precis så tunt att fingret/pekaren inte kan träffa landmassan
// (Gambia 1, Syrien 2, Kuba 3, Israel 5) — Slovenien, Filippinerna,
// Malawi och Turkmenistan ligger strax över och klarar sig utan cirkel
const PRICK_SMAL_PX = 5.2;
const PRICK_SMAL_MAX = 120;
// pricken får aldrig krympa till en ohittbar fläck — det var precis så
// Jamaica "tappade sin pil" på översiktszoomarna — och aldrig växa till
// en jättefläck som slukar kartan när man zoomar in maximalt
const PRICK_MIN_RADIE = 5;
const PRICK_MAX_RADIE = 22;
// Vatikanstaten och San Marino är ritade som stora emblem MITT I Italien:
// de kan inte döljas med havsfärg, så deras cirkel görs i stället precis
// så stor att den sväljer hela konstblobben (tackradie, i grader). Då är
// det en CIRKEL man ser medan landet är dolt — inte konstverkets silhuett.
function prickRadiePx(zoomPx, m) {
  // zoomPx = kartpixlar per grad vid aktuell zoom/skala
  if (m && m.tackradie) return Math.max(PRICK_MIN_RADIE, m.tackradie * zoomPx);
  return Math.min(PRICK_MAX_RADIE, Math.max(PRICK_MIN_RADIE, CIRKEL_GRAD * zoomPx));
}
function prickSyns(m, zoomPx) {
  // emblemländer (konsten har inte landets form) och utspridda ö-nationer
  // behåller ALLTID sin cirkel — den är det enda som visar var landet
  // egentligen ligger, hur långt in man än zoomar
  if (m.spridd || m.badge) return true;
  if (m.omfang * zoomPx < PRICK_SYNS_PX) return true;
  return (m.smal || m.omfang) * zoomPx < PRICK_SMAL_PX &&
         m.omfang * zoomPx < PRICK_SMAL_MAX;
}
// GL-lagrets radie/kontur: ett stopp per zoomsteg där landet antingen får
// sin fasta kartradie (om det fortfarande är litet på skärmen) eller 0 —
// interpolationen mellan stoppen gör att pricken krymper bort mjukt
function prickStops(vardeFn) {
  const stops = [];
  for (let z = 0; z <= 10; z++) {
    const pxDeg = 512 * Math.pow(2, z) / 360;
    stops.push(z, ['case', ['boolean', ['feature-state', 'tackt'], false],
      ['case', ['any', ['==', ['get', 'spridd'], 1], ['==', ['get', 'badge'], 1]],
        vardeFn(true, pxDeg),
        ['case', ['any',
          ['<', ['get', 'omfang'], PRICK_SYNS_PX / pxDeg],
          ['all',
            ['<', ['coalesce', ['get', 'smal'], ['get', 'omfang']], PRICK_SMAL_PX / pxDeg],
            ['<', ['get', 'omfang'], PRICK_SMAL_MAX / pxDeg]]],
          vardeFn(false, pxDeg), 0]],
      0]);
  }
  return stops;
}


// ══════════════════════
// Flaggor: landnamn → emoji (ISO-koder; England/Skottland/Wales har egna
// emojiflaggor, Nordirland saknar och får GB)
// ══════════════════════
const FLAGG_ISO = { Afghanistan:'AF', Albanien:'AL', Algeriet:'DZ', Andorra:'AD', Angola:'AO',
  'Antigua & Barbuda':'AG', Argentina:'AR', Armenien:'AM', Australien:'AU', Azerbajdzjan:'AZ',
  Bahamas:'BS', Bahrain:'BH', Bangladesh:'BD', Barbados:'BB', Belgien:'BE', Belize:'BZ',
  Benin:'BJ', Bhutan:'BT', Bolivia:'BO', 'Bosnien-Hercegovina':'BA', Botswana:'BW',
  Brasilien:'BR', Brunei:'BN', Bulgarien:'BG', 'Burkina Faso':'BF', Burma:'MM', Burundi:'BI',
  'Centralafrikanska Republiken':'CF', Chile:'CL', Colombia:'CO', 'Costa Rica':'CR',
  Cypern:'CY', Danmark:'DK', 'Demokratiska Republiken Kongo':'CD', Djibouti:'DJ',
  Dominica:'DM', 'Dominikanska Republiken':'DO', Ecuador:'EC', Egypten:'EG',
  Ekvatorialguinea:'GQ', 'El Salvador':'SV', Elfenbenskusten:'CI', England:'gbeng',
  Eritrea:'ER', Estland:'EE', Eswatini:'SZ', Etiopien:'ET', Fiji:'FJ', Filippinerna:'PH',
  Finland:'FI', Frankrike:'FR', 'Franska Guyana':'GF', 'Förenade Arabemiraten':'AE',
  Gabon:'GA', Gambia:'GM', Georgien:'GE', Ghana:'GH', Grekland:'GR', Grenada:'GD',
  Guatemala:'GT', Guinea:'GN', 'Guinea-Bissau':'GW', Guyana:'GY', Haiti:'HT', Honduras:'HN',
  Indien:'IN', Indonesien:'ID', Irak:'IQ', Iran:'IR', Irland:'IE', Island:'IS', Israel:'IL',
  Italien:'IT', Jamaica:'JM', Japan:'JP', Jemen:'YE', Jordanien:'JO', Kambodja:'KH',
  Kamerun:'CM', Kanada:'CA', 'Kap Verde':'CV', Kazakstan:'KZ', Kenya:'KE', Kina:'CN',
  Kirgizistan:'KG', Kiribati:'KI', Komorerna:'KM', 'Kongo-Brazzaville':'CG', Kosovo:'XK',
  Kroatien:'HR', Kuba:'CU', Kuwait:'KW', Laos:'LA', Lesotho:'LS', Lettland:'LV',
  Libanon:'LB', Liberia:'LR', Libyen:'LY', Liechtenstein:'LI', Litauen:'LT', Luxembourg:'LU',
  Madagaskar:'MG', Makedonien:'MK', Nordmakedonien:'MK', Malawi:'MW', Malaysia:'MY', Maldiverna:'MV', Mali:'ML',
  Malta:'MT', Marocko:'MA', 'Marshallöarna':'MH', Mauretanien:'MR', Mauritius:'MU',
  Mexiko:'MX', Mikronesien:'FM', Mocambique:'MZ', Moldavien:'MD', Monaco:'MC',
  Mongoliet:'MN', Montenegro:'ME', Namibia:'NA', Nauru:'NR', 'Nederländerna':'NL',
  Nepal:'NP', Nicaragua:'NI', Niger:'NE', Nigeria:'NG', Nordirland:'GB', Nordkorea:'KP',
  Norge:'NO', 'Nya Zeeland':'NZ', Oman:'OM', Pakistan:'PK', Palau:'PW', Palestina:'PS',
  Panama:'PA', 'Papua Nya Guinea':'PG', Paraguay:'PY', Peru:'PE', Polen:'PL', Portugal:'PT',
  Qatar:'QA', 'Rumänien':'RO', Rwanda:'RW', Ryssland:'RU', 'Saint Kitts & Nevis':'KN',
  'Saint Lucia':'LC', 'Saint Vincent & Grenadinerna':'VC', Samoa:'WS', 'San Marino':'SM',
  'Sao Tome & Principe':'ST', Saudiarabien:'SA', Schweiz:'CH', Senegal:'SN', Serbien:'RS',
  Seychellerna:'SC', 'Sierra Leone':'SL', Singapore:'SG', Skottland:'gbsct', Slovakien:'SK',
  Slovenien:'SI', 'Solomonöarna':'SB', Somalia:'SO', Spanien:'ES', 'Sri Lanka':'LK',
  Sudan:'SD', Surinam:'SR', Sverige:'SE', Sydafrika:'ZA', Sydkorea:'KR', Sydsudan:'SS',
  Syrien:'SY', Tadzjikistan:'TJ', Taiwan:'TW', Tanzania:'TZ', Tchad:'TD', Thailand:'TH',
  Tjeckien:'CZ', Togo:'TG', Tonga:'TO', 'Trinidad & Tobago':'TT', Tunisien:'TN',
  Turkiet:'TR', Turkmenistan:'TM', Tuvalu:'TV', Tyskland:'DE', USA:'US', Uganda:'UG',
  Ukraina:'UA', Ungern:'HU', Uruguay:'UY', Uzbekistan:'UZ', Vanuatu:'VU',
  Vatikanstaten:'VA', Venezuela:'VE', Vietnam:'VN', Vitryssland:'BY', Belarus:'BY', 'Västsahara':'EH',
  Wales:'gbwls', Zambia:'ZM', Zimbabwe:'ZW', 'Österrike':'AT', 'Östtimor':'TL' };
function flagga(namn) {
  const kod = FLAGG_ISO[namn];
  if (!kod) return '';
  if (kod.length === 2) {
    return String.fromCodePoint(...[...kod].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
  }
  // subnationella flaggor (gbeng/gbsct/gbwls): svart flagga + tag-tecken
  return '\u{1F3F4}' + [...kod].map(c => String.fromCodePoint(0xE0000 + c.charCodeAt(0))) .join('') + '\u{E007F}';
}


// ══════════════════════
// Ljud: små syntplingar (inga filer behövs) + global mute-knapp
// ══════════════════════
let ljudAv = localStorage.getItem('ljud-av') === '1';
let audioCtx = null;
function spela(typ) {
  if (ljudAv) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    if (typ === 'klick') {
      // mjukt "tick" när länder tänds/släcks i Utforska: en kort dämpad
      // brusstöt genom bandpass — som ett lätt knäpp, inte en pling
      const n = Math.round(audioCtx.sampleRate * 0.04);
      const buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * 0.18));
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      const bp = audioCtx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 1.4;
      const g = audioCtx.createGain();
      g.gain.value = 0.25;
      src.connect(bp); bp.connect(g); g.connect(audioCtx.destination);
      src.start(t);
      return;
    }
    const toner = typ === 'ratt' ? [[523.25, 0, .09], [659.25, .08, .09], [783.99, .16, .18]]
      : typ === 'fel' ? [[196, 0, .16], [155.56, .1, .22]]
      : [[523.25, 0, .12], [659.25, .1, .12], [783.99, .2, .12], [1046.5, .3, .34]];
    for (const [fr, st, len] of toner) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = typ === 'fel' ? 'triangle' : 'sine';
      o.frequency.value = fr;
      g.gain.setValueAtTime(0.0001, t + st);
      g.gain.exponentialRampToValueAtTime(typ === 'fel' ? .2 : .16, t + st + .015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + st + len);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t + st); o.stop(t + st + len + .05);
    }
  } catch (e) { /* ljud är aldrig kritiskt */ }
}
const ljudKnapp = document.getElementById('ljud-knapp');
function visaLjudlage() { if (ljudKnapp) ljudKnapp.textContent = ljudAv ? '🔇' : '🔊'; }
if (ljudKnapp) ljudKnapp.addEventListener('click', () => {
  ljudAv = !ljudAv;
  localStorage.setItem('ljud-av', ljudAv ? '1' : '0');
  visaLjudlage();
});
visaLjudlage();

const configCache = {};
async function loadRegionConfig(slug) {
  if (configCache[slug]) return configCache[slug];
  const raw = await fetchJson(`assets/${slug}/config.json?v=` + V);
  configCache[slug] = raw;
  return raw;
}

// Spelbara länder för en region: config-länder som har en klickyta
function buildCountries(slug, raw) {
  const out = [];
  for (const c of raw.countries) {
    const filename = c.filename || c.file.replace('countries/', '').replace('.webp', '');
    const f = featureByFilename.get(filename);
    if (!f) { console.warn('ingen klickyta:', slug, filename); continue; }
    out.push({
      name: c.name, filename, slug, gid: f.id,
      desc: c.desc || '', assoc: c.imageAssociation || '',
    });
  }
  return out;
}

// ══════════════════════════════════
// MapLibre-globen
// ══════════════════════════════════
function initMap() {
  protocol = new pmtiles.Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  if (pmArchive) protocol.add(pmArchive);

  map = new maplibregl.Map({
    container: 'spel-map',
    center: KAMERA.world.center,
    zoom: KAMERA.world.zoom,
    maxZoom: 9.5,
    clickTolerance: 10,
    doubleClickZoom: false,
    attributionControl: { compact: true },
    style: {
      version: 8,
      projection: { type: 'globe' },
      sources: {
        art: {
          type: 'raster',
          url: 'pmtiles://' + TILE_URL,
          // rutorna är 512 px men deklareras som 256: MapLibre hämtar då
          // en zoomnivå djupare rutor för samma vy — konsten blir skarp
          // redan utzoomat i stället för suddig fram till nästa nivå
          tileSize: 256,
          attribution: 'Illustrationer © Jonas · Gränser: Natural Earth',
        },
        borders: { type: 'geojson', data: dataUrl('assets/art-borders.json?v=' + V) },
        jorden: { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: {
          type: 'Polygon', coordinates: [[[-180, -89.9], [-180, 89.9], [180, 89.9],
                                          [180, -89.9], [-180, -89.9]]] } } },
        regioner: { type: 'geojson', data: regionsGj },
        markorer: { type: 'geojson', data: markersGj },
      },
      layers: [
        // rymden bakom sfären; själva havet är en VEKTORSFÄR som syns
        // omedelbart — utan den är globen osynlig tills konst-tilesen
        // strömmat in (kan ta många sekunder på förhandslänkar/mobil)
        { id: 'bg', type: 'background', paint: { 'background-color': '#02060d' } },
        { id: 'hav', type: 'fill', source: 'jorden',
          paint: { 'fill-color': '#123050' } },
        { id: 'art', type: 'raster', source: 'art', paint: { 'raster-resampling': 'linear' } },
        // täcket: badge-öar (bilden ligger i havet men har inte landets
        // form) döljs med HAVSFÄRG när de är täckta/gröna — den riktiga
        // formen och pricken nedanför visar var landet faktiskt finns.
        // Samma sak för dekordelar (Malaysias ögon och spröt är ritade i
        // havet): täckta ska de försvinna i havet, inte bli pappersformer.
        { id: 'cover', type: 'fill', source: 'regioner',
          paint: {
            // hover: landet LYSER UPP helt opakt (ljusgrönt/ljusgult) —
            // bilden under täcket får aldrig skymta, den visas först vid
            // klick. Havs-badges hålls havsfärgade även vid hover (deras
            // cirkel lyser i stället).
            'fill-color': ['case',
              ['boolean', ['feature-state', 'fel'], false], ROD,
              ['boolean', ['feature-state', 'tips'], false], GUL,
              ['any',
                ['all', ['==', ['get', 'badge'], 1], ['==', ['get', 'hav'], 1]],
                ['==', ['get', 'dekor'], 1]], '#123050',
              ['boolean', ['feature-state', 'hover'], false],
                ['case', ['boolean', ['feature-state', 'gron'], false], LJUSGRON,
                         ['boolean', ['feature-state', 'tackt'], false], HOVERGUL,
                         '#ffffff'],
              ['boolean', ['feature-state', 'gron'], false], GRON,
              // kvittotonen över besvarade länder i bildquizet
              ['==', ['coalesce', ['feature-state', 'svar'], 0], 1], SVAR_FARG[1],
              ['==', ['coalesce', ['feature-state', 'svar'], 0], 2], SVAR_FARG[2],
              ['==', ['coalesce', ['feature-state', 'svar'], 0], 3], SVAR_FARG[3],
              ['>=', ['coalesce', ['feature-state', 'svar'], 0], 4], SVAR_FARG[4],
              TACK],
            'fill-opacity': ['case',
              ['boolean', ['feature-state', 'fel'], false], 0.92,
              ['boolean', ['feature-state', 'tips'], false], 0.92,
              // havs-badges/dekordelar döljs i havet även när landet fått
              // sin kvittofärg — bara den riktiga formen ska bära färgen
              ['any',
                ['all', ['==', ['get', 'badge'], 1], ['==', ['get', 'hav'], 1]],
                ['==', ['get', 'dekor'], 1]],
                ['case', ['any', ['boolean', ['feature-state', 'gron'], false],
                                 ['boolean', ['feature-state', 'tackt'], false],
                                 ['>=', ['coalesce', ['feature-state', 'svar'], 0], 1]], 1, 0],
              ['boolean', ['feature-state', 'hover'], false],
                ['case', ['any', ['boolean', ['feature-state', 'gron'], false],
                                 ['boolean', ['feature-state', 'tackt'], false]], 1, 0.25],
              ['boolean', ['feature-state', 'gron'], false], 1,
              ['boolean', ['feature-state', 'tackt'], false], 1,
              ['>=', ['coalesce', ['feature-state', 'svar'], 0], 1], 1,
              0],
          } },
        // bildens antialiasing-frans (alfa < 128) ligger strax UTANFÖR
        // klickytan — en kantlinje i havsfärg sväljer den så inga
        // konturrester av den dolda bilden skymtar på havet
        { id: 'cover-kant', type: 'line', source: 'regioner',
          filter: ['any',
            ['all', ['==', ['get', 'badge'], 1], ['==', ['get', 'hav'], 1]],
            ['==', ['get', 'dekor'], 1]],
          paint: {
            'line-color': '#123050',
            'line-width': 3,
            'line-opacity': ['case',
              ['any',
                ['boolean', ['feature-state', 'fel'], false],
                ['boolean', ['feature-state', 'tips'], false],
                ['boolean', ['feature-state', 'hover'], false]], 0,
              ['any',
                ['boolean', ['feature-state', 'tackt'], false],
                ['boolean', ['feature-state', 'gron'], false],
                ['>=', ['coalesce', ['feature-state', 'svar'], 0], 1]], 1,
              0],
          },
          layout: { 'line-join': 'round' } },
        // badge-ländernas RIKTIGA Natural Earth-form: medan landet är
        // täckt syns BARA cirkeln — formen visas först när landet
        // avslöjats (och som grön geografi i den gröna omvärlden)
        { id: 'former', type: 'fill', source: 'markorer',
          filter: ['==', ['get', 'form'], 1],
          paint: {
            'fill-color': ['case',
              ['boolean', ['feature-state', 'gron'], false], '#45b45e',
              // badge-öarnas riktiga form bär kvittofärgen helt opakt —
              // formen är för liten för en genomskinlig ton
              ['==', ['coalesce', ['feature-state', 'svar'], 0], 1], SVAR_FARG[1],
              ['==', ['coalesce', ['feature-state', 'svar'], 0], 2], SVAR_FARG[2],
              ['==', ['coalesce', ['feature-state', 'svar'], 0], 3], SVAR_FARG[3],
              ['>=', ['coalesce', ['feature-state', 'svar'], 0], 4], SVAR_FARG[4],
              TACK],
            'fill-opacity': ['case',
              ['boolean', ['feature-state', 'gron'], false], 1,
              ['boolean', ['feature-state', 'tackt'], false], 0,
              1],
            'fill-outline-color': '#0a0a0a',
          } },
        { id: 'borders', type: 'line', source: 'borders',
          paint: { 'line-color': '#0a0a0a', 'line-width': 1.5,
            // badge-blobbarnas och dekordelarnas konturer (egna features,
            // id = gid) släcks när landet är täckt/grönt/kvittofärgat —
            // bilden de ramar in är ju dold då
            'line-opacity': ['case',
              ['all',
                ['any', ['==', ['get', 'badge'], 1], ['==', ['get', 'dekor'], 1]],
                ['any', ['boolean', ['feature-state', 'tackt'], false],
                        ['boolean', ['feature-state', 'gron'], false],
                        ['>=', ['coalesce', ['feature-state', 'svar'], 0], 1]]],
              0, 0.9] },
          layout: { 'line-join': 'round', 'line-cap': 'round' } },
        // klickbar cirkel på täckta småländer. ABSOLUT storlek på kartan
        // (zoomar med geografin, ingen minsta skärmstorlek) och helt opak —
        // ritas ovanpå gränslinjerna så att inget land skymtar igenom.
        { id: 'prickar', type: 'circle', source: 'markorer',
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-radius': ['interpolate', ['exponential', 2], ['zoom'],
              ...prickStops((spridd, pxDeg) => ['min',
                ['case', ['has', 'tackradie'], 1e6, PRICK_MAX_RADIE],
                ['max', PRICK_MIN_RADIE,
                  ['*', ['coalesce', ['get', 'tackradie'], CIRKEL_GRAD], pxDeg]]])],
            'circle-color': ['case',
              ['boolean', ['feature-state', 'fel'], false], ROD,
              ['any', ['boolean', ['feature-state', 'tips'], false],
                      ['boolean', ['feature-state', 'hover'], false]], GUL,
              TACK],
            'circle-opacity': 1,
            'circle-stroke-color': '#0a0a0a',
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'],
              ...prickStops(spridd => spridd ? 2.5 : 1.5)],
          } },
      ],
    },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');

  let hoverGid = null;
  map.on('mousemove', e => {
    if ((currentMode === 'seterra' || currentMode === 'bildquiz') && seterraTarget && !seterraLocked) {
      cursorLabel.style.left = e.originalEvent.clientX + 'px';
      cursorLabel.style.top = e.originalEvent.clientY + 'px';
    } else if (cursorLabel.classList.contains('explore-tooltip') && cursorLabel.style.display === 'block') {
      // landnamnsrutan i Utforska följer med musen tills den tonar bort
      cursorLabel.style.left = e.originalEvent.clientX + 'px';
      cursorLabel.style.top = e.originalEvent.clientY + 'px';
    }
    const hits = map.queryRenderedFeatures(e.point, { layers: ['prickar', 'former', 'cover'] });
    const gid = hits.length ? hits[0].id : null;
    if (document.body.classList.contains('startlage')) {
      // startsidan: hela världsdelen skimrar när man pekar på den
      const slug = gid !== null ? startRegionSlug(gid) : null;
      if (slug !== startHoverSlug) {
        sattStartHover(startHoverSlug, false);
        sattStartHover(slug, true);
        startHoverSlug = slug;
      }
      map.getCanvas().style.cursor = slug ? 'pointer' : '';
      return;
    }
    const c = gid !== null ? aktivByGid.get(gid) : null;
    const newHover = c && !revealed.has(gid) ? gid : null;
    if (newHover !== hoverGid) {
      if (hoverGid !== null) setLand(hoverGid, { hover: false });
      if (newHover !== null && !landState(newHover).fel) setLand(newHover, { hover: true });
      hoverGid = newHover;
    }
    map.getCanvas().style.cursor = gid !== null ? 'pointer' : '';
  });
  map.on('click', e => {
    let hits = map.queryRenderedFeatures(e.point, { layers: ['prickar', 'former', 'cover'] });
    if (!hits.length && TRYCKMARGINAL) {
      // pekskärm: fingret missar lätt de små prickarna (Västindien!) —
      // fånga träffar strax intill, men bara när exakta träffen är tom
      hits = map.queryRenderedFeatures(
        [[e.point.x - TRYCKMARGINAL, e.point.y - TRYCKMARGINAL],
         [e.point.x + TRYCKMARGINAL, e.point.y + TRYCKMARGINAL]],
        { layers: ['prickar', 'former', 'cover'] });
      if (hits.length > 1) {
        // närmsta pricken vinner — i prickgyttret (Västindien utzoomat)
        // fick annars den överst ritade alla närliggande tryck. Gäller BARA
        // träffar i prickLAGRET: polygonträffar behåller ritordningen
        // (sorteringen är stabil), annars vinner grannen vars mittpunkt
        // råkar ligga närmast i stället för landet man faktiskt nuddade
        const avst = f => {
          if (!f.layer || f.layer.id !== 'prickar') return Infinity;
          const m = markerPts.find(m2 => m2.gid === f.id);
          if (!m) return Infinity;
          const p = map.project([m.lng, m.lat]);
          return Math.hypot(p.x - e.point.x, p.y - e.point.y);
        };
        hits.sort((a, b) => avst(a) - avst(b));
      }
    }
    if (!hits.length) return;
    // startsidan: klick på en världsdel flyger dit och öppnar träningsläget
    if (document.body.classList.contains('startlage')) {
      const slug = startRegionSlug(hits[0].id);
      if (slug) gaTillRegion(slug);
      return;
    }
    handleMapClick(hits[0].id, e.originalEvent);
  });
  // snurren på startsidan släpper vid beröring men återupptas efteråt —
  // åt det håll användaren själv drog globen
  for (const ev of ['pointerdown', 'touchstart', 'wheel']) {
    map.getCanvas().addEventListener(ev, () => {
      if (ev === 'pointerdown' || ev === 'touchstart') pekarNere = true;
      stoppaSnurr();
      planeraSnurrAter();
      startaForladdning();   // den som rör globen är engagerad → hämta arkivet
    }, { passive: true });
  }
  for (const ev of ['pointerup', 'pointercancel', 'touchend', 'touchcancel']) {
    map.getCanvas().addEventListener(ev, () => {
      pekarNere = false;
      planeraSnurrAter();
    }, { passive: true });
  }
  let senasteLng = null;
  map.on('move', e => {
    // bara användarens egna drag räknas (programstyrda flygningar saknar
    // originalEvent) — riktningen avgör åt vilket håll snurren återupptas
    if (!e.originalEvent || !document.body.classList.contains('startlage')) {
      senasteLng = null;
      return;
    }
    const lng = map.getCenter().lng;
    if (senasteLng != null) {
      let d = lng - senasteLng;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      if (Math.abs(d) > 0.01) snurrRikt = d > 0 ? 1 : -1;
    }
    senasteLng = lng;
  });
  map.on('moveend', () => {
    if (document.body.classList.contains('startlage') && snurrId === null) planeraSnurrAter();
  });
  // tillstånd satta innan stilen laddat klart (snabbstart/trög proxy)
  // försvinner i setLands try-fångst — lägg på dem igen när stilen är klar
  map.on('load', () => {
    for (const [gid, t] of tillstand) {
      try {
        map.setFeatureState({ source: 'regioner', id: gid }, t);
        map.setFeatureState({ source: 'markorer', id: gid }, t);
        map.setFeatureState({ source: 'borders', id: gid }, t);
      } catch (e) { /* källa saknas ännu — hämtas när den laddat */ }
    }
  });
}

function handleMapClick(gid, ev) {
  const c = aktivByGid.get(gid);
  if (currentMode === 'explore') {
    if (c) exploreClick(c, ev);
    return;
  }
  // quiz: klick på land utanför spelet räknas också (man ser vad det var)
  if (c) seterraClick(c);
  else {
    const f = regionsGj.features.find(f2 => f2.id === gid);
    if (f) seterraClick({ name: f.properties.namn, filename: null, gid, desc: '', assoc: '', frammande: true });
  }
}

// ══════════════════════════════════
// Väggkartan (Robinson) — zoombar
// ══════════════════════════════════
const D2R = Math.PI / 180;
const MAXLAT = 85.051128779807 * D2R;
const RX = [1.0000,0.9986,0.9954,0.9900,0.9822,0.9730,0.9600,0.9427,0.9216,0.8962,0.8679,0.8350,0.7986,0.7597,0.7186,0.6732,0.6213,0.5722,0.5322];
const RY = [0.0000,0.0620,0.1240,0.1860,0.2480,0.3100,0.3720,0.4340,0.4958,0.5571,0.6176,0.6769,0.7346,0.7903,0.8435,0.8936,0.9394,0.9761,1.0000];
const lerpTab = (tab, t) => {
  const i = Math.min(17, Math.floor(t)), f = t - i;
  return tab[i] + (tab[i + 1] - tab[i]) * f;
};
const robinson = {
  forward(l, p) {
    const t = Math.abs(p) / D2R / 5;
    return [0.8487 * lerpTab(RX, t) * l, 1.3523 * lerpTab(RY, t) * Math.sign(p)];
  },
  inverse(x, y) {
    const Yv = Math.abs(y) / 1.3523;
    if (Yv > 1) return null;
    let lo = 0, hi = 18;
    while (hi - lo > 1e-6) {
      const mid = (lo + hi) / 2;
      if (lerpTab(RY, mid) < Yv) lo = mid; else hi = mid;
    }
    const t = (lo + hi) / 2;
    const p = t * 5 * D2R * Math.sign(y);
    const l = x / (0.8487 * lerpTab(RX, t));
    if (Math.abs(l) > Math.PI) return null;
    return [l, p];
  },
};

const flatCanvas = document.getElementById('flat-canvas');
const flatCtx = flatCanvas.getContext('2d');
let flatVisible = false;
const MOSZ = 3, MOS = 512 << MOSZ;
let mdata = null;                 // mercator-helmosaik (4096²)
let flatBase = null;              // senaste fullrenderade utsnittet (offscreen)
let flatBaseView = null;          // vyn {k,cx,cy,W,H} som flatBase gäller för
let flat = { xm: 1, ym: 1, W: 2, H: 2, k: 1, cx: 0, cy: 0 };
const FLAT_MAX = 16;
let borderFeats = [];           // {gid: 0 | badge-gid, lines}
let flatDirtyFlag = false;
let flatSeq = 0;                  // gör pågående asynkrona renderingar föråldrade
let flatTimer = null;
let patch = null;                 // högupplöst tile-utsnitt {z,tx0,ty0,W,H,data}

fetchJson('assets/art-borders.json?v=' + V)
  .then(gj => {
    borderFeats = gj.features.map(f => ({
      // badge-blobbar OCH dekordelar (Malaysias ansikte) bär sitt gid så
      // konturerna kan släckas medan landet är täckt
      gid: f.properties && (f.properties.badge || f.properties.dekor) ? f.properties.gid : 0,
      lines: f.geometry.coordinates,
    }));
    flatDirty();
  })
  .catch(() => {});

function flatDirty() {
  if (!flatVisible || flatDirtyFlag) return;
  flatDirtyFlag = true;
  requestAnimationFrame(() => { flatDirtyFlag = false; composeFlat(); });
}

async function loadMosaic() {
  if (mdata) return;
  const N = 1 << MOSZ, T = 512;
  const pm = pmSource();
  const mosaic = document.createElement('canvas');
  mosaic.width = MOS; mosaic.height = MOS;
  const mctx = mosaic.getContext('2d');
  const jobs = [];
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) {
      jobs.push(pm.getZxy(MOSZ, x, y).then(async t => {
        if (!t || !t.data) return;
        const img = await createImageBitmap(new Blob([t.data], { type: 'image/webp' }));
        mctx.drawImage(img, x * T, y * T);
      }).catch(() => {}));
    }
  }
  await Promise.all(jobs);
  mdata = mctx.getImageData(0, 0, MOS, MOS).data;
}

// ── vy-transformen: projektionskoordinater ↔ canvaspixlar ──
function flatScale() { return flat.W / (2 * flat.xm) * flat.k; }   // px per projenhet
function projToCanvas(x, y) {
  const s = flatScale();
  return [(x - flat.cx) * s + flat.W / 2, (flat.cy - y) * s + flat.H / 2];
}
function canvasToProj(px, py) {
  const s = flatScale();
  return [flat.cx + (px - flat.W / 2) / s, flat.cy - (py - flat.H / 2) / s];
}
function projPt(lng, lat) {
  const f = robinson.forward(lng * D2R, lat * D2R);
  return projToCanvas(f[0], f[1]);
}
function clampFlatView() {
  flat.k = Math.max(1, Math.min(FLAT_MAX, flat.k));
  const mx = flat.xm * (1 - 1 / flat.k), my = flat.ym * (1 - 1 / flat.k);
  flat.cx = Math.max(-mx, Math.min(mx, flat.cx));
  flat.cy = Math.max(-my, Math.min(my, flat.cy));
}

// Inzoomad vy samplar ett HÖGUPPLÖST tile-utsnitt (z4–z7) över det synliga
// området i stället för helmosaiken — annars blir väggkartan suddig när man
// zoomar. Utsnittet hämtas ur samma förladdade arkiv, max ~48 rutor.
async function ensurePatch(seq) {
  const zWant = MOSZ + Math.max(0, Math.floor(Math.log2(flat.k)));
  if (zWant <= MOSZ) { patch = null; return; }
  // synligt mercatorområde: sampla ett rutnät över canvasen
  let m0x = Infinity, m1x = -Infinity, m0y = Infinity, m1y = -Infinity, any = false;
  for (let iy = 0; iy <= 4; iy++) {
    for (let ix = 0; ix <= 4; ix++) {
      const pr = canvasToProj(flat.W * ix / 4, flat.H * iy / 4);
      const ll = robinson.inverse(pr[0], pr[1]);
      if (!ll) continue;
      any = true;
      const mx = ll[0] / (2 * Math.PI) + 0.5;
      const phi = Math.max(-MAXLAT, Math.min(MAXLAT, ll[1]));
      const my = 0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI);
      if (mx < m0x) m0x = mx; if (mx > m1x) m1x = mx;
      if (my < m0y) m0y = my; if (my > m1y) m1y = my;
    }
  }
  if (!any) { patch = null; return; }
  const marg = 0.03 / flat.k;
  for (let zs = Math.min(7, zWant); zs > MOSZ; zs--) {
    const n = 1 << zs;
    const tx0 = Math.max(0, Math.floor((m0x - marg) * n));
    const tx1 = Math.min(n - 1, Math.floor((m1x + marg) * n));
    const ty0 = Math.max(0, Math.floor((m0y - marg) * n));
    const ty1 = Math.min(n - 1, Math.floor((m1y + marg) * n));
    const txn = tx1 - tx0 + 1, tyn = ty1 - ty0 + 1;
    if (txn * tyn > 48) continue;                    // för stort — prova grövre z
    if (patch && patch.z === zs && patch.tx0 === tx0 && patch.ty0 === ty0 &&
        patch.W === txn * 512 && patch.H === tyn * 512) return;   // återanvänd
    const pm = pmSource();
    const c = document.createElement('canvas');
    c.width = txn * 512; c.height = tyn * 512;
    const cx2 = c.getContext('2d');
    const jobs = [];
    for (let tx = tx0; tx <= tx1; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        jobs.push(pm.getZxy(zs, tx, ty).then(async t => {
          if (!t || !t.data) return;
          const img = await createImageBitmap(new Blob([t.data], { type: 'image/webp' }));
          cx2.drawImage(img, (tx - tx0) * 512, (ty - ty0) * 512);
        }).catch(() => {}));
      }
    }
    await Promise.all(jobs);
    if (seq !== flatSeq) return;                     // vyn hann ändras
    patch = { z: zs, tx0, ty0, W: c.width, H: c.height,
              data: cx2.getImageData(0, 0, c.width, c.height).data };
    return;
  }
  patch = null;
}

// bas-varpen (dyr) renderas per vy; tillstånden komponeras ovanpå varje gång
async function renderFlatBase() {
  const seq = ++flatSeq;
  let xm = 0, ym = 0;
  for (let p = -90; p <= 90; p += 0.5) {
    const [x, y] = robinson.forward(Math.PI, p * D2R);
    xm = Math.max(xm, Math.abs(x)); ym = Math.max(ym, Math.abs(y));
  }
  const r = mapPanel.getBoundingClientRect();
  const availW = r.width - 16, availH = r.height - 16;
  let W = Math.min(1600, Math.max(320, availW));
  let H = Math.round(W * ym / xm);
  if (H > availH) { H = Math.max(200, availH); W = Math.round(H * xm / ym); }
  flat.xm = xm; flat.ym = ym; flat.W = W; flat.H = H;
  clampFlatView();
  await ensurePatch(seq);
  if (seq !== flatSeq) return;
  const base = document.createElement('canvas');
  base.width = W; base.height = H;
  const bctx = base.getContext('2d');
  const id = bctx.createImageData(W, H);
  const out = id.data;
  const p2 = patch, pScale = p2 ? 512 << p2.z : 0;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const pr = canvasToProj(px + 0.5, py + 0.5);
      const ll = robinson.inverse(pr[0], pr[1]);
      if (!ll) continue;
      const o = (py * W + px) * 4;
      const m01x = ll[0] / (2 * Math.PI) + 0.5;
      const phi = Math.max(-MAXLAT, Math.min(MAXLAT, ll[1]));
      const m01y = 0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI);
      // högupplösta utsnittet om pixeln täcks av det, annars helmosaiken
      let data = mdata, SW = MOS, SH = MOS;
      let mx = m01x * MOS - 0.5, my = m01y * MOS - 0.5;
      if (p2) {
        const hx = m01x * pScale - p2.tx0 * 512 - 0.5;
        const hy = m01y * pScale - p2.ty0 * 512 - 0.5;
        if (hx >= -0.5 && hy >= -0.5 && hx <= p2.W - 0.5 && hy <= p2.H - 0.5) {
          data = p2.data; SW = p2.W; SH = p2.H; mx = hx; my = hy;
        }
      }
      const fx = Math.floor(mx), fy = Math.floor(my);
      let r2 = 0, g2 = 0, b2 = 0, a2 = 0;
      for (let t = 0; t < 4; t++) {
        const tx2 = Math.min(SW - 1, Math.max(0, fx + (t & 1)));
        const ty2 = Math.min(SH - 1, Math.max(0, fy + (t >> 1)));
        const w = (t & 1 ? mx - fx : 1 - (mx - fx)) * (t >> 1 ? my - fy : 1 - (my - fy));
        const si = (ty2 * SW + tx2) * 4;
        const wa = w * data[si + 3] / 255;
        r2 += data[si] * wa; g2 += data[si + 1] * wa; b2 += data[si + 2] * wa;
        a2 += wa;
      }
      out[o] = r2 + 205 * (1 - a2);
      out[o + 1] = g2 + 228 * (1 - a2);
      out[o + 2] = b2 + 246 * (1 - a2);
      out[o + 3] = 255;
    }
  }
  bctx.putImageData(id, 0, 0);
  flatBase = base;
  flatBaseView = { k: flat.k, cx: flat.cx, cy: flat.cy, W, H };
}

function scheduleFlatRender() {
  clearTimeout(flatTimer);
  flatTimer = setTimeout(async () => {
    await renderFlatBase();
    composeFlat();
  }, 160);
}

function updateZoomLabel() {
  const el = document.getElementById('zoom-level');
  if (mapPanel.classList.contains('orig')) el.textContent = Math.round(origZoom * 100) + '%';
  else el.textContent = Math.round(flat.k * 100) + '%';
}

// zooma mot en canvaspunkt: punkten under pekaren står stilla
function flatZoomTo(newK, px, py) {
  const before = canvasToProj(px, py);
  flat.k = Math.max(1, Math.min(FLAT_MAX, newK));
  const after = canvasToProj(px, py);
  flat.cx += before[0] - after[0];
  flat.cy += before[1] - after[1];
  clampFlatView();
  updateZoomLabel();
  composeFlat();
  scheduleFlatRender();
}

function traceFeature(ctx, f) {
  ctx.beginPath();
  for (const poly of f.geometry.coordinates) {
    for (const ring of poly) {
      ring.forEach(([lng, lat], i) => {
        const [px, py] = projPt(lng, lat);
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      });
      ctx.closePath();
    }
  }
}

function composeFlat() {
  if (!flatBase || !regionsGj) return;
  flatCanvas.width = flat.W; flatCanvas.height = flat.H;
  flatCtx.fillStyle = '#0e2438';
  flatCtx.fillRect(0, 0, flat.W, flat.H);
  // rita basen transformerad från vyn den renderades för till den aktuella
  // vyn — under en pågående gest är det en billig förhandsvisning, efter
  // omrenderingen är transformen identitet och bilden knivskarp
  const s = flatScale();
  const sb = flatBaseView.W / (2 * flat.xm) * flatBaseView.k;
  const sc = s / sb;
  const ox = (flatBaseView.cx - flat.cx) * s + flat.W / 2 - sc * flatBaseView.W / 2;
  const oy = (flat.cy - flatBaseView.cy) * s + flat.H / 2 - sc * flatBaseView.H / 2;
  flatCtx.drawImage(flatBase, ox, oy, flatBaseView.W * sc, flatBaseView.H * sc);
  const SJO = 'rgb(205,228,246)';        // väggkartans havston
  for (const f of regionsGj.features) {
    const t = landState(f.id);
    // havs-badges och dekordelar (Malaysias ansikte) döljs i havsfärg när
    // landet är täckt eller kvittofärgat — de har ingen landform att visa
    const havBadge = (f.properties.badge === 1 && f.properties.hav === 1) ||
                     f.properties.dekor === 1;
    let color = null, alpha = 1;
    if (t.fel) { color = ROD; alpha = 0.92; }
    else if (t.tips) { color = GUL; alpha = 0.92; }
    else if (havBadge) { if (t.gron || t.tackt || t.svar) color = SJO; }
    else if (t.hover) {
      // opak uppljusning — bilden under täcket får inte skymta
      if (t.gron) color = LJUSGRON;
      else if (t.tackt) color = HOVERGUL;
      else { color = '#ffffff'; alpha = 0.25; }
    }
    else if (t.gron) color = GRON;
    else if (t.tackt) color = TACK;
    else if (t.svar) color = SVAR_FARG[Math.min(t.svar, 4)];
    if (!color) continue;
    flatCtx.globalAlpha = alpha;
    flatCtx.fillStyle = color;
    traceFeature(flatCtx, f);
    flatCtx.fill('evenodd');
    if (havBadge && !t.fel && !t.tips) {
      // svälj bildens antialiasing-frans strax utanför klickytan
      flatCtx.strokeStyle = color;
      flatCtx.lineWidth = 3;
      flatCtx.lineJoin = 'round';
      flatCtx.stroke();
    }
  }
  flatCtx.globalAlpha = 1;
  // badge-ländernas riktiga former: medan landet är täckt syns BARA
  // cirkeln — formen ritas först när landet avslöjats (grön i den gröna
  // omvärlden, papper med kontur efter avslöjande)
  for (const f of markersGj.features) {
    if (f.properties.form !== 1) continue;
    const t = landState(f.id);
    let color = null;
    const alpha = 1;
    if (t.gron) color = '#45b45e';
    else if (!t.tackt) color = t.svar ? SVAR_FARG[Math.min(t.svar, 4)] : TACK;
    if (!color) continue;
    flatCtx.globalAlpha = alpha;
    flatCtx.fillStyle = color;
    traceFeature(flatCtx, f);
    flatCtx.fill('evenodd');
    flatCtx.globalAlpha = 1;
    flatCtx.lineWidth = 1;
    flatCtx.strokeStyle = '#0a0a0a';
    flatCtx.stroke();
  }
  if (borderFeats.length) {
    flatCtx.strokeStyle = '#0a0a0a';
    flatCtx.lineWidth = 1.5;
    flatCtx.lineJoin = 'round';
    flatCtx.lineCap = 'round';
    flatCtx.beginPath();
    for (const bf of borderFeats) {
      if (bf.gid) {
        // badge-blobbens kontur ritas bara när bilden faktiskt syns
        const t = landState(bf.gid);
        if (t.tackt || t.gron || t.svar) continue;
      }
      for (const line of bf.lines) {
        let prev = null;
        for (const [lng, lat] of line) {
          const [px, py] = projPt(lng, lat);
          if (prev !== null && Math.abs(px - prev) > flat.W / 2) { flatCtx.moveTo(px, py); prev = px; continue; }
          if (prev === null) flatCtx.moveTo(px, py); else flatCtx.lineTo(px, py);
          prev = px;
        }
      }
    }
    flatCtx.stroke();
  }
  // klickbara cirklar på täckta småländer — absolut storlek på kartan
  // (zoomar med geografin), ritas EFTER gränslinjerna så inget syns igenom
  const pxPerDeg = flatScale() * 0.8487 * Math.PI / 180;
  for (const m of markerPts) {
    const t = landState(m.gid);
    if (!t.tackt || !prickSyns(m, pxPerDeg)) continue;
    const rr = prickRadiePx(pxPerDeg, m);
    const [mx, my] = projPt(m.lng, m.lat);
    if (mx < -rr - 20 || mx > flat.W + rr + 20 || my < -rr - 20 || my > flat.H + rr + 20) continue;
    flatCtx.beginPath();
    flatCtx.arc(mx, my, rr, 0, Math.PI * 2);
    flatCtx.fillStyle = t.fel ? ROD : (t.tips || t.hover) ? GUL : TACK;
    flatCtx.fill();
    flatCtx.lineWidth = m.spridd ? 2.5 : 1.5;
    flatCtx.strokeStyle = '#0a0a0a';
    flatCtx.stroke();
  }
}

function flatHit(ev) {
  const r = flatCanvas.getBoundingClientRect();
  const px = (ev.clientX - r.left) * flatCanvas.width / r.width;
  const py = (ev.clientY - r.top) * flatCanvas.height / r.height;
  const pr = canvasToProj(px, py);
  const ll = robinson.inverse(pr[0], pr[1]);
  if (!ll) return null;
  // prickarna testas FÖRST: de indikerar länder som är för små att träffa
  // på landmassan (Vatikanens prick ligger t.ex. ovanpå Italiens yta).
  // Närmsta pricken inom tryckytan vinner — inte den första i datan.
  const pxPerDeg = flatScale() * 0.8487 * Math.PI / 180;
  let prickGid = null, prickAvst = Infinity;
  for (const m of markerPts) {
    const t = landState(m.gid);
    if (!t.tackt || !prickSyns(m, pxPerDeg)) continue;
    const [mx, my] = projPt(m.lng, m.lat);
    const d = Math.hypot(mx - px, my - py);
    if (d <= prickRadiePx(pxPerDeg, m) + TRYCKMARGINAL + 4 && d < prickAvst) {
      prickGid = m.gid; prickAvst = d;
    }
  }
  if (prickGid !== null) return featureByGid.get(prickGid) || null;
  const lng = ll[0] / D2R, lat = ll[1] / D2R;
  // baklänges = samma företräde som globen: queryRenderedFeatures ger den
  // ÖVERST ritade featuren, och ritordningen är filordningen
  for (let fi = regionsGj.features.length - 1; fi >= 0; fi--) {
    const f = regionsGj.features[fi];
    let inside = false;
    for (const poly of f.geometry.coordinates) {
      for (const ring of poly) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
          if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
        }
      }
    }
    if (inside) return f;
  }
  return null;
}

// ── väggkartans gester: dra = panorera, hjul/nyp = zooma, stillaklick = spel ──
// Nypzoomen går HELT via pointer events (två aktiva pekare) i stället för
// touch events — en och samma kodväg i alla webbläsare, även iOS Safari.
const fPtrs = new Map();          // pointerId → {x, y}
let fDrag = null, fPinch = null;
let flatHoverGid = null, flatHoverRaf = false;
flatCanvas.addEventListener('pointerdown', ev => {
  if (ev.pointerType === 'mouse' && ev.button !== 0) return;
  ev.preventDefault();
  flatCanvas.setPointerCapture(ev.pointerId);
  fPtrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (fPtrs.size === 2) {
    const [a, b] = [...fPtrs.values()];
    fPinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k0: flat.k };
    fDrag = null;
    flatCanvas.classList.add('dragging');
  } else if (fPtrs.size === 1) {
    // riktiga fingrar darrar flera pixlar under ett tryck — med för snäv
    // tröskel tolkas trycket som en dragning och klicket sväljs
    fDrag = { id: ev.pointerId, sx: ev.clientX, sy: ev.clientY,
              cx0: flat.cx, cy0: flat.cy, moved: false,
              tol: ev.pointerType === 'touch' ? 12 : 4 };
  } else {
    fDrag = null;
  }
});
flatCanvas.addEventListener('pointermove', ev => {
  if ((currentMode === 'seterra' || currentMode === 'bildquiz') && seterraTarget && !seterraLocked) {
    cursorLabel.style.left = ev.clientX + 'px';
    cursorLabel.style.top = ev.clientY + 'px';
  }
  const p = fPtrs.get(ev.pointerId);
  if (p) { p.x = ev.clientX; p.y = ev.clientY; }
  if (fPinch && fPtrs.size >= 2) {
    const [a, b] = [...fPtrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > 0 && fPinch.d > 0) {
      const r = flatCanvas.getBoundingClientRect();
      flatZoomTo(fPinch.k0 * d / fPinch.d,
        ((a.x + b.x) / 2 - r.left) * flat.W / r.width,
        ((a.y + b.y) / 2 - r.top) * flat.H / r.height);
    }
    return;
  }
  if (fDrag && ev.pointerId === fDrag.id) {
    const dx = ev.clientX - fDrag.sx, dy = ev.clientY - fDrag.sy;
    if (Math.abs(dx) > fDrag.tol || Math.abs(dy) > fDrag.tol) {
      fDrag.moved = true;
      flatCanvas.classList.add('dragging');
    }
    if (fDrag.moved) {
      const r = flatCanvas.getBoundingClientRect();
      const s = flatScale() * (r.width / flat.W);   // skärm-px per projenhet
      flat.cx = fDrag.cx0 - dx / s;
      flat.cy = fDrag.cy0 + dy / s;
      clampFlatView();
      composeFlat();
      scheduleFlatRender();
    }
    return;
  }
  if (flatHoverRaf) return;
  flatHoverRaf = true;
  requestAnimationFrame(() => {
    flatHoverRaf = false;
    const f = flatHit(ev);
    const gid = f && aktivByGid.has(f.id) && !revealed.has(f.id) ? f.id : null;
    if (gid !== flatHoverGid) {
      if (flatHoverGid !== null) setLand(flatHoverGid, { hover: false });
      if (gid !== null && !landState(gid).fel) setLand(gid, { hover: true });
      flatHoverGid = gid;
    }
  });
});
function flatPointerEnd(ev) {
  fPtrs.delete(ev.pointerId);
  if (fPinch) {
    if (fPtrs.size < 2) {
      fPinch = null;
      if (!fPtrs.size) flatCanvas.classList.remove('dragging');
    }
    return;
  }
  if (!fDrag || ev.pointerId !== fDrag.id) return;
  const moved = fDrag.moved;
  fDrag = null;
  flatCanvas.classList.remove('dragging');
  if (moved || ev.type === 'pointercancel') return;
  const f = flatHit(ev);
  if (f) handleMapClick(f.id, ev);
}
flatCanvas.addEventListener('pointerup', flatPointerEnd);
flatCanvas.addEventListener('pointercancel', flatPointerEnd);
flatCanvas.addEventListener('wheel', ev => {
  ev.preventDefault();
  const r = flatCanvas.getBoundingClientRect();
  const px = (ev.clientX - r.left) * flat.W / r.width;
  const py = (ev.clientY - r.top) * flat.H / r.height;
  flatZoomTo(flat.k * (ev.deltaY > 0 ? 0.9 : 1.1), px, py);
}, { passive: false });

// ══════════════════════════════════
// Originalkartan — regionens handritade karta precis som originalsidan:
// map.webp + landbilderna på sina composition-koordinater, alfa-träffytor,
// gula hover-bilder klippta vid gränserna, specialformer och zoom/panorering.
// Drivs av samma speltillstånd som globen och väggkartan.
// ══════════════════════════════════
const origWrap = document.getElementById('orig-wrap');
const origWrapper = document.getElementById('orig-wrapper');
const origBase = document.getElementById('orig-base');
let origInit = false, origLoading = false;
let origSlug = null, origRaw = null;
let ORIG = { L: 0, T: 0, W: 1, H: 1 };
const origOverlayEls = {}, origHoverEls = {}, origMarkerEls = {};
const origHitData = {}, origShapes = {};
let origSorted = [];
let aktivByFile = new Map();      // filnamn → aktivt land (för klick/hover)
let origZoom = 1, origPanX = 0, origPanY = 0;
const ORIG_MIN = 0.5, ORIG_MAX = 5;

function origApplyTransform() {
  origWrapper.style.transform = `translate(${origPanX}px, ${origPanY}px) scale(${origZoom})`;
  updateZoomLabel();
}
function origClampPan() {
  const bw = origBase.offsetWidth, bh = origBase.offsetHeight;
  const pw = origWrap.clientWidth, ph = origWrap.clientHeight;
  const maxX = Math.max(0, (bw * origZoom - pw) / 2 + pw * 0.5);
  const maxY = Math.max(0, (bh * origZoom - ph) / 2 + ph * 0.5);
  origPanX = Math.max(-maxX, Math.min(maxX, origPanX));
  origPanY = Math.max(-maxY, Math.min(maxY, origPanY));
}
function origSetZoom(nz, cursorX, cursorY) {
  const oz = origZoom;
  origZoom = Math.max(ORIG_MIN, Math.min(ORIG_MAX, nz));
  if (origZoom === oz) return;
  if (cursorX !== undefined) {
    const r = origWrap.getBoundingClientRect();
    const px = cursorX - r.left - r.width / 2, py = cursorY - r.top - r.height / 2;
    origPanX = px - ((px - origPanX) / oz) * origZoom;
    origPanY = py - ((py - origPanY) / oz) * origZoom;
  }
  origClampPan();
  origApplyTransform();
}

async function initOrig() {
  const slug = origSlug, raw = origRaw;
  origBase.src = `assets/${slug}/map.webp`;
  await new Promise(res => {
    if (origBase.complete && origBase.naturalWidth > 0) res();
    else { origBase.onload = res; origBase.onerror = res; }
  });
  ORIG = { L: raw.mapOffset.left, T: raw.mapOffset.top, W: raw.mapWidth, H: raw.mapHeight };
  for (const [key, sh] of Object.entries(raw.specialShapes || {})) {
    origShapes[key] = { file: `assets/${slug}/${sh.file}`, left: sh.left, top: sh.top,
      width: sh.width, height: sh.height, hitOnly: !!sh.hitOnly, data: null, canvas: null };
  }
  const list = raw.countries.map(c => ({
    name: c.name,
    filename: c.filename || c.file.replace('countries/', '').replace('.webp', ''),
    left: c.left, top: c.top, width: c.width, height: c.height,
  }));
  origSorted = [...list].sort((a, b) => a.width * a.height - b.width * b.height);
  for (const c of list) {
    const img = document.createElement('img');
    img.className = 'country-overlay';
    img.src = `assets/${slug}/countries/${c.filename}.webp`;
    img.draggable = false;
    origWrapper.appendChild(img);
    origOverlayEls[c.filename] = img;
    const sh = origShapes[c.filename];
    if (sh && sh.hitOnly) {
      const marker = document.createElement('div');
      marker.className = 'hit-marker';
      origWrapper.appendChild(marker);
      origMarkerEls[c.filename] = marker;
    } else {
      const hover = document.createElement('img');
      hover.className = 'hover-highlight';
      hover.draggable = false;
      origWrapper.appendChild(hover);
      origHoverEls[c.filename] = hover;
    }
  }
  // konturöverlägg överst, om regionen har ett
  const ov = document.createElement('img');
  ov.className = 'map-overlay';
  ov.id = 'orig-overlay';
  ov.draggable = false;
  ov.style.display = 'none';
  ov.onload = () => { ov.style.display = ''; origPosition(); };
  ov.onerror = () => ov.remove();
  ov.src = `assets/${slug}/overlay.webp`;
  origWrapper.appendChild(ov);

  // träffdata: alfakanalen i varje landbild (och specialform). Stora länder
  // samplas i HALV upplösning — träffsäkerheten påverkas inte märkbart, men
  // fullupplösta ImageData-buffertar för alla länder samtidigt kan spränga
  // mobilens canvas-minne. Små länder behåller full precision.
  const loadImg = src => new Promise(res => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });
  const hitScale = (w, h) => (w * h > 1000000 ? 2 : 1);
  await Promise.all([
    ...list.map(async c => {
      const i = await loadImg(`assets/${slug}/countries/${c.filename}.webp`);
      if (!i) return;
      const s = hitScale(c.width, c.height);
      const w = Math.max(1, Math.round(c.width / s)), h = Math.max(1, Math.round(c.height / s));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const cx2 = cv.getContext('2d');
      cx2.drawImage(i, 0, 0, w, h);
      origHitData[c.filename] = { data: cx2.getImageData(0, 0, w, h).data, w, h, s, canvas: cv };
    }),
    ...Object.values(origShapes).map(async sh => {
      const i = await loadImg(sh.file);
      if (!i) return;
      const s = hitScale(sh.width, sh.height);
      const w = Math.max(1, Math.round(sh.width / s)), h = Math.max(1, Math.round(sh.height / s));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const cx2 = cv.getContext('2d');
      cx2.drawImage(i, 0, 0, w, h);
      sh.data = cx2.getImageData(0, 0, w, h).data;
      sh.w = w; sh.h = h; sh.s = s;
      sh.canvas = cv;
    }),
  ]);
  origHoverImages(list);
  origPosition();
  for (const [gid, t] of tillstand) origApplyState(gid, t);
  origInit = true;
}

// gula hover-bilder: landbilden tonad gul, klippt vid baskartans konturer.
// Gränsmasken byggs i HALV upplösning (en fjärdedels minne — mobilen) och
// hover-bilderna genereras i träffdatans skala; CSS sträcker upp dem.
function origHoverImages(list) {
  const HR = 255, HG = 220, HB = 50, TH = 150;
  const MW = Math.max(1, ORIG.W >> 1), MH = Math.max(1, ORIG.H >> 1);
  const mc = document.createElement('canvas');
  mc.width = MW; mc.height = MH;
  const mctx = mc.getContext('2d');
  mctx.drawImage(origBase, 0, 0, MW, MH);
  const md = mctx.getImageData(0, 0, MW, MH).data;
  const raw = new Uint8Array(MW * MH);
  for (let i = 0; i < MW * MH; i++) {
    const mi = i * 4;
    const b = (md[mi] + md[mi + 1] + md[mi + 2]) / 3;
    if (b < TH || md[mi + 3] < 128) raw[i] = 1;
  }
  const border = new Uint8Array(raw);
  for (let y = 0; y < MH; y++) {
    for (let x = 0; x < MW; x++) {
      const i = y * MW + x;
      if (border[i]) continue;
      if ((x > 0 && raw[i - 1]) || (x < MW - 1 && raw[i + 1]) ||
          (y > 0 && raw[i - MW]) || (y < MH - 1 && raw[i + MW])) border[i] = 1;
    }
  }
  for (const c of list) {
    const sh = origShapes[c.filename];
    if (sh && sh.hitOnly) continue;
    let hd, L, T, FW, FH;
    if (sh && sh.canvas) { hd = sh; L = sh.left; T = sh.top; FW = sh.width; FH = sh.height; }
    else {
      hd = origHitData[c.filename];
      if (!hd || !hd.canvas) continue;
      L = c.left; T = c.top; FW = c.width; FH = c.height;
    }
    const s = hd.s || 1, W2 = hd.w, H2 = hd.h;
    const cv = document.createElement('canvas');
    cv.width = W2; cv.height = H2;
    const cx2 = cv.getContext('2d');
    cx2.drawImage(hd.canvas, 0, 0);
    const pix = cx2.getImageData(0, 0, W2, H2);
    const d = pix.data;
    const sx = L - ORIG.L, sy = T - ORIG.T;
    for (let y = 0; y < H2; y++) {
      for (let x = 0; x < W2; x++) {
        const mx = (sx + x * s) >> 1, my = (sy + y * s) >> 1;
        const ci = (y * W2 + x) * 4;
        if (mx < 0 || mx >= MW || my < 0 || my >= MH || border[my * MW + mx]) {
          d[ci + 3] = 0;
        } else if (d[ci + 3] > 0) {
          d[ci] = HR; d[ci + 1] = HG; d[ci + 2] = HB;
        }
      }
    }
    cx2.putImageData(pix, 0, 0);
    const el = origHoverEls[c.filename];
    if (el) { el.src = cv.toDataURL(); el._rect = { L, T, W: FW, H: FH }; }
  }
}

function origPosition() {
  if (!origBase.naturalWidth) return;
  const mapRect = origBase.getBoundingClientRect();
  // vyn dold (resize medan glob/väggkarta visas) → rektanglarna är noll och
  // skulle ge skräppositioner som ligger kvar när vyn visas igen
  if (!mapRect.width) return;
  const wrapRect = origWrapper.getBoundingClientRect();
  // rektanglarna är lästa GENOM wrapper-transformen — dela bort zoomen,
  // stilarna sätts i wrapperns otransformerade koordinater
  const scale = mapRect.width / origZoom / ORIG.W;
  const offX = (mapRect.left - wrapRect.left) / origZoom;
  const offY = (mapRect.top - wrapRect.top) / origZoom;
  const place = (el, l, t, w, h) => {
    el.style.left = (offX + (l - ORIG.L) * scale) + 'px';
    el.style.top = (offY + (t - ORIG.T) * scale) + 'px';
    el.style.width = (w * scale) + 'px';
    el.style.height = (h * scale) + 'px';
  };
  for (const c of origSorted) {
    const el = origOverlayEls[c.filename];
    if (el) place(el, c.left, c.top, c.width, c.height);
    const hv = origHoverEls[c.filename];
    if (hv && hv._rect) place(hv, hv._rect.L, hv._rect.T, hv._rect.W, hv._rect.H);
    else if (hv) place(hv, c.left, c.top, c.width, c.height);
    const mk = origMarkerEls[c.filename];
    if (mk) {
      const sh = origShapes[c.filename];
      mk.style.left = (offX + (sh.left + sh.width / 2 - ORIG.L) * scale) + 'px';
      mk.style.top = (offY + (sh.top + sh.height / 2 - ORIG.T) * scale) + 'px';
    }
  }
  const ov = document.getElementById('orig-overlay');
  if (ov) {
    ov.style.left = offX + 'px';
    ov.style.top = offY + 'px';
    ov.style.width = (mapRect.width / origZoom) + 'px';
    ov.style.height = (mapRect.height / origZoom) + 'px';
  }
}

function origHitTest(clientX, clientY) {
  const mapRect = origBase.getBoundingClientRect();
  if (!mapRect.width) return null;
  const sc = ORIG.W / mapRect.width;          // skärm-px → kartpixlar (zoom ingår)
  const mapX = (clientX - mapRect.left) * sc + ORIG.L;
  const mapY = (clientY - mapRect.top) * sc + ORIG.T;
  for (const c of origSorted) {
    const sh = origShapes[c.filename];
    if (sh) {
      if (!sh.data) continue;
      const lx = Math.floor((mapX - sh.left) / sh.s), ly = Math.floor((mapY - sh.top) / sh.s);
      if (lx < 0 || ly < 0 || lx >= sh.w || ly >= sh.h) continue;
      if (sh.data[(ly * sh.w + lx) * 4 + 3] > 30) return c;
    } else {
      const hd = origHitData[c.filename];
      if (!hd) continue;
      const lx = Math.floor((mapX - c.left) / hd.s), ly = Math.floor((mapY - c.top) / hd.s);
      if (lx < 0 || ly < 0 || lx >= hd.w || ly >= hd.h) continue;
      if (hd.data[(ly * hd.w + lx) * 4 + 3] > 30) return c;
    }
  }
  return null;
}

// bildquizets kvitto i originalvyn: landbildens alfakanal fylls med
// kvittofärgen — exakt samma form, men som enfärgad siluett
const svarSilhuettCache = new Map();
function origSvarSilhuett(filename, svar) {
  const nyckel = `${filename}:${svar}`;
  if (svarSilhuettCache.has(nyckel)) return svarSilhuettCache.get(nyckel);
  const hd = origHitData[filename];
  if (!hd || !hd.canvas) return null;      // träffdatan laddar ännu — appliceras om efteråt
  const cv = document.createElement('canvas');
  cv.width = hd.w; cv.height = hd.h;
  const cx = cv.getContext('2d');
  cx.drawImage(hd.canvas, 0, 0);
  cx.globalCompositeOperation = 'source-in';
  cx.fillStyle = SVAR_FARG[svar];
  cx.fillRect(0, 0, hd.w, hd.h);
  const url = cv.toDataURL();
  svarSilhuettCache.set(nyckel, url);
  return url;
}
// spegla speltillståndet till originalvyns element
function origApplyState(gid, t) {
  const a = aktivByGid.get(gid);
  if (!a) return;
  const el = origOverlayEls[a.filename];
  if (!el) return;
  if (t.fel) el.classList.add('visible', 'flash-wrong');
  else {
    el.classList.remove('flash-wrong');
    el.classList.toggle('visible', !t.tackt);
  }
  if (!t.tackt && t.svar) {
    const nivaa = Math.min(t.svar, 4);
    const silu = origSvarSilhuett(a.filename, nivaa);
    if (silu && el.dataset.svar !== String(nivaa)) {
      el.src = silu;
      el.dataset.svar = String(nivaa);
    }
  } else if (el.dataset.svar) {
    el.src = `assets/${origSlug}/countries/${a.filename}.webp`;
    delete el.dataset.svar;
  }
  const glow = !t.fel && !!t.tackt && (!!t.hover || !!t.tips);
  const hv = origHoverEls[a.filename];
  if (hv) hv.classList.toggle('active', glow);
  const mk = origMarkerEls[a.filename];
  if (mk) mk.classList.toggle('active', glow);
}

// gester: dra = panorera, hjul/nyp = zooma, stillaklick = spel — nypzoomen
// via pointer events (två aktiva pekare), samma kodväg även på iOS Safari
const oPtrs = new Map();          // pointerId → {x, y}
let oDrag = null, oPinch = null, origHoverFile = null, origHoverRaf = false;
origWrap.addEventListener('pointerdown', ev => {
  if (ev.pointerType === 'mouse' && ev.button !== 0) return;
  if (ev.target.closest('.zoom-controls') || ev.target.closest('.view-toggle') ||
      ev.target.closest('.explore-toggle-buttons')) return;
  ev.preventDefault();
  origWrap.setPointerCapture(ev.pointerId);
  oPtrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (oPtrs.size === 2) {
    const [a, b] = [...oPtrs.values()];
    oPinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z0: origZoom };
    oDrag = null;
    origWrapper.classList.add('dragging');
  } else if (oPtrs.size === 1) {
    oDrag = { id: ev.pointerId, sx: ev.clientX, sy: ev.clientY,
              px0: origPanX, py0: origPanY, moved: false,
              tol: ev.pointerType === 'touch' ? 12 : 4 };
    origWrapper.classList.add('dragging');
  } else {
    oDrag = null;
  }
});
origWrap.addEventListener('pointermove', ev => {
  if ((currentMode === 'seterra' || currentMode === 'bildquiz') && seterraTarget && !seterraLocked) {
    cursorLabel.style.left = ev.clientX + 'px';
    cursorLabel.style.top = ev.clientY + 'px';
  }
  const p = oPtrs.get(ev.pointerId);
  if (p) { p.x = ev.clientX; p.y = ev.clientY; }
  if (oPinch && oPtrs.size >= 2) {
    const [a, b] = [...oPtrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > 0 && oPinch.d > 0) {
      origSetZoom(oPinch.z0 * d / oPinch.d, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
    return;
  }
  if (oDrag && ev.pointerId === oDrag.id) {
    const dx = ev.clientX - oDrag.sx, dy = ev.clientY - oDrag.sy;
    if (Math.abs(dx) > oDrag.tol || Math.abs(dy) > oDrag.tol) oDrag.moved = true;
    if (oDrag.moved) {
      origPanX = oDrag.px0 + dx;
      origPanY = oDrag.py0 + dy;
      origClampPan();
      origApplyTransform();
    }
    return;
  }
  if (origHoverRaf) return;
  origHoverRaf = true;
  requestAnimationFrame(() => {
    origHoverRaf = false;
    const hit = origHitTest(ev.clientX, ev.clientY);
    const a = hit ? aktivByFile.get(hit.filename) : null;
    const file = a && !revealed.has(a.gid) ? hit.filename : null;
    if (file !== origHoverFile) {
      if (origHoverFile) {
        const prev = aktivByFile.get(origHoverFile);
        if (prev) setLand(prev.gid, { hover: false });
      }
      if (file && !landState(a.gid).fel) setLand(a.gid, { hover: true });
      origHoverFile = file;
    }
    origWrap.style.cursor = hit && a ? 'pointer' : '';
  });
});
function origPointerEnd(ev) {
  oPtrs.delete(ev.pointerId);
  if (oPinch) {
    if (oPtrs.size < 2) {
      oPinch = null;
      if (!oPtrs.size) origWrapper.classList.remove('dragging');
    }
    return;
  }
  if (!oPtrs.size) origWrapper.classList.remove('dragging');
  if (!oDrag || ev.pointerId !== oDrag.id) return;
  const moved = oDrag.moved;
  oDrag = null;
  if (moved || ev.type === 'pointercancel') return;
  const hit = origHitTest(ev.clientX, ev.clientY);
  const a = hit ? aktivByFile.get(hit.filename) : null;
  if (a) handleMapClick(a.gid, ev);
}
origWrap.addEventListener('pointerup', origPointerEnd);
origWrap.addEventListener('pointercancel', origPointerEnd);
origWrap.addEventListener('wheel', ev => {
  ev.preventDefault();
  origSetZoom(origZoom * (ev.deltaY > 0 ? 0.9 : 1.1), ev.clientX, ev.clientY);
}, { passive: false });

// ══════════════════════════════════
// Vyväxling: glob / väggkarta / original
// ══════════════════════════════════
let aktivVy = 'glob';
async function setView(vy) {
  if (vy === 'orig' && !origSlug) vy = 'glob';   // världstestet saknar originalkarta
  aktivVy = vy;
  document.getElementById('view-glob').classList.toggle('active', vy === 'glob');
  document.getElementById('view-platt').classList.toggle('active', vy === 'platt');
  document.getElementById('view-orig').classList.toggle('active', vy === 'orig');
  mapPanel.classList.toggle('platt', vy === 'platt');
  mapPanel.classList.toggle('orig', vy === 'orig');
  flatVisible = vy === 'platt';
  const load = document.getElementById('spel-load');
  if (vy === 'platt') {
    if (!mdata) {
      load.style.display = '';
      document.getElementById('spel-load-txt').textContent = 'Bygger väggkartan …';
      await loadMosaic();
      await renderFlatBase();
      load.style.display = 'none';
    } else if (!flatBase) {
      await renderFlatBase();
    }
    composeFlat();
  } else if (vy === 'orig' && origInit) {
    // layouten kan ha ändrats medan vyn var dold (fönsterstorlek, rotation)
    // — positionera alltid om bitarna när vyn blir synlig
    requestAnimationFrame(() => { origPosition(); origClampPan(); origApplyTransform(); });
  } else if (vy === 'orig' && !origInit && !origLoading) {
    origLoading = true;
    load.style.display = '';
    document.getElementById('spel-load-txt').textContent = 'Laddar originalkartan …';
    try {
      await initOrig();
    } catch (e) {
      // visa åtminstone baskartan i stället för att fastna på spinnern
      console.warn('originalkartan kunde inte laddas helt', e);
    } finally {
      load.style.display = 'none';
      origLoading = false;
    }
  }
  updateZoomLabel();
}
document.getElementById('view-glob').addEventListener('click', () => setView('glob'));
document.getElementById('view-platt').addEventListener('click', () => setView('platt'));
document.getElementById('view-orig').addEventListener('click', () => setView('orig'));
document.getElementById('zoom-in').addEventListener('click', () => {
  if (aktivVy === 'orig') origSetZoom(origZoom * 1.3);
  else if (aktivVy === 'platt') flatZoomTo(flat.k * 1.3, flat.W / 2, flat.H / 2);
});
document.getElementById('zoom-out').addEventListener('click', () => {
  if (aktivVy === 'orig') origSetZoom(origZoom / 1.3);
  else if (aktivVy === 'platt') flatZoomTo(flat.k / 1.3, flat.W / 2, flat.H / 2);
});
window.addEventListener('resize', () => {
  if (flatVisible && mdata) renderFlatBase().then(composeFlat);
  if (origInit) { origPosition(); origClampPan(); origApplyTransform(); }
});

// ══════════════════════════════════
// Spelstart för region / världstest
// ══════════════════════════════════
// De stora världsdelarna går att träna i bitar (config.json: delar).
// aktivDel är delens id, eller null för hela världsdelen.
let aktivDel = null;
function delarFor(raw) { return (raw && raw.delar) || []; }
function delMed(raw, id) { return delarFor(raw).find(d => d.id === id) || null; }

async function startRegion(slug, flyg, delId) {
  const raw = await loadRegionConfig(slug);
  const del = delMed(raw, delId);
  aktivDel = del ? del.id : null;
  COUNTRIES = buildCountries(slug, raw);
  if (del) {
    const vill = new Set(del.lander);
    COUNTRIES = COUNTRIES.filter(c => vill.has(c.name));
  }
  aktivByGid = new Map(COUNTRIES.map(c => [c.gid, c]));
  aktivByFile = new Map(COUNTRIES.map(c => [c.filename, c]));
  IMAGE_ASSOCIATIONS = Object.fromEntries(COUNTRIES.filter(c => c.assoc).map(c => [c.filename, c.assoc]));
  // varje del har EGEN rekordlista — annars tävlar 13 länder mot 49
  HS_BAS = 'glob-' + (raw.hsKey || slug + '-highscores') + (del ? '-' + del.id : '');
  uppdateraHsKey();
  ASSET_BASE = 'assets/' + slug;
  isWorldTest = false;
  aktivSlug = slug;
  aktivRegionNamn = del ? del.namn : raw.name;
  origSlug = slug;                 // originalvyn = regionens handritade karta
  origRaw = raw;
  document.getElementById('view-orig').style.display = '';

  document.title = `${aktivRegionNamn} – Jonas geografi`;
  document.querySelector('header h1').textContent = aktivRegionNamn + ' 🌍';
  visaSpelVideo(slug);   // världsdelens film nås via play-knappen i headern
  // tränar man en del hoppar filmen till just den delens avsnitt
  const vk = document.getElementById('spel-video');
  vk.dataset.videostart = del && del.videoStart ? del.videoStart : '';
  vk.dataset.videodel = del && del.videoDel != null ? del.videoDel : '';
  document.getElementById('spel-delar').style.display = delarFor(raw).length ? '' : 'none';
  document.querySelectorAll('[data-total]').forEach(el => el.textContent = COUNTRIES.length);
  seterraProgressLabel.textContent = `0 / ${COUNTRIES.length}`;
  // hann någon välja quiz medan regionen laddade? starta det nu på riktigt
  if (seterraVantarPaData && currentMode !== 'explore') startSeterra();

  // resten av världen grön, regionens länder täckta
  for (const f of regionsGj.features) {
    if (aktivByGid.has(f.id)) setLand(f.id, { gron: false, tackt: true });
    else setLand(f.id, { gron: true, tackt: false });
  }
  spelPadding();
  const kam = KAMERA[slug] || KAMERA.world;
  // en del av världsdelen får en egen kamera: ramen läggs runt just de
  // länder som ingår, annars hamnar halva delen utanför bilden
  const ram = del ? delRam() : null;
  if (ram) map.fitBounds(ram, { padding: 60, duration: flyg ? 2400 : 0, essential: true });
  else if (flyg) map.flyTo({ center: kam.center, zoom: kam.zoom, duration: 2400, essential: true });
  else map.jumpTo({ center: kam.center, zoom: kam.zoom });
  preloadCountryImages();
}

// omslutande ram kring den aktiva delens länder (markörpunkterna räcker —
// de ligger mitt i respektive land)
function delRam() {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90, n = 0;
  for (const c of COUNTRIES) {
    const m = markerPts.find(p => p.gid === c.gid);
    if (!m) continue;
    n++;
    x0 = Math.min(x0, m.lng); x1 = Math.max(x1, m.lng);
    y0 = Math.min(y0, m.lat); y1 = Math.max(y1, m.lat);
  }
  if (n < 2) return null;
  const mx = Math.max((x1 - x0) * 0.12, 1.5), my = Math.max((y1 - y0) * 0.12, 1.5);
  return [[x0 - mx, y0 - my], [x1 + mx, y1 + my]];
}

// kartan täcker numera hela fönstret även i spelläge — paddningen ser till
// att regionen centreras i den fria ytan vänster om den svävande panelen
function spelPadding() {
  map.setPadding(window.innerWidth > 900
    ? { top: 60, right: 400, bottom: 10, left: 10 }
    : { top: 56, right: 0, bottom: 0, left: 0 });
}

async function startWorld(count, fastaGids) {
  // proportionellt urval över regionerna (största rest-metoden).
  // Länder som ligger i flera regioner (Turkiet i Europa+Asien, Papua Nya
  // Guinea i Asien+Oceanien) räknas bara EN gång — annars kan samma land
  // dras två gånger och andra frågan går inte att besvara.
  // fastaGids: en utmaning spelas med exakt samma länder som utmanaren fick.
  const entries = [];
  const sedda = new Set();
  for (const slug of WORLD_SLUGS) {
    const raw = await loadRegionConfig(slug);
    const unika = buildCountries(slug, raw)
      .filter(c => !sedda.has(c.gid) && (sedda.add(c.gid), true));
    entries.push({ slug, raw, countries: shuffle(unika) });
  }
  const totalCountries = entries.reduce((s, e) => s + e.countries.length, 0);
  COUNTRIES = [];
  if (fastaGids && fastaGids.length) {
    const vill = new Set(fastaGids);
    for (const e of entries) COUNTRIES.push(...e.countries.filter(c => vill.has(c.gid)));
    // känns inga av länderna igen (trasig länk) → vanligt slumpurval i stället
    if (COUNTRIES.length) count = COUNTRIES.length;
  }
  const helaPotten = count >= totalCountries;   // "Alla!"-knappen skickar ett tak-värde
  if (count > totalCountries) count = totalCountries;
  if (!COUNTRIES.length) {
    const alloc = entries.map(e => {
      const exact = (e.countries.length / totalCountries) * count;
      return { e, exact, n: Math.floor(exact) };
    });
    let allocated = alloc.reduce((s, a) => s + a.n, 0);
    alloc.map((a, i) => ({ i, rem: a.exact - a.n }))
      .sort((a, b) => b.rem - a.rem)
      .forEach(r => { if (allocated < count) { alloc[r.i].n++; allocated++; } });
    for (const a of alloc) COUNTRIES.push(...a.e.countries.slice(0, a.n));
  }
  aktivByGid = new Map(COUNTRIES.map(c => [c.gid, c]));
  aktivByFile = new Map(COUNTRIES.map(c => [c.filename, c]));
  IMAGE_ASSOCIATIONS = Object.fromEntries(COUNTRIES.filter(c => c.assoc).map(c => [c.filename, c.assoc]));
  aktivSlug = 'world';
  aktivRegionNamn = helaPotten
    ? `hela världen (alla ${count} länder)` : `hela världen (${count} länder)`;
  // egen rekordlista per antal — 10/20/30/50/100 länder tävlar var för sig,
  // och "Alla!" har sin egen lista för de riktiga världsmästarna
  HS_BAS = 'glob-world-highscores-' + (helaPotten ? 'alla' : count);
  uppdateraHsKey();
  isWorldTest = true;
  origSlug = null;                 // världstestet har ingen originalkarta
  document.getElementById('view-orig').style.display = 'none';
  if (aktivVy === 'orig') setView('glob');

  document.title = 'Hela världen – Jonas geografi';
  document.querySelector('header h1').textContent = 'Hela världen 🌍';
  visaSpelVideo(null);   // världstestet har ingen egen film
  document.querySelectorAll('[data-total]').forEach(el => el.textContent = COUNTRIES.length);

  // ALLA länder täckta — hela världen är spelplan
  for (const f of regionsGj.features) {
    setLand(f.id, { gron: !aktivByGid.has(f.id), tackt: aktivByGid.has(f.id) });
  }
  map.jumpTo({ center: KAMERA.world.center, zoom: KAMERA.world.zoom });
  switchMode('seterra', true);
  startSeterra();
  preloadCountryImages();
}

// ══════════════════════
// Utforska-läget
// ══════════════════════
function countryImgSrc(c) {
  return `assets/${c.slug}/countries/${c.filename}.webp`;
}
// Förladda de spelbara ländernas bilder så infokortet och quiz-feedbacken
// visar landbilden DIREKT i stället för efter en nedladdningssekund.
let bildCache = [];
function preloadCountryImages() {
  bildCache = COUNTRIES.map(c => {
    const i = new Image();
    i.decoding = 'async';
    i.src = countryImgSrc(c);
    return i;
  });
}
// beskrivningen ligger hopfälld bakom en knapp — och den som fällt ut den
// vill läsa om NÄSTA land också, så valet följer med mellan länderna
const infoToggle = document.getElementById('info-toggle');
const infoExtra = document.getElementById('info-extra');
let infoUtfalld = false;
function visaInfoUtfalld() {
  infoExtra.style.display = infoUtfalld ? '' : 'none';
  infoToggle.classList.toggle('open', infoUtfalld);
  infoToggle.textContent = infoUtfalld ? 'Dölj info om landet' : 'Visa info om landet';
}
infoToggle.addEventListener('click', () => {
  infoUtfalld = infoExtra.style.display === 'none';
  visaInfoUtfalld();
});
function showInfoCard(c) {
  activeCountry = c.gid;
  infoName.textContent = (flagga(c.name) + ' ' + c.name).trim();
  infoShape.src = countryImgSrc(c);
  const infoAssoc = document.getElementById('info-assoc');
  infoAssoc.textContent = c.assoc || '';
  infoAssoc.style.display = c.assoc ? '' : 'none';   // minnesregeln syns alltid
  infoDesc.innerHTML = escHtml(c.desc);
  visaInfoUtfalld();
  infoDefault.style.display = 'none';
  infoCard.classList.add('active');
}
function exploreClick(c, e) {
  if (revealed.has(c.gid)) coverCountry(c.gid);
  else revealCountry(c.gid);
  spela('klick');
  showInfoCard(c);
  if (e) {
    clearTimeout(exploreTooltipTimer);
    // minnesregeln direkt vid pekaren — och längre tid när det finns
    // en regel att hinna läsa
    cursorLabel.innerHTML = `<div class="tt-namn">${flagga(c.name)} ${escHtml(c.name)}</div>` +
      (c.assoc ? `<div class="tt-assoc">${escHtml(c.assoc)}</div>` : '');
    cursorLabel.classList.add('explore-tooltip');
    cursorLabel.style.left = e.clientX + 'px';
    cursorLabel.style.top = e.clientY + 'px';
    cursorLabel.style.display = 'block';
    exploreTooltipTimer = setTimeout(hideExploreTooltip, c.assoc ? 4000 : 1400);
  }
  exploredCountEl.textContent = revealed.size;
}
function hideExploreTooltip() {
  clearTimeout(exploreTooltipTimer);
  cursorLabel.style.display = 'none';
  cursorLabel.classList.remove('explore-tooltip');
}
// pekaretiketterna följer pekaren på FÖNSTERNIVÅ: kartans egna mousemove
// tystnar medan man drar i globen, och då blev rutan stående där den var.
// Gäller både utforska-tooltipen och quizens "Hitta detta land"-etikett.
window.addEventListener('mousemove', ev => {
  if (cursorLabel.style.display !== 'block') return;
  const quizEtikett = (currentMode === 'seterra' || currentMode === 'bildquiz') &&
                      seterraTarget && !seterraLocked;
  if (cursorLabel.classList.contains('explore-tooltip') || quizEtikett) {
    cursorLabel.style.left = ev.clientX + 'px';
    cursorLabel.style.top = ev.clientY + 'px';
  }
});

// ══════════════════════
// Klassiskt quiz
// ══════════════════════
let seterraVantarPaData = false;   // quiz begärt innan regionen laddat klart
function startSeterra() {
  if (!COUNTRIES.length) {
    // regionen har inte laddat klart (t.ex. omladdning rakt in i spelet).
    // Utan spärren startade ett 0-landsquiz som gav 100 % på 0 sekunder —
    // vänta i stället: startRegion kör igång quizet när länderna finns.
    seterraVantarPaData = true;
    document.getElementById('seterra-target-name').textContent = 'Laddar …';
    return;
  }
  seterraVantarPaData = false;
  resetOverlays();
  // bildquizet: konsten synlig hela tiden — man tränar på att koppla
  // bild till land innan man kör klassiska quizet helt utan stöd
  if (bildlage) COUNTRIES.forEach(c => setLand(c.gid, { tackt: false }));
  seterraQueue = shuffle([...COUNTRIES]);
  seterraCorrect = 0; seterraWrong = 0; seterraSvit = 0;
  seterraTotal = COUNTRIES.length;
  seterraLocked = false; seterraTargetMisses = 0;
  seterraFeedback.className = 'seterra-feedback';
  seterraFeedback.innerHTML = '';
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
  const missedList = COUNTRIES.filter(c => seterraMissedCountries.has(c.gid));
  if (missedList.length === 0) return;
  resetOverlays();
  COUNTRIES.forEach(c => { if (!seterraMissedCountries.has(c.gid)) revealCountry(c.gid); });
  if (bildlage) COUNTRIES.forEach(c =>
    setLand(c.gid, { tackt: false, gron: !seterraMissedCountries.has(c.gid) }));
  seterraQueue = shuffle([...missedList]);
  seterraCorrect = 0; seterraWrong = 0; seterraSvit = 0;
  seterraTotal = missedList.length;
  seterraLocked = false; seterraTargetMisses = 0;
  seterraFeedback.className = 'seterra-feedback';
  seterraFeedback.innerHTML = '';
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
  if (seterraQueue.length === 0) { endSeterra(); return; }
  seterraTarget = seterraQueue.pop();
  seterraTargetMisses = 0;
  seterraTargetName.textContent = seterraTarget.name;
  cursorLabel.textContent = seterraTarget.name;
  // feedbacken (RÄTT! + landbilden) ligger kvar tills nästa svar —
  // originalspelet visade bilden på kollaget; här är panelen platsen
  setHint(seterraTarget.assoc || '');
}

function setHint(text) {
  currentHintText = text || '';
  seterraHintBox.style.display = 'none';
  seterraHintBox.textContent = '';
  seterraHintBtn.classList.remove('used');
  seterraHintBtn.style.display = currentHintText ? '' : 'none';
}
seterraHintBtn.addEventListener('click', () => {
  if (!currentHintText) return;
  seterraHintBox.textContent = currentHintText;
  seterraHintBox.style.display = '';
  seterraHintBtn.classList.add('used');
});

function seterraClick(c) {
  if (!seterraTarget || seterraLocked) return;
  if (revealed.has(c.gid)) return;

  if (c.gid === seterraTarget.gid) {
    seterraCorrect++;
    // kvitto på landet i bildquizet: mörkgrönt = rätt direkt, gult =
    // andra försöket, orange = tredje, rött = fler
    const svar = Math.min(seterraTargetMisses + 1, 4);
    seterraTargetMisses = 0;
    spela('ratt');
    if (bildlage) {
      revealed.add(c.gid);
      setLand(c.gid, { svar, fel: false, tips: false, hover: false });
    } else {
      revealCountry(c.gid);
    }
    seterraFeedback.className = 'seterra-feedback correct-fb';
    seterraFeedback.innerHTML = `<div class="fb-banner correct-banner">RÄTT!</div><div class="fb-title">${flagga(c.name)} ${escHtml(c.name)}</div><div class="fb-shape"><img src="${countryImgSrc(c)}" alt=""></div>${c.assoc ? `<div class="assoc-box">${escHtml(c.assoc)}</div>` : ''}<div class="fb-desc">${escHtml(c.desc)}</div>`;
    // konfetti bara vid var femte rätta svar i rad — lagom festligt
    seterraSvit++;
    if (seterraSvit % 5 === 0) burstConfetti();
    updateSeterraUI();
    nextSeterraTarget();
  } else {
    seterraWrong++;
    seterraSvit = 0;
    seterraTargetMisses++;
    spela('fel');
    seterraMissedCountries.add(seterraTarget.gid);
    flashWrong(c.gid);
    seterraFeedback.className = 'seterra-feedback wrong-fb';
    seterraFeedback.innerHTML = `<div class="fb-title">Det var ${flagga(c.name)} ${escHtml(c.name)}</div><div class="fb-shape"><img src="${countryImgSrc(c)}" alt=""></div>${c.assoc ? `<div class="assoc-box">${escHtml(c.assoc)}</div>` : ''}${c.desc ? `<div class="fb-desc">${escHtml(c.desc)}</div>` : ''}`;
    updateSeterraUI();
    if (seterraTargetMisses >= 3) blinkHint(seterraTarget.gid);
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
  const m = Math.floor(elapsed / 60), s = elapsed % 60;
  seterraTimeEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
}

function endSeterra() {
  if (!seterraTotal) return;   // ett quiz utan länder kan aldrig bli "klart"
  clearInterval(seterraTimerInterval);
  updateSeterraTimer();
  seterraTarget = null;
  cursorLabel.style.display = 'none';
  const totalClicks = seterraCorrect + seterraWrong;
  const score = totalClicks > 0 ? Math.round((seterraCorrect / totalClicks) * 100) : 100;
  seterraElapsed = Math.floor((Date.now() - seterraStartTime) / 1000);
  const m = Math.floor(seterraElapsed / 60), s = seterraElapsed % 60;
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
  // bildquizet klarat → putta vidare mot klassiska quizet utan stöd
  const vidareBtn = document.getElementById('seterra-vidare');
  if (vidareBtn) vidareBtn.style.display = bildlage ? '' : 'none';
  spela('fanfar');
  // personbästa (medalj) och världsresans stämpel — bara riktiga, hela
  // klassiska omgångar räknas (en DEL av en världsdel ger varken medalj
  // eller passtämpel: de gäller hela världsdelen)
  if (!bildlage && !seterraIsRetry && aktivSlug && !aktivDel) {
    const gammal = +localStorage.getItem('medalj-' + aktivSlug) || 0;
    if (score > gammal) localStorage.setItem('medalj-' + aktivSlug, score);
    if (score >= 80) {
      const resa = resaState();
      if (RESA_ORDNING[resa.steg] === aktivSlug) {
        resa.klara[aktivSlug] = score;
        resa.steg++;
        localStorage.setItem('varldsresa', JSON.stringify(resa));
        const nasta = RESA_ORDNING[resa.steg];
        document.getElementById('seterra-final-detail').innerHTML +=
          `<br><span class="resa-stampel">🧳 Stämpel i passet!` +
          (nasta ? ` Nästa stopp: <b>${RESA_NAMN[nasta]}</b>` : ' HELA JORDEN RUNT-RESAN ÄR KLAR! 🏆') + '</span>';
        // hela jorden runt: segerfilmen rullar direkt när den finns
        if (!nasta && SEGER_VIDEO) setTimeout(() => oppnaVideo(SEGER_VIDEO.split(',')), 1800);
      } else if (resa.klara[aktivSlug] != null && score > resa.klara[aktivSlug]) {
        // återbesök på ett redan klarat stopp: bättre resultat uppdaterar
        // stämpeln (steg härleds ur stämplarna, så resan flyttas inte)
        resa.klara[aktivSlug] = score;
        localStorage.setItem('varldsresa', JSON.stringify(resa));
        document.getElementById('seterra-final-detail').innerHTML +=
          `<br><span class="resa-stampel">🧳 Ny stämpel — bättre resultat på ${RESA_NAMN[aktivSlug]}!</span>`;
      }
    }
  }
  // 100 % i klassiska quizet (hela omgången) → diplom!
  const diplomBtn = document.getElementById('seterra-diplom');
  if (diplomBtn) diplomBtn.style.display =
    (!bildlage && !seterraIsRetry && score === 100) ? '' : 'none';
  document.getElementById('hs-form').style.display = 'none';
  document.getElementById('hs-saved-msg').style.display = 'none';
  visaUtmanaKnapp(score);
  // i en utmaning ersätter duellistan de vanliga topplistorna
  document.getElementById('topplista-knapp-klar').style.display = aktivUtmaning ? 'none' : '';
  document.getElementById('utm-vidare-btn').style.display = aktivUtmaning ? '' : 'none';
  if (aktivUtmaning && !seterraIsRetry && !bildlage) {
    sparaUtmaningsResultat(score);
  } else if (aktivUtmaning) {
    visaDuellLista(null);            // övnings-/bildrunda i utmaningen: bara duellen visas
  } else if (!seterraIsRetry && score === 100 && seterraWrong === 0) {
    showCelebration(m, s);
  } else if (!seterraIsRetry) {
    showNameModal(score, m, s);
  } else {
    renderHighscores();
  }
}

// ══════════════════════
// Topplistor (Firebase + lokalt) — samma som originalsidan
// ══════════════════════
// Ingen människa klarar ett land på under en sekund (läsa namnet, hitta
// landet, klicka) — allt under så många sekunder som listan har länder är
// bluff. Golvet gäller sparande, uppladdning OCH visning, så gamla
// fuskposter i databasen försvinner ur listorna direkt.
function rimligMinTid() {
  return Math.max(5, COUNTRIES.length || seterraTotal || 0);
}
// egna resultat under EGEN nyckel: gamla HS_KEY blandade ihop egna
// resultat med hela den nedladdade världslistan, så "Mina resultat"
// visade i praktiken den globala listan. Den gamla nyckeln lämnas orörd
// (går inte att skilja eget från nedladdat i efterhand) — mina-listan
// byggs upp på nytt av kommande rundor.
function getLocalHighscores() {
  try { return JSON.parse(localStorage.getItem('mina-' + HS_KEY)) || []; }
  catch { return []; }
}
// den sammanslagna världslistan cachas också under egen nyckel — när den
// låg i HS_KEY laddade synken upp ANDRAS (rensade) poster igen från
// varje spelares enhet, och skräpet återuppstod hur ofta det än städades
function getCachadeHighscores() {
  try { return JSON.parse(localStorage.getItem('cache-' + HS_KEY)) || []; }
  catch { return []; }
}
// golvet läggs FÖRE topp 30-kapningen — annars upptar dolda fuskposter
// platserna och äkta resultat trillar ur listan
function toppNTid(list, minTid) {
  const ok = list.filter(e => e.time >= minTid);
  ok.sort((a, b) => b.score - a.score || a.time - b.time);
  if (ok.length > 30) ok.length = 30;
  return ok;
}
async function getHighscores() {
  const minTid = rimligMinTid();
  const local = getLocalHighscores();
  // reservvyn (offline eller trasig läsning): egna resultat + senast
  // nedladdade listan
  const lokalVy = () => {
    const seen = new Set(local.map(e => e.date));
    const merged = [...local];
    for (const e of getCachadeHighscores()) if (!seen.has(e.date)) merged.push(e);
    return toppNTid(merged, minTid);
  };
  if (!firebaseDB) return lokalVy();
  try {
    const snap = await firebaseDB.ref('highscores/' + HS_KEY).once('value');
    const remote = [];
    snap.forEach(child => { remote.push(child.val()); });
    const remoteDates = new Set(remote.map(e => e.date));
    // synka aldrig upp omöjliga lokala poster (t.ex. gamla fuskresultat) —
    // reglerna avvisar dem och skulle då stoppa hela uppladdningen
    const localOnly = local.filter(e => !remoteDates.has(e.date) && e.time >= minTid);
    if (localOnly.length > 0) {
      const updates = {};
      for (const e of localOnly) {
        const newKey = firebaseDB.ref('highscores/' + HS_KEY).push().key;
        updates[newKey] = e;
      }
      await firebaseDB.ref('highscores/' + HS_KEY).update(updates);
      remote.push(...localOnly);
    }
    const seen = new Set(remote.map(e => e.date));
    const merged = [...remote];
    for (const e of local) if (!seen.has(e.date)) merged.push(e);
    const lista = toppNTid(merged, minTid);
    localStorage.setItem('cache-' + HS_KEY, JSON.stringify(lista));
    return lista;
  } catch (e) {
    console.warn('Firebase read failed, using local:', e);
    return lokalVy();
  }
}
async function saveHighscore(name, score, time, wrong) {
  // omöjliga resultat sparas aldrig: quiz utan länder eller orimligt snabbt
  // (databasreglerna avvisar dem också på serversidan)
  if (!seterraTotal || time < rimligMinTid()) return null;
  const entry = { name, score, time, wrong, date: Date.now() };
  // felsökningsläget (window.spel aktivt) sparar INGENTING — inte ens
  // lokalt, för allt i HS_KEY synkas förr eller senare upp till den
  // delade listan. Skriptade rundor via ?debug ska aldrig kunna smyga in.
  if (window.spel) return entry;
  const local = getLocalHighscores();
  local.push(entry);
  local.sort((a, b) => b.score - a.score || a.time - b.time);
  if (local.length > 30) local.length = 30;
  localStorage.setItem('mina-' + HS_KEY, JSON.stringify(local));
  if (firebaseDB) {
    try {
      await firebaseDB.ref('highscores/' + HS_KEY).push(entry);
      const snap = await firebaseDB.ref('highscores/' + HS_KEY).orderByChild('score').once('value');
      const all = [];
      snap.forEach(child => { all.push({ key: child.key, ...child.val() }); });
      all.sort((a, b) => b.score - a.score || a.time - b.time);
      // trimma till topp 30 och rensa samtidigt bort omöjliga tider som
      // ligger kvar sedan tidigare versioner
      const minTid = rimligMinTid();
      const removes = {};
      let kvar = 0;
      for (const e of all) {
        if (e.time < minTid || kvar >= 30) removes[e.key] = null;
        else kvar++;
      }
      if (Object.keys(removes).length > 0) {
        await firebaseDB.ref('highscores/' + HS_KEY).update(removes);
      }
    } catch (e) { console.warn('Firebase write failed:', e); }
  }
  return entry;
}
function hsTabellHtml(list, highlightEntry, rubrik) {
  let html = `<h3>${rubrik || 'Topp 30'}</h3><table class="hs-table"><thead><tr><th>#</th><th>Namn</th><th>Poäng</th><th>Tid</th></tr></thead><tbody>`;
  list.forEach((e, i) => {
    const m = Math.floor(e.time / 60), s = e.time % 60;
    const isCurrent = highlightEntry && e.date === highlightEntry.date && e.name === highlightEntry.name;
    html += `<tr class="${isCurrent ? 'hs-current' : ''}"><td>${i + 1}</td><td>${escHtml(e.name)}</td><td>${e.score}%</td><td>${m}:${s.toString().padStart(2, '0')}</td></tr>`;
  });
  return html + '</tbody></table>';
}

async function renderHighscores(highlightEntry) {
  const container = document.getElementById('highscore-list');
  container.innerHTML = '<div class="hs-empty">Laddar topplista...</div>';
  const list = await getHighscores();
  container.innerHTML = list.length === 0
    ? '<div class="hs-empty">Inga sparade resultat ännu.</div>'
    : hsTabellHtml(list, highlightEntry);
}

// ── Topplistemodalen: global och personlig lista, nåbar när som helst ──
const topplistaModal = document.getElementById('topplista-modal');
async function visaTopplista(flik) {
  document.getElementById('hs-flik-alla').classList.toggle('aktiv', flik === 'alla');
  document.getElementById('hs-flik-mina').classList.toggle('aktiv', flik === 'mina');
  document.getElementById('topplista-region').textContent =
    aktivRegionNamn + (bildlage ? ' — Bildquiz' : ' — Klassiskt Quiz');
  const inneh = document.getElementById('topplista-innehall');
  topplistaModal.style.display = 'flex';
  inneh.innerHTML = '<div class="hs-empty">Laddar topplista...</div>';
  const list = flik === 'alla' ? await getHighscores() : getLocalHighscores();
  inneh.innerHTML = list.length === 0
    ? `<div class="hs-empty">${flik === 'alla' ? 'Inga sparade resultat ännu.'
        : 'Inga resultat på den här enheten ännu — kör ett quiz!'}</div>`
    : hsTabellHtml(list, null, flik === 'alla' ? 'Topp 30 — alla spelare' : 'Dina resultat på den här enheten');
}
document.getElementById('topplista-knapp').addEventListener('click', () => visaTopplista('alla'));
document.getElementById('topplista-knapp-klar').addEventListener('click', () => visaTopplista('mina'));
document.getElementById('hs-flik-alla').addEventListener('click', () => visaTopplista('alla'));
document.getElementById('hs-flik-mina').addEventListener('click', () => visaTopplista('mina'));
document.getElementById('topplista-stang').addEventListener('click', () => {
  topplistaModal.style.display = 'none';
});
document.getElementById('topplista-kryss').addEventListener('click', () => {
  topplistaModal.style.display = 'none';
});
topplistaModal.addEventListener('click', e => {
  if (e.target === topplistaModal) topplistaModal.style.display = 'none';
});

// ── Namn-modal ──
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
function closeNameModal() { nameModalOverlay.classList.remove('active'); }

document.getElementById('hs-save').addEventListener('click', async () => {
  const knapp = document.getElementById('hs-save');
  const name = document.getElementById('hs-name').value.trim();
  if (!name || knapp.disabled) return;
  knapp.disabled = true;   // dubbelklick under sparandet gav dubbletter i listan
  const totalClicks = seterraCorrect + seterraWrong;
  const score = totalClicks > 0 ? Math.round((seterraCorrect / totalClicks) * 100) : 100;
  // namnet minns till nästa gång: diplomet och utmaningarna fyller i det
  localStorage.setItem(UTM_NAMN_KEY, name);
  const entry = await saveHighscore(name, score, seterraElapsed, seterraWrong);
  knapp.disabled = false;
  document.getElementById('hs-form').style.display = 'none';
  document.getElementById('hs-saved-msg').style.display = '';
  await renderHighscores(entry);
});
document.getElementById('hs-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('hs-save').click();
});

// ══════════════════════
// Diplom: 100 % i klassiska quizet → utskrivbart diplom
// ══════════════════════
document.getElementById('seterra-diplom')?.addEventListener('click', () => {
  // namnet man redan skrivit på topplistan fylls i automatiskt (går att
  // ändra i rutan — den är fortfarande contenteditable)
  const namnEl = document.getElementById('diplom-namn');
  const sparat = localStorage.getItem(UTM_NAMN_KEY);
  if (namnEl && sparat) namnEl.textContent = sparat;
  document.getElementById('diplom-region').textContent = aktivRegionNamn || 'världen';
  document.getElementById('diplom-detalj').textContent =
    `alla ${seterraTotal} länder · 100 % rätt · tid ${seterraTimeEl.textContent}`;
  document.getElementById('diplom-datum').textContent =
    new Date().toLocaleDateString('sv-SE', { year: 'numeric', month: 'long', day: 'numeric' });
  document.getElementById('diplom-modal').style.display = 'flex';
  spela('fanfar');
});
document.getElementById('diplom-stang')?.addEventListener('click', () => {
  document.getElementById('diplom-modal').style.display = 'none';
});
document.getElementById('diplom-skriv')?.addEventListener('click', () => window.print());

document.getElementById('seterra-restart').addEventListener('click', () => startSeterra());
document.getElementById('seterra-vidare').addEventListener('click', () => switchMode('seterra'));
document.getElementById('seterra-retry').addEventListener('click', startSeterraRetry);
document.getElementById('modal-save').addEventListener('click', async () => {
  const knapp = document.getElementById('modal-save');
  const name = modalNameInput.value.trim();
  if (!name) { modalNameInput.focus(); return; }
  if (knapp.disabled) return;
  knapp.disabled = true;   // dubbelklick under sparandet gav dubbletter i listan
  const totalClicks = seterraCorrect + seterraWrong;
  const score = totalClicks > 0 ? Math.round((seterraCorrect / totalClicks) * 100) : 100;
  // namnet minns till nästa gång: diplomet och utmaningarna fyller i det
  localStorage.setItem(UTM_NAMN_KEY, name);
  const entry = await saveHighscore(name, score, seterraElapsed, seterraWrong);
  knapp.disabled = false;
  closeNameModal();
  await renderHighscores(entry);
});
modalNameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('modal-save').click();
});
document.getElementById('modal-skip').addEventListener('click', () => {
  closeNameModal();
  renderHighscores();
});
nameModalOverlay.addEventListener('click', e => {
  if (e.target === nameModalOverlay) { closeNameModal(); renderHighscores(); }
});

// ══════════════════════
// Lägesväxling
// ══════════════════════
function switchMode(mode, force) {
  if (mode === currentMode && !force) return;
  currentMode = mode;
  bildlage = mode === 'bildquiz';
  uppdateraHsKey();
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
    // en kvardröjande utforska-tooltip (timern löper i upp till 4 s) skulle
    // annars gömma quizets markörtext mitt i rundan när timern slår till
    hideExploreTooltip();
    headerHint.textContent = bildlage ? 'Bilderna hjälper dig — klicka på rätt land!'
                                      : 'Klicka där du tror landet är!';
    startSeterra();
  }
}
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => switchMode(btn.dataset.mode));
});

// ✨: blinka länderna man INTE hittat än — önskemål från träningsläget
// när de sista gömda länderna är svåra att se på den ifyllda kartan
let blinkKvarTimer = null;
document.getElementById('blink-kvar-btn').addEventListener('click', () => {
  const kvar = COUNTRIES.filter(c => !revealed.has(c.gid)).map(c => c.gid);
  if (!kvar.length) return;
  clearInterval(blinkKvarTimer);
  let n = 0;
  blinkKvarTimer = setInterval(() => {
    for (const gid of kvar) if (!revealed.has(gid)) setLand(gid, { tips: n % 2 === 0 });
    if (++n >= 6) {
      clearInterval(blinkKvarTimer);
      blinkKvarTimer = null;
      for (const gid of kvar) setLand(gid, { tips: false });
    }
  }, 260);
});

document.getElementById('show-all-btn').addEventListener('click', () => {
  COUNTRIES.forEach(c => revealCountry(c.gid));
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

// ── Besöksräknare: en anonym pinne per sidladdning, bucketad per dag —
// syns i Firebase-konsolen under 'besok'. Inga kakor, ingen spårning.
// Lokala körningar och förhandskanaler räknas inte. ──
if (firebaseDB && !/^(127\.|localhost)/.test(location.hostname)
    && !location.hostname.includes('--pr')) {
  const dag = new Date().toISOString().slice(0, 10);
  firebaseDB.ref('besok/' + dag).transaction(c => (c || 0) + 1).catch(() => {});
  firebaseDB.ref('besok/totalt').transaction(c => (c || 0) + 1).catch(() => {});
}

// ── Jonas high-five ──
const jonasImg = document.getElementById('jonas-img');
const highfiveCountEl = document.getElementById('highfive-count');
// ?v: service workern cachar ljudfiler för evigt — nya klatschen (syntad
// handklapp i stället för den gamla plingen) måste få en ny URL
const highfiveAudio = new Audio('high_five.wav?v=' + V);
// 'highfives2': räknaren flyttade hit när gamla nyckeln autoklickades
// sönder — gamla klienter är strandade av databasreglerna
const highfiveRef = firebaseDB ? firebaseDB.ref('highfives2') : null;
const startHifiCountEl = document.getElementById('start-hifi-count');
const startHifiImg = document.getElementById('start-hifi-img');
function sattHighfives(n) {
  highfiveCountEl.textContent = n;
  if (startHifiCountEl) startHifiCountEl.textContent = n;
}
if (highfiveRef) {
  highfiveRef.on('value', snap => sattHighfives(snap.val() || 0));
} else {
  sattHighfives(localStorage.getItem('highfive-count') || '0');
}
let hifiRaknade = 0;   // stoppar autoklickare: max 10 räknas per besök
function geHighfive(img) {
  if (!ljudAv) {
    highfiveAudio.currentTime = 0;
    highfiveAudio.play();
  }
  img.src = 'Jonas_2.webp';
  setTimeout(() => { img.src = 'Jonas_1.webp'; }, 1000);
  if (hifiRaknade >= 10) return;   // festen fortsätter, men räknaren står still
  hifiRaknade++;
  if (highfiveRef) highfiveRef.transaction(cur => (cur || 0) + 1);
  else {
    const count = parseInt(localStorage.getItem('highfive-count') || '0', 10) + 1;
    localStorage.setItem('highfive-count', count);
    sattHighfives(count);
  }
}
jonasImg.addEventListener('click', () => geHighfive(jonasImg));
if (startHifiImg) document.getElementById('start-hifi').addEventListener('click', () => geHighfive(startHifiImg));

// ══════════════════════
// Konfetti + firande — samma som originalsidan
// ══════════════════════
function startConfetti(canvas) {
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const colors = ['#ff4444', '#ffdd00', '#44bb44', '#4488ff', '#ff44ff', '#ff8800', '#00ddff', '#ffd700'];
  const pieces = [];
  for (let i = 0; i < 200; i++) {
    pieces.push({
      x: Math.random() * canvas.width, y: Math.random() * -canvas.height,
      w: 6 + Math.random() * 8, h: 4 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      speed: 1.5 + Math.random() * 3, drift: (Math.random() - 0.5) * 1.5,
      rot: Math.random() * Math.PI * 2, rotSpeed: (Math.random() - 0.5) * 0.15,
    });
  }
  let running = true;
  (function draw() {
    if (!running) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of pieces) {
      p.y += p.speed; p.x += p.drift; p.rot += p.rotSpeed;
      if (p.y > canvas.height) { p.y = -10; p.x = Math.random() * canvas.width; }
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    requestAnimationFrame(draw);
  })();
  return () => { running = false; ctx.clearRect(0, 0, canvas.width, canvas.height); };
}

function burstConfetti() {
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-burst-canvas';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const W = window.innerWidth, H = window.innerHeight;
  canvas.width = W; canvas.height = H;
  const colors = ['#ff4444', '#ffdd00', '#44bb44', '#4488ff', '#ff44ff', '#ff8800', '#00ddff', '#ffd700'];
  const pieces = [];
  const cannons = [
    { x: 0, y: H, aMin: -1.35, aMax: -0.35 },
    { x: W, y: H, aMin: Math.PI + 0.35, aMax: Math.PI + 1.35 },
  ];
  for (const cannon of cannons) {
    for (let i = 0; i < 45; i++) {
      const angle = cannon.aMin + Math.random() * (cannon.aMax - cannon.aMin);
      const speed = 11 + Math.random() * 11;
      pieces.push({
        x: cannon.x, y: cannon.y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        w: 6 + Math.random() * 7, h: 4 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * Math.PI * 2, rotSpeed: (Math.random() - 0.5) * 0.3,
      });
    }
  }
  const gravity = 0.32, duration = 1300;
  const start = performance.now();
  (function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, W, H);
    const fade = Math.max(0, 1 - t / duration);
    for (const p of pieces) {
      p.vy += gravity; p.vx *= 0.99;
      p.x += p.vx; p.y += p.vy; p.rot += p.rotSpeed;
      ctx.save();
      ctx.globalAlpha = Math.min(1, fade * 1.6);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (t < duration) requestAnimationFrame(frame);
    else canvas.remove();
  })(start);
}

function showCelebration(m, s) {
  const overlay = document.getElementById('celebration-overlay');
  document.getElementById('celebration-detail').innerHTML =
    `${seterraCorrect} av ${seterraTotal} länder &bull; 0 fel &bull; ${m}:${s.toString().padStart(2, '0')}`;
  overlay.classList.add('active');
  const stopConfetti = startConfetti(document.getElementById('confetti-canvas'));
  const celebMusic = new Audio('CELEBRATION.mp3');
  celebMusic.loop = true; celebMusic.volume = 0.7;
  celebMusic.play().catch(() => {});
  const jonasEl = document.getElementById('celebration-jonas-img');
  let toggle = false;
  const jonasInterval = setInterval(() => {
    toggle = !toggle;
    jonasEl.src = toggle ? 'Jonas_2.webp' : 'Jonas_1.webp';
  }, 300);
  const celebAudio = new Audio('high_five.wav?v=' + V);
  celebAudio.play().catch(() => {});
  const soundInterval = setInterval(() => {
    celebAudio.currentTime = 0;
    celebAudio.play().catch(() => {});
  }, 800);
  const closeBtn = document.getElementById('celebration-close');
  const closeFn = () => {
    clearInterval(jonasInterval);
    clearInterval(soundInterval);
    stopConfetti();
    celebMusic.pause(); celebMusic.currentTime = 0;
    overlay.classList.remove('active');
    jonasEl.src = 'Jonas_1.webp';
    closeBtn.removeEventListener('click', closeFn);
    showNameModal(100, m, s);
  };
  closeBtn.addEventListener('click', closeFn);
}

// ══════════════════════
// Regionväljare / navigering
// ══════════════════════
// Startskalet: startsidan syns från allra första bildrutan (ingen blink av
// spelvyn), med laddskärmens jordglobsanimation och roterande tips tills
// kartan är redo. Variant väljs med ?ladd=1|2|3 (standard 1).
// Jonas berättelse under laddningen — visas i ordning och stannar på
// sista raden (vitsens poäng ska inte snurra tillbaka till början!)
const LADD_TIPS = [
  'Har du alltid velat ha koll på världskartan?',
  'Med minnestekniker är det enkelt!',
  'På den här sidan kan du lära dig Jonas bilder för ALLA världens länder…',
  'Du kommer imponera både på dig själv och din omgivning!',
  'Alldeles strax har vi laddat klart världen åt dig…',
  'Det kommer att vara väl värt väntan!',
  'Medan vi väntar kan du få höra en rolig vits:',
  'Var i världen är det billigast att köpa nötkreatur?',
  'I nordvästra Asien, för där har de Ko-rea! 😄',
];
let laddTipsTimer = null;
function visaStartSkal() {
  document.body.classList.add('startlage');
  document.querySelector('header').style.display = 'none';
  document.getElementById('spel-load').style.display = 'none';
  document.body.style.overflow = 'hidden';
  const sel = document.getElementById('region-selector');
  sel.classList.add('laddar');
  sel.style.display = '';
  document.getElementById('ladd-rida').style.display = 'block';   // stilarkets default är none
  requestAnimationFrame(() => sel.classList.add('synlig'));
  const skarm = document.getElementById('ladd-skarm');
  const variant = new URLSearchParams(location.search).get('ladd') || '3';
  skarm.classList.add('v' + (['1','2','3'].includes(variant) ? variant : '1'));
  if (variant === '2') {
    const jordar = ['🌍', '🌎', '🌏'];
    let i = 0;
    setInterval(() => { document.getElementById('ladd-emoji').textContent = jordar[++i % 3]; }, 700);
  }
  const info = document.getElementById('ladd-info');
  let t = 0;
  info.textContent = LADD_TIPS[0];
  laddTipsTimer = setInterval(() => {
    if (t >= LADD_TIPS.length - 1) { clearInterval(laddTipsTimer); return; }
    info.classList.add('byter');
    setTimeout(() => {
      info.textContent = LADD_TIPS[++t];
      info.classList.remove('byter');
    }, 400);
  }, 3200);
  const badge = document.getElementById('start-version');
  if (badge) badge.textContent = 'version ' + V;
}
function gomStartSkal() {
  clearInterval(laddTipsTimer);
  const skarm = document.getElementById('ladd-skarm');
  skarm.classList.add('klar');
  setTimeout(() => { skarm.style.display = 'none'; }, 650);
  const rida = document.getElementById('ladd-rida');
  rida.classList.add('borta');
  setTimeout(() => { rida.style.display = 'none'; }, 1000);
  document.getElementById('region-selector').classList.remove('laddar');
}

// Startläget: SAMMA jordglob som i spelet, snurrande i rymden bakom
// startöverlägget. Väljer man en världsdel flyger kameran dit och
// spelpanelerna tonar fram — man byter aldrig sida.
// Globen stannar aldrig helt: rör man den släpper snurren, men efter en
// liten stund tar den mjukt vid igen — åt samma håll som man drog.
let snurrId = null;
let snurrRikt = 1;           // senaste rotationsriktningen (österut = +1)
let snurrLas = false;        // rundturens Italien-steg håller globen stilla
let snurrAterTimer = null;
let pekarNere = false;
let startAvslojad = false;   // globen visad färdigritad första gången?
function startaSnurr(malFart) {
  stoppaSnurr();
  if (malFart == null) malFart = 1.6 * snurrRikt;
  if (malFart) snurrRikt = malFart > 0 ? 1 : -1;
  let fart = 0;              // mjuk start: farten glider upp mot målet
  let last = performance.now();
  const tick = t => {
    if (!document.body.classList.contains('startlage')) { snurrId = null; return; }
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    fart += (malFart - fart) * Math.min(1, dt * 1.2);
    const c = map.getCenter();
    map.setCenter([c.lng + fart * dt, c.lat]);
    snurrId = requestAnimationFrame(tick);
  };
  snurrId = requestAnimationFrame(tick);
}
function stoppaSnurr() {
  if (snurrId !== null) { cancelAnimationFrame(snurrId); snurrId = null; }
}
// efter beröring/zoom: vänta ut rörelsen och återuppta sedan en långsam snurr
function planeraSnurrAter() {
  clearTimeout(snurrAterTimer);
  snurrAterTimer = setTimeout(() => {
    if (document.body.classList.contains('startlage') && startAvslojad
        && !snurrLas && !pekarNere && snurrId === null && !map.isMoving()) {
      startaSnurr(0.9 * snurrRikt);
    }
  }, 1400);
}

// kamerapaddning så att globen ligger mitt i den FRIA ytan mellan
// titeltexten och knappraden — inte mitt i hela fönstret
function startPadding() {
  const hintEl = document.querySelector('.start-hint');
  const knapparEl = document.getElementById('start-knappar');
  let top = 0, bottom = 0;
  if (hintEl) top = Math.max(0, Math.round(hintEl.getBoundingClientRect().bottom) + 6);
  if (knapparEl) bottom = Math.max(0, Math.round(innerHeight - knapparEl.getBoundingClientRect().top) + 6);
  const max = innerHeight * 0.72;   // paddningen får aldrig äta upp kartan
  if (top + bottom > max) {
    const k = max / (top + bottom);
    top = Math.round(top * k); bottom = Math.round(bottom * k);
  }
  map.setPadding({ top, bottom, left: 0, right: 0 });
}

function startLage(flyg) {
  document.body.classList.add('startlage');
  document.querySelector('header').style.display = 'none';
  const sel = document.getElementById('region-selector');
  clearTimeout(selGomTimer);   // en väntande döljning från utflygningen får inte släcka oss
  sel.style.display = '';
  requestAnimationFrame(() => sel.classList.add('synlig'));
  document.title = 'Jonas geografi';
  document.body.style.overflow = 'hidden';
  startPadding();
  // hela världen avslöjad: konstgloben i all sin prakt
  for (const f of regionsGj.features) setLand(f.id, { gron: false, tackt: false });
  map.resize();
  const badge = document.getElementById('start-version');
  if (badge) badge.textContent = 'version ' + V;
  visaMedaljer();
  if (!startAvslojad) {
    // första besöket: globen bakom ridån tills den är FÄRDIGRITAD —
    // snurren väntar också, annars blir kartan aldrig 'idle'
    map.jumpTo({ center: KAMERA.world.center, zoom: KAMERA.world.zoom });
    const klar = () => {
      if (startAvslojad) return;
      startAvslojad = true;
      gomStartSkal();
      if (document.body.classList.contains('startlage')) startaSnurr();
      if (!localStorage.getItem('rundtur-klar')) setTimeout(startaIntro, 800);
      else setTimeout(startaFeedbackTips, 1500);   // återvändare: kort feedbacknotis
    };
    map.once('idle', klar);
    setTimeout(klar, 12000);   // säkerhetsnät om rutorna strular
  } else if (flyg) {
    // snurren får inte starta förrän återflygningen är klar — varje
    // setCenter avbryter annars kamerans animation direkt
    map.flyTo({ center: KAMERA.world.center, zoom: KAMERA.world.zoom,
                duration: 2000, essential: true });
    map.once('moveend', () => {
      if (document.body.classList.contains('startlage')) startaSnurr();
    });
  } else {
    map.jumpTo({ center: KAMERA.world.center, zoom: KAMERA.world.zoom });
    startaSnurr();
  }

}

// Tillbaka till starten UTAN sidladdning: städa pågående läge, flyg ut
// till världsvyn och tona fram startöverlägget — samma glob hela tiden.
function tillbakaTillStart() {
  aktivUtmaning = null;          // utmaningen gäller bara tills man lämnar den
  if (seterraTimerInterval) clearInterval(seterraTimerInterval);
  seterraTarget = null;
  cursorLabel.style.display = 'none';
  document.getElementById('world-setup-overlay').classList.remove('active');
  document.getElementById('info-card')?.classList.remove('active');
  if (infoDefault) infoDefault.style.display = '';
  switchMode('explore', true);
  if (aktivVy !== 'glob') setView('glob');
  startLage(true);
}

// rättighetsrutan (kartans attribution) får synas en kort stund första
// gången spelvyn visas och fäller sedan ihop sig till sin lilla ⓘ-knapp
let rattigheterDolda = false;
function fallIhopRattigheter() {
  if (rattigheterDolda) return;
  rattigheterDolda = true;
  setTimeout(() => {
    document.querySelectorAll('.maplibregl-ctrl-attrib.maplibregl-compact-show').forEach(el => {
      el.classList.remove('maplibregl-compact-show');
      el.removeAttribute('open');
    });
  }, 5000);
}

let selGomTimer = null;
function lamnaStart() {
  stoppaSnurr();
  slappStartHover();   // världsdels-skimret får inte fastna i kartans state
  fallIhopRattigheter();
  const sel = document.getElementById('region-selector');
  sel.classList.remove('synlig');
  clearTimeout(selGomTimer);
  selGomTimer = setTimeout(() => { sel.style.display = 'none'; }, 450);
  document.body.classList.remove('startlage');
  document.body.classList.add('flyger');          // panelerna tonar in när kameran är framme
  document.querySelector('header').style.display = '';
  document.getElementById('back-btn').style.display = '';   // dold i grundmarkupen
  map.resize();   // panelbredden ändras när infopanelen kommer fram
  const fram = () => document.body.classList.remove('flyger');
  map.once('moveend', fram);
  setTimeout(fram, 3200);                          // säkerhetsnät
}

// startknapparna: ingen sidladdning — kameran flyger till världsdelen
async function gaTillRegion(slug, del) {
  startaForladdning();   // nu behövs sömlösa kartrutor på riktigt
  history.pushState({}, '', '?region=' + slug + (del ? '&del=' + del : ''));
  lamnaStart();
  if (slug === 'world') worldFlow();
  else {
    await startRegion(slug, true, del);
    const raw = await loadRegionConfig(slug);
    // stora världsdelar: erbjud uppdelningen direkt vid ankomst
    if (!del && delarFor(raw).length) visaDelVal(slug, raw);
    else spelTourVidBehov();   // första besöket i spelvyn: förklara lägena
  }
}

// ── Delvalsrutan: träna en bit i taget av de stora världsdelarna ──
const delOverlay = document.getElementById('del-overlay');
function visaDelVal(slug, raw) {
  const delar = delarFor(raw);
  if (!delar.length) return;
  document.getElementById('del-rubrik').textContent = raw.name.toUpperCase();
  const lista = document.getElementById('del-knappar');
  lista.innerHTML = '';
  const gor = (namn, antal, id, hel) => {
    const k = document.createElement('button');
    if (hel) k.className = 'hel';
    k.innerHTML = `${escHtml(namn)}<i>${antal} länder</i>`;
    k.addEventListener('click', async () => {
      delOverlay.classList.remove('active');
      history.replaceState({}, '', '?region=' + slug + (id ? '&del=' + id : ''));
      await startRegion(slug, false, id);
      switchMode(currentMode, true);   // börja om i aktuellt läge med nya länderna
      spelTourVidBehov();
    });
    lista.appendChild(k);
  };
  for (const d of delar) gor(d.namn, d.lander.length, d.id, false);
  gor('Hela ' + raw.name, raw.countries.length, null, true);
  delOverlay.classList.add('active');
}
document.getElementById('spel-delar').addEventListener('click', async () => {
  if (!aktivSlug || aktivSlug === 'world') return;
  visaDelVal(aktivSlug, await loadRegionConfig(aktivSlug));
});
delOverlay.addEventListener('click', e => {
  if (e.target === delOverlay) delOverlay.classList.remove('active');
});
document.querySelectorAll('.start-knappar .knapp:not(#resa-knapp)').forEach(a => {
  a.addEventListener('click', e => {
    if (e.target.closest('.knapp-video')) return;   // ▶ sköter sig själv
    e.preventDefault();
    gaTillRegion(new URL(a.href, location.href).searchParams.get('region'));
  });
});
window.addEventListener('popstate', () => {
  const r = new URLSearchParams(location.search).get('region');
  if (!r) tillbakaTillStart();     // bakåt till starten: sömlöst, utan omladdning
  else location.reload();          // bakåt/framåt mellan regioner: enklast så
});


// ══════════════════════
// Medaljer: personbästa i klassiska quizet per region (guld 100, silver 90,
// brons 70) — visas som märken på startsidans knappar
// ══════════════════════
function medaljFor(pct) { return pct >= 100 ? '🥇' : pct >= 90 ? '🥈' : pct >= 70 ? '🥉' : ''; }
// klick på medaljen visar resultatet bakom den — utan att knappen
// under hinner resa i väg till regionen
function visaMedaljInfo(span, slug) {
  let ruta = document.getElementById('medalj-info');
  if (!ruta) {
    ruta = document.createElement('div');
    ruta.id = 'medalj-info';
    document.body.appendChild(ruta);
  }
  const pct = +localStorage.getItem('medalj-' + slug) || 0;
  ruta.textContent = `${medaljFor(pct)} Ditt rekord: ${pct} %`;
  const r = span.getBoundingClientRect();
  // klampa in i vyn — medaljerna vid kanten fick annars bubblan avklippt
  // utanför skärmen på smala mobiler
  const halv = ruta.getBoundingClientRect().width / 2 + 8;
  ruta.style.left = Math.max(halv, Math.min(window.innerWidth - halv, r.left + r.width / 2)) + 'px';
  ruta.style.top = (r.top - 10) + 'px';
  ruta.classList.add('synlig');
  clearTimeout(visaMedaljInfo._timer);
  visaMedaljInfo._timer = setTimeout(() => ruta.classList.remove('synlig'), 2200);
}
function visaMedaljer() {
  document.querySelectorAll('.start-knappar .knapp:not(#resa-knapp)').forEach(a => {
    const slug = new URL(a.href, location.href).searchParams.get('region');
    const pct = +localStorage.getItem('medalj-' + slug) || 0;
    const m = medaljFor(pct);
    let span = a.querySelector('.medalj');
    if (!m) { if (span) span.remove(); return; }
    if (!span) {
      span = document.createElement('span');
      span.className = 'medalj';
      span.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        visaMedaljInfo(span, slug);
      });
      a.appendChild(span);
    }
    span.textContent = m;
    span.title = `Ditt rekord: ${pct} %`;
  });
}

// ══════════════════════
// Jorden runt: valfritt kampanjläge — res världsdel för världsdel, stämpel
// i passet vid minst 80 % i klassiska quizet, nästa stopp låses upp.
// Fritt spel påverkas inte.
// ══════════════════════
const RESA_ORDNING = ['sydamerika', 'nordamerika', 'europa', 'afrika', 'asien', 'oceanien', 'vastindien', 'world'];
// Segerfilmen som spelas när HELA resan är klar. Fyll i YouTube-id:t när
// filmen är inspelad (flera delar separeras med komma) — tills dess visas
// bara pokaltexten, ingen knapp.
const SEGER_VIDEO = '';
const RESA_NAMN = { europa: 'Europa', sydamerika: 'Sydamerika', nordamerika: 'Nordamerika',
  afrika: 'Afrika', asien: 'Asien', oceanien: 'Oceanien', vastindien: 'Västindien',
  world: 'Hela världen 🌍' };
function resaState() {
  let resa;
  try { resa = JSON.parse(localStorage.getItem('varldsresa')) || { steg: 0, klara: {} }; }
  catch (e) { resa = { steg: 0, klara: {} }; }
  // aktuellt stopp härleds ur stämplarna — så tål sparade resor att
  // ordningen på stoppen ändras
  resa.steg = RESA_ORDNING.findIndex(s => resa.klara[s] == null);
  if (resa.steg < 0) resa.steg = RESA_ORDNING.length;
  return resa;
}
// ── Passet: en riktig gummistämpel per klarad världsdel ──
// Varje stopp har egen bläckfärg och eget motiv; stämpeln ritas som SVG
// (skarp i alla storlekar) med sliten kant via en brusförskjutning.
const STAMPEL = {
  sydamerika:  { ink: '#2f7d4f', motiv: '🦙', ort: 'AMAZONAS' },
  nordamerika: { ink: '#2a5fa8', motiv: '🗽', ort: 'GREAT LAKES' },
  europa:      { ink: '#7a3f9d', motiv: '🏰', ort: 'ALPERNA' },
  afrika:      { ink: '#c9701c', motiv: '🦁', ort: 'SAHARA' },
  asien:       { ink: '#b0343c', motiv: '🐼', ort: 'HIMALAYA' },
  oceanien:    { ink: '#12796f', motiv: '🦘', ort: 'KORALLHAVET' },
  vastindien:  { ink: '#b3357f', motiv: '🌴', ort: 'KARIBIEN' },
  world:       { ink: '#a8811d', motiv: '🌍', ort: 'HELA JORDEN' },
};
function passStampelSvg(slug, procent, i) {
  const s = STAMPEL[slug] || STAMPEL.world;
  const namn = (RESA_NAMN[slug] || slug).replace(' 🌍', '').toUpperCase();
  const lut = (i % 5) * 7 - 14;                 // varje stämpel lite på sned
  const id = 'st-' + slug;
  return `<svg viewBox="0 0 200 200" role="img" aria-label="Stämpel ${escHtml(namn)}"
      style="transform:rotate(${lut}deg)">
    <defs>
      <path id="${id}-topp" d="M100,100 m-72,0 a72,72 0 1,1 144,0" fill="none"/>
      <path id="${id}-bott" d="M100,100 m-64,0 a64,64 0 0,0 128,0" fill="none"/>
      <filter id="${id}-slit" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="3" seed="${7 + i}"/>
        <feDisplacementMap in="SourceGraphic" scale="3.2" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
    </defs>
    <g filter="url(#${id}-slit)" fill="none" stroke="${s.ink}" opacity="0.88">
      <circle cx="100" cy="100" r="92" stroke-width="5"/>
      <circle cx="100" cy="100" r="80" stroke-width="2"/>
      <g fill="${s.ink}" stroke="none" font-family="Verdana,sans-serif" font-weight="700">
        <text font-size="17" letter-spacing="1.5">
          <textPath href="#${id}-topp" startOffset="50%" text-anchor="middle">${escHtml(namn)}</textPath>
        </text>
        <text font-size="11" letter-spacing="1.2" opacity=".85">
          <textPath href="#${id}-bott" startOffset="50%" text-anchor="middle">${escHtml(s.ort)}</textPath>
        </text>
        <text x="100" y="150" font-size="15" text-anchor="middle">${procent} %</text>
      </g>
      <line x1="34" y1="128" x2="166" y2="128" stroke-width="2" opacity=".8"/>
    </g>
    <text x="100" y="112" font-size="52" text-anchor="middle">${s.motiv}</text>
  </svg>`;
}
function visaPassStamplar(resa) {
  const ruta = document.getElementById('pass-stamplar');
  if (!ruta) return;
  const klara = RESA_ORDNING.filter(slug => resa.klara[slug] != null);
  ruta.innerHTML = klara.length
    ? klara.map((slug, i) => passStampelSvg(slug, resa.klara[slug], i)).join('')
    : '<div class="pass-tom">Ännu inga stämplar — klara ett stopp så får du din första!</div>';
  const agare = document.getElementById('pass-agare');
  if (agare) {
    const namn = localStorage.getItem(UTM_NAMN_KEY);
    agare.textContent = (namn ? namn.toUpperCase() + ' · ' : '') +
      `${klara.length} / ${RESA_ORDNING.length} STÄMPLAR`;
  }
}

function visaResa() {
  const resa = resaState();
  visaPassStamplar(resa);
  const lista = document.getElementById('resa-lista');
  lista.innerHTML = RESA_ORDNING.map((slug, i) => {
    const namn = RESA_NAMN[slug];
    if (resa.klara[slug] != null)
      return `<div class="resa-rad klar">✅ <b>${namn}</b><i>${resa.klara[slug]} %</i>` +
        `<button class="resa-res igen" data-slug="${slug}" title="Res tillbaka och spela igen">Res igen</button></div>`;
    if (i === resa.steg)
      return `<div class="resa-rad nu">▶ <b>${namn}</b><button class="resa-res" data-slug="${slug}">Res hit!</button></div>`;
    return `<div class="resa-rad last">🔒 <b>${namn}</b></div>`;
  }).join('');
  const klar = resaState().steg >= RESA_ORDNING.length;
  document.getElementById('resa-klart').style.display = klar ? '' : 'none';
  document.getElementById('resa-seger').style.display = klar && SEGER_VIDEO ? '' : 'none';
  document.getElementById('resa-modal').style.display = 'flex';
}
document.getElementById('resa-seger')?.addEventListener('click', () => {
  if (SEGER_VIDEO) oppnaVideo(SEGER_VIDEO.split(','));
});
document.getElementById('resa-kryss')?.addEventListener('click', () => {
  document.getElementById('resa-modal').style.display = 'none';
});
// mobilen: passet fälls ut bakom passikonen (på datorn syns det alltid)
document.getElementById('pass-oppna')?.addEventListener('click', () => {
  const bok = document.getElementById('pass-bok');
  const oppet = bok.classList.toggle('oppen');
  document.getElementById('pass-oppna').innerHTML =
    oppet ? '🛂 Dölj passet' : '🛂 Visa passet';
});
document.getElementById('resa-knapp')?.addEventListener('click', e => { e.preventDefault(); visaResa(); });
document.getElementById('resa-stang')?.addEventListener('click', () => {
  document.getElementById('resa-modal').style.display = 'none';
});
document.getElementById('resa-modal')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  const res = e.target.closest('.resa-res');
  if (res) { e.currentTarget.style.display = 'none'; gaTillRegion(res.dataset.slug); }
});

// Världstestets uppställning (antal länder + start) — bunden EN gång
let worldCount = 50;
document.querySelectorAll('#world-count-buttons button').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#world-count-buttons button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    worldCount = +b.dataset.count;
  });
});
document.getElementById('world-start-btn').addEventListener('click', async () => {
  document.getElementById('world-setup-overlay').classList.remove('active');
  await startWorld(worldCount);
});
function worldFlow() {
  spelPadding();
  document.getElementById('view-orig').style.display = 'none';
  document.title = 'Hela världen – Jonas geografi';
  document.querySelector('header h1').textContent = 'Hela världen 🌍';
  visaSpelVideo(null);   // världstestet har ingen egen film
  const overlay = document.getElementById('world-setup-overlay');
  overlay.classList.add('active');
  document.getElementById('world-setup-loading').style.display = 'none';
  document.getElementById('world-setup-ready').style.display = '';
  // visa globen bakom modalen under tiden
  for (const f of regionsGj.features) setLand(f.id, { gron: false, tackt: false });
}
document.getElementById('back-btn').addEventListener('click', () => {
  history.pushState({}, '', window.location.pathname);
  tillbakaTillStart();
});

// ══════════════════════
// Rundturerna: Jonas (riktiga foton, ny pose per steg) berättar medan en
// strålkastare lyfter fram delar av sidan. Samma maskineri driver både
// startsidans rundtur och spelvyns genomgång av lägena.
// Stegflaggor:  stor = stora Jonas utan strålkastare,  el = mål (element
// eller ruta),  rund = runt hål,  hoger = Jonas står till höger,
// spegel = spegelvänd pose,  knapp = text på gå-vidare-knappen.
// ══════════════════════
const introOverlay = document.getElementById('intro-overlay');
const introJonas = document.getElementById('intro-jonas');
const introBubbla = document.getElementById('intro-bubbla');
const introText = document.getElementById('intro-text');
const introNasta = document.getElementById('intro-nasta');
const introHoppa = document.getElementById('intro-hoppa');
const tourHal = document.getElementById('tour-hal');

// jordglobens ruta på skärmen: centrum via kartprojektionen, radien ur
// zoomnivån (globens omkrets = kartvärldens bredd i pixlar)
function globRect() {
  const c = map.project(map.getCenter());
  let r = 512 * Math.pow(2, map.getZoom()) / (2 * Math.PI);
  r = Math.min(r, window.innerHeight * 0.42, window.innerWidth * 0.42);
  return { left: c.x - r, top: c.y - r, right: c.x + r, bottom: c.y + r,
           width: r * 2, height: r * 2 };
}

const TOUR = [
  { stor: true, bild: 'assets/jonas/hej.webp', knapp: 'Visa mig runt!',
    text: 'Hej! Det är jag som är Jonas, och det här är min geografisida. Ska jag visa dig runt?' },
  { el: globRect, rund: true, bild: 'assets/jonas/upp.webp', italien: true,
    text: 'Alla minns var Italien ligger eftersom det ser ut som en stövel. På samma sätt går det att hitta på en bild för varje land i världen och på så vis minnas det mycket lättare!' },
  { el: () => document.getElementById('start-knappar'), bild: 'assets/jonas/ner.webp',
    // Jonas svävar mitt ovanför knappraden och pekar ner på den
    asp: 0.50, plats: (r, jw) => ({ left: r.left + r.width / 2 - jw / 2,
      bottom: window.innerHeight - r.top + 20 }),
    text: 'Du kan träna på en världsdel i taget eller utmana dig på hela världen på en gång!' },
  { el: () => document.getElementById('resa-knapp'), bild: 'assets/jonas/lugn2.webp',
    // snett ovanför resknappen, alldeles intill
    plats: (r, jw) => ({ left: r.left - jw * 0.7,
      bottom: window.innerHeight - r.top + 14 }),
    text: 'Om du vill gå igenom hela sidan systematiskt rekommenderar jag Jorden runt-resan!' },
  { el: () => document.getElementById('start-video-syd'), bild: 'assets/jonas/kul.webp',
    // tätt till vänster om play-knappen, bubblan på andra sidan
    asp: 0.68, plats: (r, jw) => ({ left: r.left - jw - 18, bottom: 0,
      bubbLeft: r.right + 26 }),
    text: 'Varje världsdel har en film bakom play-knappen! Om något är oklart är det en bra idé att titta på filmen om Sydamerikas länder där jag också förklarar hur minnesteknikerna fungerar!' },
  { el: () => document.getElementById('start-hifi'), bild: 'assets/jonas/smash.webp',
    hoger: true, spegel: true,
    text: 'Varje gång du känner dig extra nöjd med att ha lyckats minnas något är du välkommen att ge mig en high five i hörnet!' },
  { el: () => document.getElementById('feedback-knapp'), rund: true,
    bild: 'assets/jonas/upp.webp', spegel: true,
    text: 'Och bakom brevet här uppe kan du tycka till om sidan! Jag tar jättegärna emot feedback och förslag på förbättringar.' },
  { stor: true, bild: 'assets/jonas/masken.webp', knapp: 'Nu kör vi!',
    text: 'Kör hårt!' },
];

// kort engångsnotis för den som redan sett rundturen innan
// feedbackknappen fanns: bara "psst, nu kan du tycka till"-steget
const FEEDBACK_TIPS = [
  { el: () => document.getElementById('feedback-knapp'), rund: true,
    bild: 'assets/jonas/upp.webp', spegel: true, knapp: 'Tack, bra att veta!',
    text: 'Psst — en nyhet! Bakom brevet här uppe kan du numera tycka till om sidan. Jag tar jättegärna emot feedback och förslag på förbättringar!' },
];
function startaFeedbackTips() {
  if (localStorage.getItem('feedback-tips-klar')) return;
  if (!document.body.classList.contains('startlage')) return;
  if (introOverlay.style.display !== 'none') return;   // annan tur igång
  startaTour(FEEDBACK_TIPS, 'feedback-tips-klar', null);
}

// spelvyns genomgång: förklarar lägena första gången man är inne.
// På datorn ställer sig Jonas rakt under knappen han berättar om,
// med pratbubblan bredvid sig.
function underKnappen(r, jw) {
  const jh = Math.min(window.innerHeight * 0.36, 320);
  return { left: r.left + r.width / 2 - jw / 2,
           bottom: Math.max(0, window.innerHeight - r.bottom - jh - 12) };
}
const SPEL_TOUR = [
  { stor: true, bild: 'assets/jonas/hej.webp', knapp: 'Ja, visa mig!',
    text: 'Nu är vi inne! Ska jag snabbt förklara hur lägena funkar?' },
  { el: () => document.querySelector('.mode-btn[data-mode="explore"]'),
    bild: 'assets/jonas/upp.webp', plats: underKnappen,
    text: 'Vi börjar alltid i Utforska: klicka runt på länderna och kolla in bilderna och mina minnesknep!' },
  { el: () => document.querySelector('.info-panel'),
    bild: 'assets/jonas/kul.webp',
    plats: (r, jw) => ({ left: r.left - jw - 16, bottom: 0,
      bubbLeft: Math.max(16, r.left - jw - 452), svans: 'hoger' }),
    text: 'Klicka på ett land, så dyker det upp här! Du får se vad landet föreställer och ett minnesknep som kopplar bilden till landets namn.' },
  { el: () => document.querySelector('.mode-btn[data-mode="bildquiz"]'),
    bild: 'assets/jonas/pekar.webp', plats: underKnappen,
    text: 'Bildquiz är perfekt att börja träna med — jag frågar efter länderna medan bilderna fortfarande syns.' },
  { el: () => document.querySelector('.mode-btn[data-mode="seterra"]'),
    bild: 'assets/jonas/stark.webp', plats: underKnappen,
    text: 'Klassiskt Quiz är den riktiga utmaningen: inga bilder! Minst 80 % ger en stämpel i Jorden runt-resan — och 100 % ger ett diplom!' },
  { el: () => document.getElementById('back-btn'),
    bild: 'assets/jonas/upp.webp', spegel: true, plats: underKnappen,
    text: 'Pilen tar dig tillbaka till jordgloben när du vill välja något annat.' },
  { stor: true, bild: 'assets/jonas/masken.webp', knapp: 'Nu kör vi!',
    text: 'Kör hårt!' },
];

let aktivTour = TOUR;
let tourSteg = -1;
let tourNyckel = 'rundtur-klar';
let tourSlut = null;

// posernas bredd/höjd-förhållanden (beskurna figurer) — för placering
const POSE_ASP = { hej: 0.58, upp: 0.47, ner: 0.50, 'ner-hoger': 0.50,
  kul: 0.68, smash: 0.56, stark: 0.67, pekar: 0.54, lugn2: 0.57, masken: 0.82 };
const aspFor = bild =>
  POSE_ASP[(bild || '').replace(/^.*\//, '').replace('.webp', '')] || 0.55;

function visaHal(mal) {
  if (!mal) { nastaSteg(); return; }
  const r = mal.getBoundingClientRect ? mal.getBoundingClientRect() : mal;
  tourHal.style.left = (r.left - 8) + 'px';
  tourHal.style.top = (r.top - 8) + 'px';
  tourHal.style.width = (r.width + 16) + 'px';
  tourHal.style.height = (r.height + 16) + 'px';
  if (window.innerWidth <= 700) return;   // mobilen placerar bubblan själv
  // bubblan får aldrig täcka målet: ovanför mål i nedre halvan, annars under
  if (r.top > window.innerHeight / 2) {
    introBubbla.style.bottom = (window.innerHeight - r.top + 30) + 'px';
  } else {
    introBubbla.style.bottom =
      Math.max(40, window.innerHeight - r.bottom - introBubbla.offsetHeight - 46) + 'px';
  }
}

function visaTourSteg() {
  const s = aktivTour[tourSteg];
  // "Hoppa över" bara i riktiga turer — en ensam notis har redan en enda knapp
  introHoppa.style.display = (tourSteg === 0 && aktivTour.length > 1) ? '' : 'none';
  introOverlay.classList.toggle('steg', !s.stor);
  introOverlay.classList.toggle('hoger', !!s.hoger);
  introJonas.classList.toggle('spegel', !!s.spegel);
  tourHal.classList.toggle('rund', !!s.rund);
  // stövel-steget: globen vrids så att Italien hamnar mitt i cirkeln
  if (s.italien && map) {
    snurrLas = true;
    stoppaSnurr();
    map.easeTo({ center: [12.5, 42.5], duration: 1400, essential: true });
  } else if (snurrLas) {
    snurrLas = false;
    if (document.body.classList.contains('startlage')) startaSnurr(0.9 * snurrRikt);
  }
  // grundplacering (CSS) tills steget säger annat
  introJonas.style.left = ''; introJonas.style.bottom = '';
  introBubbla.style.left = ''; introBubbla.style.right = '';
  introBubbla.style.maxWidth = '';
  if (s.bild) introJonas.src = s.bild;
  introText.textContent = s.text;
  introNasta.textContent = s.knapp || 'Nästa';
  if (s.el) {
    const mal = s.el();
    visaHal(mal);
    if (!mal) return;
    const r = mal.getBoundingClientRect ? mal.getBoundingClientRect() : mal;
    const W = window.innerWidth, H = window.innerHeight;
    if (W > 700) {
      // på större skärmar kan Jonas ställa sig alldeles intill målet
      if (s.plats) {
        const jh = Math.min(H * 0.36, 320);
        const jw = jh * aspFor(s.bild);
        const p = s.plats(r, jw);
        const vx = Math.max(8, Math.min(p.left, W - jw - 8));
        introJonas.style.left = vx + 'px';
        introJonas.style.bottom = Math.max(0, p.bottom) + 'px';
        let bubbLeft = p.bubbLeft != null ? p.bubbLeft : vx + jw + 14;
        let svansHoger = p.svans === 'hoger';
        if (p.bubbLeft == null && W - bubbLeft < 280) {
          bubbLeft = Math.max(16, vx - 414);   // trångt till höger → vänster sida
          svansHoger = true;
        }
        if (svansHoger) introOverlay.classList.add('hoger');   // svansen mot Jonas
        introBubbla.style.left = bubbLeft + 'px';
        introBubbla.style.maxWidth = Math.min(400, W - bubbLeft - 16) + 'px';
      }
      return;
    }
    // ── mobil: Jonas får aldrig skymma målet — då flyttar han sig ovanför
    // det — och bubblan ligger ovanför Jonas (eller ovanför målet) ──
    const jh = H * 0.30, jw = jh * aspFor(s.bild);
    let jLeft = s.hoger ? W * 0.98 - jw : W * 0.02;
    let jBottom = 0;
    const skymmer = r.bottom > H - jh - 14
      && r.right > jLeft - 14 && r.left < jLeft + jw + 14;
    if (skymmer) {
      jBottom = H - r.top + 12;
      jLeft = Math.max(8, Math.min(r.left + r.width / 2 - jw / 2, W - jw - 8));
    }
    introJonas.style.left = jLeft + 'px';
    introJonas.style.bottom = jBottom + 'px';
    const bh = introBubbla.offsetHeight;
    let bb = jBottom + jh + 26;   // svansen sticker ner — täck aldrig Jonas
    if (H - bb - bh < r.bottom + 6 && H - bb > r.top - 6) {
      // bubblan skulle skymma målet → lägg den ovanför, aldrig utanför skärmen
      bb = Math.min(H - r.top + 16, H - 6 - bh);
    }
    introBubbla.style.bottom = bb + 'px';
    // svansen pekar mot Jonas
    introBubbla.style.setProperty('--svans-x',
      Math.max(18, Math.min(jLeft + jw / 2 - W * 0.08, W * 0.84 - 46)) + 'px');
    return;
  }
  // inget utpekat: hålet är en punkt utanför skärmen → dimman täcker allt
  tourHal.style.left = '-60px'; tourHal.style.top = '-60px';
  tourHal.style.width = '0px'; tourHal.style.height = '0px';
  introBubbla.style.bottom = '';
  // stora Jonas: bubblan läggs efter posens faktiska bredd (masken är bred!)
  if (window.innerWidth > 700) {
    const jhS = Math.min(window.innerHeight * 0.64, 560);
    introBubbla.style.left = Math.round(Math.min(
      window.innerWidth * 0.06 + jhS * aspFor(s.bild) + 16,
      window.innerWidth - 430)) + 'px';
  }
}

function startaTour(lista, nyckel, vidSlut) {
  aktivTour = lista; tourNyckel = nyckel; tourSlut = vidSlut; tourSteg = 0;
  lista.forEach(s => { if (s.bild) new Image().src = s.bild; });   // värm cachen
  introOverlay.style.display = '';
  introBubbla.style.display = '';
  introJonas.style.display = '';
  introJonas.style.transform = '';
  tourHal.style.display = '';
  visaTourSteg();
}

function startaIntro() { startaTour(TOUR, 'rundtur-klar', null); }

function nastaSteg() {
  tourSteg++;
  if (tourSteg >= aktivTour.length) {
    localStorage.setItem(tourNyckel, '1');
    // hela rundturen visar redan feedbackknappen — då behövs ingen notis sen
    if (tourNyckel === 'rundtur-klar') localStorage.setItem('feedback-tips-klar', '1');
    snurrLas = false;
    if (tourSlut) tourSlut();
    else introOverlay.style.display = 'none';
    return;
  }
  visaTourSteg();
}

// spelvyns genomgång startar när kameran har landat i regionen
function spelTourVidBehov() {
  if (localStorage.getItem('speltur-klar')) return;
  let gjord = false;
  const kor = () => {
    if (gjord) return; gjord = true;
    if (document.body.classList.contains('startlage')) return;   // hann tillbaka
    if (introOverlay.style.display !== 'none') return;           // annan tur igång
    startaTour(SPEL_TOUR, 'speltur-klar', null);
  };
  map.once('moveend', () => setTimeout(kor, 500));
  setTimeout(kor, 3800);                    // säkerhetsnät om flygturen uteblir
}

introNasta.addEventListener('click', nastaSteg);
introHoppa.addEventListener('click', () => {
  localStorage.setItem(tourNyckel, '1');
  introOverlay.style.display = 'none';
});
document.getElementById('start-hjalp').addEventListener('click', startaIntro);
window.addEventListener('resize', () => {
  if (introOverlay.style.display !== 'none' && tourSteg >= 0 && tourSteg < aktivTour.length) {
    visaTourSteg();   // räknar om både hålet och Jonas placering
  }
  if (document.body.classList.contains('startlage')) startPadding();
});

// Videomodal — genomgångsvideor per världsdel (▶-knappen på kortet).
// Flera delar (Afrika) anges kommaseparerat och byts med delknapparna;
// ingen dold spellista, så markeringen stämmer alltid med det som spelas.
const videoModal = document.getElementById('video-modal');
const videoIframe = document.getElementById('video-iframe');
const videoDelar = document.getElementById('video-delar');
let undertextTimers = [];
function stangVideo() {
  videoModal.style.display = 'none';
  videoIframe.src = '';
  undertextTimers.forEach(clearTimeout);
  undertextTimers = [];
}
// Undertexterna tänds ändå när tittaren har "visa alltid" påslaget i sitt
// YouTube-konto — cc_load_policy räcker inte. Spelar-API:t kan däremot
// LASTA UR textningsmodulen; kommandot måste komma efter att spelaren
// blivit klar, så det upprepas några gånger under de första sekunderna.
function slaAvUndertexter() {
  undertextTimers.forEach(clearTimeout);
  undertextTimers = [400, 1200, 2500, 4000].map(t => setTimeout(() => {
    const w = videoIframe.contentWindow;
    if (!w) return;
    for (const modul of ['captions', 'cc']) {
      try {
        w.postMessage(JSON.stringify(
          { event: 'command', func: 'unloadModule', args: [modul] }), '*');
      } catch (e) { /* spelaren inte redo än — nästa försök tar det */ }
    }
  }, t));
}
function spelaVideo(delar, start, startSek) {
  videoIframe.src = 'https://www.youtube.com/embed/' + delar[start]
    + '?autoplay=1&rel=0&cc_load_policy=0&iv_load_policy=3&enablejsapi=1'
    + (startSek ? '&start=' + Math.round(startSek) : '');
  slaAvUndertexter();
  videoDelar.querySelectorAll('button').forEach((k, i) =>
    k.classList.toggle('aktiv', i === start));
}
// startSek: tränar man en DEL av världsdelen hoppar filmen till den delens
// avsnitt i stället för att börja om från början
function oppnaVideo(delar, start, startSek) {
  start = Math.min(Math.max(start || 0, 0), delar.length - 1);
  videoDelar.innerHTML = '';
  videoDelar.style.display = delar.length > 1 ? 'flex' : 'none';
  if (delar.length > 1) {
    delar.forEach((_, i) => {
      const k = document.createElement('button');
      k.textContent = 'Del ' + (i + 1);
      k.addEventListener('click', () => spelaVideo(delar, i));
      videoDelar.appendChild(k);
    });
  }
  spelaVideo(delar, start, startSek);
  videoModal.style.display = 'flex';
}
document.querySelectorAll('.knapp-video').forEach(b => b.addEventListener('click', e => {
  e.preventDefault(); e.stopPropagation();
  oppnaVideo(b.dataset.video.split(','));
}));
// samma videor inifrån spelvyn: play-knappen bredvid regiontiteln
function regionVideo(slug) {
  const knapp = document.querySelector(
    `.start-knappar .knapp[href*="region=${slug}"] .knapp-video`);
  return knapp ? knapp.dataset.video : null;
}
const spelVideoKnapp = document.getElementById('spel-video');
function visaSpelVideo(slug) {
  const video = slug ? regionVideo(slug) : null;
  spelVideoKnapp.style.display = video ? '' : 'none';
  spelVideoKnapp.dataset.video = video || '';
}
spelVideoKnapp.addEventListener('click', () => {
  if (!spelVideoKnapp.dataset.video) return;
  oppnaVideo(spelVideoKnapp.dataset.video.split(','),
    +spelVideoKnapp.dataset.videodel || 0, +spelVideoKnapp.dataset.videostart || 0);
});
document.getElementById('spel-hjalp').addEventListener('click', () => {
  startaTour(SPEL_TOUR, 'speltur-klar', null);
});
document.getElementById('video-stang').addEventListener('click', stangVideo);
videoModal.addEventListener('click', e => { if (e.target === videoModal) stangVideo(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (videoModal.style.display !== 'none') stangVideo();
  const rm = document.getElementById('resa-modal');
  if (rm && rm.style.display !== 'none') rm.style.display = 'none';
  const fm = document.getElementById('feedback-modal');
  if (fm && fm.style.display !== 'none') fm.style.display = 'none';
  const tm = document.getElementById('topplista-modal');
  if (tm && tm.style.display !== 'none') tm.style.display = 'none';
});

// ══════════════════════
// Feedback: formulär som mejlas till Jonas via FormSubmit
// ══════════════════════
const FEEDBACK_MOTTAGARE = 'info@jonasvonessen.se';
const feedbackModal = document.getElementById('feedback-modal');
const feedbackStatus = document.getElementById('feedback-status');
document.getElementById('feedback-knapp').addEventListener('click', () => {
  feedbackStatus.textContent = '';
  feedbackStatus.className = '';
  document.getElementById('feedback-form').style.display = '';
  feedbackModal.style.display = 'flex';
  document.getElementById('feedback-medd').focus();
});
document.getElementById('feedback-stang').addEventListener('click', () => {
  feedbackModal.style.display = 'none';
});
feedbackModal.addEventListener('click', e => {
  if (e.target === feedbackModal) feedbackModal.style.display = 'none';
});
document.getElementById('feedback-form').addEventListener('submit', async e => {
  e.preventDefault();
  const medd = document.getElementById('feedback-medd').value.trim();
  if (!medd) return;
  const skicka = document.getElementById('feedback-skicka');
  skicka.disabled = true;
  feedbackStatus.className = '';
  feedbackStatus.textContent = 'Skickar …';
  try {
    const svar = await fetch('https://formsubmit.co/ajax/' + FEEDBACK_MOTTAGARE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        namn: document.getElementById('feedback-namn').value.trim() || '(inget namn)',
        epost: document.getElementById('feedback-epost').value.trim() || '(ingen e-post)',
        meddelande: medd,
        _subject: 'Feedback från Jonas geografi',
        _template: 'table',
      }),
    });
    if (!svar.ok) throw new Error('HTTP ' + svar.status);
    document.getElementById('feedback-form').style.display = 'none';
    feedbackStatus.className = 'tack';
    feedbackStatus.textContent = '🎉 Tack för din feedback! Meddelandet är skickat till Jonas.';
    feedbackModal.querySelector('.feedback-kort').appendChild(feedbackStatus);
    setTimeout(() => { feedbackModal.style.display = 'none'; }, 3500);
  } catch (fel) {
    feedbackStatus.className = 'fel';
    feedbackStatus.innerHTML = 'Hoppsan, det gick inte att skicka just nu. Prova igen — eller mejla direkt till '
      + '<a href="mailto:' + FEEDBACK_MOTTAGARE + '?subject=Feedback%20fr%C3%A5n%20Jonas%20geografi">'
      + FEEDBACK_MOTTAGARE + '</a>.';
  }
  skicka.disabled = false;
});

function showGame() {
  document.body.classList.remove('startlage');   // markupens default är startläge
  fallIhopRattigheter();
  document.querySelector('header').style.display = '';
  document.getElementById('region-selector').style.display = 'none';
  document.querySelector('.game-container').style.display = '';
  document.querySelector('.mode-toggle').style.display = '';
  document.getElementById('header-hint').style.display = '';
  document.getElementById('back-btn').style.display = '';
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    const header = document.querySelector('header');
    if (header) document.documentElement.style.setProperty('--mobile-header-h', header.offsetHeight + 'px');
  });
}

// litet API för tester och felsökning — INTE i produktion: med klick()
// och target i konsolen kunde vem som helst skripta ett perfekt quiz
// på sekunder och toppa listorna med omöjliga tider
if (/^(127\.|localhost)/.test(location.hostname) ||
    new URLSearchParams(location.search).has('debug')) {
  window.spel = {
    get map() { return map; },
    get countries() { return COUNTRIES; },
    get revealed() { return revealed; },
    get target() { return seterraTarget; },
    get mode() { return currentMode; },
    get vy() { return aktivVy; },
    get flat() { return flat; },
    get origZoom() { return origZoom; },
    klick: gid => handleMapClick(gid, null),
    setLand, landState, setView, flatZoomTo, origSetZoom,
  };
}

// ══════════════════════
// Utmaningar: efter ett klassiskt quiz kan man skapa en länk och utmana
// kompisar. Länken låser region + (för världstestet) exakt samma länder,
// och alla som spelar den hamnar i samma duellista. Ingen inloggning —
// bara ett spelarnamn, precis som i topplistorna.
// ══════════════════════
const UTM_NAMN_KEY = 'spelarnamn';
const utmUrl = id => location.origin + location.pathname + '?utmaning=' + id;
const utmTid = t => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
const utmRegionNamn = slug => RESA_NAMN[slug] || slug;
const utmDelText = (namn, d, id) =>
  `${namn} utmanar dig i Jonas geografi! ${utmRegionNamn(d.slug)}: ` +
  `${d.score} % på ${utmTid(d.time)} — kan du slå det? ${utmUrl(id)}`;

const utmanaBtn = document.getElementById('utmana-btn');
const utmSkapaModal = document.getElementById('utmaning-skapa-modal');
function visaUtmanaKnapp(score) {
  // bara riktiga, hela klassiska omgångar går att utmana på — och inte
  // inne i någon annans utmaning (då delar man vidare i stället).
  // Delar av en världsdel går inte att utmana på: utmaningslänken bär
  // bara regionens slug, så kompisen skulle få hela världsdelen.
  utmanaBtn.style.display =
    (firebaseDB && !bildlage && !seterraIsRetry && !aktivUtmaning && !aktivDel && seterraTotal)
      ? '' : 'none';
  utmanaBtn.dataset.score = score;
}
utmanaBtn.addEventListener('click', () => {
  document.getElementById('utm-skapa-form').style.display = '';
  document.getElementById('utm-skapa-klar').style.display = 'none';
  document.getElementById('utm-skapa-status').textContent = '';
  document.getElementById('utm-skapa-detalj').textContent =
    `${utmRegionNamn(aktivSlug)} — du fick ${utmanaBtn.dataset.score} % på ${utmTid(seterraElapsed)}`;
  const namn = document.getElementById('utm-skapa-namn');
  namn.value = localStorage.getItem(UTM_NAMN_KEY) || '';
  utmSkapaModal.style.display = 'flex';
  if (!namn.value) setTimeout(() => namn.focus(), 100);
});
document.getElementById('utm-skapa-avbryt').addEventListener('click', () => {
  utmSkapaModal.style.display = 'none';
});
document.getElementById('utm-skapa-stang').addEventListener('click', () => {
  utmSkapaModal.style.display = 'none';
});
utmSkapaModal.addEventListener('click', e => {
  if (e.target === utmSkapaModal) utmSkapaModal.style.display = 'none';
});
document.getElementById('utm-skapa-btn').addEventListener('click', async () => {
  const namnEl = document.getElementById('utm-skapa-namn');
  const namn = namnEl.value.trim();
  if (!namn) { namnEl.focus(); return; }
  localStorage.setItem(UTM_NAMN_KEY, namn);
  const post = {
    namn, slug: aktivSlug, antal: seterraTotal,
    score: +utmanaBtn.dataset.score, time: seterraElapsed,
    wrong: seterraWrong, date: Date.now(),
  };
  if (isWorldTest) post.lander = COUNTRIES.map(c => c.gid).join(',');
  const status = document.getElementById('utm-skapa-status');
  status.textContent = 'Skapar länken …';
  try {
    const ref = await firebaseDB.ref('utmaningar').push(post);
    status.textContent = '';
    document.getElementById('utm-skapa-form').style.display = 'none';
    document.getElementById('utm-skapa-klar').style.display = '';
    document.getElementById('utm-lank').value = utmUrl(ref.key);
    document.getElementById('utm-dela').onclick = async () => {
      const text = utmDelText(namn, post, ref.key);
      if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) {} }
      kopieraUtmLank();
    };
  } catch (e) {
    status.textContent = 'Kunde inte skapa länken — kolla nätet och prova igen.';
  }
});
function kopieraUtmLank() {
  const inp = document.getElementById('utm-lank');
  inp.select(); inp.setSelectionRange(0, 300);
  (navigator.clipboard ? navigator.clipboard.writeText(inp.value)
                       : Promise.reject()).catch(() => document.execCommand('copy'));
  const k = document.getElementById('utm-kopiera');
  k.textContent = 'Kopierad!';
  setTimeout(() => { k.textContent = 'Kopiera länken'; }, 1600);
}
document.getElementById('utm-kopiera').addEventListener('click', kopieraUtmLank);

// mottagarsidan: ?utmaning=<id> — spelplanen görs i ordning bakom
// anta-rutan, själva quizet startar först när man antagit utmaningen
async function forberedUtmaning(id) {
  let data = null;
  if (firebaseDB) {
    try { data = (await firebaseDB.ref('utmaningar/' + id).once('value')).val(); }
    catch (e) { /* nätfel → samma felruta som saknad utmaning */ }
  }
  const modal = document.getElementById('utmaning-anta-modal');
  if (!data || !RESA_NAMN[data.slug]) {
    startLage();
    document.getElementById('utm-anta-rubrik').textContent = 'Hoppsan!';
    document.getElementById('utm-anta-text').textContent =
      'Utmaningen kunde inte hittas — länken kan vara trasig eller nätet nere.';
    document.getElementById('utm-anta-form').style.display = 'none';
    document.getElementById('utm-anta-felknappar').style.display = '';
    modal.style.display = 'flex';
    return;
  }
  aktivUtmaning = { id, data };
  if (data.slug === 'world') {
    document.title = 'Hela världen – Jonas geografi';
    document.querySelector('header h1').textContent = 'Hela världen 🌍';
    document.getElementById('view-orig').style.display = 'none';
    visaSpelVideo(null);
    spelPadding();
    for (const f of regionsGj.features) setLand(f.id, { gron: false, tackt: false });
    map.jumpTo({ center: KAMERA.world.center, zoom: KAMERA.world.zoom });
  } else {
    await startRegion(data.slug);
  }
  document.getElementById('utm-anta-rubrik').textContent = '⚔️ Utmaning!';
  document.getElementById('utm-anta-text').innerHTML =
    `<b>${escHtml(data.namn)}</b> utmanar dig på <b>${escHtml(utmRegionNamn(data.slug))}</b>` +
    (data.slug === 'world' ? ` med <b>${data.antal} länder</b>` : '') +
    `!<br>Resultatet att slå: <b>${data.score} %</b> på <b>${utmTid(data.time)}</b>.`;
  const namn = document.getElementById('utm-anta-namn');
  namn.value = localStorage.getItem(UTM_NAMN_KEY) || '';
  document.getElementById('utm-anta-form').style.display = '';
  document.getElementById('utm-anta-felknappar').style.display = 'none';
  modal.style.display = 'flex';
}
document.getElementById('utm-anta-btn').addEventListener('click', async () => {
  const namnEl = document.getElementById('utm-anta-namn');
  const namn = namnEl.value.trim();
  if (!namn) { namnEl.focus(); return; }
  localStorage.setItem(UTM_NAMN_KEY, namn);
  aktivUtmaning.namn = namn;
  document.getElementById('utmaning-anta-modal').style.display = 'none';
  const d = aktivUtmaning.data;
  if (d.slug === 'world') {
    const gids = (d.lander || '').split(',').filter(Boolean).map(Number);
    await startWorld(d.antal, gids);
  } else {
    switchMode('seterra', true);   // startar quizet — länderna är redan laddade
  }
});
const utmAntaNej = () => { location.href = location.pathname; };
document.getElementById('utm-anta-nej').addEventListener('click', utmAntaNej);
document.getElementById('utm-anta-stang').addEventListener('click', utmAntaNej);

async function sparaUtmaningsResultat(score) {
  const u = aktivUtmaning;
  const entry = { name: u.namn || 'Jag', score, time: seterraElapsed,
                  wrong: seterraWrong, date: Date.now() };
  // samma fuskspärr som topplistorna: under 5 sekunder sparas aldrig
  if (firebaseDB && seterraTotal && entry.time >= 5) {
    try { await firebaseDB.ref('utmaningar/' + u.id + '/resultat').push(entry); }
    catch (e) { /* duellen visas ändå, med det som gick att läsa */ }
  }
  visaDuellLista(entry);
}
async function visaDuellLista(egen) {
  const u = aktivUtmaning;
  const el = document.getElementById('highscore-list');
  el.innerHTML = '<div class="hs-empty">Hämtar duellen …</div>';
  const alla = [{ name: u.data.namn + ' 👑', score: u.data.score,
                  time: u.data.time, date: u.data.date }];
  if (firebaseDB) {
    try {
      const snap = await firebaseDB.ref('utmaningar/' + u.id + '/resultat').once('value');
      snap.forEach(ch => alla.push(ch.val()));
    } catch (e) {}
  }
  const basta = new Map();   // bästa försöket per namn — man får försöka igen!
  for (const e of alla) {
    const f = basta.get(e.name);
    if (!f || e.score > f.score || (e.score === f.score && e.time < f.time)) basta.set(e.name, e);
  }
  const lista = [...basta.values()].sort((a, b) => b.score - a.score || a.time - b.time);
  el.innerHTML = hsTabellHtml(lista, egen, '⚔️ Duellen hittills');
}
document.getElementById('utm-vidare-btn').addEventListener('click', async () => {
  const u = aktivUtmaning;
  if (!u) return;
  if (navigator.share) {
    try { await navigator.share({ text: utmDelText(u.data.namn, u.data, u.id) }); return; }
    catch (e) {}
  }
  try { await navigator.clipboard.writeText(utmUrl(u.id)); } catch (e) {}
  const b = document.getElementById('utm-vidare-btn');
  b.textContent = 'Länken kopierad! 📋';
  setTimeout(() => { b.textContent = 'Skicka utmaningen vidare 📨'; }, 1800);
});

// ══════════════════════
// "Installera appen": riktiga installationsdialogen där webbläsaren har en
// (Chrome på Android/desktop), annars steg-för-steg-instruktioner. Knappen
// syns bara när det finns något att göra — aldrig inne i den installerade
// appen själv.
// ══════════════════════
const installKnapp = document.getElementById('installera-knapp');
const installModal = document.getElementById('installera-modal');
const arIos = /iphone|ipod|ipad/i.test(navigator.userAgent)
  || (navigator.userAgent.includes('Mac') && navigator.maxTouchPoints > 1);
const korSomApp = matchMedia('(display-mode: standalone)').matches
  || navigator.standalone === true;
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();               // vi visar en egen knapp i stället för bannern
  installPrompt = e;
  if (!korSomApp) installKnapp.style.display = '';
});
if (arIos && !korSomApp) installKnapp.style.display = '';
installKnapp.addEventListener('click', () => {
  if (installPrompt) {
    // dialogen får bara visas en gång per händelse — avböjer man får
    // man instruktionerna nästa gång i stället
    const p = installPrompt;
    installPrompt = null;
    p.prompt();
    return;
  }
  document.getElementById('installera-ios').style.display = arIos ? '' : 'none';
  document.getElementById('installera-android').style.display = arIos ? 'none' : '';
  installModal.style.display = 'flex';
});
window.addEventListener('appinstalled', () => { installKnapp.style.display = 'none'; });
document.getElementById('installera-stang').addEventListener('click', () => {
  installModal.style.display = 'none';
});
installModal.addEventListener('click', e => {
  if (e.target === installModal) installModal.style.display = 'none';
});

// ══════════════════════
// Uppstart
// ══════════════════════
// PWA: installerbar + offline (service workern cachar kartarkiv och data)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* http utan SW-stöd */ });
}

(async () => {
  const params = new URLSearchParams(window.location.search);
  const region = params.get('region');
  const utmaningId = params.get('utmaning');

  if (region || utmaningId) showGame(); else visaStartSkal();
  const loadTxt = document.getElementById('spel-load-txt');
  if (region || utmaningId) {
    document.getElementById('spel-load').style.display = '';   // dold i markupen numera
    loadTxt.textContent = 'Startar …';
  }
  // Bara klickytorna behövs innan spelet drar igång — kartrutorna strömmar
  // på begäran (regionens rutor är en handfull). Hela arkivet förladdas
  // först vid engagemang (startaForladdning): direktlänk in i spelet,
  // beröring av globen, regionsval eller en stunds kvarstannande.
  try {
    await Promise.all([loadRegions(), loadMarkers()]);
    if (region || utmaningId) {
      startaForladdning();               // direktlänk in i spelet = engagerad
    } else {
      // återbesökare: arkivet ligger redan i SW-cachen → förladda gratis
      if (window.caches) {
        const nyckel = new URL(TILE_URL, location.href); nyckel.search = '';
        caches.open('geografi-tiles').then(c => c.match(nyckel.href))
          .then(traff => { if (traff) startaForladdning(); }).catch(() => {});
      }
      setTimeout(startaForladdning, 45000);   // den som stannar är nyfiken på riktigt
    }
    initMap();
    // feature-states kan inte sättas innan stilen laddat klart — men om
    // kartrutorna strular (t.ex. trög förhandsproxy) startar spelet ändå:
    // vektorlagren funkar direkt och tillstånden återappliceras på 'load'
    await new Promise(res => { map.once('load', res); setTimeout(res, 8000); });
  } catch (e) {
    // fastna ALDRIG tyst på "Startar …" — visa vad som gick fel
    loadTxt.textContent = 'Kunde inte ladda kartdata — prova att ladda om sidan. [' + ((e && e.message) || e) + ']';
    throw e;
  }
  document.getElementById('spel-load').style.display = 'none';
  if (!region && !utmaningId) document.querySelector('.game-container').style.display = '';

  if (utmaningId) {
    await forberedUtmaning(utmaningId);   // ingen rundtur — kompisen vill duellera
  } else if (region === 'world') {
    worldFlow();
  } else if (WORLD_SLUGS.includes(region)) {
    const del = params.get('del');
    await startRegion(region, false, del);
    const raw = await loadRegionConfig(region);
    if (!del && delarFor(raw).length) visaDelVal(region, raw);
    else spelTourVidBehov();
  } else {
    startLage();
  }
})();
