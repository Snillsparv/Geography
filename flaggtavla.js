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
//    Poäng, tid, rätt, fel och framstegen står överst på tavlan. Panelen
//    har frågan (namnet och Visa ledtråd) fäst överst och svaret under.
//  Utforska: flaggorna i bokstavsordning med namnet under. Ett klick öppnar
//    landets kort (som börjar med rutan Flaggan) och räknas som utforskat —
//    som ett klick på globen.
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
//             utforskade activeCountry
//   quizet    seterraTarget seterraLocked seterraCorrect seterraWrong
//             seterraTargetMisses seterraClick
//   element   cursorLabel headerHint infoCard infoName seterraFeedback
//             seterraHintBox seterraScoreEl seterraTimeEl seterraCorrectEl
//             seterraWrongEl seterraProgressLabel seterraBar
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
  }
  function tom() {
    rutnat.textContent = '';
    rutor.clear();
    byggdFor = '';
    namnMatt = null;
  }

  // ── läget: tavlan eller globen ──
  function uppdatera() {
    const visa = syns();
    const utf = currentMode === 'explore';
    const quiz = visa && !utf;
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
    if (!quiz) cursorLabel.classList.remove('tavla-etikett', 'utanfor');
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
    bygg(ordning, 'quiz');
    uppdatera();
    // "Klicka på …" syns först när pekaren är över tavlan
    cursorLabel.classList.add('tavla-etikett', 'utanfor');
  }

  // nästa fråga: "Klicka på Kina" vid pekaren (vit som på Seterra). Panelen
  // har redan namnet (nextSeterraTarget).
  function fraga() {
    if (!flagglage || !seterraTarget) return;
    if (!rutor.size) nyRunda();          // (en runda som startats förbi nyRunda)
    cursorLabel.classList.add('tavla-etikett');
    cursorLabel.innerHTML = `Klicka på <b>${escHtml(seterraTarget.name)}</b>`;
    if (smal.matches) headerHint.innerHTML = `Klicka på flaggan för <b>${escHtml(seterraTarget.name)}</b>`;
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
    if (lage === 'utforska') utforskaKlick(c);
    else quizKlick(c, b);
  });

  function quizKlick(c, b) {
    if (currentMode === 'explore' || !flagglage || !seterraTarget || seterraLocked || revealed.has(c.gid)) return;
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
    b.setAttribute('aria-disabled', 'true');
    b.setAttribute('aria-label', c.name + ', hittad');
    b.querySelector('.tavla-namn').textContent = c.name;
    b.title = c.name;
    if (bildlage) vand(c, b);
  }

  // Bildquiz: den hittade flaggan vänds till Jonas minnesbild, så tavlan
  // fylls med hans teckningar (som konsten på globen). Utan minnesbild (ett
  // land som saknar en, eller innan flaggbilder.json laddat) bleknar den bara.
  // Bilden är 800×450 men rutan några tiotal pixlar: den ritas ner till
  // rutans storlek och blir en liten egen bild, så att en hel världsrunda
  // inte håller hundratals stora avkodade bilder i minnet. (En canvas
  // direkt i rutan blir ett eget GPU-lager per ruta.) 3D-läget finns bara
  // under själva vändningen: sedan är rutan platt igen.
  function vand(c, b) {
    laddaFlaggbilder().then(() => {
      const fb = flaggbildFor(c);
      if (!fb || !b.isConnected || b.querySelector('.tavla-minne')) return;
      const stor = new Image();
      stor.src = flaggbildSrc(fb);
      // vänd när bilden finns — inte till en tom baksida
      stor.decode().then(() => {
        if (!b.isConnected || !b.classList.contains('hittad') || b.querySelector('.tavla-minne')) return;
        const kort = b.querySelector('.tavla-kort');
        const bild = new Image();
        bild.className = 'tavla-minne';
        bild.alt = '';
        bild.draggable = false;
        bild.dataset.bild = flaggbildSrc(fb);
        bild.src = nedskalad(stor, kort);
        return bild.decode().then(() => {
          if (!b.isConnected || b.querySelector('.tavla-minne')) return;
          b.classList.add('minne');
          kort.appendChild(bild);
          requestAnimationFrame(() => {
            b.classList.add('vand');
            setTimeout(() => {
              b.classList.add('vand-klar');
              b.classList.remove('minne');
            }, 700);
          });
        });
      }).catch(() => {});
    });
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
  // början så att det är det man ser.
  function utforskaKlick(c) {
    if (currentMode !== 'explore') return;
    if (revealed.has(c.gid)) { spela('klick'); showInfoCard(c); }
    else exploreClick(c, null);
    synka();
    const rulla = infoCard.closest('.info-panel-content');
    if (rulla) rulla.scrollTop = 0;
  }

  function synka() {
    if (lage !== 'utforska') return;
    const kort = infoCard.classList.contains('active');
    for (const [gid, b] of rutor) {
      b.classList.toggle('utforskad', utforskade.has(gid));
      b.classList.toggle('aktiv', kort && activeCountry === gid);
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
  const rubrikRad = document.querySelector('#seterra-ui > .info-header');
  function visaRuta(el) {
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
      }
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
