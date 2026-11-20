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
// fråga), efter en kort 3-2-1 och Kör! i den tomma rutan. Man säger landets
// namn: så fort ett delresultat (interim) eller slutresultat matchar flaggan
// som visas blir det ✓ med namnet, poäng, och nästa flagga direkt. Ett
// slutresultat med ett annat land ger ✗ och flaggan står kvar; "Jag hörde:
// …" visar alltid vad igenkänningen hörde (grått om inget land sades).
// "Hoppa över" (knappen, eller exakt "pass", "nästa", "hoppa över",
// "skippa") visar svaret och går vidare. När tiden är ute stängs mikrofonen
// direkt och slutsidan visar antal rätt, rundans flaggor (rätt / fel /
// hoppade över / hann inte) och rekordet per region (bara lokalt:
// SPRAK.hsPrefix + 'flaggblixt-' + HS_BAS, inga nya Firebase-regler; lika
// många rätt slår rekordet bara om ALLA flaggor blev rätt på kortare tid).
// Spela igen tar inte emot ett tryck den första stunden (SLUTVILA). Quizens
// klocka bakom väntar bara om quizet inte börjat (inga svar än); mitt i ett
// quiz går den vidare, som med flaggvideon (v109), och introt säger det.
// Medan panelen är öppen är spelet och ▶ 🧩 ? i sidhuvudet och hörnen
// inerta (videon läser upp länder i mikrofonen); ← och lägesknapparna
// stänger panelen, och oppnaVideo/visaDelVal stänger den också.
//
// Rösten: SpeechRecognition (webkit i Chrome och Safari), sv-SE, interim,
// continuous, 5 alternativ. Mikrofonen begärs först när man trycker Starta
// och stängs (abort) när rundan tar slut, vid Spela igen, när panelen
// stängs (✕, Esc), vid lägesbyte, ny region, startsidan (alla via
// uppdatera(), som glob-spel.js uppdateraHuvudstadslage anropar), när sidan
// göms (visibilitychange, pagehide) och vid varje fel. Igenkänningen startas
// om när den stannar av sig själv (tystnad i Chrome, iOS; snurrskyddet
// räknar bara sessioner som inte gav något resultat). Det som hörts och
// räknats minns per resultat (session:index) som vikt text: bara det som
// sägs efteråt prövas, även när igenkänningen skriver om orden ("sydkorea"
// → "Syd-Korea"). Byts flaggan (svar, Hoppa över, väntan) räknas allt som
// hörts som förbrukat, så att ett sent slutresultat aldrig ger poäng eller ✗
// på nästa flagga; fortsätter man prata efter ett rätt svar ("Sverige …
// Norge") prövas de nya orden mot nästa flagga. Ett eko av det nyss rätta
// svaret ger varken poäng eller ✗. Alternativen avgörs i igenkänningens
// ordning (ett tydligt grannland först vinner inte på att rätt land står
// längre ner). Ett namn som kan vara början på ett annat land (Guinea →
// Guinea-Bissau, Mali → Malawi, Kina → Kanada), och ett hoppord, godkänns i
// ett delresultat först när inget mer ord kommit på en stund
// (installningar.fordroj).
// Reserven: saknas igenkänningen (Firefox) eller ger den not-allowed,
// service-not-allowed, audio-capture, network eller language-not-supported
// skriver man i stället (samma matchning, samma klocka, Enter skickar; ett
// exakt namn godkänns redan medan man skriver, men bara om inget längre namn
// börjar likadant, annars efter en kort paus). Man kan också välja "Skriv i
// stället" före start. Med tangentbordet uppe på en låg telefon blir
// skrivläget tätare (data-kort).
//
// Matchningen (tolka, matcha) är rena funktioner: texten normaliseras
// (gemener, utan diakritiska tecken, bindestreck och & som mellanslag,
// fyllnadsord som "det är", "jag tror", "flaggan", "mmm" bort) och viks
// fonetiskt (c/k, z/s, w/v, y/i, dubbla bokstäver …). Varje ordfönster
// jämförs med varje lands namn i spelet, ALIAS, engelska namn, adjektiv
// ("svenska flaggan") och ATRAPPER (Sydamerika, Grönland …: inget land) med
// en editeringsgräns som växer med längden (korta namn och hoppord måste
// vara exakta). Fönstren väljs så att summan av längd × likhet blir störst,
// aldrig över ett skiljeord ("eller", "nej"): "Guinea-Bissau" vinner över
// "Guinea", men "Niger eller Kina" blir aldrig Nigeria. Ett svar räknas
// bara om flaggans land (eller dess tvilling, FLAGG_TVILLINGAR) är BÄST
// bland alla länder i spelet: "Guinea" är fel för Guinea-Bissau, "Niger"
// för Nigeria, "Sudan" för Sydsudan, och "Kongo" är medvetet tvetydigt
// (båda Kongo lika bra = inget av dem; "Vilket Kongo?" bara på ett Kongo).
// Av flera länder räknas det första ("Sverige Norge Danmark" är Sverige),
// eller det första efter ett rättelseord ("Niger, nej Nigeria").
// sjalvkontroll() prövar att varje lands namn och alias bara matchar landet
// självt, parkontroll() att två länder i rad blir de två (regress.mjs v113).
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
//   tolka/matcha/matchaKod/normalisera/sjalvkontroll/parkontroll/vantar
//                      matchningen (testerna)
//   installningar      { tid, nedrakning, steg, fordroj, kor, forst } (testerna kortar rundan)
//   lage()             tillståndet för testerna
window.flaggblixt = (() => {
  // engelska sajten och USA har inga flaggor (filen laddas inte ens där)
  if (typeof SPRAK === 'undefined' || SPRAK.lang !== 'sv') return null;

  const installningar = {
    tid: 60000,          // rundans längd (ms)
    nedrakning: 3,       // 3-2-1 innan första flaggan (0 = direkt)
    steg: 450,           // ms per siffra i nedräkningen
    fordroj: 450,        // ms innan ett delresultat som kan bli ett längre land (eller ett hoppord) godkänns
    kor: 300,            // ms som Kör! står i den tomma rutan innan första flaggan och klockan
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
    MD: ['Moldova'],
    BS: ['Bahamaöarna', 'Bahamasöarna'],
    BR: ['Brasil'],
    SS: ['Södra Sudan'],
  };
  ALIAS.KN.push('St Kitts', 'Sankt Kitts');          // (S:t Kitts blir samma ord)
  ALIAS.US.push('USAs');
  // Engelska namn (barn säger ofta Germany eller France). Bara där det
  // svenska namnet inte redan är samma efter vikningen (Kanada, Mexico …).
  const ENGELSKA = {
    DE: ['Germany'], FR: ['France'], ES: ['Spain'], IT: ['Italy'], SE: ['Sweden'], NO: ['Norway'], DK: ['Denmark'],
    IS: ['Iceland'], IE: ['Ireland'], NL: ['Netherlands', 'The Netherlands'], CH: ['Switzerland'], AT: ['Austria'],
    AU: ['Australia'], GR: ['Greece'], RU: ['Russia'], CN: ['China'], IN: ['India'], BR: ['Brazil'], PL: ['Poland'],
    RO: ['Romania'], US: ['United States', 'United States of America'], GB: ['United Kingdom', 'Northern Ireland'],
    NZ: ['New Zealand'], KR: ['South Korea'], KP: ['North Korea'], ZA: ['South Africa'], SS: ['South Sudan'],
    CZ: ['Czech Republic', 'Czechia'], BE: ['Belgium'], HU: ['Hungary'], HR: ['Croatia'], RS: ['Serbia'],
    MA: ['Morocco'], EG: ['Egypt'], TR: ['Turkey'], LY: ['Libya'], UA: ['Ukraine'], LT: ['Lithuania'], LV: ['Latvia'],
    EE: ['Estonia'], SK: ['Slovakia'], SI: ['Slovenia'], BG: ['Bulgaria'], AL: ['Albania'], CY: ['Cyprus'],
    PH: ['Philippines'], ID: ['Indonesia'], SA: ['Saudi Arabia'], SY: ['Syria'], JO: ['Jordan'], LB: ['Lebanon'],
    TN: ['Tunisia'], DZ: ['Algeria'], ET: ['Ethiopia'], CM: ['Cameroon'], CI: ['Ivory Coast'], MN: ['Mongolia'],
    VA: ['Vatican'], DO: ['Dominican Republic'], gbsct: ['Scotland'], AE: ['United Arab Emirates'],
  };
  // "den svenska flaggan", "norska flaggan": landets adjektiv (de vanligaste)
  const ADJEKTIV = {
    SE: ['svenska'], NO: ['norska'], DK: ['danska'], FI: ['finska'], IS: ['isländska'], DE: ['tyska'],
    FR: ['franska'], gbeng: ['engelska'], gbsct: ['skotska'], GB: ['brittiska'], IE: ['irländska'], ES: ['spanska'],
    IT: ['italienska'], PT: ['portugisiska'], GR: ['grekiska'], TR: ['turkiska'], PL: ['polska'], RU: ['ryska'],
    UA: ['ukrainska'], EE: ['estniska'], LV: ['lettiska'], LT: ['litauiska'], NL: ['nederländska', 'holländska'],
    BE: ['belgiska'], CH: ['schweiziska'], AT: ['österrikiska'], HU: ['ungerska'], CZ: ['tjeckiska'],
    SI: ['slovenska'], SK: ['slovakiska'], JP: ['japanska'], CN: ['kinesiska'], IN: ['indiska'], US: ['amerikanska'],
    CA: ['kanadensiska'], MX: ['mexikanska'], BR: ['brasilianska'], AR: ['argentinska'], AU: ['australiensiska'],
    ZA: ['sydafrikanska'], EG: ['egyptiska'], KR: ['sydkoreanska'], KP: ['nordkoreanska'],
  };
  // Medvetet tvetydiga ord: alla koderna är lika bra, så inget av dem räknas
  // ("Vilket Kongo?"). De ingår inte i sjalvkontroll (de ska ju krocka).
  const TVETYDIGA = { Kongo: ['CD', 'CG'] };
  // Ord som liknar ett land men inte är något i spelet (världsdelar, öar,
  // gamla riken): de matchar sig själva och ger ✗ i stället för att vikas
  // till närmaste land ("Sydamerika" är inte Sydafrika, "Grönland" inte Grekland).
  const INGET = 'INGET';
  const ATRAPPER = ['Europa', 'Afrika', 'Asien', 'Sydamerika', 'Nordamerika', 'Mellanamerika', 'Centralamerika',
    'Latinamerika', 'Oceanien', 'Antarktis', 'Arktis', 'Grönland', 'Greenland', 'Åland', 'Färöarna', 'Sibirien',
    'Persien', 'Polynesien', 'Nya Kaledonien', 'Lappland', 'Skandinavien', 'Karibien', 'Hawaii'];
  // Hoppa över med rösten: bara de här orden, och bara exakt ("hoppas",
  // "nästan" och "pasta" är inga hoppord; "jag vet inte …" är att tänka högt)
  const HOPPA = 'HOPPA';
  const HOPPORD = ['pass', 'passar', 'nästa', 'hoppa över', 'skippa', 'skip'];
  // Ord som inte är ett svar (tas bort före matchningen). Utdragna ljud
  // ("mmm", "eeeh") jämförs med upprepade bokstäver hopslagna.
  const FYLL = new Set(['det', 'där', 'den', 'denna', 'detta', 'är', 'e', 'va', 'var', 'vad', 'jag', 'tror',
    'tänker', 'att', 'kanske', 'nog', 'väl', 'ju', 'typ', 'alltså', 'ehm', 'eh', 'öh', 'äh', 'ah', 'hm',
    'm', 'mh', 'mhm', 'um', 'öhm', 'ähm', 'a', 'åh', 'oh', 'ö', 'ä', 'jaha', 'aha', 'flaggan', 'flagga',
    'flaggor', 'flaggorna', 'landet', 'heter', 'nej', 'nä', 'ja', 'jo', 'okej', 'ok', 'från', 'för', 'tillhör',
    'som', 'eller', 'men', 'vänta', 'nu', 'så', 'ett', 'en', 'menar', 'förlåt', 'oj']);
  // Ord som skiljer två svar åt (inget namn byggs över dem: "Kina eller
  // Ryssland" är två länder, inte Vitryssland) …
  const SKILJE = new Set(['eller', 'nej', 'nä', 'men', 'menar', 'förlåt', 'oj', 'vänta']);
  // … och av dem de som rättar det man nyss sa ("Niger, nej Nigeria")
  const RATTELSE = new Set(['nej', 'nä', 'menar', 'förlåt', 'oj']);

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
  // texten → ord: [{ t: vikt ord, w: index i de råa orden, g: ett skiljeord
  // före, r: ett rättelseord före }] och de råa orden (så att "Jag hörde"
  // kan visa just det som inte räknats än)
  function ord(text) {
    const ra = String(text == null ? '' : text).trim().split(/\s+/).filter(Boolean);
    const ut = [];
    let g = false, r = false;
    ra.forEach((w, i) => {
      for (const b of w.toLocaleLowerCase('sv').replace(/[&+]/g, ' och ').split(/[^\p{L}\p{N}]+/u)) {
        if (!b) continue;
        const hop = b.replace(/(.)\1+/gu, '$1');
        if (FYLL.has(b) || FYLL.has(hop)) {
          if (SKILJE.has(b) || SKILJE.has(hop)) g = true;
          if (RATTELSE.has(b) || RATTELSE.has(hop)) r = true;
          continue;
        }
        const f = vik(b);
        if (!f) continue;
        ut.push({ t: f, w: i, g, r });
        g = r = false;
      }
    });
    return { ut, ra };
  }
  const normalisera = text => ord(text).ut.map(o => o.t).join(' ');
  // vikta ord ihop, med dubbla bokstäver över ordgränsen hopslagna
  // ("öst timor" och "östtimor" blir samma)
  const ihop = ut => ut.map(x => x.t).join('').replace(/(.)\1+/g, '$1');

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
  let tabell = null;
  const tvilling = (a, b) => a !== b && FLAGG_TVILLINGAR.some(p => p.includes(a) && p.includes(b));
  const ARLAND = k => k !== HOPPA && k !== INGET;
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
    // (engelska namn och adjektiv: inte "början på ett annat land" i riskabel)
    for (const t of [ENGELSKA, ADJEKTIV]) for (const [kod, lista] of Object.entries(t)) for (const n of lista) lagg(kod, n, 'extra');
    for (const [n, koder] of Object.entries(TVETYDIGA)) for (const kod of koder) lagg(kod, n, 'tvetydig');
    for (const n of ATRAPPER) lagg(INGET, n, false);
    for (const n of HOPPORD) lagg(HOPPA, n, false);
  }
  // Det som hördes (s, vikt) kan vara början på ett annat land: då godkänns
  // ett delresultat först när inget mer ord kommit (installningar.fordroj).
  // Exakt början (Guinea → Guinea-Bissau, Niger → Nigeria, Dominica →
  // Dominikanska republiken) eller nästan (Mali → Malawi, Iran → Irland,
  // Kina → Kanada: högst ett fel i en början som är lika lång ± 1).
  const riskMinne = new Map();
  function riskabel(s, kod) {
    const nyckel = s + '|' + kod;
    if (riskMinne.has(nyckel)) return riskMinne.get(nyckel);
    let svar = false;
    for (const b of tabell) {
      if (b.kod === kod || !ARLAND(b.kod) || b.alias === 'extra' || tvilling(kod, b.kod) || b.f.length <= s.length) continue;
      if (b.f.startsWith(s)) { svar = true; break; }
      if (s.length < 3) continue;
      for (let L = s.length - 1; L <= s.length + 1 && !svar; L++) {
        if (L < b.f.length && avstand(s, b.f.slice(0, L), 1) <= 1) svar = true;
      }
      if (svar) break;
    }
    if (riskMinne.size > 5000) riskMinne.clear();
    riskMinne.set(nyckel, svar);
    return svar;
  }
  // bästa koderna för en vikt sträng: { koder, sim } eller null. Hoppord
  // gäller bara exakt. (Svaren sparas: ett delresultat prövas om och om
  // igen medan det växer, och bara de nya fönstren behöver räknas.)
  const minne = new Map();
  function bast(s) {
    if (minne.has(s)) return minne.get(s);
    let sim = 0, koder = [];
    for (const e of tabell) {
      const L = Math.max(s.length, e.f.length), max = e.kod === HOPPA ? 0 : tal(L);
      if (Math.abs(s.length - e.f.length) > max) continue;
      const d = avstand(s, e.f, max);
      if (d > max) continue;
      const v = 1 - d / L;
      if (v > sim + 1e-9) { sim = v; koder = [e.kod]; }
      else if (Math.abs(v - sim) <= 1e-9 && !koder.includes(e.kod)) koder.push(e.kod);
    }
    const svar = koder.length ? { koder, sim } : null;
    if (minne.size > 20000) minne.clear();
    minne.set(s, svar);
    return svar;
  }
  // Tolkningarna av en följd vikta ord (ord().ut), i ordning: [{ kod, koder,
  // tvetydig, i, j (orden i..j-1), sim }]. Fönstren väljs så att summan av
  // längd × likhet blir störst (ord som inget matchar ger 0; lika = färre
  // fönster): "guinea bissau" blir ETT land, men "Niger Kina" blir Niger +
  // Kina och inte ett ungefärligt Nigeria. Inget fönster går över ett
  // skiljeord ("eller", "nej"). Ett fönster där två länder (som inte är
  // tvillingar) är lika bra är tvetydigt.
  function tolkaOrd(ol) {
    byggTabell();
    const n = ol.length;
    const slutar = Array.from({ length: n + 1 }, () => []);
    for (let i = 0; i < n; i++) {
      let s = '';
      for (let j = i; j < Math.min(n, i + MAXORD); j++) {
        if (j > i && ol[j].g) break;
        s += ol[j].t;
        const b = bast(s);
        if (!b) continue;
        const grupp = b.koder.every(k => k === b.koder[0] || tvilling(k, b.koder[0]));
        slutar[j + 1].push({ kod: b.koder[0], koder: b.koder, tvetydig: !grupp, i, j: j + 1, sim: b.sim,
          vikt: b.sim * s.length, s });
      }
    }
    const bas = [{ v: 0, c: 0, k: null, fran: -1 }];
    for (let x = 1; x <= n; x++) {
      let b = { v: bas[x - 1].v, c: bas[x - 1].c, k: null, fran: x - 1 };
      for (const k of slutar[x]) {
        const v = bas[k.i].v + k.vikt, c = bas[k.i].c + 1;
        if (v > b.v + 1e-9 || (Math.abs(v - b.v) <= 1e-9 && c < b.c)) b = { v, c, k, fran: k.i };
      }
      bas[x] = b;
    }
    const ut = [];
    for (let x = n; x > 0; x = bas[x].fran) if (bas[x].k) ut.push(bas[x].k);
    return ut.reverse();
  }
  const tolka = text => tolkaOrd(ord(text).ut);
  // rätt för flaggan med koden kod? (landet självt eller tvillingen)
  const rattFor = (k, kod) => !k.tvetydig && ARLAND(k.kod) && (k.kod === kod || tvilling(k.kod, kod));
  const SAKER = 0.8;               // så lik måste ett alternativs land vara för att avgöra (se avgor)
  // Det avgörande svaret i en följd ord (samma regel för rösten, det skrivna
  // och matcha): det FÖRSTA landet räknas, inte vilket som helst av flera
  // ("Sverige Norge Danmark Finland" är Sverige). Ett rättelseord ("nej",
  // "jag menar", "förlåt") börjar om: det första landet efter det sista
  // rättelseordet räknas ("Niger, nej Nigeria"). eko(k): ett eko av svaret
  // som nyss räknades (rösten, se eko nedan) räknas inte alls. Ett hoppord
  // räknas om inte flaggans land också sägs.
  // → { k, ratt } eller null
  function avgor(ol, kod, eko) {
    const fonster = tolkaOrd(ol).filter(k => !(eko && !k.tvetydig && ARLAND(k.kod) && eko(k)));
    if (!fonster.length) return null;
    const del = k => { let s = 0; for (let x = 0; x <= k.i; x++) if (ol[x].r) s++; return s; };
    const sista = Math.max(...fonster.map(del));
    let k = fonster.find(x => del(x) === sista);
    if (k.kod === HOPPA) k = fonster.find(x => rattFor(x, kod)) || k;
    return { k, ratt: rattFor(k, kod) };
  }
  function matchaKod(text, kod) {
    const d = avgor(ord(text).ut, kod, null);
    return !!d && d.ratt;
  }
  function matcha(text, gid) {
    const c = aktivByGid.get(gid) || pool.find(x => x.gid === gid);
    const kod = c && flaggKod(c);
    return !!kod && matchaKod(text, kod);
  }
  // varje lands namn och alias ska bara peka på landet självt (eller
  // tvillingen), hela vägen; hoppord och atrapper bara på sig själva: [fel]
  function sjalvkontroll() {
    byggTabell();
    const fel = [];
    for (const e of tabell) {
      if (e.alias === 'tvetydig') continue;
      const t = tolka(e.namn);
      const ok = t.length === 1 && t[0].i === 0 && !t[0].tvetydig
        && (t[0].kod === e.kod || (ARLAND(e.kod) && tvilling(t[0].kod, e.kod)))
        && t[0].j === ord(e.namn).ut.length;
      if (!ok) fel.push(`${e.namn} (${e.kod}) → ${t.map(k => (k.tvetydig ? '?' : '') + k.koder.join('/')).join(' + ') || 'inget'}`);
    }
    return fel;
  }
  // Två länder i rad ("A B") ska bli A och B, aldrig ett tredje land som
  // liknar dem ihop (testerna: alla par i spelet): [fel]
  function parkontroll() {
    byggTabell();
    const namn = Object.keys(FLAGG_ISO), fel = [];
    const lika = (a, b) => a === b || tvilling(a, b);
    for (const a of namn) for (const b of namn) {
      if (a === b) continue;
      const t = tolka(a + ' ' + b);
      if (!(t.length === 2 && !t[0].tvetydig && !t[1].tvetydig && lika(t[0].kod, FLAGG_ISO[a]) && lika(t[1].kod, FLAGG_ISO[b]))) {
        fel.push(`${a} ${b} → ${t.map(k => (k.tvetydig ? '?' : '') + k.koder.join('/')).join(' + ') || 'inget'}`);
      }
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
/* ▶ (flaggvideon) och 🧩 (delarna) i sidhuvudet öppnar något ovanpå
   rundan: borta medan Flaggblixt är öppen (← och lägesknapparna stänger den) */
body.blixt-pa #spel-video, body.blixt-pa #spel-delar { visibility: hidden; }
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
.blixt-klocknot { max-width: 30em; font-size: .8rem; line-height: 1.4; color: #ffcf8a; }
.blixt-meddelande:empty, .blixt-integritet[hidden], .blixt-klocknot[hidden] { display: none; }
.blixt-ingress, .blixt-integritet, .blixt-meddelande, .blixt-klocknot { text-wrap: balance; }   /* inget ensamt sista ord */

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
.blixt-hort.kongo { font-size: .82rem; }
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
#flaggblixt:not([data-lage="spelar"]) .blixt-hoppa,
#flaggblixt:not([data-lage="spelar"]) .blixt-hoppa-liten { opacity: .4; pointer-events: none; }
.blixt-skriv .blixt-hoppa-liten { display: none; min-width: 48px; padding: 0 10px; font-size: 1.1rem; }
/* Skriva med tangentbordet uppe på en låg telefon (lagret under ~420 px):
   tätare, ✓ ovanpå flaggans nederkant och ⏭ i samma rad som OK, så att
   klockan, rutan och Hoppa över alltid syns */
#flaggblixt[data-kort][data-satt="skriv"] .blixt-ram { padding: 6px 12px 8px; }
#flaggblixt[data-kort][data-satt="skriv"] .blixt-spel { gap: 6px; }
#flaggblixt[data-kort][data-satt="skriv"] .blixt-status { min-height: 32px; }
#flaggblixt[data-kort][data-satt="skriv"] .blixt-tid,
#flaggblixt[data-kort][data-satt="skriv"] .blixt-poang { font-size: 1.15rem; }
#flaggblixt[data-kort][data-satt="skriv"] .blixt-scen { min-height: 56px; margin-top: 0; }
#flaggblixt[data-kort][data-satt="skriv"] .blixt-svarrad { height: 0; position: relative; z-index: 2; overflow: visible; }
#flaggblixt[data-kort][data-satt="skriv"] .blixt-svar { transform: translateY(-24px); font-size: .95rem; }
#flaggblixt[data-kort][data-satt="skriv"] .blixt-skriv input { height: 42px; }
#flaggblixt[data-kort][data-satt="skriv"] .blixt-skriv .blixt-knapp { min-height: 42px; }
#flaggblixt[data-kort][data-satt="skriv"] .blixt-skriv .blixt-hoppa-liten { display: inline-flex; }
#flaggblixt[data-kort][data-satt="skriv"] .blixt-nedre { display: none; }

/* slutet */
.blixt-slut { align-items: center; gap: 10px; overflow-y: auto; padding: 4px 0 6px; text-align: center; }
.blixt-slutrubrik { font-size: 1rem; font-weight: 700; color: #9fc6e8; padding-right: 0; margin-top: 4px; }
.blixt-resultat { font-size: 1.25rem; color: #e6eef7; }
.blixt-resultat:focus, #flaggblixt:focus { outline: none; }
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
  // det igenkänningen hörde hålls utanför PostHogs sessionsinspelningar
  // (kakor.js: inspelning för den som sagt ja till kakor; text maskas inte)
  const HORT = 'blixt-hort ph-no-capture';

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
    <p class="blixt-integritet">Mikrofonen är bara på under rundan. Rösten tolkas av webbläsarens tjänst (Google i Chrome, Apple i Safari) – sidan sparar inget.</p>
    <p class="blixt-klocknot" hidden>Quizets klocka bakom fortsätter att gå under tiden.</p>
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
    <div class="blixt-hort ph-no-capture" aria-hidden="true"></div>
    <div class="blixt-mik"><i></i><span class="blixt-miktext"></span></div>
    <form class="blixt-skriv" autocomplete="off">
      <input type="text" aria-label="Landets namn" placeholder="Skriv landets namn …" autocomplete="off"
        autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go">
      <button type="submit" class="blixt-knapp">OK</button>
      <button type="button" class="blixt-knapp blixt-hoppa-liten" aria-label="Hoppa över" title="Hoppa över">⏭</button>
    </form>
    <div class="blixt-nedre"><button type="button" class="blixt-knapp blixt-hoppa">Hoppa över ⏭</button></div>
  </div>
  <div class="blixt-del blixt-slut">
    <div class="blixt-slutrubrik"></div>
    <div class="blixt-resultat" tabindex="-1"></div>
    <div class="blixt-rekordrad"></div>
    <div class="blixt-avbruten"></div>
    <div class="blixt-slutknappar">
      <button type="button" class="blixt-knapp blixt-gron blixt-igen">Spela igen</button>
      <button type="button" class="blixt-knapp blixt-tillbaka">Tillbaka</button>
    </div>
    <ol class="blixt-lista" aria-label="Rundans flaggor"></ol>
  </div>
  <div class="blixt-dold blixt-live ph-no-capture" aria-live="polite" aria-atomic="true"></div>
</div>`;
  document.body.appendChild(rot);
  const $ = s => rot.querySelector(s);
  const ui = {
    stang: $('.blixt-stang'), region: $('.blixt-region'), rekordtext: $('.blixt-rekordtext'), starta: $('.blixt-starta'),
    skrivval: $('.blixt-skrivval'), meddelande: $('.blixt-meddelande'), integritet: $('.blixt-integritet'),
    klocknot: $('.blixt-klocknot'), spel: $('.blixt-spel'),
    tid: $('.blixt-tid'), bar: $('.blixt-bar i'), poang: $('.blixt-poang'), poangTal: $('.blixt-poang b'),
    scen: $('.blixt-scen'), kort: $('.blixt-kort'), flagga: $('.blixt-flagga'), vanttext: $('.blixt-vanttext'),
    splash: $('.blixt-splash'), svar: $('.blixt-svar'), hort: $('.blixt-hort'), mik: $('.blixt-mik'),
    miktext: $('.blixt-miktext'), form: $('.blixt-skriv'), input: $('.blixt-skriv input'), hoppa: $('.blixt-hoppa'),
    hoppaLiten: $('.blixt-hoppa-liten'),
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
  let runda = null;              // { lista, i, poang, resultat, slut, start, gen }
  let timer = 0, nedTimer = 0, svarTimer = 0, felTimer = 0;
  let pausFran = null;           // quizens klocka väntar, om quizet inte börjat (inga svar än)
  let fokusFore = null;
  let hintFore = null;
  let troga = [];                // det vi gjort inert medan panelen är öppen
  // Medan Flaggblixt är öppen går inget bakom att nå: spelet, och det i
  // sidhuvudet och i hörnen som öppnar något ovanpå rundan (▶ flaggvideon,
  // 🧩 delarna, ? genomgången, tyck till, installera). ← och lägesknapparna
  // får vara kvar: de stänger Flaggblixt (uppdatera).
  const BAKOM = ['.game-container', '#spel-video', '#spel-delar', '#spel-hjalp', '#feedback-knapp', '#installera-knapp'];
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
    // mitt i ett quiz: säg det (minuten läggs på quizets tid)
    ui.klocknot.hidden = !(currentMode !== 'explore' && seterraTarget && !pausFran);
    rot.hidden = false;
    document.body.classList.add('blixt-pa');
    troga = [];
    for (const sel of BAKOM) {
      const e = document.querySelector(sel);
      if (e && !e.hasAttribute('inert')) { e.setAttribute('inert', ''); troga.push(e); }
    }
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
    for (const e of troga) e.removeAttribute('inert');
    troga = [];
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
    kompakt();
    storlek();
  }
  // lågt lager (tangentbordet uppe): tätare skrivläge (stilen ovan)
  function kompakt() {
    const h = rot.clientHeight;
    rot.toggleAttribute('data-kort', h > 0 && h < 420);
  }
  // lagret har overflow: hidden, men focus() kan ändå rulla det: klockan
  // överst ska alltid synas
  rot.addEventListener('scroll', () => { if (rot.scrollTop) rot.scrollTop = 0; });
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
  // Spela igen: inte under den första stunden efter slutet (den som skriver
  // och trycker Enter, eller står på Hoppa över, när klockan når 0:00 ska
  // hinna se resultatet)
  let slutVid = 0;
  const SLUTVILA = 900;
  ui.igen.addEventListener('click', () => {
    if (lage !== 'slut' || performance.now() - slutVid < SLUTVILA) return;
    startaRunda(satt === 'rost' && !rostTrasig && SR() ? 'rost' : 'skriv');
  });
  // Esc stänger, var fokus än är (efter Starta står det ofta på sidan själv)
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || lage === 'stangd' || e.defaultPrevented) return;
    e.preventDefault();
    stang();
  });
  rot.tabIndex = -1;

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
    runda = { lista, i: -1, poang: 0, resultat: [], slut: 0, start: 0, gen: 0 };
    sist = null;
    ui.poangTal.textContent = '0';
    ui.tid.textContent = fmt(installningar.tid);
    ui.tid.className = 'blixt-tid';
    ui.bar.style.transform = 'scaleX(1)';
    ui.svar.className = 'blixt-svar';
    ui.hort.textContent = '';
    ui.hort.className = HORT;
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
      ui.input.focus({ preventScroll: true });
      nedrakning(true);
    } else {
      ui.vanttext.textContent = 'Tillåt mikrofonen om webbläsaren frågar …';
      ui.miktext.textContent = 'Startar mikrofonen …';
      ui.mik.classList.remove('pa');
      // fokus kvar i lagret (introt göms): Esc och Tab fungerar
      if (!rot.contains(document.activeElement) || document.activeElement.closest('.blixt-intro, .blixt-slut')) {
        rot.focus({ preventScroll: true });
      }
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
      if (k <= 0) {
        // Kör! i den tomma rutan en kort stund, sedan flaggan och klockan
        // (texten ska inte ligga över flaggan när man ska läsa den)
        if (!installningar.kor) { kor(); return; }
        visaSplash('Kör!');
        nedTimer = setTimeout(kor, installningar.kor);
        return;
      }
      visaSplash(String(k));
      k--;
      nedTimer = setTimeout(steg, installningar.steg);
    };
    ui.vanttext.textContent = '';
    steg();
  }
  function kor() {
    if (lage !== 'nedrakning') return;
    rot.dataset.lage = lage = 'spelar';
    clearTimeout(nedTimer);
    ui.splash.classList.remove('syns');
    runda.start = performance.now();
    runda.slut = runda.start + installningar.tid;
    if (satt === 'rost') ui.miktext.textContent = rek ? 'Lyssnar – säg landets namn' : 'Lyssnar …';
    nasta();
    if (satt === 'skriv' && ui.input.value) ui.input.dispatchEvent(new Event('input'));
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
  // Namnet som visas: Union Jack heter Nordirland i spelets världsdelar
  // (England, Skottland och Wales har egna), men flaggan är Storbritanniens
  const visNamn = c => flaggKod(c) === 'GB' && c.name !== 'Storbritannien' ? `Storbritannien (${c.name})` : c.name;
  // ett namn för en flaggkod (tvillingens, för ✓-rutan)
  const namnFor = kod => (pool.find(x => flaggKod(x) === kod) || {}).name
    || Object.keys(FLAGG_ISO).find(n => FLAGG_ISO[n] === kod) || kod;
  // nästa flagga; utom = resultatet (rösten) vars träff gav bytet: allt annat
  // som hörts räknas som förbrukat (se forbrukaAllt)
  function nasta(utom) {
    if (!runda) return;
    forbrukaAllt(utom);
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
    // (det man hann skriva under Kör! får stå kvar till första flaggan)
    if (satt === 'skriv' && runda.i > 0) ui.input.value = '';
  }
  // rätt svar (kod: det som sades, landet eller tvillingen; nyckel: rösten)
  function ratt(kod, hort, nyckel) {
    const c = aktuell(), r = runda.resultat[runda.resultat.length - 1];
    r.status = 'ratt';
    r.sagt = hort || '';
    runda.poang++;
    ui.poangTal.textContent = String(runda.poang);
    ui.poang.classList.remove('puls');
    void ui.poang.offsetWidth;
    ui.poang.classList.add('puls');
    // tvillingflaggan: det man sa och flaggans land, båda
    const annat = kod !== flaggKod(c) ? namnFor(kod) : '';
    visaSvar('ratt', c, '✓ ' + visNamn(c) + (annat ? ' / ' + annat : ''));
    ui.hort.textContent = '';
    ui.hort.className = HORT;
    spela('ratt');
    sag(annat ? `Rätt, ${annat}! Samma flagga som ${visNamn(c)}. Nästa flagga.` : `Rätt, ${visNamn(c)}! Nästa flagga.`);
    nasta(nyckel);
  }
  function hoppa(kalla_) {
    if (lage !== 'spelar') return;
    const c = aktuell(), r = runda.resultat[runda.resultat.length - 1];
    r.status = r.hort ? 'fel' : 'hoppad';
    visaSvar('hoppad', c, '⏭ ' + visNamn(c));
    ui.hort.textContent = '';
    ui.hort.className = HORT;
    sag(`Hoppade över ${visNamn(c)}. Nästa flagga.`);
    nasta();
    if (satt === 'skriv' && kalla_ === 'knapp') ui.input.focus({ preventScroll: true });
  }
  // fel svar; kongo: "Kongo" sades och flaggan ÄR ett av Kongo (annars
  // vore frågan en ledtråd)
  function fel(text, kongo) {
    const r = runda.resultat[runda.resultat.length - 1];
    r.hort = text;
    // bara ✗ syns (inte förra flaggans gröna ✓ samtidigt, inte ens tonande)
    clearTimeout(svarTimer);
    ui.svar.style.transition = 'none';
    ui.svar.classList.remove('syns');
    void ui.svar.offsetWidth;
    ui.svar.style.transition = '';
    ui.kort.classList.remove('fel');
    void ui.kort.offsetWidth;
    ui.kort.classList.add('fel');
    clearTimeout(felTimer);
    felTimer = setTimeout(() => ui.kort.classList.remove('fel'), 900);
    const vem = satt === 'skriv' ? 'Du skrev' : 'Jag hörde';
    ui.hort.textContent = kongo ? '✗ Vilket Kongo? Kinshasa eller Brazzaville?' : `✗ ${vem}: ${text}`;
    ui.hort.className = HORT + ' fel' + (kongo ? ' kongo' : '');
    spela('fel');
    sag(kongo ? `Vilket Kongo? ${satt === 'skriv' ? 'Skriv' : 'Säg'} Kongo-Kinshasa eller Kongo-Brazzaville.`
      : `Fel, ${vem.toLowerCase()} ${text}.`);
  }
  const arKongo = (k, kod) => !!k && k.tvetydig && k.koder.includes('CD') && k.koder.includes('CG')
    && (kod === 'CD' || kod === 'CG');
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
    // alla flaggor rätt (inte bara slut på flaggor för att man hoppade)
    const allaRatt = orsak === 'alla' && runda.poang === runda.lista.length;
    ui.slutrubrik.textContent = allaRatt ? `Alla flaggor klara på ${fmt(brukt)}! 🎉`
      : orsak === 'alla' ? 'Inga fler flaggor' : avbruten ? 'Rundan avbröts' : 'Tiden är ute!';
    ui.resultat.innerHTML = `<b>${runda.poang}</b> rätt`;
    let rekord = false;
    const fore = lasRekord();
    // rekordet: flest rätt; lika många räknas bara om alla flaggor blev
    // rätt på kortare tid (tid finns bara då)
    let snabbare = false;
    if (!avbruten && hann && runda.poang > 0) {
      const tid = allaRatt ? Math.round(brukt) : null;
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
      const extra = r.status === 'fel' && r.hort
        ? `<small class="ph-no-capture">${satt === 'skriv' ? 'du skrev' : 'jag hörde'}: ${escHtml(r.hort)}</small>` : '';
      return `<li class="${r.status}"><img src="${flaggSrc(r.c)}" alt=""><span class="blixt-ln">${escHtml(visNamn(r.c))}${extra}</span>`
        + `<span class="blixt-st">${ETIKETT[r.status]}</span></li>`;
    }).join('');
    const antal = s => runda.resultat.filter(r => r.status === s).length;
    window.kakSpara?.('flaggblixt_klar', { region: regionKod(), ratt: runda.poang, visade: runda.resultat.length,
      fel: antal('fel'), hoppade: antal('hoppad'), satt, rekord, avbruten, alla: orsak === 'alla' });
    if (hann && !avbruten && runda.poang > 0 && (orsak !== 'alla' || allaRatt)) spela('fanfar');
    sag(`${ui.slutrubrik.textContent} ${runda.poang} rätt.${rekord ? ' Nytt rekord!' : ''}`);
    // Fokus på resultatet först (ett Enter som var menat för rundan startar
    // ingen ny), sedan på Spela igen
    slutVid = performance.now();
    ui.resultat.focus({ preventScroll: true });
    setTimeout(() => {
      const a = document.activeElement;
      if (lage === 'slut' && (a === ui.resultat || a === document.body || a === rot)) ui.igen.focus({ preventScroll: true });
    }, SLUTVILA);
  }
  // allt som går stoppas: mikrofonen, klockan och väntande timrar
  function stoppa() {
    stoppaRost();
    clearInterval(timer);
    clearTimeout(nedTimer);
    clearTimeout(svarTimer);
    clearTimeout(felTimer);
    clearTimeout(skrivTimer);
    avbrytVantan();
    ui.mik.classList.remove('pa');
    ui.splash.classList.remove('syns');
  }

  ui.hoppa.addEventListener('click', () => hoppa('knapp'));
  ui.hoppaLiten.addEventListener('click', () => hoppa('knapp'));

  // ══════════════════════════════════════════════════════════════════
  // Rösten
  // ══════════════════════════════════════════════════════════════════
  let rek = null;                // igenkänningen som lyssnar nu
  let session = 0;               // en ny för varje start (resultatens index börjar om)
  // Vad som hörts och räknats, per resultat ('session:index'), som vikt text
  // ihop + antal ord: { t, n }. sett = allt som hörts i resultatet (översta
  // alternativet; n = flest ord i något alternativ), forbrukt = det som
  // redan räknats (se snitt). sist = det land som just gav poäng och i
  // vilket resultat: samma yttrande ger aldrig två poäng för samma namn.
  let sett = new Map();
  let forbrukt = new Map();
  let sist = null;
  let vantan = null;             // { nyckel, tid } fördröjt godkännande
  let omstarter = [];            // tidpunkter för omstarter utan något resultat (snurrskydd)
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
    // en ny session: de gamla resultaten kommer aldrig mer
    sett = new Map();
    forbrukt = new Map();
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
    r.onresult = e => {
      if (rek !== r) return;
      // en session som ger resultat fungerar: Android och iOS slutar efter
      // varje fras, och det är ingen snurra hur fort man än svarar
      omstarter = [];
      resultat(e, s);
    };
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
  // Startas om när den stannar av sig själv. Fler än 6 omstarter på 4 s utan
  // att något hörts är en snurra (start() kastar, end direkt): skriv i stället.
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
    avbrytVantan();
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
    ui.hort.className = HORT + ' fel';
    sag(text);
    ui.input.focus({ preventScroll: true });
    matt();
    requestAnimationFrame(storlek);
  }

  // ── resultaten ──
  // Bara det som inte räknats än prövas (snitt): ett ord ger aldrig två
  // poäng, och ett "Brasilien" som blir slutgiltigt efter att flaggan bytts
  // (av ett svar, Hoppa över eller en väntan) prövas inte mot nästa flagga.
  // Fortsätter man prata i samma andetag efter ett rätt svar ("Sverige …
  // Norge") prövas de nya orden mot nästa flagga. Under nedräkningen räknas
  // allt som sägs som förbrukat.
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
      const allt = { t: ihop(tolkade[0].ut), n: Math.max(...tolkade.map(o => o.ut.length)) };
      sett.set(nyckel, allt);
      if (lage !== 'spelar') { forbrukt.set(nyckel, allt); continue; }
      provaRost(nyckel, tolkade, !!r.isFinal);
      if (lage !== 'spelar') return;
    }
  }
  // Flaggan byts: allt som hörts hittills räknas som förbrukat, utom i
  // resultatet (utom) vars ord just gav träffen (där gäller orden fram till
  // träffen, så att resten av andetaget prövas mot nästa flagga).
  function forbrukaAllt(utom) {
    for (const [n, v] of sett) {
      if (n === utom) continue;
      const f = forbrukt.get(n);
      if (!f || f.t !== v.t || f.n < v.n) forbrukt.set(n, { t: v.t, n: Math.max(v.n, f ? f.n : 0) });
    }
  }
  // Var det oräknade börjar i ett alternativ (o = ord(...)): efter den
  // längsta början vars text ihop är den förbrukade, eller nära nog
  // (igenkänningen skriver om "sydkorea" till "Syd-Korea" och "chi le" till
  // "Chile Peru" mellan del- och slutresultat). Hittas ingen: samma antal ord.
  function snitt(o, nyckel) {
    const f = forbrukt.get(nyckel);
    if (!f || !f.n) return 0;
    const tol = tal(f.t.length);
    let bastK = -1, bastD = Infinity, s = '';
    for (let k = 1; k <= o.ut.length; k++) {
      s += o.ut[k - 1].t;
      const h = s.replace(/(.)\1+/g, '$1');
      if (h.length - f.t.length > tol) break;
      if (f.t.length - h.length > tol) continue;
      const d = avstand(h, f.t, tol);
      if (d <= tol && d < bastD) { bastD = d; bastK = k; }
    }
    return bastK >= 0 ? bastK : Math.min(f.n, o.ut.length);
  }
  // Alternativen i igenkänningens ordning: det FÖRSTA som säger ett land
  // (säkert nog, eller ett hoppord) avgör. Ett sämre alternativ räknas bara
  // när de bättre inte innehåller något land alls (eller bara ett ungefärligt
  // eller tvetydigt): "Island" först och "Irland" sedan är Island, men
  // "Islandia" (ungefärligt) och sedan "Irland" är Irland.
  // → { o, cut, k, ratt } eller null
  // Ett eko av svaret som nyss räknades (sist) räknas inte, och ger inget ✗:
  // samma namn igen i samma yttrande ("Brasilien Brasilien", "Papua … Nya
  // Guinea"), eller som ett nytt yttrande direkt på flaggan efter ("Chile!"
  // en gång till) om det inte är rätt där (tvillingflaggorna).
  const EKO_MS = 2500;
  const eko = (nyckel, kod) => k => {
    if (!sist || !(k.kod === sist.kod || tvilling(k.kod, sist.kod))) return false;
    if (sist.nyckel === nyckel) return true;
    return !rattFor(k, kod) && runda.i === sist.i + 1 && performance.now() - sist.t < EKO_MS;
  };
  function bestam(tolkade, nyckel, kod) {
    let svag = null, tvet = null;
    const ekot = eko(nyckel, kod);
    for (const o of tolkade) {
      const cut = snitt(o, nyckel);
      if (cut >= o.ut.length) continue;
      const d = avgor(o.ut.slice(cut), kod, ekot);
      if (!d) continue;
      const res = { o, cut, k: d.k, ratt: d.ratt };
      if (d.k.tvetydig) { tvet = tvet || res; continue; }
      if (d.k.kod === HOPPA || d.k.sim >= SAKER - 1e-9) return res;
      svag = svag || res;
    }
    return svag || tvet;
  }
  function provaRost(nyckel, tolkade, slutgiltig) {
    if (vantan && vantan.nyckel === nyckel) avbrytVantan();
    const forsta = tolkade[0];
    for (;;) {
      const kod = flaggKod(aktuell());
      // det som hörts (och inte räknats än) syns direkt
      const c0 = snitt(forsta, nyckel);
      if (c0 < forsta.ut.length || (c0 === 0 && forsta.ra.length)) visaHort(forsta, c0);
      const b = bestam(tolkade, nyckel, kod);
      if (!b || (!b.ratt && b.k.kod !== HOPPA)) {
        if (slutgiltig) slutUtanTraff(nyckel, tolkade, b, kod);
        return;
      }
      const slutOrd = b.cut + b.k.j;
      const text = hortText(b.o, b.cut);
      // Ett hoppord, eller ett namn som kan bli ett annat land (Guinea →
      // Guinea-Bissau, Mali → Malawi), sist i ett delresultat: vänta en
      // stund på fler ord (kommer det fler prövas allt om)
      if (!slutgiltig && slutOrd >= b.o.ut.length && (b.k.kod === HOPPA || riskabel(b.k.s, b.k.kod))) {
        const gen = runda.gen, k = b.k, o = b.o;
        vantan = { nyckel, tid: setTimeout(() => {
          vantan = null;
          if (lage !== 'spelar' || !runda || runda.gen !== gen) return;
          if (k.kod === HOPPA) { hoppa('rost'); return; }
          traff(nyckel, o, slutOrd, k.kod, text);
        }, installningar.fordroj) };
        return;
      }
      // ett hoppord: hela resultatet hittills är förbrukat (nasta)
      if (b.k.kod === HOPPA) hoppa('rost');
      else traff(nyckel, b.o, slutOrd, b.k.kod, text);
      if (lage !== 'spelar') return;
    }
  }
  // rätt med rösten: orden fram till träffen är förbrukade
  function traff(nyckel, o, slutOrd, kod, text) {
    forbrukt.set(nyckel, { t: ihop(o.ut.slice(0, slutOrd)), n: slutOrd });
    sist = { nyckel, kod, i: runda.i, t: performance.now() };
    ratt(kod, text, nyckel);
  }
  // Ett slutresultat utan träff: ✗ om ett annat land (eller en atrapp, eller
  // tvetydiga "Kongo") sades. Upprepar man bara ett land som redan räknats
  // ("Brasilien Brasilien", "Papua … Nya Guinea"), eller sägs inget som
  // liknar ett land alls ("mmm vänta", "nästan", att tänka högt), blir det
  // inget ✗: "Jag hörde: …" står kvar i grått.
  function slutUtanTraff(nyckel, tolkade, b, kod) {
    forbrukt.set(nyckel, sett.get(nyckel) || { t: ihop(tolkade[0].ut), n: tolkade[0].ut.length });
    if (b) fel(hortText(b.o, b.cut), arKongo(b.k, kod));
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
    ui.hort.className = HORT;
  }

  // ══════════════════════════════════════════════════════════════════
  // Tangentbordet (reserven)
  // ══════════════════════════════════════════════════════════════════
  // Ett namn som stämmer exakt godkänns redan medan man skriver, men bara om
  // inget längre namn börjar så (annars hamnar resten av ordet i nästa
  // flaggas ruta: "Elfenbenskust|en", "Trinidad| och Tobago"). Då godkänns
  // det när man slutat skriva en stund, eller vid Enter.
  let skrivTimer = 0;
  const SKRIVPAUS = 600;
  ui.input.addEventListener('input', () => {
    clearTimeout(skrivTimer);
    if (lage !== 'spelar' || satt !== 'skriv') return;
    const varde = ui.input.value;
    const o = ord(varde);
    if (!o.ut.length) return;
    const s = o.ut.map(x => x.t).join('');
    byggTabell();
    const kod = flaggKod(aktuell());
    const exakt = tabell.filter(e => e.f === s && e.alias !== 'tvetydig');
    if (!exakt.length || !exakt.every(e => ARLAND(e.kod) && (e.kod === kod || tvilling(e.kod, kod)))) return;
    const gen = runda.gen;
    const godkann = () => {
      if (lage !== 'spelar' || satt !== 'skriv' || !runda || runda.gen !== gen || ui.input.value !== varde) return;
      ui.input.value = '';
      ratt(exakt[0].kod, varde.trim());
    };
    if (tabell.some(e => e.f.length > s.length && e.f.startsWith(s))) skrivTimer = setTimeout(godkann, SKRIVPAUS);
    else godkann();
  });
  ui.form.addEventListener('submit', e => {
    e.preventDefault();
    clearTimeout(skrivTimer);
    if (lage !== 'spelar') return;
    const text = ui.input.value.trim();
    if (!text) return;
    const kod = flaggKod(aktuell());
    const d = avgor(ord(text).ut, kod, null);
    if (d && d.k.kod === HOPPA) { ui.input.value = ''; hoppa('skriv'); return; }
    if (d && d.ratt) { ui.input.value = ''; ratt(d.k.kod, text); return; }
    fel(text, d ? arKongo(d.k, kod) : false);
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

  // (testerna) väntar ett delresultat med den här texten en stund (riskabel)?
  function vantar(text) {
    const t = tolka(text);
    return t.length === 1 && riskabel(t[0].s, t[0].kod);
  }
  return { uppdatera, oppna, stang, tolka, matcha, matchaKod, normalisera, sjalvkontroll, parkontroll, vantar, installningar,
    lage: lageFor };
})();
// ingångarna direkt (glob-spel.js anropar uppdatera vid varje byte)
window.flaggblixt?.uppdatera();
