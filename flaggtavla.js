// ════════════════════════════════════════════════════════════════════
// Flaggtavlan (bara svenska sajten): flaggorna som på Seterra
// ════════════════════════════════════════════════════════════════════
// När quizens växel (#fraga-val, flagglage) eller Utforskas egen växel
// (#utforska-val, utforskaFlaggor) står på Flaggor täcks kartytan av en
// ljusgrå tavla med en riktig flagga (assets/flaggor) per land i rundan,
// alla lika höga, i centrerade rader. Tavlan skrollar när flaggorna inte
// ryms. Växlarna är oberoende: Flaggor i quizet öppnar inte Utforska på
// tavlan, och tvärtom.
//
//  Bildquiz och Klassiskt Quiz: tavlan blandas en gång när rundan börjar
//    (Öva på felaktiga: samma tavla igen, men bara de missade frågas).
//    Panelen säger landets NAMN och man klickar på rätt flagga; svaret
//    avgörs av seterraClick, precis som ett klick på globen. Rätt: grön ram
//    och ✓, flaggan bleknar och namnet kommer fram under — i Bildquiz vänds
//    den till Jonas minnesbild. Fel: rutan skakar rött, och efter tre missar
//    blinkar den rätta. Rutorna heter bara "Flagga" för skärmläsare tills
//    de hittats, och vid pekaren står "Klicka på Kina" (inte på pekskärm:
//    där står namnet i sidhuvudet också, för liggande mobil).
//    En hittad flagga vänds vid varje klick: minnesbilden ⇄ flaggan (v101).
//    Det är aldrig ett svar: inget seterraClick, ingen poäng, inget felljud
//    och ingen spärr — bara ett mjukt klick. Det går också när rundan är
//    slut, tills tavlan byggs om. Ett land utan minnesbild vänds inte.
//    Ett dubbelklick (dubbeltryck) är ett klick: klicket som hittade
//    flaggan och ett klick till strax efter vänder inte tillbaka.
//    När rundans första flagga hittats står ett tips om vändningen en
//    stund på tavlan (tills man har vänt en hittad flagga en gång).
//    Poäng, tid, rätt, fel och framstegen står överst på tavlan. Panelen
//    har frågan (namnet och Visa ledtråd) fäst överst och svaret under.
//  Utforska: flaggorna i bokstavsordning med namnet under. Ett klick öppnar
//    landets kort (som börjar med rutan Flaggan) och räknas som utforskat —
//    som ett klick på globen — och vänder flaggan till minnesbilden; ett
//    klick till vänder tillbaka (kortet står kvar på landet). Flera rutor
//    kan vara vända samtidigt. Ett dubbelklick vänder en gång.
//  En ny tavla (ny runda, region, Spela igen, annat läge) och en tavla som
//  göms och visas igen börjar med alla rutor på sin vanliga sida.
//
// Globen ligger kvar laddad under tavlan, täckt (inte dold: en dold WebGL-duk
// ritar om varje bildruta, se glob.html .tavla-pa), utan sina knappar, inert
// (går inte att nå med tangentbordet) och utan omritningar: setLand sparar
// bara tillståndet medan kartaTackt är sant, och allt läggs på när kartan
// syns igen. Inga kartkällor eller lager läggs till, och slumpen dras bara i
// flaggläget (ögonblicksbildstestet seedar Math.random).
//
// Klassiska skript delar toppnivåns let/const, så glob-spel.js namn används
// direkt. Byter något av dem namn eller form där går tavlan sönder utan att
// git säger något — kör hela test/regress.mjs efter en ombasering:
//   läge      COUNTRIES aktivByGid aktivSlug currentMode bildlage flagglage
//             utforskaFlaggor kartaTackt tillstand map USA_GID revealed
//             utforskade activeCountry FLAGGBILD
//   quizet    seterraTarget seterraLocked seterraCorrect seterraWrong
//             seterraTargetMisses seterraClick
//   element   cursorLabel headerHint infoCard infoName seterraFeedback
//             seterraHintBox seterraTargetName seterraScoreEl seterraTimeEl
//             seterraCorrectEl seterraWrongEl seterraProgressLabel seterraBar
//   funktioner exploreClick showInfoCard hideExploreTooltip spela shuffle
//             escHtml uppdateraOrdval uppdateraQuizTexter flaggKod flaggSrc
//             FLAGG_FORM flaggTvilling laddaFlaggbilder flaggbildFor
//             flaggbildSrc flatDirty huvudstadDirty origApplyState
// Allt här ligger i en funktion, så inga nya globala namn kan krocka med
// glob-spel.js; det enda som syns utåt är window.flaggtavla, som glob-spel.js
// anropar med ?.:
//   uppdatera()     läge, val eller länder har ändrats (växlarna, switchMode, startRegion)
//   nyRunda(retry)  en quizrunda börjar (startSeterra / startSeterraRetry)
//   fraga()         nästa fråga (nextSeterraTarget)
//   visaRuta(el)    panelens ruta (ledtråden) skrollas fram under frågan (visaLedtrad)
window.flaggtavla = (() => {
  // engelska sajten och USA har inga flaggor: ingen tavla, inga lyssnare
  if (typeof SPRAK === 'undefined' || SPRAK.lang !== 'sv') return null;
  const panel = document.getElementById('map-panel');
  if (!panel) return null;
  const tavla = document.createElement('div');
  tavla.id = 'flaggtavla';
  tavla.lang = 'sv';
  tavla.hidden = true;
  // quizets siffror överst på tavlan (speglar panelens, som göms i flaggläget)
  const status = document.createElement('div');
  status.className = 'tavla-status';
  status.innerHTML = '<span class="ts ts-poang">Poäng <b>100%</b></span>'
    + '<span class="ts ts-tid">Tid <b>0:00</b></span>'
    + '<span class="ts ts-ratt">Rätt <b>0</b></span>'
    + '<span class="ts ts-fel">Fel <b>0</b></span>'
    + '<span class="ts ts-framsteg"><span class="ts-bar"><i></i></span><b>0 / 0</b></span>';
  const [sPoang, sTid, sRatt, sFel, sFram] = [...status.querySelectorAll('b')];
  const sBar = status.querySelector('.ts-bar i');
  // tipset om vändningen, en stund under siffrorna (vinka). Skärmläsaren
  // hör det på knappen i stället ("– visa minnesbilden").
  const vink = document.createElement('div');
  vink.className = 'tavla-vink';
  vink.setAttribute('aria-hidden', 'true');
  vink.textContent = 'Klicka på en hittad flagga för att vända den';
  status.appendChild(vink);
  const rutnat = document.createElement('div');
  rutnat.className = 'tavla-rutnat';
  rutnat.setAttribute('role', 'group');
  // tona ut nederkanten när fler flaggor finns längre ner (rullningslister
  // är avstängda i hela appen, glob.html)
  const mer = document.createElement('div');
  mer.className = 'tavla-mer';
  mer.setAttribute('aria-hidden', 'true');
  tavla.append(status, rutnat, mer);
  panel.appendChild(tavla);

  let lage = '';                 // vad tavlan är byggd för: 'quiz' | 'utforska' | ''
  let byggdFor = '';             // läge + länder, så att den bara byggs om när den måste
  let ordning = [];              // quizets blandade ordning (Öva på felaktiga återanvänder den)
  let egnaTexter = false;        // Utforska-texterna säger "flagga" (uppdateraUtforskStader)
  const rutor = new Map();       // gid → knapp
  // Ett dubbelklick (dubbeltryck) är ett klick: en ruta vänds inte igen
  // förrän så här länge efter förra vändningen, och klicket som hittade en
  // flagga i quizet varar som Bildquizets belöningsvändning.
  const OMVAND_MS = 400, SVAR_MS = 700;
  let vinkat = false;            // tipset har visats den här rundan
  let provat = false;            // en hittad flagga har vänts: då behövs inget tips
  let vinkTid = 0;
  const skarpKo = new Set();     // rutor vars minnesbild ska ritas om större (skarpa)
  let skarpGar = false;

  const syns = () => (flagglage || utforskaFlaggor) && COUNTRIES.length > 0 && !!aktivSlug;
  const nyckel = (l, lista) => l + ':' + lista.map(c => c.gid).join(',');
  const sammaLander = () => rutor.size === COUNTRIES.length && COUNTRIES.every(c => rutor.has(c.gid));
  const mobil = matchMedia('(max-width: 900px)');
  // ingen pekaretikett (pekskärm) eller ingen synlig panelfråga (liggande
  // mobil): namnet står i sidhuvudet också
  const smal = matchMedia('(max-width: 900px), (hover: none)');

  // ── bygget ──
  function bygg(lista, l) {
    lage = l;
    byggdFor = nyckel(l, lista);
    const utf = l === 'utforska';
    tavla.classList.toggle('utforska', utf);
    tavla.scrollTop = 0;
    rutnat.setAttribute('aria-label', utf ? 'Flaggorna: klicka på en flagga för att läsa om landet'
                                          : 'Flaggorna: klicka på rätt flagga');
    rutnat.textContent = '';
    rutor.clear();
    skarpKo.clear();
    vinkat = false;
    dolVink();
    for (const c of lista) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tavla-ruta';
      b.dataset.gid = c.gid;
      const form = FLAGG_FORM[(flaggKod(c) || '').toLowerCase()];
      if (form) b.classList.add(form);
      // quizet: rutan säger inte landet (varken text, alt eller title)
      // förrän flaggan hittats
      b.setAttribute('aria-label', utf ? c.name : 'Flagga');
      if (utf) b.title = c.name;
      b.innerHTML = `<span class="tavla-kort"><img class="tavla-flagga" src="${flaggSrc(c)}" alt="" draggable="false"></span>`
        + `<span class="tavla-namn">${utf ? escHtml(c.name) : ''}</span>`;
      rutor.set(c.gid, b);
      rutnat.appendChild(b);
    }
    namnMatt = utf ? matNamn(lista) : null;
    storlek();
    // Utforska: varje flagga med en minnesbild går att vända (när
    // flaggbilder.json kommit — tavlan kan ha byggts om under tiden)
    if (utf) {
      const nu = byggdFor;
      laddaFlaggbilder().then(() => {
        if (byggdFor !== nu) return;
        for (const c of lista) {
          const b = rutor.get(c.gid);
          if (b && flaggbildFor(c)) gorVandbar(c, b);
        }
      });
    }
  }
  function tom() {
    rutnat.textContent = '';
    rutor.clear();
    skarpKo.clear();
    dolVink();
    byggdFor = '';
    namnMatt = null;
  }

  // ── läget: tavlan eller globen ──
  function uppdatera() {
    const visa = syns();
    const utf = currentMode === 'explore';
    const quiz = visa && !utf;
    // Utforskas vända flaggor vänds tillbaka när tavlan går (Länder,
    // Huvudstäder, ett quiz): kommer den igen börjar alla på flaggan
    if (!visa && !tavla.hidden && lage === 'utforska') vilaAlla();
    tavla.hidden = !visa;
    tavla.classList.toggle('quiz', quiz);
    panel.classList.toggle('tavla-pa', visa);
    document.body.classList.toggle('flaggtavla', visa);
    // globen under tavlan: varken fokus, tangenter eller omritningar
    for (const id of ['spel-map', 'flat-wrap', 'orig-wrap']) document.getElementById(id)?.toggleAttribute('inert', visa);
    tackKartan(visa);
    flyttaHint(quiz);
    flyttaFlaggRuta(visa && utf);
    // kartans utforska-tooltip (upp till 4 s) ska inte ligga kvar över tavlan
    if (visa && cursorLabel.classList.contains('explore-tooltip')) hideExploreTooltip();
    if (!quiz) {
      cursorLabel.classList.remove('tavla-etikett', 'utanfor');
      dolVink();
      satLuft(0);
    }
    // Utforska: sidhuvudet och kortets platshållare talar om flaggor, och
    // tillbaka om länder eller städer när tavlan går (texterna står i
    // glob-spel.js uppdateraUtforskStader, som uppdateraOrdval anropar)
    if ((visa && utf) || egnaTexter) {
      egnaTexter = visa && utf;
      uppdateraOrdval();
    }
    if (!visa) return;
    if (utf) {
      const lista = [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name, 'sv'));
      if (byggdFor !== nyckel('utforska', lista)) bygg(lista, 'utforska');
    } else if (lage !== 'quiz' || !sammaLander()) {
      // hit kommer man bara mellan lägesbytet och rundans start: nyRunda
      // (som alltid följer) bygger och blandar — en gång, och utan slump här
      tom();
      lage = 'quiz';
    }
    synka();
    speglaStatus();
    storlek();
  }

  // en quizrunda börjar: ny blandning (Öva på felaktiga: samma tavla igen,
  // nollställd — alla flaggor går att klicka på, bara de missade frågas)
  function nyRunda(retry) {
    if (!flagglage) return;
    if (!retry || lage !== 'quiz' || !sammaLander()) ordning = shuffle([...COUNTRIES]);
    satLuft(0);
    bygg(ordning, 'quiz');
    uppdatera();
    // "Klicka på …" syns först när pekaren är över tavlan
    cursorLabel.classList.add('tavla-etikett', 'utanfor');
  }

  // nästa fråga: "Klicka på Kina" vid pekaren (vit som på Seterra). Panelen
  // har redan namnet (nextSeterraTarget). Utan pekaretikett står samma text
  // i sidhuvudet: "Klicka på flaggan för …" bröt raden i v104:s fasta tips
  // (340 px) på en platta på tvären (Demokratiska Republiken Kongo).
  function fraga() {
    if (!flagglage || !seterraTarget) return;
    if (!rutor.size) nyRunda();          // (en runda som startats förbi nyRunda)
    cursorLabel.classList.add('tavla-etikett');
    const text = `Klicka på <b>${escHtml(seterraTarget.name)}</b>`;
    cursorLabel.innerHTML = text;
    if (smal.matches) headerHint.innerHTML = text;
    passaMalNamn();
  }
  // mobilen: panelens namn står bredvid Visa ledtråd. Ryms ett ord inte
  // (Centralafrikanska, Ekvatorialguinea på 320 px) eller blir namnet tre
  // rader, får det ett mindre typsnitt (glob.html .target-name.langt)
  function passaMalNamn() {
    const n = seterraTargetName;
    n.classList.remove('langt');
    if (!mobil.matches || !n.clientWidth) return;
    const rad = parseFloat(getComputedStyle(n).lineHeight);
    if (n.scrollWidth > n.clientWidth + 1 || n.offsetHeight > rad * 2.5) n.classList.add('langt');
  }
  const smalByte = () => {
    if (!flagglage) return;
    uppdateraQuizTexter();
    fraga();
  };
  if (smal.addEventListener) smal.addEventListener('change', smalByte);
  else if (smal.addListener) smal.addListener(smalByte);

  // ── klicken ──
  rutnat.addEventListener('click', e => {
    const b = e.target.closest('.tavla-ruta');
    if (!b || !rutnat.contains(b)) return;
    const c = aktivByGid.get(+b.dataset.gid);
    if (!c) return;
    if (lage === 'utforska') utforskaKlick(c, b);
    else quizKlick(c, b);
  });
  // Minnesbilden ritas i förväg när ett klick är på väg (pekaren stannar på
  // en vändbar flagga, ett tryck börjar, tangentbordet når den), så att
  // vändningen inte väntar på den stora bilden. (Klassiskt Quiz ritar
  // dessutom när datorn har tid efter att flaggan hittats, se hittad.)
  let pekRuta = null, pekTid = 0;
  rutnat.addEventListener('pointerover', e => {
    const b = e.target.closest('.tavla-ruta');
    if (b === pekRuta) return;
    pekRuta = b;
    clearTimeout(pekTid);
    if (b) pekTid = setTimeout(() => forladda(b), 150);
  });
  rutnat.addEventListener('pointerleave', () => { pekRuta = null; clearTimeout(pekTid); });
  for (const typ of ['pointerdown', 'focusin']) {
    rutnat.addEventListener(typ, e => {
      const b = e.target.closest('.tavla-ruta');
      if (b) forladda(b);
    });
  }
  function forladda(b) {
    if (!b.isConnected || !b.classList.contains('vandbar') || b.minneP) return;
    const c = aktivByGid.get(+b.dataset.gid);
    if (c) minnesbild(c, b);
  }
  const ledigt = f => window.requestIdleCallback ? requestIdleCallback(f, { timeout: 2000 }) : setTimeout(f, 300);

  // Är klicket en ny vändning, eller resten av ett dubbelklick? (Klicket
  // som hittade flaggan och klick på samma ruta tätare än OMVAND_MS.)
  function nyVandning(b) {
    const nu = performance.now();
    if (nu - (b.hittadNar || -1e9) < SVAR_MS || nu - (b.vandNar || -1e9) < OMVAND_MS) return false;
    b.vandNar = nu;
    return true;
  }

  function quizKlick(c, b) {
    if (currentMode === 'explore' || !flagglage) return;
    // en hittad flagga vänds (minnesbilden ⇄ flaggan) och är aldrig ett
    // svar: före spärren och frågan, så att det går mitt i ett felklicks
    // spärr och när rundan är slut. Utan minnesbild händer inget, och
    // resten av ett dubbelklick (det som hittade den) vänder inte tillbaka:
    // då försvann Bildquizets minnesbild direkt.
    if (b.classList.contains('hittad')) {
      if (b.classList.contains('vandbar') && nyVandning(b)) {
        provat = true;
        dolVink();
        vand(c, b, !b.vilMinne, true);
      }
      return;
    }
    if (!seterraTarget || seterraLocked || revealed.has(c.gid)) return;
    const fragan = seterraTarget, ratt = seterraCorrect, fel = seterraWrong;
    seterraClick(c);                   // poäng, ljud, panelen, nästa fråga
    visaRuta(seterraFeedback);
    if (seterraCorrect > ratt) {
      hittad(c, b);
      if (!seterraTarget) uppdateraQuizTexter();    // rundan är slut: sidhuvudet utan namn
    } else if (seterraWrong > fel) {
      blixt(b, 'fel', 900);
      // tre missar på samma fråga: den rätta flaggan blinkar (som blinkHint)
      if (seterraTarget === fragan && seterraTargetMisses >= 3) tipsa(fragan);
    } else if (flaggTvilling(c, fragan)) {
      blixt(b, 'tvilling', 1100);      // nästan samma flagga: inget fel (seterraClick)
    }
  }

  function hittad(c, b) {
    b.classList.remove('fel', 'tips', 'tvilling');
    b.classList.add('hittad');
    // tills den visat sig gå att vända (gorVandbar): en ruta utan
    // minnesbild tar inga fler klick
    b.setAttribute('aria-disabled', 'true');
    b.setAttribute('aria-label', c.name + ', hittad');
    b.querySelector('.tavla-namn').textContent = c.name;
    b.title = c.name;
    b.hittadNar = performance.now();
    laddaFlaggbilder().then(() => {
      if (!b.isConnected || !flaggbildFor(c)) return;
      gorVandbar(c, b);
      vinka();
      if (!bildlage) ledigt(() => forladda(b));
    });
    if (bildlage) vand(c, b, true);
  }

  // Första gången i en runda som en hittad flagga går att vända: ett tips
  // på tavlan en stund (också på pekskärmen, som inte har någon hovring).
  // Har man vänt en hittad flagga en gång behövs det inte mer.
  function vinka() {
    if (vinkat || provat || lage !== 'quiz') return;
    vinkat = true;
    vink.classList.add('syns');
    clearTimeout(vinkTid);
    vinkTid = setTimeout(dolVink, 5000);
  }
  function dolVink() {
    clearTimeout(vinkTid);
    vink.classList.remove('syns');
  }

  // ── vändningen: flaggan ⇄ Jonas minnesbild ──
  // Bildquiz vänder den hittade flaggan till minnesbilden, så tavlan fylls
  // med hans teckningar (som konsten på globen). Sedan vänds en hittad
  // flagga vid varje klick (Klassiskt Quiz: från den bleka flaggan, och
  // tillbaka till den bleka), och i Utforska vid varje klick på flaggan.
  // Utan minnesbild (ett land som saknar en, eller innan flaggbilder.json
  // laddat) vänds inget.
  //   .vandbar     rutan går att vända (pekare, hovring, aria-pressed)
  //   .vand        minnesbilden är den sida som visas (eller vänds fram)
  //   .minne       3D-läget, bara medan vändningen pågår: annars får varje
  //                ruta ett eget GPU-lager (en världsrunda har 202)
  //   .vand-klar   i vila med minnesbilden: platt, utan flaggan
  //   .flagga-igen Bildquiz: flaggan har vänts fram igen, hel och inte blek
  //                (den är det man vill se där)
  //   .direkt      ett ögonblick utan övergångar (in i 3D-läget utan ryck)
  // b.vilMinne är sidan som senast begärdes: ett klick begär den andra,
  // också medan bilden laddar eller rutan vänds (vändningen går då
  // tillbaka därifrån den är).
  function gorVandbar(c, b) {
    if (b.classList.contains('vandbar')) return;
    b.classList.add('vandbar');
    b.removeAttribute('aria-disabled');
    etikett(c, b);
  }
  // skärmläsaren: knappen säger vad ett klick gör, aria-pressed vilken sida
  // som visas. (I quizet säger en ohittad ruta fortfarande bara "Flagga".)
  // Med musen säger en hittad flagga att den går att vända.
  function etikett(c, b) {
    if (!c || !b.classList.contains('vandbar')) return;
    const minne = b.classList.contains('vand'), hittad = b.classList.contains('hittad');
    b.setAttribute('aria-pressed', minne ? 'true' : 'false');
    b.setAttribute('aria-label', c.name + (hittad ? ', hittad' : '')
      + (minne ? ' – visa flaggan' : ' – visa minnesbilden'));
    if (hittad) b.title = c.name + ' – klicka för att vända';
  }
  // ljud: quizets mjuka klick, när vändningen börjar (Utforska har sitt eget)
  function vand(c, b, tillMinne, ljud) {
    b.vilMinne = tillMinne;
    minnesbild(c, b).then(bild => {
      if (!b.isConnected || b.vilMinne !== tillMinne) return;
      // ingen bild (gick inte att hämta, tavlan gömdes): rutan står kvar,
      // och nästa klick ska begära den andra sidan än den som syns
      if (!bild) { b.vilMinne = b.classList.contains('vand'); return; }
      if (ljud) spela('klick');
      snurra(c, b, tillMinne);
      if (tillMinne) skarpa(b);
    });
  }
  // Själva vändningen, lika åt båda hållen: 3D-läget slås på utan att något
  // syns hoppa (samma sida som nu), och nästa bildruta vrids kortet.
  function snurra(c, b, tillMinne) {
    clearTimeout(b.vandTid);
    cancelAnimationFrame(b.vandRaf);
    if (!b.classList.contains('minne')) {
      if (b.classList.contains('vand') === tillMinne) return etikett(c, b);
      b.classList.add('direkt', 'minne');
      b.classList.remove('vand-klar');
      void b.firstChild.offsetWidth;
      b.classList.remove('direkt');
    }
    if (!tillMinne && lage === 'quiz' && bildlage) b.classList.add('flagga-igen');
    b.vandRaf = requestAnimationFrame(() => {
      b.classList.toggle('vand', tillMinne);
      etikett(c, b);
      b.vandTid = setTimeout(() => {
        b.classList.toggle('vand-klar', tillMinne);
        b.classList.remove('minne');
      }, 700);
    });
  }
  // tillbaka till flaggan direkt, utan vändning (tavlan gömdes, passet nollades)
  function vila(c, b) {
    clearTimeout(b.vandTid);
    cancelAnimationFrame(b.vandRaf);
    b.vilMinne = false;
    b.vantar = false;
    b.classList.remove('minne', 'vand', 'vand-klar', 'flagga-igen');
    etikett(c, b);
  }
  function vilaAlla() {
    for (const [gid, b] of rutor) if (b.vilMinne || b.vantar || b.classList.contains('vand')) vila(aktivByGid.get(gid), b);
  }
  // Minnesbilden ritas en gång per ruta och sparas i den (ligger dold när
  // flaggan visas). Bilden är 800×450 men rutan några tiotal pixlar: den
  // ritas ner till rutans storlek och blir en liten egen bild, så att en
  // hel världsrunda inte håller hundratals stora avkodade bilder i minnet.
  // (En canvas direkt i rutan blir ett eget GPU-lager per ruta.) Den läggs
  // i rutan först när den är avkodad: vänds aldrig till en tom baksida.
  // Gick laddningen fel försöker nästa klick igen.
  function minnesbild(c, b) {
    if (b.minneP) return b.minneP;
    const igen = () => { if (b.minneP === p) b.minneP = null; return null; };
    const p = b.minneP = laddaFlaggbilder().then(() => {
      const fb = flaggbildFor(c);
      if (!fb) return FLAGGBILD.size ? null : igen();
      return ritaNer(fb, b).then(ner => {
        if (!ner) return igen();                                     // tavlan gömdes under tiden
        const bild = new Image();
        bild.className = 'tavla-minne';
        bild.alt = '';
        bild.draggable = false;
        bild.dataset.bild = flaggbildSrc(fb);
        bild.src = ner.src;
        return bild.decode().then(() => {
          if (!b.isConnected) return null;
          b.querySelector('.tavla-kort').appendChild(bild);
          b.minneH = ner.h;
          return bild;
        });
      });
    }).catch(igen);
    return p;
  }
  // den stora bilden, nerritad till rutans storlek nu: { src, h } (rutans
  // höjd), eller null när rutan inte syns
  function ritaNer(fb, b) {
    const stor = new Image();
    stor.src = flaggbildSrc(fb);
    return stor.decode().then(() => {
      const kort = b.querySelector('.tavla-kort');
      if (!b.isConnected || kort.offsetWidth < 4) return null;
      return { src: nedskalad(stor, kort), h: kort.offsetHeight };
    });
  }
  // Tavlan har växt (fönstret, en vriden mobil, panelen): en minnesbild som
  // ritats för en mindre ruta blir suddig. Den ritas om när den visas, en
  // ruta i taget när det finns tid; den gamla syns tills den nya är klar.
  function skarpa(b, h = b.querySelector('.tavla-kort').offsetHeight) {
    if (!b.minneH || h <= b.minneH * 1.15) return;
    skarpKo.add(b);
    if (!skarpGar) {
      skarpGar = true;
      ledigt(skarpNasta);
    }
  }
  function skarpNasta() {
    const b = skarpKo.values().next().value;
    if (!b) { skarpGar = false; return; }
    skarpKo.delete(b);
    const c = aktivByGid.get(+b.dataset.gid), fb = c && flaggbildFor(c);
    const bild = b.querySelector('.tavla-minne');
    const kort = b.querySelector('.tavla-kort');
    const klar = () => ledigt(skarpNasta);
    if (!fb || !bild || !b.isConnected || !b.classList.contains('vand') || kort.offsetHeight <= b.minneH * 1.15) return klar();
    ritaNer(fb, b).then(ner => {
      if (!ner) return;
      const ny = new Image();
      ny.src = ner.src;
      return ny.decode().then(() => {
        bild.src = ner.src;
        b.minneH = ner.h;
      });
    }).catch(() => {}).then(klar);
  }
  // minnesbilden i rutans storlek (×2 för skarpa skärmar), som data-URL
  function nedskalad(img, kort) {
    const r = kort.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
    const duk = document.createElement('canvas');
    duk.width = w;
    duk.height = h;
    const ctx = duk.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    const iw = img.naturalWidth, ih = img.naturalHeight;
    if (Math.abs(w / h - iw / ih) / (iw / ih) > 0.25) {
      // kvadraten (Schweiz, Vatikanstaten) och vimpeln (Nepal): hela bilden
      const s = Math.min(w / iw, h / ih);
      ctx.drawImage(img, (w - iw * s) / 2, (h - ih * s) / 2, iw * s, ih * s);
    } else {
      // 3:2-rutan: som object-fit: cover
      const s = Math.max(w / iw, h / ih), sw = w / s, sh = h / s;
      ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, w, h);
    }
    return duk.toDataURL('image/webp', 0.9);
  }

  // en kort markering (fel, tips, tvilling) som börjar om vid nytt klick
  function blixt(b, klass, ms) {
    b.classList.remove(klass);
    void b.offsetWidth;
    b.classList.add(klass);
    clearTimeout(b['tid_' + klass]);
    b['tid_' + klass] = setTimeout(() => b.classList.remove(klass), ms);
  }
  // tre missar: den rätta flaggan blinkar. Ligger den utanför bild skrollas
  // tavlan så att den hamnar mitt i (inte under statusraden eller tonen
  // nertill), och blinkningen börjar om när skrollningen är klar.
  let tipsTid = 0;
  function tipsa(c) {
    const b = rutor.get(c.gid);
    if (!b) return;
    blixt(b, 'tips', 1800);
    const br = b.getBoundingClientRect(), tr = tavla.getBoundingClientRect();
    const ovan = tr.top + (tavla.classList.contains('quiz') ? status.offsetHeight : 0);
    const under = tr.bottom - (tavla.classList.contains('mer-under') ? 34 : 0);
    if (br.top >= ovan + 4 && br.bottom <= under - 4) return;
    const mitt = (ovan + tr.bottom) / 2;
    tavla.scrollTo({ top: tavla.scrollTop + (br.top + br.height / 2 - mitt), behavior: 'smooth' });
    clearTimeout(tipsTid);
    tipsTid = setTimeout(() => {
      if (b.isConnected && !b.classList.contains('hittad') && seterraTarget === c) blixt(b, 'tips', 1800);
    }, 450);
  }

  // Utforska: som ett klick på globen — landet avtäcks (även på globen) och
  // räknas som utforskat. Ett klick till döljer inget, kortet visas igen.
  // Kortet börjar med Flaggan (flyttaFlaggRuta), och panelen visas från
  // början så att det är det man ser. Flaggan vänds till minnesbilden, och
  // tillbaka vid nästa klick (kortet visar landet ändå). Det andra klicket
  // i ett dubbelklick visar kortet som förut men vänder inte tillbaka.
  function utforskaKlick(c, b) {
    if (currentMode !== 'explore') return;
    const vanda = nyVandning(b);
    if (revealed.has(c.gid)) { spela('klick'); showInfoCard(c); }
    else exploreClick(c, null);
    synka();
    if (vanda) {
      if (b.classList.contains('vandbar')) vand(c, b, !b.vilMinne);
      else vantaPaBilder(c, b);
    }
    const rulla = infoCard.closest('.info-panel-content');
    if (rulla) rulla.scrollTop = 0;
  }
  // flaggbilder.json hade inte kommit (eller gick inte att läsa förut):
  // vänd när den finns, om landet har en minnesbild. Klicken medan man
  // väntar räknas: två klick är tillbaka på flaggan.
  function vantaPaBilder(c, b) {
    b.vantar = !b.vantar;
    if (b.vantarP) return;
    b.vantarP = laddaFlaggbilder().then(() => {
      b.vantarP = null;
      const vill = b.vantar;
      b.vantar = false;
      if (!b.isConnected || !flaggbildFor(c)) return;
      gorVandbar(c, b);
      if (vill && !tavla.hidden && utforskade.has(c.gid)) vand(c, b, true);
    });
  }

  // Utforskas bockar och kortets blå ram. Ett nytt pass (Utforska igen,
  // Huvudstäder och tillbaka) vänder också flaggorna tillbaka.
  function synka() {
    if (lage !== 'utforska') return;
    const kort = infoCard.classList.contains('active');
    for (const [gid, b] of rutor) {
      const utforskad = utforskade.has(gid);
      b.classList.toggle('utforskad', utforskad);
      b.classList.toggle('aktiv', kort && activeCountry === gid);
      if (!utforskad && (b.vilMinne || b.vantar || b.classList.contains('vand'))) vila(aktivByGid.get(gid), b);
    }
  }

  // ── panelen ──
  // Quizet: Visa ledtråd står i frågans fästa block (under namnet), så att
  // den syns hela rundan även när svaret har skrollat panelen. Tillbaka på
  // sin plats i alla andra lägen.
  const malRuta = document.querySelector('#seterra-game .seterra-target');
  const hintRad = document.querySelector('#seterra-game .seterra-hint-row');
  const hintKnappar = hintRad && hintRad.querySelector('.hint-knappar');
  function flyttaHint(pa) {
    if (!malRuta || !hintKnappar) return;
    if (pa && hintKnappar.parentNode !== malRuta) malRuta.appendChild(hintKnappar);
    else if (!pa && hintKnappar.parentNode !== hintRad) hintRad.insertBefore(hintKnappar, hintRad.firstChild);
  }
  // Utforska: rutan Flaggan direkt under landets namn (man klickade ju på
  // flaggan). Kartans kort har den på sin vanliga plats.
  const flaggRuta = document.getElementById('info-flagga');
  const flaggPlats = document.createComment('info-flagga');
  if (flaggRuta) flaggRuta.before(flaggPlats);
  function flyttaFlaggRuta(forst) {
    if (!flaggRuta || !infoName) return;
    if (forst && flaggRuta.previousElementSibling !== infoName) infoName.after(flaggRuta);
    else if (!forst && flaggPlats.nextSibling !== flaggRuta) flaggPlats.after(flaggRuta);
  }
  // Panelens ruta (svaret, ledtråden) skrollas fram under den fästa frågan:
  // ryms den visas den helt med så lite skroll som möjligt, annars börjar
  // den direkt under frågan. Frågans block mäts (det växer med långa namn
  // och knappen). Panelen skrollas för hand: scrollIntoView kan flytta sidan.
  // Rubrikraden ovanför (Klassiskt Quiz och växeln) står antingen hel eller
  // är helt bortskrollad, aldrig halvt kapad: ett stopp mitt i den rundas
  // upp till dess underkant. Där har frågan ännu inte börjat glida över
  // något, så rutan syns ändå.
  // Räcker panelens innehåll inte till för att skrolla bort hela rubrikraden
  // (svaret är bara lite högre än det som syns: 390 × 844 efter ett fel,
  // då syntes 10 px av växeln), får frågerutan den luft som fattas under
  // sig. Luften tas bort när rundan eller läget byts.
  const rubrikRad = document.querySelector('#seterra-ui > .info-header');
  const spelRuta = document.getElementById('seterra-game');
  let luft = 0;
  function satLuft(px) {
    if (!spelRuta || px === luft) return;
    const bas = parseFloat(getComputedStyle(spelRuta).paddingBottom) - luft;
    luft = px;
    spelRuta.style.paddingBottom = px ? (bas + px) + 'px' : '';
  }
  function visaRuta(el) {
    // en minnesbild som ännu laddar gör rutan högre efteråt (den visades
    // då kapad nertill, med hela rubrikraden ovanför): mät igen när den kommit
    if (el) for (const img of el.querySelectorAll('img')) {
      if (!img.complete) img.addEventListener('load', () => visaRuta(el), { once: true });
    }
    requestAnimationFrame(() => {
      const rulla = el && el.closest('.info-panel-content');
      if (!rulla || !flagglage || !el.firstChild || el.style.display === 'none') return;
      const r = el.getBoundingClientRect(), p = rulla.getBoundingClientRect();
      const topp = p.top + (malRuta ? malRuta.offsetHeight : 0) + 8;
      let flytt = 0;
      if (r.top < topp) flytt = r.top - topp;
      else if (r.bottom > p.bottom) flytt = Math.min(r.bottom - p.bottom + 6, r.top - topp);
      let mal = rulla.scrollTop + flytt;
      if (rubrikRad && rulla.contains(rubrikRad) && mal > 0) {
        const kant = Math.ceil(rubrikRad.getBoundingClientRect().bottom - p.top + rulla.scrollTop);
        if (mal < kant) mal = kant;
        satLuft(Math.max(0, kant - (rulla.scrollHeight - luft - rulla.clientHeight)));
      } else satLuft(0);
      if (Math.abs(mal - rulla.scrollTop) > 1) rulla.scrollTo({ top: mal, behavior: 'smooth' });
    });
  }

  // quizets siffror på tavlan: speglar panelens (updateSeterraUI, timern)
  function speglaStatus() {
    if (!tavla.classList.contains('quiz')) return;
    sPoang.textContent = seterraScoreEl.textContent;
    sTid.textContent = seterraTimeEl.textContent;
    sRatt.textContent = seterraCorrectEl.textContent;
    sFel.textContent = seterraWrongEl.textContent;
    sFram.textContent = seterraProgressLabel.textContent;
    sBar.style.width = seterraBar.style.width || '0%';
  }
  if (window.MutationObserver) {
    const obs = new MutationObserver(speglaStatus);
    const stats = document.querySelector('#seterra-game .seterra-stats');
    if (stats) obs.observe(stats, { subtree: true, childList: true, characterData: true });
    obs.observe(seterraProgressLabel, { childList: true, characterData: true, subtree: true });
    obs.observe(seterraBar, { attributes: true, attributeFilter: ['style'] });
  }

  // ── globen under tavlan ──
  // setLand sparar bara tillståndet medan tavlan täcker kartan; när den
  // syns igen läggs allt på i ett svep (som när kartstilen laddat klart).
  function tackKartan(pa) {
    if (typeof kartaTackt === 'undefined' || kartaTackt === pa) return;
    kartaTackt = pa;
    if (pa) return;
    for (const [gid, t] of tillstand) {
      if (gid >= USA_GID) continue;      // delstaterna har aldrig någon tavla
      if (map) {
        try {
          map.setFeatureState({ source: 'regioner', id: gid }, t);
          map.setFeatureState({ source: 'markorer', id: gid }, t);
          map.setFeatureState({ source: 'borders', id: gid }, t);
        } catch (e) { /* stilen laddar: map.on('load') lägger på tillstand */ }
      }
      origApplyState(gid, t);
    }
    flatDirty();
    huvudstadDirty();
  }

  // ── storleken: alla flaggor lika höga, så stora som ytan tillåter ──
  // Den största höjd (upp till taket) där hela tavlan ryms utan att skrolla —
  // i quizet ska man helst se alla flaggor på en gång. Räcker inte vanliga
  // mellanrum prövas tätare rader och smalare kanter, ner till ett nödgolv.
  // Ryms den inte ens då skrollar tavlan, och flaggorna får en bekväm
  // storlek i stället (mobilen, de stora världsrundorna).
  // Utforska har namnen under: upp till tre rader, och ett namn vars
  // längsta ord inte ryms krymper lite (Centralafrikanska republiken).
  let namnMatt = null;           // Utforska: namnens ord, uppmätta vid 100 px
  let mellanrum = 0;
  let matDuk = null;
  function matNamn(lista) {
    matDuk = matDuk || document.createElement('canvas').getContext('2d');
    if (!matDuk) return null;
    matDuk.font = '700 100px ' + getComputedStyle(tavla).fontFamily;
    mellanrum = matDuk.measureText(' ').width;
    return lista.map(c => {
      const delar = [];
      c.name.split(/\s+/).forEach((ord, i) => {
        const bitar = ord.split('-');
        bitar.forEach((t, j) => delar.push({
          w: matDuk.measureText(t + (j < bitar.length - 1 ? '-' : '')).width, ny: i > 0 && j === 0 }));
      });
      return { gid: c.gid, delar, langst: Math.max(...delar.map(d => d.w)) };
    });
  }
  const skalaFor = (m, W, f) => Math.max(0.8, Math.min(1, W / (m.langst * f / 100)));
  function raderFor(m, W, f) {
    let n = 1, x = 0;
    for (const d of m.delar) {
      const w = d.w * f / 100, s = d.ny ? mellanrum * f / 100 : 0;
      if (x > 0 && x + s + w > W) { n++; x = w; }
      else x += (x > 0 ? s : 0) + w;
      if (w > W) { n += Math.ceil(w / W) - 1; x = w % W; }
    }
    return n;
  }
  function matt(h, liten, utf, tat) {
    const namn = Math.round(Math.max(liten ? 11 : 12, Math.min(13.5, h * 0.15)) * 10) / 10;
    const gx = tat ? Math.round(h * 0.18) + 4 : liten ? Math.round(h * 0.22) + 4 : Math.round(h * 0.3) + 8;
    const gy = tat ? Math.round(h * 0.18) + 6 : liten ? Math.round(h * 0.2) + 6 : Math.round(h * 0.26) + 10;
    // datorn: ?- och ljudknapparna ligger över tavlans nedre vänstra hörn
    const px = liten ? 10 : tat ? 32 : 48;
    const pt = liten ? 12 : tat ? 14 : 24, pb = liten ? 22 : tat ? 18 : 28;
    const W = h * 1.5 + gx - 10;        // namnets bredd (får gå ut i mellanrummet)
    let rader = 1;
    if (utf && namnMatt) {
      rader = 1;
      for (const m of namnMatt) rader = Math.max(rader, Math.min(3, raderFor(m, W, namn * skalaFor(m, W, namn))));
    }
    return { h, namn, gx, gy, px, pt, pb, W, rader, namnH: Math.ceil(namn * 1.25) * rader + 5 };
  }
  function storlek() {
    if (tavla.hidden || !rutor.size) return;
    const liten = mobil.matches, utf = lage === 'utforska';
    const B = tavla.clientWidth;
    const H = tavla.clientHeight - (tavla.classList.contains('quiz') ? status.offsetHeight : 0);
    if (B <= 0 || H <= 0) return;
    const n = rutor.size;
    const ryms = (h, tat) => {
      const m = matt(h, liten, utf, tat);
      const per = Math.max(1, Math.floor((B - 2 * m.px + m.gx) / (h * 1.5 + m.gx)));
      return Math.ceil(n / per) * (h + m.namnH + m.gy) - m.gy <= H - m.pt - m.pb ? m : null;
    };
    const tak = liten ? 64 : 100;
    const golv = liten ? 50 : utf ? 60 : 44;
    const nod = liten ? 50 : utf ? 52 : 40;
    let vanlig = null, tat = null;
    for (let h = tak; h >= golv && !vanlig; h -= 2) vanlig = ryms(h, false);
    for (let h = tak; h >= nod && !tat; h -= 2) tat = ryms(h, true);
    const m = vanlig && (!tat || vanlig.h >= tat.h - 4) ? vanlig
      : tat || matt(liten ? 50 : utf ? 64 : 56, liten, utf, false);
    tavla.style.setProperty('--h', m.h + 'px');
    tavla.style.setProperty('--gx', m.gx + 'px');
    tavla.style.setProperty('--gy', m.gy + 'px');
    tavla.style.setProperty('--namn', m.namn + 'px');
    tavla.style.setProperty('--namnrader', m.rader);
    tavla.style.setProperty('--px', m.px + 'px');
    tavla.style.setProperty('--pt', m.pt + 'px');
    tavla.style.setProperty('--pb', m.pb + 'px');
    // en större tavla: minnesbilderna som syns ritas om (skarpa)
    for (const b of rutor.values()) if (b.minneH && b.classList.contains('vand')) skarpa(b, m.h);
    if (utf && namnMatt) {
      for (const nm of namnMatt) {
        const b = rutor.get(nm.gid), s = skalaFor(nm, m.W, m.namn);
        if (!b) continue;
        if (s < 1) b.style.setProperty('--skala', s.toFixed(3));
        else b.style.removeProperty('--skala');
      }
    }
    merUnder();
  }
  function merUnder() {
    tavla.classList.toggle('mer-under', tavla.scrollTop + tavla.clientHeight < tavla.scrollHeight - 6);
  }
  tavla.addEventListener('scroll', merUnder, { passive: true });
  let storlekRaf = 0;
  const omStorlek = () => {
    cancelAnimationFrame(storlekRaf);
    storlekRaf = requestAnimationFrame(storlek);
  };
  if (window.ResizeObserver) new ResizeObserver(omStorlek).observe(tavla);
  window.addEventListener('resize', omStorlek);

  // "Klicka på Kina" syns bara medan musen är över tavlan
  tavla.addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse') cursorLabel.classList.remove('utanfor');
  });
  tavla.addEventListener('pointerleave', () => cursorLabel.classList.add('utanfor'));

  return { uppdatera, nyRunda, fraga, visaRuta };
})();
