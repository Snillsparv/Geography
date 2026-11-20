// ════════════════════════════════════════════════════════════════════
// Flaggblixt (bara svenska sajten): säg flaggans land – en minut
// ════════════════════════════════════════════════════════════════════
// Jonas önskan: "ett flaggtest: att man har en minut på sig, det dyker upp
// en flagga, och så ska man säga vilken flagga det är. Röstigenkänningen
// skulle då bara ge godkänt eller inte, och allt borde gå väldigt snabbt."
//
// Ingången: "🎤 Flaggblixt – 1 minut" i quizpanelen bredvid Topplista när
// Flaggor är valt (#fraga-val, flagglage), på quizens slutsida under Spela
// igen och under tipset i Utforska + Flaggor (inte på låga telefoner, där
// den panelen har fast höjd, glob.html v106/v107). Samma villkor som
// flaggtavlan (flaggaKanSpelas): aldrig USA, aldrig i en kompisutmaning,
// och den engelska sajten laddar inte ens filen (tools/make-sajt-html.mjs).
//
// Rundan: regionens länder (Hela världen: alla 202, inte bara rundans
// urval) i slumpad ordning utan upprepning, en stor riktig flagga i taget
// (assets/flaggor, samma som tavlan). Klockan (60 s) går först när
// mikrofonen verkligen lyssnar (audiostart, alltså efter webbläsarens
// fråga), efter en kort 3-2-1. Man säger landets namn: så fort ett
// delresultat (interim) eller slutresultat matchar flaggan som visas blir
// det ✓ med namnet, poäng, och nästa flagga direkt. Ett slutresultat som
// inte matchar ger ✗ och flaggan står kvar; "Jag hörde: …" visar alltid
// vad igenkänningen hörde. "Hoppa över" (knappen, eller "pass", "nästa",
// "hoppa över") visar svaret och går vidare. När tiden är ute stängs
// mikrofonen direkt och slutsidan visar antal rätt, rundans flaggor
// (rätt / fel / hoppade över / hann inte) och rekordet per region (bara
// lokalt: SPRAK.hsPrefix + 'flaggblixt-' + HS_BAS, inga nya Firebase-regler).
// Quizens klocka bakom väntar bara om quizet inte börjat (inga svar än);
// mitt i ett quiz går den vidare, som med flaggvideon (v109).
//
// Rösten: SpeechRecognition (webkit i Chrome och Safari), sv-SE, interim,
// continuous, 5 alternativ (alla prövas). Mikrofonen begärs först när man
// trycker Starta och stängs (abort) när rundan tar slut, vid Spela igen,
// när panelen stängs, vid lägesbyte, ny region, startsidan (alla via
// uppdatera(), som glob-spel.js uppdateraHuvudstadslage anropar), när sidan
// göms (visibilitychange, pagehide) och vid varje fel. Igenkänningen
// startas om när den stannar av sig själv (tystnad i Chrome, iOS). Varje
// resultat (session:index) minns hur många ord som redan räknats: samma ord
// räknas aldrig två gånger och glider aldrig över till nästa flagga, men
// fortsätter man prata i samma andetag ("Sverige … Norge") räknas de nya
// orden mot nästa flagga. Ett namn som kan vara början på ett annat land
// (Guinea → Guinea-Bissau, Niger → Nigeria, Dominica → Dominikanska
// republiken) godkänns i ett delresultat först när inget mer ord kommit på
// en stund (installningar.fordroj).
// Reserven: saknas igenkänningen (Firefox) eller ger den not-allowed,
// service-not-allowed, audio-capture, network eller language-not-supported
// skriver man i stället (samma matchning, samma klocka, Enter skickar; ett
// exakt namn godkänns redan medan man skriver). Man kan också välja
// "Skriv i stället" före start.
//
// Matchningen (tolka, matcha) är rena funktioner: texten normaliseras
// (gemener, utan diakritiska tecken, bindestreck och & som mellanslag,
// fyllnadsord som "det är", "jag tror", "flaggan" bort) och viks fonetiskt
// (c/k, z/s, w/v, y/i, dubbla bokstäver …). Varje ordfönster jämförs med
// varje lands namn i spelet och ALIAS nedan (en editeringsgräns som växer
// med längden; korta namn måste vara exakta). Fönstren väljs girigt efter
// längd × likhet, så "Guinea-Bissau" vinner över "Guinea". Ett svar räknas
// bara om flaggans land (eller dess tvilling, FLAGG_TVILLINGAR) är BÄST
// bland alla länder i spelet: "Guinea" är fel för Guinea-Bissau, "Niger"
// för Nigeria, "Sudan" för Sydsudan, och "Kongo" är medvetet tvetydigt
// (båda Kongo lika bra = inget av dem). sjalvkontroll() prövar att varje
// lands namn och alias bara matchar landet självt (regress.mjs v113).
//
// Klassiska skript delar toppnivåns let/const, så glob-spel.js namn används
// direkt (som i flaggtavla.js). Byter något av dem namn eller form: kör hela
// test/regress.mjs.
//   läge      COUNTRIES aktivByGid aktivSlug aktivRegionNamn HS_BAS currentMode
//             flagglage utforskaFlaggor aktivUtmaning seterraTarget seterraStartTime
//             seterraCorrect seterraWrong
//   funktioner flaggaKanSpelas flaggKod flaggSrc FLAGG_ISO FLAGG_TVILLINGAR
//             FLAGG_FORM shuffle escHtml spela updateSeterraTimer headerHint
//             WORLD_SLUGS loadRegionConfig buildCountries
// Det enda som syns utåt är window.flaggblixt (glob-spel.js anropar
// uppdatera() med ?.):
//   uppdatera()        läge, val, region eller länder har ändrats
//   oppna(kalla)       öppnar Flaggblixt (introt)
//   stang()            stänger (mikrofonen av)
//   tolka/matcha/matchaKod/normalisera/sjalvkontroll   matchningen (testerna)
//   installningar      { tid, nedrakning, steg, fordroj } (testerna kortar rundan)
//   lage()             tillståndet för testerna
window.flaggblixt = (() => {
  // engelska sajten och USA har inga flaggor (filen laddas inte ens där)
  if (typeof SPRAK === 'undefined' || SPRAK.lang !== 'sv') return null;

  const installningar = {
    tid: 60000,          // rundans längd (ms)
    nedrakning: 3,       // 3-2-1 innan första flaggan (0 = direkt)
    steg: 450,           // ms per siffra i nedräkningen
    fordroj: 450,        // ms innan ett delresultat som kan bli ett längre land godkänns
    forst: null,         // (testerna) namn som ska komma först, i den ordningen
  };

  // ══════════════════════════════════════════════════════════════════
  // Matchningen
  // ══════════════════════════════════════════════════════════════════
  // Fler namn per flaggkod (FLAGG_ISO ger redan spelets namn och några
  // gamla: Makedonien, Vitryssland). Vanliga andra namn, äldre namn och
  // stavningar som igenkänningen skriver. Stavningsvarianter som bara
  // skiljer i c/k, z/s, w/v, y/i eller dubbla bokstäver behövs inte (vik).
  const ALIAS = {
    NL: ['Holland'],
    MM: ['Myanmar'],
    MK: ['Norra Makedonien'],
    CI: ["Côte d'Ivoire", 'Elfenbenskust'],
    CZ: ['Tjeckiska republiken'],
    GB: ['Storbritannien', 'Förenade kungariket', 'Förenade konungariket', 'Britannien', 'UK',
      'Great Britain', 'Union Jack'],
    US: ['Förenta staterna', 'Amerikas förenta stater', 'Amerika', 'U S A'],
    KR: ['Korea', 'Republiken Korea'],
    KP: ['Demokratiska folkrepubliken Korea'],
    CD: ['Kongo-Kinshasa', 'Kinshasa-Kongo', 'DR Kongo', 'Demokratiska Kongo', 'Zaire'],
    CG: ['Republiken Kongo', 'Brazzaville-Kongo'],
    TL: ['Timor-Leste', 'Timor', 'Östra Timor'],
    SZ: ['Swaziland'],
    BA: ['Bosnien', 'Bosnien och Hercegovina', 'Bosnien och Herzegovina'],
    KN: ['Saint Kitts', 'Sankt Kitts och Nevis', 'St Kitts och Nevis'],
    TT: ['Trinidad'],
    VA: ['Vatikanen'],
    AG: ['Antigua'],
    VC: ['Saint Vincent', 'Sankt Vincent och Grenadinerna', 'St Vincent och Grenadinerna'],
    LC: ['Sankta Lucia', 'Sankt Lucia', 'St Lucia'],
    ST: ['São Tomé och Príncipe', 'Sao Tome'],
    CF: ['Centralafrika'],
    DO: ['Dominikanska'],
    AE: ['Arabemiraten', 'Emiraten', 'Förenade arabiska emiraten'],
    PG: ['Papua', 'Nya Guinea'],
    MZ: ['Moçambique', 'Mosambik'],
    CV: ['Kapverde', 'Kapverdeöarna', 'Cabo Verde'],
    SB: ['Salomonöarna'],
    FM: ['Mikronesiens federerade stater'],
    SA: ['Saudi', 'Saudi-Arabien'],
    KG: ['Kirgizien'],
    LU: ['Luxemburg'],
    CO: ['Columbia'],
    PH: ['Filipinerna'],
    GF: ['Guyane'],
    EH: ['Sahara'],
    TR: ['Türkiye'],
    TD: ['Tjad'],
    BF: ['Burkina'],
    IE: ['Eire'],
    BN: ['Brunei Darussalam'],
  };
  // Medvetet tvetydiga ord: alla koderna är lika bra, så inget av dem räknas
  // ("Vilket Kongo?"). De ingår inte i sjalvkontroll (de ska ju krocka).
  const TVETYDIGA = { Kongo: ['CD', 'CG'] };
  // Hoppa över med rösten
  const HOPPA = 'HOPPA';
  const HOPPORD = ['pass', 'passar', 'nästa', 'hoppa', 'hoppa över', 'skippa', 'skip', 'vet inte', 'vet ej',
    'ingen aning'];
  // Ord som inte är ett svar (tas bort före matchningen)
  const FYLL = new Set(['det', 'där', 'den', 'denna', 'detta', 'är', 'e', 'va', 'var', 'vad', 'jag', 'tror',
    'tänker', 'att', 'kanske', 'nog', 'väl', 'ju', 'typ', 'alltså', 'ehm', 'eh', 'öh', 'äh', 'ah', 'hm',
    'hmm', 'mm', 'mhm', 'um', 'öhm', 'ähm', 'flaggan', 'flagga', 'flaggor', 'flaggorna', 'landet', 'heter',
    'nej', 'ja', 'jo', 'okej', 'ok', 'från', 'för', 'tillhör', 'som', 'eller', 'men', 'vänta', 'nu', 'så',
    'ett', 'en']);

  // fonetisk vikning av ETT ord (gemener, utan fyllnadsord)
  function vik(s) {
    s = s.replace(/ç/g, 's').replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/ø/g, 'o')
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
    return s.replace(/sch/g, 'sj').replace(/tch/g, 'tj').replace(/ch/g, 'tj')
      .replace(/ph/g, 'f').replace(/th/g, 't').replace(/qu/g, 'k').replace(/q/g, 'k')
      .replace(/ck/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k')
      .replace(/w/g, 'v').replace(/z/g, 's').replace(/x/g, 'ks').replace(/y/g, 'i')
      .replace(/[^a-z0-9]/g, '').replace(/(.)\1+/g, '$1');
  }
  // texten → ord: [{ t: vikt ord, w: index i de råa orden }] och de råa orden
  // (så att "Jag hörde" kan visa just det som inte räknats än)
  function ord(text) {
    const ra = String(text == null ? '' : text).trim().split(/\s+/).filter(Boolean);
    const ut = [];
    ra.forEach((w, i) => {
      for (const b of w.toLocaleLowerCase('sv').replace(/[&+]/g, ' och ').split(/[^\p{L}\p{N}]+/u)) {
        if (!b || FYLL.has(b)) continue;
        const f = vik(b);
        if (f) ut.push({ t: f, w: i });
      }
    });
    return { ut, ra };
  }
  const normalisera = text => ord(text).ut.map(o => o.t).join(' ');

  // Damerau (optimal string alignment) med tak: > max betyder "för långt bort"
  function avstand(a, b, max) {
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    let p2 = null, p1 = new Array(lb + 1), cur = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) p1[j] = j;
    for (let i = 1; i <= la; i++) {
      cur[0] = i;
      let min = i;
      const ca = a.charCodeAt(i - 1);
      for (let j = 1; j <= lb; j++) {
        const cb = b.charCodeAt(j - 1);
        let v = Math.min(p1[j] + 1, cur[j - 1] + 1, p1[j - 1] + (ca === cb ? 0 : 1));
        if (p2 && j > 1 && ca === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === cb) v = Math.min(v, p2[j - 2] + 1);
        cur[j] = v;
        if (v < min) min = v;
      }
      if (min > max) return max + 1;
      const t = p2 || new Array(lb + 1);
      p2 = p1; p1 = cur; cur = t;
    }
    return p1[lb];
  }
  // hur många fel ett namn av längden L tål (korta namn: inga alls)
  const tal = L => L <= 4 ? 0 : L <= 6 ? 1 : L <= 10 ? 2 : 3;
  const MAXORD = 5;              // längsta namnet i ord (Sankt Vincent och Grenadinerna)

  // tabellen: [{ kod, f (vikta ord ihop), namn, alias }], byggs första gången
  let tabell = null, riskabla = null, tvetydigaVikta = null;
  const tvilling = (a, b) => a !== b && FLAGG_TVILLINGAR.some(p => p.includes(a) && p.includes(b));
  function byggTabell() {
    if (tabell) return;
    tabell = [];
    const sedda = new Set();
    const lagg = (kod, namn, alias) => {
      const f = ord(namn).ut.map(o => o.t).join('');
      if (!f || sedda.has(kod + ':' + f)) return;
      sedda.add(kod + ':' + f);
      tabell.push({ kod, f, namn, alias });
    };
    for (const [namn, kod] of Object.entries(FLAGG_ISO)) lagg(kod, namn, false);
    for (const [kod, lista] of Object.entries(ALIAS)) for (const n of lista) lagg(kod, n, true);
    for (const [n, koder] of Object.entries(TVETYDIGA)) for (const kod of koder) lagg(kod, n, 'tvetydig');
    for (const n of HOPPORD) lagg(HOPPA, n, false);
    tvetydigaVikta = new Set(Object.keys(TVETYDIGA).map(n => ord(n).ut.map(o => o.t).join('')));
    // ett namn som är början på ett annat lands namn (Guinea → Guinea-Bissau)
    riskabla = new Set();
    for (const a of tabell) {
      if (a.alias === 'tvetydig') continue;
      for (const b of tabell) {
        if (b.kod !== a.kod && !tvilling(a.kod, b.kod) && b.f.length > a.f.length && b.f.startsWith(a.f)) riskabla.add(a.kod);
      }
    }
  }
  // bästa koderna för en vikt sträng: { koder, sim } eller null
  function bast(s) {
    let sim = 0, koder = [];
    for (const e of tabell) {
      const L = Math.max(s.length, e.f.length), max = tal(L);
      if (Math.abs(s.length - e.f.length) > max) continue;
      const d = avstand(s, e.f, max);
      if (d > max) continue;
      const v = 1 - d / L;
      if (v > sim + 1e-9) { sim = v; koder = [e.kod]; }
      else if (Math.abs(v - sim) <= 1e-9 && !koder.includes(e.kod)) koder.push(e.kod);
    }
    return koder.length ? { koder, sim } : null;
  }
  // Tolkningarna av en följd vikta ord, i ordning: [{ kod, koder, tvetydig,
  // i, j (orden i..j-1), sim }]. Fönstren väljs girigt efter längd × likhet
  // (så "guinea bissau" blir ETT land, inte Guinea + ett ord över), och ett
  // fönster där två länder (som inte är tvillingar) är lika bra är tvetydigt.
  function tolkaOrd(t) {
    byggTabell();
    const kand = [];
    for (let i = 0; i < t.length; i++) {
      let s = '';
      for (let j = i; j < Math.min(t.length, i + MAXORD); j++) {
        s += t[j];
        const b = bast(s);
        if (!b) continue;
        const grupp = b.koder.every(k => k === b.koder[0] || tvilling(k, b.koder[0]));
        kand.push({ kod: b.koder[0], koder: b.koder, tvetydig: !grupp, i, j: j + 1, sim: b.sim,
          vikt: b.sim * s.length, s });
      }
    }
    kand.sort((a, b) => b.vikt - a.vikt || b.sim - a.sim || a.i - b.i);
    const tagen = [], ut = [];
    for (const k of kand) {
      let fri = true;
      for (let x = k.i; x < k.j; x++) if (tagen[x]) { fri = false; break; }
      if (!fri) continue;
      for (let x = k.i; x < k.j; x++) tagen[x] = true;
      ut.push(k);
    }
    return ut.sort((a, b) => a.i - b.i);
  }
  const tolka = text => tolkaOrd(ord(text).ut.map(o => o.t));
  // rätt för flaggan med koden kod? (landet självt eller tvillingen)
  const rattFor = (k, kod) => !k.tvetydig && k.kod !== HOPPA && (k.kod === kod || tvilling(k.kod, kod));
  function matchaKod(text, kod) {
    return tolka(text).some(k => rattFor(k, kod));
  }
  function matcha(text, gid) {
    const c = aktivByGid.get(gid) || pool.find(x => x.gid === gid);
    const kod = c && flaggKod(c);
    return !!kod && matchaKod(text, kod);
  }
  // varje lands namn och alias ska bara peka på landet självt (eller
  // tvillingen), hela vägen, och aldrig vara ett hoppord: [fel]
  function sjalvkontroll() {
    byggTabell();
    const fel = [];
    for (const e of tabell) {
      if (e.alias === 'tvetydig') continue;
      const t = tolka(e.namn);
      const ok = t.length === 1 && t[0].i === 0 && !t[0].tvetydig
        && (t[0].kod === e.kod || (e.kod !== HOPPA && tvilling(t[0].kod, e.kod)))
        && t[0].j === ord(e.namn).ut.length;
      if (!ok) fel.push(`${e.namn} (${e.kod}) → ${t.map(k => (k.tvetydig ? '?' : '') + k.koder.join('/')).join(' + ') || 'inget'}`);
    }
    return fel;
  }

  // ══════════════════════════════════════════════════════════════════
  // Utseendet (bara den här sajten: stilen följer med filen)
  // ══════════════════════════════════════════════════════════════════
  const stil = document.createElement('style');
  stil.textContent = `
.blixt-ingang { display: inline-block; margin: 0; text-align: center;
  padding: 7px 14px; border-radius: 10px; border: 1px solid rgba(120, 220, 190, .5);
  background: #10292b; color: #9ff3d6; font: inherit; font-weight: 800; font-size: .85rem;
  line-height: 1.2; white-space: nowrap; cursor: pointer; }
.blixt-ingang:hover { background: #163a3b; }
.blixt-ingang:focus-visible, .blixt-knapp:focus-visible, .blixt-stang:focus-visible { outline: 3px solid #9fd8c6; outline-offset: 2px; }
.blixt-ingang[hidden] { display: none; }
#blixt-startrad { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin: 0 auto 10px; }
body.flaggtavla #seterra-game > #blixt-startrad { order: 2; margin: 0 auto; }
#blixt-startrad[hidden] { display: none; }
#blixt-startrad > .topplista-knapp { margin: 0; }
#blixt-klar-knapp { margin: 10px auto 0; }
.blixt-utforska { margin-top: 14px; display: flex; flex-direction: column; align-items: center; gap: 6px;
  color: #8fb1cc; font-size: .85rem; }
.blixt-utforska[hidden] { display: none; }
@media (max-width: 900px) and (max-height: 699.98px) { .blixt-utforska { display: none; } }
@media (max-width: 359.98px) { .blixt-ingang .blixt-lang { display: none; } }
/* smala telefoner: raden får inte gå in under ?-knappen till vänster */
@media (max-width: 400px) {
  #blixt-startrad { gap: 6px; }
  #blixt-startrad > .topplista-knapp, #blixt-startrad > .blixt-ingang { padding: 6px 10px; font-size: .8rem; }
}

#flaggblixt { position: fixed; left: 0; right: 0; top: var(--blixt-topp, 0px); height: var(--blixt-hojd, auto);
  bottom: var(--blixt-botten, 0px); z-index: 70; display: flex; justify-content: center; overflow: hidden;
  background: radial-gradient(ellipse at 50% 0%, #17365a 0%, #0c1a2e 55%, #08111f 100%);
  color: #e6eef7; }
#flaggblixt[hidden] { display: none; }
body.blixt-pa .cursor-label { visibility: hidden !important; }
.blixt-ram { position: relative; width: 100%; max-width: 760px; height: 100%; display: flex; flex-direction: column;
  padding: 12px 16px 14px; }
.blixt-del { display: none; flex: 1 1 auto; min-height: 0; flex-direction: column; }
#flaggblixt[data-lage="intro"] .blixt-intro, #flaggblixt[data-lage="slut"] .blixt-slut { display: flex; }
#flaggblixt[data-lage="vantar"] .blixt-spel, #flaggblixt[data-lage="nedrakning"] .blixt-spel,
#flaggblixt[data-lage="spelar"] .blixt-spel { display: flex; }
.blixt-stang { position: absolute; top: 8px; right: 10px; z-index: 3; width: 40px; height: 40px; border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, .18); background: rgba(255, 255, 255, .06); color: #cfe3f4;
  font-size: 1.1rem; line-height: 1; cursor: pointer; }
.blixt-stang:hover { background: rgba(255, 255, 255, .14); }
.blixt-knapp { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px;
  padding: 10px 22px; border-radius: 12px; border: 1px solid rgba(255, 255, 255, .22);
  background: rgba(255, 255, 255, .06); color: #e6eef7; font: inherit; font-weight: 700; font-size: .95rem;
  cursor: pointer; }
.blixt-knapp:hover { background: rgba(255, 255, 255, .12); }
.blixt-knapp[hidden] { display: none; }
.blixt-knapp.blixt-gron { border: none; background: linear-gradient(135deg, #27ae60, #2ecc71); color: #fff;
  font-size: 1.1rem; padding: 12px 34px; box-shadow: 0 6px 18px rgba(39, 174, 96, .35); }
.blixt-knapp.blixt-gron:hover { filter: brightness(1.08); }

/* introt */
.blixt-intro { align-items: center; justify-content: center; text-align: center; gap: 12px; overflow-y: auto;
  padding: 8px 0; }
.blixt-intro h2, .blixt-slut h2 { font-size: 1.6rem; color: #fff; letter-spacing: .01em; }
.blixt-region { display: block; margin-top: 2px; font-size: .95rem; font-weight: 600; color: #7fc4ff; }
.blixt-ingress { max-width: 30em; font-size: 1rem; line-height: 1.45; color: #cfe0f0; }
.blixt-rekordtext { font-size: .92rem; color: #ffdc32; font-weight: 700; min-height: 1.3em; }
.blixt-introknappar { display: flex; flex-direction: column; align-items: center; gap: 10px; margin-top: 4px; }
.blixt-integritet { max-width: 30em; font-size: .8rem; line-height: 1.4; color: #8fb1cc; }
.blixt-meddelande { max-width: 30em; font-size: .9rem; line-height: 1.4; color: #ffb37a; font-weight: 700; }
.blixt-meddelande:empty, .blixt-integritet[hidden] { display: none; }
.blixt-ingress, .blixt-integritet, .blixt-meddelande { text-wrap: balance; }   /* inget ensamt sista ord */

/* spelet */
.blixt-spel { gap: 8px; }
.blixt-status { flex: none; display: flex; align-items: center; gap: 14px; padding-right: 50px; min-height: 40px; }
.blixt-klocka { flex: 1; display: flex; align-items: center; gap: 10px; min-width: 0; }
.blixt-tid { font-size: 1.5rem; font-weight: 800; font-variant-numeric: tabular-nums; min-width: 3.1ch; color: #fff; }
.blixt-tid.snart { color: #ffb347; }
.blixt-tid.sist { color: #ff6b6b; }
.blixt-bar { flex: 1; height: 8px; border-radius: 99px; background: rgba(255, 255, 255, .12); overflow: hidden; }
.blixt-bar i { display: block; height: 100%; width: 100%; border-radius: inherit; background: linear-gradient(90deg, #2ecc71, #7be0a8);
  transform-origin: left center; transition: transform .1s linear; }
.blixt-tid.snart + .blixt-bar i { background: #ffb347; }
.blixt-tid.sist + .blixt-bar i { background: #ff6b6b; }
.blixt-poang { flex: none; font-size: 1.5rem; font-weight: 800; color: #4ade80; font-variant-numeric: tabular-nums; }
.blixt-poang b { display: inline-block; min-width: 1.2ch; }
.blixt-poang.puls b { animation: blixt-puls .35s ease-out; }
@keyframes blixt-puls { 0% { transform: scale(1.5); } 100% { transform: scale(1); } }
/* scenen växer till flaggans största storlek; luften över det delas lika
   över och under (marginalerna), så att knapparna står nära flaggan */
.blixt-scen { position: relative; flex: 1 1 auto; min-height: 110px; max-height: calc(min(100vw - 24px, 600px) / 1.5 + 64px);
  margin-top: auto; display: flex; align-items: center; justify-content: center; }
.blixt-kort { position: relative; width: var(--fw, 300px); height: var(--fh, 200px); }
.blixt-flagga { position: absolute; inset: 0; width: 100%; height: 100%; display: block; border-radius: 6px;
  background: #fff; box-shadow: 0 0 0 1px rgba(255, 255, 255, .2), 0 18px 44px rgba(0, 0, 0, .55);
  user-select: none; -webkit-user-drag: none; }
.blixt-kort.vimpel .blixt-flagga { background: none; box-shadow: none; border-radius: 0;
  filter: drop-shadow(0 12px 22px rgba(0, 0, 0, .55)); }
.blixt-kort[data-tom] .blixt-flagga { visibility: hidden; }
.blixt-vantruta { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 8px; border-radius: 10px; border: 2px dashed rgba(127, 196, 255, .35);
  color: #9fc6e8; text-align: center; padding: 12px; font-size: .95rem; line-height: 1.4; }
.blixt-vantruta b { font-size: 2.2rem; line-height: 1; }
.blixt-kort:not([data-tom]) .blixt-vantruta { display: none; }
#flaggblixt[data-lage="nedrakning"] .blixt-vantruta > * { visibility: hidden; }
.blixt-kort.fel .blixt-flagga { box-shadow: 0 0 0 4px #ff5b5b, 0 18px 44px rgba(0, 0, 0, .55); }
.blixt-kort.fel { animation: blixt-skak .38s ease; }
@keyframes blixt-skak { 20% { transform: translateX(-9px); } 40% { transform: translateX(8px); }
  60% { transform: translateX(-5px); } 80% { transform: translateX(3px); } }
.blixt-mark { position: absolute; top: -16px; right: -16px; width: 46px; height: 46px; border-radius: 50%;
  display: none; align-items: center; justify-content: center; font-size: 1.6rem; font-weight: 900; color: #fff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, .45); }
.blixt-kort.fel .blixt-mark { display: flex; background: #e04848; }
.blixt-splash { position: absolute; inset: 0; display: none; align-items: center; justify-content: center;
  font-size: clamp(3rem, 14vmin, 7rem); font-weight: 900; color: #fff; text-shadow: 0 6px 24px rgba(0, 0, 0, .6);
  pointer-events: none; }
.blixt-splash.syns { display: flex; }
.blixt-splash > span { display: inline-block; }
.blixt-splash.syns > span { animation: blixt-pop .45s ease-out; }   /* bara texten växer: inget sticker ut i sidled */
@keyframes blixt-pop { 0% { transform: scale(1.6); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
.blixt-svarrad { flex: none; height: 38px; display: flex; align-items: center; justify-content: center; }
.blixt-svar { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; padding: 5px 14px 5px 8px;
  border-radius: 999px; font-weight: 800; font-size: 1.05rem; white-space: nowrap; overflow: hidden;
  opacity: 0; transition: opacity .25s; }
.blixt-svar.syns { opacity: 1; transition: none; }
.blixt-svar.ratt { background: #1f8a45; color: #fff; }
.blixt-svar.hoppad { background: rgba(255, 255, 255, .14); color: #e6eef7; font-weight: 700; }
.blixt-svar img { height: 22px; width: auto; border-radius: 2px; flex: none; }
.blixt-svar span { overflow: hidden; text-overflow: ellipsis; }
.blixt-hort { flex: none; height: 1.4em; font-size: .9rem; color: #9fbad3; text-align: center; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.blixt-hort.fel { color: #ff8a8a; font-weight: 700; }
.blixt-mik { flex: none; height: 1.4em; display: flex; align-items: center; justify-content: center; gap: 8px;
  font-size: .85rem; color: #8fb1cc; }
.blixt-mik i { width: 10px; height: 10px; border-radius: 50%; background: #64748b; }
.blixt-mik.pa i { background: #ff4d5e; box-shadow: 0 0 0 0 rgba(255, 77, 94, .6); animation: blixt-lyssna 1.4s infinite; }
@keyframes blixt-lyssna { 0% { box-shadow: 0 0 0 0 rgba(255, 77, 94, .55); } 100% { box-shadow: 0 0 0 10px rgba(255, 77, 94, 0); } }
.blixt-skriv { flex: none; display: none; gap: 8px; width: 100%; max-width: 440px; margin: 0 auto; }
#flaggblixt[data-satt="skriv"] .blixt-skriv { display: flex; }
#flaggblixt[data-satt="skriv"] .blixt-mik { display: none; }
.blixt-skriv input { flex: 1; min-width: 0; height: 46px; padding: 0 14px; border-radius: 12px;
  border: 2px solid rgba(127, 196, 255, .45); background: #0a1526; color: #fff; font: inherit; font-size: 1.1rem; }
.blixt-skriv input:focus { outline: none; border-color: #7fc4ff; box-shadow: 0 0 0 3px rgba(127, 196, 255, .25); }
.blixt-skriv .blixt-knapp { min-width: 64px; padding: 0 14px; }
.blixt-nedre { flex: none; display: flex; justify-content: center; margin-bottom: auto; }
#flaggblixt:not([data-lage="spelar"]) .blixt-hoppa { opacity: .4; pointer-events: none; }

/* slutet */
.blixt-slut { align-items: center; gap: 10px; overflow-y: auto; padding: 4px 0 6px; text-align: center; }
.blixt-slutrubrik { font-size: 1rem; font-weight: 700; color: #9fc6e8; padding-right: 0; margin-top: 4px; }
.blixt-resultat { font-size: 1.25rem; color: #e6eef7; }
.blixt-resultat b { display: block; font-size: clamp(2.6rem, 10vmin, 4rem); line-height: 1.05; color: #4ade80; }
.blixt-rekordrad { font-size: .98rem; font-weight: 800; color: #ffdc32; }
.blixt-rekordrad.nytt { font-size: 1.15rem; }
.blixt-avbruten { font-size: .9rem; color: #ffb37a; font-weight: 700; }
.blixt-avbruten:empty { display: none; }
.blixt-slutknappar { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin: 4px 0 6px; }
.blixt-lista { list-style: none; width: 100%; max-width: 520px; display: flex; flex-direction: column; gap: 4px;
  text-align: left; }
.blixt-lista li { display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; align-items: center; gap: 10px;
  padding: 5px 10px; border-radius: 10px; background: rgba(255, 255, 255, .05); }
.blixt-lista img { width: 42px; height: 28px; object-fit: contain; border-radius: 2px; }
.blixt-lista .blixt-ln { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.blixt-lista .blixt-ln small { display: block; font-weight: 600; font-size: .78rem; color: #ff9c9c; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.blixt-lista .blixt-st { font-size: .8rem; font-weight: 800; padding: 3px 9px; border-radius: 999px; white-space: nowrap; }
.blixt-lista li.ratt .blixt-st { background: rgba(46, 204, 113, .18); color: #6ee7a0; }
.blixt-lista li.fel .blixt-st { background: rgba(255, 91, 91, .16); color: #ff9c9c; }
.blixt-lista li.hoppad .blixt-st, .blixt-lista li.slut .blixt-st { background: rgba(255, 255, 255, .1); color: #c9d6e3; }
.blixt-dold { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%);
  white-space: nowrap; }
@media (max-width: 480px) {
  .blixt-ram { padding: 8px 12px 10px; }
  .blixt-status { gap: 10px; }
  .blixt-tid, .blixt-poang { font-size: 1.3rem; }
  .blixt-intro h2, .blixt-slut h2 { font-size: 1.35rem; }
  .blixt-ingress { font-size: .92rem; }
  .blixt-mark { top: -12px; right: -10px; width: 38px; height: 38px; font-size: 1.3rem; }
}
@media (max-height: 520px) {
  .blixt-intro { gap: 8px; }
  .blixt-knapp.blixt-gron { padding: 10px 28px; }
}
@media (prefers-reduced-motion: reduce) {
  .blixt-kort.fel, .blixt-splash.syns > span, .blixt-poang.puls b { animation: none; }
  .blixt-mik.pa i { animation: none; box-shadow: 0 0 0 3px rgba(255, 77, 94, .35); }
  .blixt-bar i, .blixt-svar { transition: none; }
}`;
  stil.id = 'flaggblixt-stil';     // (alla regler gäller bara blixt-: spelets egna fb- är svarets)
  document.head.appendChild(stil);

  const el = (tag, klass, html) => {
    const e = document.createElement(tag);
    if (klass) e.className = klass;
    if (html != null) e.innerHTML = html;
    return e;
  };
  const MIK = '🎤';

  // ── lagret ──
  const rot = el('div');
  rot.id = 'flaggblixt';
  rot.lang = 'sv';
  rot.hidden = true;
  rot.setAttribute('role', 'region');
  rot.setAttribute('aria-label', 'Flaggblixt');
  rot.dataset.lage = 'intro';
  rot.dataset.satt = 'rost';
  rot.innerHTML = `
<div class="blixt-ram">
  <button type="button" class="blixt-stang" aria-label="Stäng Flaggblixt" title="Stäng">✕</button>
  <div class="blixt-del blixt-intro">
    <h2 id="blixt-rubrik">${MIK} Flaggblixt<span class="blixt-region"></span></h2>
    <p class="blixt-ingress">En flagga i taget: säg vilket land den tillhör, så snabbt du kan.
      Du har <b>en minut</b> – hur många hinner du?</p>
    <div class="blixt-rekordtext"></div>
    <div class="blixt-introknappar">
      <button type="button" class="blixt-knapp blixt-gron blixt-starta">${MIK} Starta</button>
      <button type="button" class="blixt-knapp blixt-skrivval">⌨️ Skriv i stället</button>
    </div>
    <p class="blixt-meddelande" role="status"></p>
    <p class="blixt-integritet">Mikrofonen lyssnar bara medan klockan går. I Chrome tolkar Google rösten – inget ljud sparas här.</p>
  </div>
  <div class="blixt-del blixt-spel">
    <div class="blixt-status">
      <div class="blixt-klocka"><span class="blixt-tid" role="timer" aria-label="Tid kvar">1:00</span><span class="blixt-bar" aria-hidden="true"><i></i></span></div>
      <div class="blixt-poang" aria-label="Rätt">✓ <b>0</b></div>
    </div>
    <div class="blixt-scen">
      <div class="blixt-kort" data-tom>
        <img class="blixt-flagga" alt="Flagga – vilket land?" draggable="false">
        <div class="blixt-mark" aria-hidden="true">✗</div>
        <div class="blixt-vantruta"><b>${MIK}</b><span class="blixt-vanttext"></span></div>
      </div>
      <div class="blixt-splash" aria-hidden="true"></div>
    </div>
    <div class="blixt-svarrad"><div class="blixt-svar" aria-hidden="true"></div></div>
    <div class="blixt-hort" aria-hidden="true"></div>
    <div class="blixt-mik"><i></i><span class="blixt-miktext"></span></div>
    <form class="blixt-skriv" autocomplete="off">
      <input type="text" aria-label="Landets namn" placeholder="Skriv landets namn …" autocomplete="off"
        autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go">
      <button type="submit" class="blixt-knapp">OK</button>
    </form>
    <div class="blixt-nedre"><button type="button" class="blixt-knapp blixt-hoppa">Hoppa över ⏭</button></div>
  </div>
  <div class="blixt-del blixt-slut">
    <div class="blixt-slutrubrik"></div>
    <div class="blixt-resultat"></div>
    <div class="blixt-rekordrad"></div>
    <div class="blixt-avbruten"></div>
    <div class="blixt-slutknappar">
      <button type="button" class="blixt-knapp blixt-gron blixt-igen">Spela igen</button>
      <button type="button" class="blixt-knapp blixt-tillbaka">Tillbaka</button>
    </div>
    <ol class="blixt-lista" aria-label="Rundans flaggor"></ol>
  </div>
  <div class="blixt-dold blixt-live" aria-live="polite" aria-atomic="true"></div>
</div>`;
  document.body.appendChild(rot);
  const $ = s => rot.querySelector(s);
  const ui = {
    stang: $('.blixt-stang'), region: $('.blixt-region'), rekordtext: $('.blixt-rekordtext'), starta: $('.blixt-starta'),
    skrivval: $('.blixt-skrivval'), meddelande: $('.blixt-meddelande'), integritet: $('.blixt-integritet'),
    tid: $('.blixt-tid'), bar: $('.blixt-bar i'), poang: $('.blixt-poang'), poangTal: $('.blixt-poang b'),
    scen: $('.blixt-scen'), kort: $('.blixt-kort'), flagga: $('.blixt-flagga'), vanttext: $('.blixt-vanttext'),
    splash: $('.blixt-splash'), svar: $('.blixt-svar'), hort: $('.blixt-hort'), mik: $('.blixt-mik'),
    miktext: $('.blixt-miktext'), form: $('.blixt-skriv'), input: $('.blixt-skriv input'), hoppa: $('.blixt-hoppa'),
    slutrubrik: $('.blixt-slutrubrik'), resultat: $('.blixt-resultat'), rekordrad: $('.blixt-rekordrad'),
    avbruten: $('.blixt-avbruten'), igen: $('.blixt-igen'), tillbaka: $('.blixt-tillbaka'), lista: $('.blixt-lista'),
    live: $('.blixt-live'),
  };

  // ── ingångarna ──
  const knappHtml = `${MIK} Flaggblixt<span class="blixt-lang">&nbsp;– 1&nbsp;minut</span>`;
  const ingang = (id, kalla) => {
    const b = el('button', 'blixt-ingang', knappHtml);
    b.type = 'button';
    b.id = id;
    b.title = 'Säg flaggornas länder på en minut';
    b.setAttribute('aria-label', 'Flaggblixt: säg flaggornas länder på en minut');
    b.addEventListener('click', () => oppna(kalla));
    return b;
  };
  const spelRuta = document.getElementById('seterra-game');
  const topplista = document.getElementById('topplista-knapp');
  const topplistaPlats = document.createComment('topplista-knapp');
  if (topplista) topplista.before(topplistaPlats);
  const startrad = el('div');
  startrad.id = 'blixt-startrad';
  startrad.hidden = true;
  const quizKnapp = ingang('blixt-quiz-knapp', 'quiz');
  startrad.appendChild(quizKnapp);
  if (spelRuta) spelRuta.appendChild(startrad);
  const klarKnapp = ingang('blixt-klar-knapp', 'klar');
  klarKnapp.hidden = true;
  document.getElementById('seterra-restart')?.after(klarKnapp);
  const utfRad = el('div', 'blixt-utforska');
  utfRad.hidden = true;
  utfRad.appendChild(el('span', '', 'Kan du dem redan?'));
  const utfKnapp = ingang('blixt-utforska-knapp', 'utforska');
  utfRad.appendChild(utfKnapp);
  document.getElementById('info-default')?.appendChild(utfRad);
  // Topplista och Flaggblixt i en rad (flaggläget); annars står Topplista
  // på sin vanliga plats
  function flyttaTopplista(iRaden) {
    if (!topplista) return;
    if (iRaden && topplista.parentNode !== startrad) startrad.insertBefore(topplista, quizKnapp);
    else if (!iRaden && topplista.parentNode === startrad) topplistaPlats.after(topplista);
  }

  const kanSpelas = () => SPRAK.lang === 'sv' && !aktivUtmaning && !!aktivSlug && aktivSlug !== 'usa'
    && !document.body.classList.contains('startlage') && flaggaKanSpelas();

  // ══════════════════════════════════════════════════════════════════
  // Tillståndet
  // ══════════════════════════════════════════════════════════════════
  let lage = 'stangd';           // 'stangd' | 'intro' | 'vantar' | 'nedrakning' | 'spelar' | 'slut'
  let satt = 'rost';             // 'rost' | 'skriv'
  let valdSatt = null;           // spelarens val i introt ('skriv'), annars rösten om den finns
  let rostTrasig = '';           // varför rösten inte gick förra gången (den här sidvisningen)
  let kontext = null;            // { mode, slug, lander } när panelen öppnades
  let kalla = 'quiz';
  let pool = [];                 // rundans möjliga länder
  let runda = null;              // { lista, i, poang, resultat, slut, start, sagda, gen }
  let timer = 0, nedTimer = 0, svarTimer = 0, felTimer = 0;
  let pausFran = null;           // quizens klocka väntar, om quizet inte börjat (inga svar än)
  let fokusFore = null;
  let hintFore = null;
  const HINT = 'Flaggblixt – hur många flaggor på en minut?';
  const SR = () => window.SpeechRecognition || window.webkitSpeechRecognition || null;

  const regionNamn = () => aktivSlug === 'world' ? 'Hela världen' : (aktivRegionNamn || '');
  const rekordNyckel = () => SPRAK.hsPrefix + 'flaggblixt-'
    + (aktivSlug === 'world' ? 'glob-world-highscores-alla' : HS_BAS);
  function lasRekord() {
    try { return JSON.parse(localStorage.getItem(rekordNyckel())) || null; } catch (e) { return null; }
  }
  const fmt = ms => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  const sag = text => { ui.live.textContent = ''; requestAnimationFrame(() => { ui.live.textContent = text; }); };

  // ── uppdatera(): ingångarna, och stäng om läget eller regionen bytts ──
  function uppdatera() {
    const kan = kanSpelas();
    const quiz = kan && currentMode !== 'explore' && flagglage;
    startrad.hidden = !quiz;
    flyttaTopplista(quiz);
    klarKnapp.hidden = !quiz;
    utfRad.hidden = !(kan && currentMode === 'explore' && utforskaFlaggor);
    if (lage !== 'stangd' && kontext && (!kan || kontext.mode !== currentMode || kontext.slug !== aktivSlug
      || kontext.lander !== COUNTRIES)) stang();
  }

  // ══════════════════════════════════════════════════════════════════
  // Öppna och stänga
  // ══════════════════════════════════════════════════════════════════
  function oppna(fran) {
    if (!kanSpelas()) return;
    kalla = fran || 'quiz';
    kontext = { mode: currentMode, slug: aktivSlug, lander: COUNTRIES };
    fokusFore = document.activeElement;
    // Quizens klocka: har spelaren inte svarat på något än väntar den (som
    // att börja om quizet). Mitt i ett quiz går den vidare, som med videon
    // (v109): topplistan går på tid, och Flaggblixt visar namnen till flaggorna.
    pausFran = currentMode !== 'explore' && seterraTarget && !seterraCorrect && !seterraWrong
      ? { t: Date.now(), start: seterraStartTime } : null;
    rot.hidden = false;
    document.body.classList.add('blixt-pa');
    document.querySelector('.game-container')?.setAttribute('inert', '');
    hintFore = headerHint.textContent;
    headerHint.textContent = HINT;
    matt();
    byggPool();
    visaIntro('');
    window.kakSpara?.('flaggblixt_oppna', { region: regionKod(), fran: kalla });
    setTimeout(() => { if (lage === 'intro') ui.starta.focus(); }, 0);
  }
  function stang() {
    if (lage === 'stangd') return;
    stoppa();
    lage = 'stangd';
    rot.hidden = true;
    rot.dataset.lage = 'intro';
    document.body.classList.remove('blixt-pa');
    document.querySelector('.game-container')?.removeAttribute('inert');
    if (hintFore != null && headerHint.textContent === HINT) headerHint.textContent = hintFore;
    hintFore = null;
    if (pausFran && seterraTarget && seterraStartTime === pausFran.start && !seterraCorrect && !seterraWrong) {
      seterraStartTime += Date.now() - pausFran.t;
      updateSeterraTimer();
    }
    pausFran = null;
    kontext = null;
    const f = fokusFore;
    fokusFore = null;
    if (f && f.isConnected && f.offsetParent !== null) { try { f.focus({ preventScroll: true }); } catch (e) { /* */ } }
  }
  const regionKod = () => (aktivSlug === 'world' ? 'varlden' : aktivSlug) || 'varlden';

  // Rundans länder: regionens (delens), eller hela världens alla länder
  // (världstestets COUNTRIES är bara rundans urval). Konfigurationerna är
  // redan hämtade (startWorld), så det här går direkt.
  function byggPool() {
    pool = COUNTRIES.filter(c => flaggKod(c));
    if (aktivSlug !== 'world' || typeof WORLD_SLUGS === 'undefined') return;
    const slug = aktivSlug, lander = COUNTRIES;
    Promise.all(WORLD_SLUGS.map(s => loadRegionConfig(s).then(raw => buildCountries(s, raw)))).then(listor => {
      if (aktivSlug !== slug || COUNTRIES !== lander) return;
      const sedda = new Set(), alla = [];
      for (const l of listor) for (const c of l) if (!sedda.has(c.gid) && flaggKod(c)) { sedda.add(c.gid); alla.push(c); }
      if (alla.length > pool.length) pool = alla;
    }).catch(() => { /* rundans urval får räcka */ });
  }

  // ── storleken: flaggan så stor som scenen tillåter, utan hopp ──
  const forhallande = c => {
    const f = FLAGG_FORM[(flaggKod(c) || '').toLowerCase()];
    return f === 'kvadrat' ? 1 : f === 'vimpel' ? 281 / 341.333 : 1.5;
  };
  let aktuellForm = 1.5;
  function storlek() {
    const W = ui.scen.clientWidth, H = ui.scen.clientHeight;
    if (!W || !H) return;
    // högst 600 × 400 (3:2), och lite luft runt om för skuggan och ✗
    const r = aktuellForm, pad = W < 420 ? 6 : 16;
    const fw = Math.max(60, Math.floor(Math.min(W - pad * 2, (H - pad * 2) * r, 600, 400 * r)));
    ui.kort.style.setProperty('--fw', fw + 'px');
    ui.kort.style.setProperty('--fh', Math.floor(fw / r) + 'px');
  }
  // lagret börjar under sidhuvudet och slutar där tangentbordet börjar
  function matt() {
    // (datorns sidhuvud är fast: offsetParent är då alltid null)
    const h = document.querySelector('header');
    const hr = h && getComputedStyle(h).display !== 'none' ? h.getBoundingClientRect() : null;
    const topp = hr && hr.height > 0 ? Math.max(0, Math.round(hr.bottom)) : 0;
    rot.style.setProperty('--blixt-topp', topp + 'px');
    const vv = window.visualViewport;
    if (vv && vv.height < window.innerHeight - 40) {
      rot.style.setProperty('--blixt-hojd', Math.max(200, Math.round(vv.height + vv.offsetTop - topp)) + 'px');
      rot.style.setProperty('--blixt-botten', 'auto');
    } else {
      rot.style.removeProperty('--blixt-hojd');
      rot.style.removeProperty('--blixt-botten');
    }
    storlek();
  }
  if (window.ResizeObserver) {
    new ResizeObserver(() => { if (lage !== 'stangd') storlek(); }).observe(ui.scen);
    const h = document.querySelector('header');
    if (h) new ResizeObserver(() => { if (lage !== 'stangd') matt(); }).observe(h);
  }
  window.addEventListener('resize', () => { if (lage !== 'stangd') matt(); });
  window.visualViewport?.addEventListener('resize', () => { if (lage !== 'stangd') matt(); });

  // ══════════════════════════════════════════════════════════════════
  // Introt
  // ══════════════════════════════════════════════════════════════════
  function visaIntro(meddelande) {
    lage = 'intro';
    rot.dataset.lage = 'intro';
    ui.region.textContent = regionNamn();
    const r = lasRekord();
    ui.rekordtext.textContent = r && r.ratt > 0 ? `🏆 Ditt rekord här: ${r.ratt} rätt` : '';
    const harRost = !!SR() && !rostTrasig;
    const rost = harRost && valdSatt !== 'skriv';
    ui.starta.innerHTML = rost ? `${MIK} Starta` : '⌨️ Starta – skriv namnen';
    ui.skrivval.hidden = !rost;
    ui.integritet.hidden = !rost;
    // ett val tillbaka till rösten, om den finns
    ui.skrivval.innerHTML = '⌨️ Skriv i stället';
    let text = meddelande || '';
    if (!text && !SR()) text = 'Den här webbläsaren kan inte lyssna – skriv landets namn i stället.';
    if (!text && rostTrasig) text = rostTrasig;
    ui.meddelande.textContent = text;
    tillbakaRost.hidden = !(SR() && (rostTrasig || valdSatt === 'skriv'));
  }
  const tillbakaRost = el('button', 'blixt-knapp', `${MIK} Försök med rösten`);
  tillbakaRost.type = 'button';
  tillbakaRost.hidden = true;
  ui.skrivval.after(tillbakaRost);
  tillbakaRost.addEventListener('click', () => {
    rostTrasig = '';
    valdSatt = null;
    visaIntro('');
    ui.starta.focus();
  });
  ui.skrivval.addEventListener('click', () => {
    valdSatt = 'skriv';
    startaRunda('skriv');
  });
  ui.starta.addEventListener('click', () => {
    startaRunda(SR() && !rostTrasig && valdSatt !== 'skriv' ? 'rost' : 'skriv');
  });
  ui.stang.addEventListener('click', stang);
  ui.tillbaka.addEventListener('click', stang);
  ui.igen.addEventListener('click', () => startaRunda(satt === 'rost' && !rostTrasig && SR() ? 'rost' : 'skriv'));
  rot.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); stang(); }
  });

  // ══════════════════════════════════════════════════════════════════
  // Rundan
  // ══════════════════════════════════════════════════════════════════
  function startaRunda(hur) {
    stoppa();
    if (!pool.length) byggPool();
    satt = hur;
    rot.dataset.satt = hur;
    const lista = shuffle([...pool]);
    if (Array.isArray(installningar.forst)) {
      const forst = installningar.forst.map(n => lista.find(c => c.name === n)).filter(Boolean);
      lista.splice(0, lista.length, ...forst, ...lista.filter(c => !forst.includes(c)));
    }
    runda = { lista, i: -1, poang: 0, resultat: [], slut: 0, start: 0, sagda: new Set(),
      gen: 0, avbruten: false };
    ui.poangTal.textContent = '0';
    ui.tid.textContent = fmt(installningar.tid);
    ui.tid.className = 'blixt-tid';
    ui.bar.style.transform = 'scaleX(1)';
    ui.svar.className = 'blixt-svar';
    ui.hort.textContent = '';
    ui.hort.className = 'blixt-hort';
    ui.kort.classList.remove('fel');
    ui.kort.setAttribute('data-tom', '');
    ui.splash.className = 'blixt-splash';
    ui.input.value = '';
    forladda(0);
    rot.dataset.lage = lage = 'vantar';
    window.kakSpara?.('flaggblixt_start', { region: regionKod(), satt: hur });
    if (hur === 'skriv') {
      // fokus i klicket (iPhone öppnar bara tangentbordet då), och klockan direkt
      ui.vanttext.textContent = '';
      ui.input.focus();
      nedrakning(true);
    } else {
      ui.vanttext.textContent = 'Tillåt mikrofonen om webbläsaren frågar …';
      ui.miktext.textContent = 'Startar mikrofonen …';
      ui.mik.classList.remove('pa');
      startaRost();
    }
    requestAnimationFrame(storlek);
  }
  // en siffra eller Kör! mitt på flaggan (animationen börjar om varje gång)
  function visaSplash(text) {
    ui.splash.classList.remove('syns');
    ui.splash.innerHTML = '<span></span>';
    ui.splash.firstChild.textContent = text;
    void ui.splash.offsetWidth;
    ui.splash.classList.add('syns');
  }
  // 3-2-1 (rösten, när mikrofonen lyssnar) eller bara Kör! (tangentbordet)
  function nedrakning(kort) {
    if (lage !== 'vantar') return;
    rot.dataset.lage = lage = 'nedrakning';
    const n = kort ? 0 : installningar.nedrakning;
    let k = n;
    const steg = () => {
      if (lage !== 'nedrakning') return;
      if (k <= 0) { kor(); return; }
      visaSplash(String(k));
      k--;
      nedTimer = setTimeout(steg, installningar.steg);
    };
    ui.vanttext.textContent = '';
    steg();
  }
  function kor() {
    rot.dataset.lage = lage = 'spelar';
    visaSplash('Kör!');
    clearTimeout(nedTimer);
    nedTimer = setTimeout(() => ui.splash.classList.remove('syns'), 550);
    runda.start = performance.now();
    runda.slut = runda.start + installningar.tid;
    if (satt === 'rost') ui.miktext.textContent = rek ? 'Lyssnar – säg landets namn' : 'Lyssnar …';
    nasta();
    clearInterval(timer);
    timer = setInterval(tick, 100);
    tick();
    sag('Kör! Säg landets namn.');
  }
  function tick() {
    if (lage !== 'spelar' || !runda) return;
    runda.slut = runda.start + installningar.tid;   // (testerna kan korta tiden mitt i en runda)
    const kvar = runda.slut - performance.now();
    ui.tid.textContent = fmt(kvar);
    ui.tid.className = 'blixt-tid' + (kvar <= 5000 ? ' sist' : kvar <= 15000 ? ' snart' : '');
    ui.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, kvar / installningar.tid)).toFixed(4)})`;
    if (kvar <= 0) slut('tid');
  }
  const aktuell = () => runda && runda.i >= 0 ? runda.lista[runda.i] : null;
  // de närmaste flaggorna hämtas i förväg, så att bytet sker direkt
  const forladdade = new Map();    // src → Image
  function forladda(fran) {
    if (!runda) return;
    for (let k = fran; k < Math.min(runda.lista.length, fran + 3); k++) {
      const src = flaggSrc(runda.lista[k]);
      if (!src || forladdade.has(src)) continue;
      const i = new Image();
      i.decoding = 'async';
      i.src = src;
      forladdade.set(src, i);
    }
  }
  function nasta() {
    if (!runda) return;
    runda.i++;
    runda.gen++;
    avbrytVantan();
    const c = aktuell();
    if (!c) { slut('alla'); return; }
    runda.resultat.push({ c, status: '', hort: '' });
    aktuellForm = forhallande(c);
    const form = FLAGG_FORM[(flaggKod(c) || '').toLowerCase()];
    ui.kort.classList.toggle('vimpel', form === 'vimpel');
    ui.kort.classList.remove('fel');
    clearTimeout(felTimer);
    ui.flagga.src = flaggSrc(c);
    ui.kort.removeAttribute('data-tom');
    storlek();
    forladda(runda.i + 1);
    if (satt === 'skriv') { ui.input.value = ''; }
  }
  // rätt svar (kod: det som sades, landet eller tvillingen)
  function ratt(kod, hort) {
    const c = aktuell(), r = runda.resultat[runda.resultat.length - 1];
    r.status = 'ratt';
    r.sagt = hort || '';
    runda.sagda.add(kod);
    runda.poang++;
    ui.poangTal.textContent = String(runda.poang);
    ui.poang.classList.remove('puls');
    void ui.poang.offsetWidth;
    ui.poang.classList.add('puls');
    visaSvar('ratt', c, '✓ ' + c.name);
    ui.hort.textContent = '';
    ui.hort.className = 'blixt-hort';
    spela('ratt');
    sag(`Rätt, ${c.name}! Nästa flagga.`);
    nasta();
  }
  function hoppa(kalla_) {
    if (lage !== 'spelar') return;
    const c = aktuell(), r = runda.resultat[runda.resultat.length - 1];
    r.status = r.hort ? 'fel' : 'hoppad';
    visaSvar('hoppad', c, '⏭ ' + c.name);
    ui.hort.textContent = '';
    ui.hort.className = 'blixt-hort';
    sag(`Hoppade över ${c.name}. Nästa flagga.`);
    nasta();
    if (satt === 'skriv' && kalla_ === 'knapp') ui.input.focus();
  }
  function fel(text, tvetydig) {
    const r = runda.resultat[runda.resultat.length - 1];
    r.hort = text;
    ui.kort.classList.remove('fel');
    void ui.kort.offsetWidth;
    ui.kort.classList.add('fel');
    clearTimeout(felTimer);
    felTimer = setTimeout(() => ui.kort.classList.remove('fel'), 900);
    const vem = satt === 'skriv' ? 'Du skrev' : 'Jag hörde';
    ui.hort.textContent = tvetydig ? `${vem}: ${text} – vilket Kongo? Kinshasa eller Brazzaville?` : `✗ ${vem}: ${text}`;
    ui.hort.className = 'blixt-hort fel';
    spela('fel');
    sag(tvetydig ? 'Vilket Kongo? Säg Kongo-Kinshasa eller Kongo-Brazzaville.' : `Fel, ${vem.toLowerCase()} ${text}.`);
  }
  function visaSvar(typ, c, text) {
    clearTimeout(svarTimer);
    ui.svar.className = 'blixt-svar ' + typ;
    ui.svar.innerHTML = `<img src="${flaggSrc(c)}" alt=""><span>${escHtml(text)}</span>`;
    void ui.svar.offsetWidth;
    ui.svar.classList.add('syns');
    svarTimer = setTimeout(() => ui.svar.classList.remove('syns'), 1300);
  }

  // ── slutet ──
  function slut(orsak) {
    if (!runda || (lage !== 'spelar' && lage !== 'nedrakning' && lage !== 'vantar')) return;
    const hann = lage === 'spelar';
    stoppa();
    rot.dataset.lage = lage = 'slut';
    const brukt = runda.start ? Math.min(installningar.tid, performance.now() - runda.start) : 0;
    const sista = runda.resultat[runda.resultat.length - 1];
    if (sista && !sista.status) sista.status = sista.hort ? 'fel' : 'slut';
    const avbruten = orsak === 'gomd' || !hann;
    ui.slutrubrik.textContent = orsak === 'alla' ? `Alla flaggor klara på ${fmt(brukt)}! 🎉`
      : avbruten ? 'Rundan avbröts' : 'Tiden är ute!';
    ui.resultat.innerHTML = `<b>${runda.poang}</b> rätt`;
    let rekord = false;
    const fore = lasRekord();
    // rekordet: flest rätt; lika många räknas bara om alla flaggor hanns
    // med på kortare tid (tid finns bara då)
    let snabbare = false;
    if (!avbruten && hann && runda.poang > 0) {
      const tid = orsak === 'alla' ? Math.round(brukt) : null;
      snabbare = !!fore && runda.poang === fore.ratt && tid != null && tid < (fore.tid == null ? Infinity : fore.tid);
      rekord = !fore || runda.poang > fore.ratt || snabbare;
      if (rekord) {
        try {
          localStorage.setItem(rekordNyckel(), JSON.stringify({ ratt: runda.poang, tid, datum: Date.now(), satt }));
        } catch (e) { /* privat läge */ }
      }
    }
    ui.rekordrad.className = 'blixt-rekordrad' + (rekord ? ' nytt' : '');
    ui.rekordrad.textContent = rekord ? (snabbare ? '🏆 Nytt rekord – snabbare än förut!'
      : fore ? `🏆 Nytt rekord! (förut ${fore.ratt} rätt)` : '🏆 Ditt första rekord här!')
      : fore ? `🏆 Ditt rekord: ${fore.ratt} rätt` : '';
    ui.avbruten.textContent = orsak === 'gomd' ? 'Sidan doldes, så mikrofonen stängdes. Rundan räknas inte.' : '';
    ui.tillbaka.textContent = kalla === 'utforska' ? 'Tillbaka till Utforska' : 'Tillbaka till flaggquizet';
    const ETIKETT = { ratt: '✓ rätt', fel: '✗ fel', hoppad: '⏭ hoppade över', slut: '⏱ hann inte' };
    ui.lista.innerHTML = runda.resultat.filter(r => r.status).map(r => {
      const extra = r.status === 'fel' && r.hort ? `<small>${satt === 'skriv' ? 'du skrev' : 'jag hörde'}: ${escHtml(r.hort)}</small>` : '';
      return `<li class="${r.status}"><img src="${flaggSrc(r.c)}" alt=""><span class="blixt-ln">${escHtml(r.c.name)}${extra}</span>`
        + `<span class="blixt-st">${ETIKETT[r.status]}</span></li>`;
    }).join('');
    const antal = s => runda.resultat.filter(r => r.status === s).length;
    window.kakSpara?.('flaggblixt_klar', { region: regionKod(), ratt: runda.poang, visade: runda.resultat.length,
      fel: antal('fel'), hoppade: antal('hoppad'), satt, rekord, avbruten, alla: orsak === 'alla' });
    if (hann && !avbruten) spela('fanfar');
    sag(`${ui.slutrubrik.textContent} ${runda.poang} rätt.${rekord ? ' Nytt rekord!' : ''}`);
    setTimeout(() => { if (lage === 'slut') ui.igen.focus({ preventScroll: true }); }, 0);
  }
  // allt som går stoppas: mikrofonen, klockan och väntande timrar
  function stoppa() {
    stoppaRost();
    clearInterval(timer);
    clearTimeout(nedTimer);
    clearTimeout(svarTimer);
    clearTimeout(felTimer);
    avbrytVantan();
    ui.mik.classList.remove('pa');
    ui.splash.classList.remove('syns');
  }

  ui.hoppa.addEventListener('click', () => hoppa('knapp'));

  // ══════════════════════════════════════════════════════════════════
  // Rösten
  // ══════════════════════════════════════════════════════════════════
  let rek = null;                // igenkänningen som lyssnar nu
  let session = 0;               // en ny för varje start (resultatens index börjar om)
  let forbrukt = new Map();      // 'session:index' → antal ord som redan räknats
  let vantan = null;             // { nyckel, tid } fördröjt godkännande
  let omstarter = [];            // tidpunkter för omstarter (snurrskydd)
  const FATALA = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported',
    'bad-grammar']);
  const ORSAK = {
    'not-allowed': 'Mikrofonen är inte tillåten här – skriv landets namn i stället.',
    'service-not-allowed': 'Mikrofonen är inte tillåten här – skriv landets namn i stället.',
    'audio-capture': 'Ingen mikrofon hittades – skriv landets namn i stället.',
    'network': 'Röstigenkänningen når inte fram – skriv landets namn i stället.',
    'language-not-supported': 'Svenska röstigenkänning finns inte här – skriv landets namn i stället.',
  };

  function startaRost() {
    const Klass = SR();
    if (!Klass) { reserv('saknas'); return; }
    let r;
    try {
      r = new Klass();
      r.lang = 'sv-SE';
      r.interimResults = true;
      r.continuous = true;
      r.maxAlternatives = 5;
    } catch (e) { reserv('saknas'); return; }
    const s = ++session;
    let lyssnar = false;
    const igang = () => {
      if (rek !== r || lyssnar) return;
      lyssnar = true;
      ui.mik.classList.add('pa');
      ui.miktext.textContent = lage === 'spelar' ? 'Lyssnar – säg landets namn' : 'Gör dig redo …';
      if (lage === 'vantar') nedrakning(false);
    };
    // Klockan går först när mikrofonen tar emot ljud (audiostart). Ger en
    // webbläsare bara start, går den en stund efter start.
    let startReserv = 0;
    r.onaudiostart = () => { clearTimeout(startReserv); igang(); };
    r.onstart = () => {
      if (rek !== r) return;
      startReserv = setTimeout(igang, 1000);
    };
    r.onresult = e => { if (rek === r) resultat(e, s); };
    r.onerror = e => {
      if (rek !== r) return;
      const kod = e && e.error;
      clearTimeout(startReserv);
      // varje fel: mikrofonen av direkt (no-speech och aborted startas om vid end)
      if (FATALA.has(kod)) { reserv(kod); return; }
      try { r.abort(); } catch (x) { /* */ }
    };
    r.onend = () => {
      if (rek !== r) return;
      clearTimeout(startReserv);
      ui.mik.classList.remove('pa');
      if (lage === 'nedrakning' || lage === 'spelar') omstart();
      else if (lage === 'vantar') reserv('slutade');
    };
    rek = r;
    try { r.start(); } catch (e) { rek = null; reserv('saknas'); }
  }
  function omstart() {
    const nu = performance.now();
    omstarter = omstarter.filter(t => nu - t < 4000);
    omstarter.push(nu);
    if (omstarter.length > 6) { reserv('snurrar'); return; }
    ui.miktext.textContent = 'Lyssnar …';
    rek = null;
    startaRost();
  }
  function stoppaRost() {
    const r = rek;
    rek = null;
    if (!r) return;
    r.onresult = r.onerror = r.onend = r.onstart = r.onaudiostart = null;
    try { r.abort(); } catch (e) { /* redan stängd */ }
    ui.mik.classList.remove('pa');
  }
  // tillbaka till tangentbordet: före klockan via introt (ett tryck behövs
  // för tangentbordet på iPhone), mitt i rundan direkt
  function reserv(kod) {
    stoppaRost();
    const text = ORSAK[kod] || 'Mikrofonen fungerar inte här – skriv landets namn i stället.';
    rostTrasig = text;
    window.kakSpara?.('flaggblixt_reserv', { orsak: kod || 'okand', lage });
    if (lage === 'vantar') {
      visaIntro(text);
      ui.starta.focus();
      return;
    }
    if (lage !== 'nedrakning' && lage !== 'spelar') return;
    satt = 'skriv';
    rot.dataset.satt = 'skriv';
    ui.hort.textContent = text;
    ui.hort.className = 'blixt-hort fel';
    sag(text);
    ui.input.focus();
    requestAnimationFrame(storlek);
  }

  // ── resultaten ──
  // Varje resultat (session:index) har en räknare för ord som redan räknats
  // (forbrukt). Bara orden efter dem prövas: ett ord ger aldrig två poäng och
  // ett "Sverige" som blir slutgiltigt efter att flaggan bytts ger inget ✗
  // på nästa flagga. Under nedräkningen räknas allt som sägs som förbrukat.
  function resultat(e, s) {
    const lista = e.results;
    if (!lista) return;
    for (let i = e.resultIndex || 0; i < lista.length; i++) {
      const r = lista[i];
      if (!r) continue;
      const alts = [];
      for (let k = 0; k < r.length; k++) if (r[k] && typeof r[k].transcript === 'string') alts.push(r[k].transcript);
      if (!alts.length) continue;
      const nyckel = s + ':' + i;
      const tolkade = alts.map(a => ord(a));
      if (lage !== 'spelar') {
        forbrukt.set(nyckel, Math.max(forbrukt.get(nyckel) || 0, ...tolkade.map(o => o.ut.length)));
        continue;
      }
      provaRost(nyckel, tolkade, !!r.isFinal);
      if (lage !== 'spelar') return;
    }
  }
  function provaRost(nyckel, tolkade, slutgiltig) {
    if (vantan && vantan.nyckel === nyckel) avbrytVantan();
    const forut = forbrukt.get(nyckel) || 0;
    let fore = forut;
    // det som hörts (och inte räknats än) syns direkt
    const forsta = tolkade[0];
    if (forsta.ut.length > fore || (fore === 0 && forsta.ra.length)) visaHort(forsta, fore);
    for (;;) {
      const kod = flaggKod(aktuell());
      let traff = null;
      for (const o of tolkade) {
        if (o.ut.length <= fore) continue;
        for (const k of tolkaOrd(o.ut.slice(fore).map(x => x.t))) {
          if (k.tvetydig) continue;
          if (k.kod === HOPPA || (rattFor(k, kod) && (k.kod === kod || !runda.sagda.has(k.kod)))) { traff = { o, k }; break; }
        }
        if (traff) break;
      }
      if (!traff) break;
      const slutOrd = fore + traff.k.j;
      // ett ord som kan bli ett längre land (Guinea → Guinea-Bissau): vänta
      // en stund på fler ord, om det inte redan är slutgiltigt
      if (!slutgiltig && traff.k.kod !== HOPPA && slutOrd >= traff.o.ut.length && riskabla.has(traff.k.kod)) {
        const gen = runda.gen, k = traff.k, text = hortText(traff.o, fore);
        vantan = { nyckel, tid: setTimeout(() => {
          vantan = null;
          if (lage !== 'spelar' || !runda || runda.gen !== gen) return;
          forbrukt.set(nyckel, Math.max(forbrukt.get(nyckel) || 0, slutOrd));
          ratt(k.kod, text);
        }, installningar.fordroj) };
        return;
      }
      const text = hortText(traff.o, fore);
      forbrukt.set(nyckel, slutOrd);
      fore = slutOrd;
      if (traff.k.kod === HOPPA) hoppa('rost'); else ratt(traff.k.kod, text);
      if (lage !== 'spelar') return;
    }
    if (!slutgiltig) return;
    // slutgiltigt utan träff: ✗ om något nytt sades (ett land, eller vad
    // som helst i ett yttrande som inte redan gett poäng)
    const rest = forsta.ut.slice(fore);
    forbrukt.set(nyckel, Math.max(fore, ...tolkade.map(o => o.ut.length)));
    if (!rest.length) return;
    const t = tolkaOrd(rest.map(x => x.t));
    if (t.length || fore === 0) fel(hortText(forsta, fore), t.some(k => k.tvetydig && k.koder.includes('CD') && k.koder.includes('CG')));
  }
  function avbrytVantan() {
    if (vantan) clearTimeout(vantan.tid);
    vantan = null;
  }
  // de råa orden från det första ord som inte räknats
  const hortText = (o, fore) => fore <= 0 ? o.ra.join(' ') : fore >= o.ut.length ? '' : o.ra.slice(o.ut[fore].w).join(' ');
  function visaHort(o, fore) {
    const text = hortText(o, fore);
    if (!text) return;
    ui.hort.textContent = 'Jag hörde: ' + text;
    ui.hort.className = 'blixt-hort';
  }

  // ══════════════════════════════════════════════════════════════════
  // Tangentbordet (reserven)
  // ══════════════════════════════════════════════════════════════════
  // Ett namn som stämmer exakt godkänns redan medan man skriver (om det inte
  // kan vara början på ett annat land); annars prövas det vid Enter.
  ui.input.addEventListener('input', () => {
    if (lage !== 'spelar' || satt !== 'skriv') return;
    const o = ord(ui.input.value);
    if (!o.ut.length) return;
    const s = o.ut.map(x => x.t).join('');
    byggTabell();
    const kod = flaggKod(aktuell());
    const exakt = tabell.filter(e => e.f === s && e.alias !== 'tvetydig');
    if (exakt.length && exakt.every(e => e.kod === kod || tvilling(e.kod, kod)) && !riskabla.has(exakt[0].kod)
      && (exakt[0].kod === kod || !runda.sagda.has(exakt[0].kod))) {
      ui.input.value = '';
      ratt(exakt[0].kod, s);
    }
  });
  ui.form.addEventListener('submit', e => {
    e.preventDefault();
    if (lage !== 'spelar') return;
    const text = ui.input.value.trim();
    if (!text) return;
    const kod = flaggKod(aktuell());
    const t = tolka(text);
    const traff = t.find(k => !k.tvetydig && (k.kod === HOPPA || (rattFor(k, kod) && (k.kod === kod || !runda.sagda.has(k.kod)))));
    if (traff && traff.kod === HOPPA) { ui.input.value = ''; hoppa('skriv'); return; }
    if (traff) { ui.input.value = ''; ratt(traff.kod, text); return; }
    fel(text, t.some(k => k.tvetydig && k.koder.includes('CD') && k.koder.includes('CG')));
    ui.input.select();
  });

  // ══════════════════════════════════════════════════════════════════
  // Sidan göms: mikrofonen av direkt, rundan avbryts
  // ══════════════════════════════════════════════════════════════════
  const gomd = () => {
    if (lage === 'spelar') slut('gomd');
    else if (lage === 'vantar' || lage === 'nedrakning') {
      stoppa();
      visaIntro('Mikrofonen stängdes när sidan doldes. Tryck på Starta igen.');
    } else stoppaRost();
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) gomd(); });
  window.addEventListener('pagehide', gomd);

  function lageFor() {
    const c = aktuell();
    return { lage, satt, oppen: !rot.hidden, lyssnar: !!rek, poang: runda ? runda.poang : 0,
      aktuell: c ? c.name : null, gid: c ? c.gid : null, kvar: runda && runda.slut ? Math.round(runda.slut - performance.now()) : null,
      pool: pool.length, resultat: runda ? runda.resultat.map(r => [r.c.name, r.status]) : [] };
  }

  return { uppdatera, oppna, stang, tolka, matcha, matchaKod, normalisera, sjalvkontroll, installningar,
    lage: lageFor };
})();
// ingångarna direkt (glob-spel.js anropar uppdatera vid varje byte)
window.flaggblixt?.uppdatera();
