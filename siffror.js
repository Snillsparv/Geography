// ── Sifferssidan: sju steg från sifferalfabetet till pi ──
// Fristående från spelet: behöver bara siffror-ljud.js, siffror-data.js och
// (valfritt) kakor.js för statistiken. Rekorden sparas i localStorage.
(() => {
  'use strict';
  const D = window.SIFFROR;
  const L = window.Sifferljud;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const blanda = a => {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const REDUCERAD = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sekunder = start => Math.max(1, Math.round((Date.now() - start) / 1000));
  const sekText = n => n === 1 ? '1 sekund' : `${n} sekunder`;
  const missText = n => `${n} ${n === 1 ? 'miss' : 'missar'}`;

  // efter ett svar växer eller krymper övningsrutan: scrolla så lite som
  // möjligt så att hela rutan syns igen
  function iSikte(el) {
    const r = el.getBoundingClientRect();
    let dy = 0;
    if (r.top < 8) dy = r.top - 8;
    else if (r.bottom > innerHeight - 8) dy = Math.min(r.bottom - innerHeight + 8, r.top - 8);
    if (Math.abs(dy) > 2) scrollBy({ top: dy, behavior: REDUCERAD ? 'auto' : 'smooth' });
  }

  const lagra = {
    hamta(k, def) {
      try { const v = localStorage.getItem('siffror-' + k); return v == null ? def : JSON.parse(v); }
      catch (e) { return def; }
    },
    spara(k, v) { try { localStorage.setItem('siffror-' + k, JSON.stringify(v)); } catch (e) {} },
  };
  const statistik = (namn, props) => {
    try { if (window.kakSpara) window.kakSpara('siffror_' + namn, props || {}); } catch (e) {}
  };

  // lathundens ord för ett tal (en ensam siffra har ett eget ord)
  const ordFor = t => t.length === 1 ? D.ensam[+t] : D.lathund[+t][0];

  // ordet bokstav för bokstav, med siffran under varje konsonantljud
  const uppdelningHTML = delar => '<span class="upp">' + delar.map(d => !d.t.trim()
    ? '<span class="mellan"></span>'
    : `<span${d.d ? ' class="ljud"' : ''}><b>${esc(d.t)}</b><i>${d.d}</i></span>`).join('') + '</span>';
  const upp = text => uppdelningHTML(L.analysera(text).delar);

  // knappsats: 1–9, ⌫, 0, ✓ (eller bara siffrorna i två rader med tio:true)
  function knappsats(tryck, { klar = true, tio = false } = {}) {
    const el = document.createElement('div');
    el.className = 'knappsats' + (tio ? ' tio' : '');
    const tangenter = tio ? [...'1234567890'] : [...'123456789', 'Backspace', '0', klar ? 'Enter' : ''];
    for (const t of tangenter) {
      const b = document.createElement('button');
      b.type = 'button';
      if (!t) { b.style.visibility = 'hidden'; b.tabIndex = -1; b.setAttribute('aria-hidden', 'true'); }
      else if (t === 'Backspace') { b.className = 'radera'; b.textContent = '⌫'; b.setAttribute('aria-label', 'Radera'); }
      else if (t === 'Enter') { b.className = 'klar'; b.textContent = '✓'; b.setAttribute('aria-label', 'Rätta'); }
      else b.textContent = t;
      if (t) {
        b.addEventListener('click', () => tryck(t));
        // musklick ska inte ge knappen fokus: då hamnar Enter på knappen i
        // stället för att rätta svaret
        b.addEventListener('mousedown', e => e.preventDefault());
      }
      el.appendChild(b);
    }
    return el;
  }

  // svarsrutor efter en mask: '19__' → 1 9 [ ][ ]
  function rutorHTML(mask, skrivet) {
    let i = 0, html = '', forsta = true;
    for (const c of mask) {
      if (c !== '_') { html += `<span class="ruta fast">${esc(c)}</span>`; continue; }
      const s = skrivet[i++];
      if (s != null) html += `<span class="ruta">${s}</span>`;
      else { html += `<span class="ruta${forsta ? ' mark' : ''}"></span>`; forsta = false; }
    }
    return html;
  }

  // resultatet efter en övning
  const resultatHTML = (rubrik, text) => `<div class="resultat">
    <div class="stor">${rubrik}</div><p>${text}</p></div>
    <div class="knapprad"><button class="knapp sekundar" type="button" data-igen>Kör igen</button></div>`;

  const nastaKnapp = (text, el) => {
    const kn = $('[data-knappar]', el);
    kn.innerHTML = `<div class="knapprad"><button class="knapp" type="button" data-nasta>${text}</button></div>`;
    return $('[data-nasta]', kn);
  };

  // ── tangentbordet: siffror, Enter och pilar går till steget som syns ──
  const tangenter = {};
  let aktivVy = 'alfabetet';
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    // Enter/mellanslag på en fokuserad knapp är knappens eget klick
    if (t && (t.tagName === 'BUTTON' || t.tagName === 'A') && (e.key === 'Enter' || e.key === ' ')) return;
    const f = tangenter[aktivVy];
    if (f && f(e.key)) e.preventDefault();
  });

  // ════════════════════════════════════════════════════════════════════
  // 1. SIFFERALFABETET
  // ════════════════════════════════════════════════════════════════════
  function alfabet() {
    $('#exempel').innerHTML = `${upp('Jonas')}<span class="blir">= 620</span>`;
    $('#alfabet').innerHTML = D.alfabet.map(a => `<li><span class="s">${a.s}</span>
      <span><b>${a.ljud.join(' ')}</b><span class="regel">${esc(a.regel)}</span></span></li>`).join('');
  }

  // snabbquiz: varje siffra två gånger (siffra → ljud och ljud → siffra)
  const LJUDTEXT = D.alfabet.map(a => a.ljud.join(' / '));
  function alfabetQuiz() {
    const el = $('#alfa-quiz');
    let fragor = [], i = 0, missar = 0, start = 0, klocka = null, last = false, omgang = 0;

    el.innerHTML = `<h3>Testa dig själv</h3>
      <p>20 snabba frågor. Hur snabbt kan du hela alfabetet?</p>
      <div class="knapprad"><button class="knapp" type="button" data-start>Starta ▶</button></div>`;
    $('[data-start]', el).addEventListener('click', starta);

    function starta() {
      const fr = [];
      for (let s = 0; s < 10; s++) {
        fr.push({ typ: 'ljud', s });
        const ljud = D.quizljud[s];
        fr.push({ typ: 'siffra', s, ljud: ljud[Math.floor(Math.random() * ljud.length)] });
      }
      fragor = blanda(fr);
      i = 0; missar = 0; start = Date.now(); last = false; omgang++;
      clearInterval(klocka);
      klocka = setInterval(() => { const k = $('[data-klocka]', el); if (k) k.textContent = sekunder(start) + ' s'; }, 500);
      visa();
      iSikte(el);
    }

    function visa() {
      if (i >= fragor.length) return klart();
      const f = fragor[i];
      last = false;
      el.innerHTML = `
        <div class="ov-topp"><span>Fråga ${Math.min(i + 1, 20)} av ${Math.max(20, fragor.length)}</span><span data-klocka>${sekunder(start)} s</span></div>
        ${f.typ === 'ljud'
          ? `<p class="fraga">Vilket ljud har</p><div class="stor">${f.s}</div>`
          : `<p class="fraga">Vilken siffra är ljudet</p><div class="stor">${f.ljud}</div>`}
        <div data-svar></div>
        <p class="aterkoppling" aria-live="polite" data-ak></p>`;
      const svar = $('[data-svar]', el);
      if (f.typ === 'ljud') {
        const v = document.createElement('div');
        v.className = 'ljudval';
        for (const s of blanda([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])) {
          const b = document.createElement('button');
          b.type = 'button'; b.dataset.s = s; b.textContent = LJUDTEXT[s];
          b.addEventListener('click', () => svara(s, b));
          b.addEventListener('mousedown', e => e.preventDefault());
          v.appendChild(b);
        }
        svar.appendChild(v);
        tangenter.alfabetet = k => {
          const bokstav = String(k).toLowerCase();
          const s = Object.keys(D.quizljud).find(n => D.quizljud[n].some(l => l.toLowerCase() === bokstav));
          if (s == null) return false;
          svara(+s, $(`.ljudval [data-s="${s}"]`, el));
          return true;
        };
      } else {
        svar.appendChild(knappsats(t => svara(+t), { tio: true }));
        tangenter.alfabetet = k => { if (/^\d$/.test(k)) { svara(+k); return true; } return false; };
      }
    }

    function svara(s, knapp) {
      if (last) return;
      last = true;
      const f = fragor[i];
      const ratt = s === f.s;
      const ak = $('[data-ak]', el);
      if (f.typ === 'ljud') {
        if (knapp) knapp.classList.add(ratt ? 'ratt' : 'fel');
        const rk = $(`.ljudval [data-s="${f.s}"]`, el);
        if (rk) rk.classList.add('ratt');
      }
      if (ratt) {
        ak.className = 'aterkoppling ratt'; ak.textContent = 'Rätt!';
      } else {
        missar++;
        ak.className = 'aterkoppling fel';
        ak.textContent = f.typ === 'ljud' ? `${f.s} är ${LJUDTEXT[f.s]}` : `${f.ljud} är ${f.s}`;
        // missade frågor kommer tillbaka lite senare
        fragor.splice(Math.min(fragor.length, i + 4), 0, { ...f });
      }
      const o = omgang;
      setTimeout(() => { if (o === omgang) { i++; visa(); iSikte(el); } }, ratt ? 420 : 1500);
    }

    function klart() {
      clearInterval(klocka);
      tangenter.alfabetet = null;
      const tid = sekunder(start);
      const bast = lagra.hamta('alfa-bast', null);
      const rekord = !bast || tid < bast;
      if (rekord) lagra.spara('alfa-bast', tid);
      statistik('alfabet_klart', { sek: tid, missar });
      el.innerHTML = resultatHTML(sekText(tid),
        (missar ? `${missText(missar)} på vägen.` : 'Inte en enda miss!') +
        (bast ? (rekord ? ' Nytt rekord!' : ` Ditt rekord är ${sekText(bast)}.`) : ''));
      $('[data-igen]', el).addEventListener('click', starta);
      iSikte(el);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 2. ORD → SIFFROR
  // ════════════════════════════════════════════════════════════════════
  function ordTillSiffror() {
    const el = $('#ord-ovning');
    const ord = D.ordovning;
    let i = 0, ratta = 0, skrivet = '', lage = 'svarar';

    function starta() { i = 0; ratta = 0; visa(); }

    function visa() {
      if (i >= ord.length) return klart();
      const o = ord[i];
      skrivet = ''; lage = 'svarar';
      el.innerHTML = `
        <div class="ov-topp"><span>Ord ${i + 1} av ${ord.length}</span></div>
        <p class="fraga">Vilket tal blir</p>
        <div class="stor ord${o.ord.length > 12 ? ' lang' : ''}">${esc(o.ord)}</div>
        <div class="ov-svar" data-rutor aria-live="polite"></div>
        <p class="aterkoppling" aria-live="polite" data-ak></p>
        <div class="forklaring" data-fk></div>
        <div data-knappar></div>`;
      $('[data-knappar]', el).appendChild(knappsats(tryck));
      ritaRutor();
    }

    function ritaRutor() {
      const r = $('[data-rutor]', el);
      if (!r) return;
      r.innerHTML = [...skrivet].map(c => `<span class="ruta">${c}</span>`).join('') +
        (lage === 'svarar' ? '<span class="ruta mark"></span>' : '') +
        (skrivet ? '' : '<span class="ruta"></span>');
    }

    function tryck(t) {
      if (lage === 'visar') { if (t === 'Enter') nasta(); return; }
      if (t === 'Backspace') skrivet = skrivet.slice(0, -1);
      else if (t === 'Enter') { if (skrivet) ratta_(); return; }
      else if (skrivet.length < 20) skrivet += t;
      ritaRutor();
    }

    function ratta_() {
      const o = ord[i];
      const ratt = skrivet === o.svar;
      if (ratt) ratta++;
      lage = 'visar';
      ritaRutor();
      const ak = $('[data-ak]', el);
      ak.className = 'aterkoppling ' + (ratt ? 'ratt' : 'fel');
      ak.textContent = ratt ? 'Rätt!' : `Rätt svar är ${o.svar}`;
      $('[data-fk]', el).innerHTML = upp(o.ord) + (o.not ? `<p>${esc(o.not)}</p>` : '');
      const b = nastaKnapp(i + 1 < ord.length ? 'Nästa ord →' : 'Se resultatet', el);
      b.addEventListener('click', nasta);
      b.focus({ preventScroll: true });
      iSikte(el);
    }

    function nasta() { i++; visa(); iSikte(el); }

    function klart() {
      lage = 'klar';
      statistik('ord_klart', { ratt: ratta, antal: ord.length });
      const alla = ratta === ord.length;
      el.innerHTML = resultatHTML(`${ratta} av ${ord.length}`,
        alla ? 'Alla rätt! Du läser siffror som en minnesatlet.' : 'Bra jobbat! Kör en gång till, så sitter det.');
      $('[data-igen]', el).addEventListener('click', () => { starta(); iSikte(el); });
    }

    tangenter.ord = k => {
      if (lage === 'klar') return false;
      if (/^\d$/.test(k) || k === 'Backspace' || k === 'Enter') { tryck(k); return true; }
      return false;
    };
    starta();

    // prova själv
    const inn = $('#prova-in'), ut = $('#prova-ut');
    inn.addEventListener('input', () => {
      const v = inn.value.slice(0, 60);
      if (!v.trim()) { ut.innerHTML = ''; return; }
      const a = L.analysera(v);
      ut.innerHTML = `<div class="stor">${a.siffror || '<span class="tom">–</span>'}</div>${uppdelningHTML(a.delar)}`;
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // 3. SIFFROR → ORD
  // ════════════════════════════════════════════════════════════════════
  function siffrorTillOrd() {
    const el = $('#tal-ovning');
    const tal = D.boktal;   // [tal, mitt förslag]
    let i = 0, ratta = 0, lage = 'svarar';

    function starta() { i = 0; ratta = 0; visa(); }

    function visa() {
      if (i >= tal.length) return klart();
      const [t] = tal[i];
      lage = 'svarar';
      el.innerHTML = `
        <div class="ov-topp"><span>Tal ${i + 1} av ${tal.length}</span></div>
        <p class="fraga">Hitta på ett ord för</p>
        <div class="stor${t.length > 5 ? ' lang' : ''}">${t}</div>
        <form class="rad-in" data-form autocomplete="off">
          <label class="sr" for="tal-ord">Ditt ord</label>
          <input id="tal-ord" type="text" autocapitalize="off" spellcheck="false" placeholder="Ditt ord …" maxlength="40">
          <button class="knapp" type="submit">Kolla</button>
        </form>
        <p class="aterkoppling" aria-live="polite" data-ak></p>
        <div class="forklaring" data-fk></div>
        <div data-knappar><button class="lank" type="button" data-forslag>Visa mitt förslag</button></div>`;
      $('[data-form]', el).addEventListener('submit', e => { e.preventDefault(); kolla(); });
      $('[data-forslag]', el).addEventListener('click', () => avsluta(false, null));
    }

    function kolla() {
      if (lage !== 'svarar') return;
      const inn = $('#tal-ord');
      const ord = inn.value.trim();
      if (!ord) { inn.focus(); return; }
      const [t] = tal[i];
      const a = L.analysera(ord);
      if (a.siffror === t) return avsluta(true, a);
      const ak = $('[data-ak]', el);
      ak.className = 'aterkoppling fel';
      ak.textContent = a.siffror ? `Jag hör ${a.siffror} i »${ord}«.` : `Jag hör inga konsonantljud i »${ord}«.`;
      $('[data-fk]', el).innerHTML = uppdelningHTML(a.delar) +
        `<p><button class="lank" type="button" data-andra>Jag uttalar det så att det blir ${t}</button></p>`;
      $('[data-andra]', el).addEventListener('click', () => avsluta(true, a));
    }

    function avsluta(ratt, analys) {
      lage = 'visar';
      const forslag = tal[i][1];
      if (ratt) ratta++;
      const ak = $('[data-ak]', el);
      ak.className = 'aterkoppling ratt';
      ak.textContent = ratt ? 'Snyggt!' : '';
      $('[data-fk]', el).innerHTML = analys
        ? `${uppdelningHTML(analys.delar)}<p>Mitt förslag: <b>${esc(forslag)}</b></p>`
        : `<p>Mitt förslag: <b>${esc(forslag)}</b></p>${upp(forslag.replace(/!$/, ''))}`;
      $('#tal-ord').disabled = true;
      $('[data-form] button', el).disabled = true;
      const b = nastaKnapp(i + 1 < tal.length ? 'Nästa tal →' : 'Se resultatet', el);
      b.addEventListener('click', () => { i++; visa(); iSikte(el); });
      b.focus({ preventScroll: true });
      iSikte(el);
    }

    function klart() {
      statistik('tal_klart', { ratt: ratta, antal: tal.length });
      el.innerHTML = resultatHTML(`${ratta} av ${tal.length}`,
        'Ju fler ord du hittar på, desto snabbare går det. Proffsen har ett färdigt ord för varje tal, och det är nästa steg!');
      $('[data-igen]', el).addEventListener('click', () => { starta(); iSikte(el); });
    }

    starta();
  }

  // ════════════════════════════════════════════════════════════════════
  // 4. LATHUNDEN: läs tio ord, öva på dem, ta nästa tiotal
  // ════════════════════════════════════════════════════════════════════
  function lathund() {
    const el = $('#lathund-ovning'), valEl = $('#lathund-val');
    let tio = 0, ko = [], missar = 0, aktuell = null, lage = 'lista';
    const talen = () => [...Array(10).keys()].map(n => `${tio}${n}`);

    valEl.innerHTML = [...Array(10).keys()].map(n =>
      `<button type="button" data-tio="${n}">${n}0–${n}9</button>`).join('');
    valEl.addEventListener('click', e => {
      const b = e.target.closest('[data-tio]');
      if (b) { tio = +b.dataset.tio; lista(); }
    });

    function lista() {
      lage = 'lista'; aktuell = null;
      $$('[data-tio]', valEl).forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.tio === tio)));
      el.innerHTML = `<ul class="ordlista">${talen().map(t => {
          const [ord, not] = D.lathund[+t];
          return `<li><span class="nr">${t}</span><span>${esc(ord)}${not ? `<small>${esc(not)}</small>` : ''}</span></li>`;
        }).join('')}</ul>
        <div class="knapprad"><button class="knapp" type="button" data-ova>Öva på de här ▶</button></div>`;
      $('[data-ova]', el).addEventListener('click', ova);
    }

    function ova() {
      ko = blanda(talen()); missar = 0;
      nasta();
      iSikte(el);
    }

    function nasta() {
      if (!ko.length) return klart();
      aktuell = ko.shift();
      lage = 'fraga';
      el.innerHTML = `
        <div class="ov-topp"><span>${ko.length + 1} kvar</span></div>
        <div class="vandkort"><div class="stor">${aktuell}</div><div data-baksida></div></div>
        <div class="knapprad" data-knappar><button class="knapp" type="button" data-vand>Visa ordet</button></div>`;
      $('[data-vand]', el).addEventListener('click', vand);
    }

    function vand() {
      if (lage !== 'fraga') return;
      lage = 'vand';
      const [ord, not] = D.lathund[+aktuell];
      $('[data-baksida]', el).innerHTML = `<div class="stor ord">${esc(ord)}</div>${not ? `<p class="liten">${esc(not)}</p>` : ''}`;
      $('[data-knappar]', el).innerHTML = `
        <button class="knapp sekundar" type="button" data-nej>Kunde inte</button>
        <button class="knapp" type="button" data-ja>Kunde</button>`;
      $('[data-ja]', el).addEventListener('click', () => bedom(true));
      $('[data-nej]', el).addEventListener('click', () => bedom(false));
    }

    function bedom(kunde) {
      if (lage !== 'vand') return;
      // ett ord man inte kunde kommer tillbaka om några kort
      if (!kunde) { missar++; ko.splice(Math.min(ko.length, 3), 0, aktuell); }
      nasta();
      iSikte(el);
    }

    function klart() {
      lage = 'klar'; aktuell = null;
      statistik('lathund_klart', { tio, missar });
      el.innerHTML = resultatHTML(missar ? 'Klart!' : 'Felfritt!',
        `${tio}0–${tio}9${missar ? `, med ${missText(missar)} på vägen` : ''}. Repetera i morgon så sitter de ännu bättre.`);
      if (tio < 9) {
        $('.knapprad', el).insertAdjacentHTML('beforeend', '<button class="knapp" type="button" data-nasta-tio>Nästa tiotal →</button>');
        $('[data-nasta-tio]', el).addEventListener('click', () => { tio++; lista(); iSikte(el); });
      }
      $('[data-igen]', el).addEventListener('click', ova);
      iSikte(el);
    }

    tangenter.lathund = k => {
      if (lage === 'fraga' && (k === ' ' || k === 'Enter')) { vand(); return true; }
      if (lage === 'vand' && (k === 'ArrowRight' || k === 'Enter')) { bedom(true); return true; }
      if (lage === 'vand' && (k === 'ArrowLeft' || k === 'Backspace')) { bedom(false); return true; }
      return false;
    };

    lista();
  }

  // ════════════════════════════════════════════════════════════════════
  // 5. ÅRTAL
  // ════════════════════════════════════════════════════════════════════
  // bildförslaget med lathundens ord i fetstil
  function bildHTML(a) {
    const n = a.bild.toLowerCase().indexOf(a.ord.toLowerCase());
    return n < 0 ? `${esc(a.bild)} <b>${esc(a.ord)}</b>`
      : esc(a.bild.slice(0, n)) + `<b>${esc(a.bild.slice(n, n + a.ord.length))}</b>` + esc(a.bild.slice(n + a.ord.length));
  }

  function artal() {
    $('#artal-lista').innerHTML = D.artal.map(a => `<li><span class="ar">${a.ar}</span>
      <span>${esc(a.text)}<span class="bild">${bildHTML(a)}</span></span></li>`).join('');

    const el = $('#artal-ovning');
    let fr = [], i = 0, ratta = 0, skrivet = '', lage = 'av';

    el.innerHTML = `<h3>Förhör</h3>
      <p>Har bilderna fastnat? Jag frågar om tio av årtalen.</p>
      <div class="knapprad"><button class="knapp" type="button" data-start>Förhör mig ▶</button></div>`;
    $('[data-start]', el).addEventListener('click', starta);

    function starta() {
      fr = blanda(D.artal).slice(0, 10);
      i = 0; ratta = 0;
      visa();
      iSikte(el);
    }

    function visa() {
      if (i >= fr.length) return klart();
      skrivet = ''; lage = 'svarar';
      el.innerHTML = `
        <div class="ov-topp"><span>Fråga ${i + 1} av ${fr.length}</span></div>
        <p class="handelse">${esc(fr[i].text)}</p>
        <div class="ov-svar" data-rutor>${rutorHTML('19__', '')}</div>
        <p class="aterkoppling" aria-live="polite" data-ak></p>
        <div class="forklaring" data-fk></div>
        <div data-knappar></div>`;
      $('[data-knappar]', el).appendChild(knappsats(tryck, { klar: false }));
    }

    function tryck(t) {
      if (lage === 'visar') { if (t === 'Enter') nasta(); return; }
      if (lage !== 'svarar' || t === 'Enter') return;
      if (t === 'Backspace') skrivet = skrivet.slice(0, -1);
      else skrivet += t;
      $('[data-rutor]', el).innerHTML = rutorHTML('19__', skrivet);
      if (skrivet.length === 2) ratta_();
    }

    function ratta_() {
      const a = fr[i];
      lage = 'visar';
      const ratt = skrivet === a.tal;
      if (ratt) ratta++;
      const ak = $('[data-ak]', el);
      ak.className = 'aterkoppling ' + (ratt ? 'ratt' : 'fel');
      ak.textContent = ratt ? 'Rätt!' : `Rätt svar: ${a.ar}`;
      if (!ratt) $('[data-rutor]', el).classList.add('skaka');
      $('[data-fk]', el).innerHTML = `<p>${bildHTML(a)}</p>`;
      const b = nastaKnapp(i + 1 < fr.length ? 'Nästa fråga →' : 'Se resultatet', el);
      b.addEventListener('click', nasta);
      b.focus({ preventScroll: true });
      iSikte(el);
    }

    function nasta() { i++; visa(); iSikte(el); }

    function klart() {
      lage = 'av';
      statistik('artal_klart', { ratt: ratta, antal: fr.length });
      const alla = ratta === fr.length;
      el.innerHTML = resultatHTML(`${ratta} av ${fr.length}`,
        alla ? 'Alla rätt! Nu kan du briljera på nästa middag.' : 'Läs igenom bilderna en gång till och kör igen!');
      $('[data-igen]', el).addEventListener('click', starta);
    }

    tangenter.artal = k => {
      if (lage !== 'svarar' && lage !== 'visar') return false;
      if (/^\d$/.test(k) || k === 'Backspace' || k === 'Enter') { tryck(k); return true; }
      return false;
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // 6. PI-UTMANINGEN
  // ════════════════════════════════════════════════════════════════════
  // en ring på bokens karta över minnespalatset
  const ringStil = n => `left:${D.palatsPos[n][0]}%;top:${D.palatsPos[n][1]}%`;

  function pi() {
    const P = D.pi.platser;
    const promEl = $('#pi-promenad'), forEl = $('#pi-forhor'), radEl = $('#pi-rad');
    let p = 0;

    function ritaPromenad() {
      const pl = P[p];
      radEl.innerHTML = '3, ' + P.map((x, n) => `<span${n === p ? ' class="nu"' : ''}>${x.par.join(' ')}</span>`).join(' ');
      $('[data-ring]', promEl).style.cssText = ringStil(p);
      $('[data-plats]', promEl).innerHTML = `
        <p class="plats-nr">Plats ${p + 1} av ${P.length}</p>
        <p class="plats-namn">${esc(D.palats[p])}</p>
        <p class="plats-par">${pl.par.map(par => `<span><b>${par}</b> ${esc(ordFor(par))}</span>`).join('')}</p>
        <p class="plats-bild">${esc(pl.bild)}</p>`;
      $('[data-forra]', promEl).disabled = p === 0;
      $('[data-nasta]', promEl).textContent = p < P.length - 1 ? 'Nästa plats →' : 'Testa dig ↓';
    }
    promEl.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if ('forra' in b.dataset) p = Math.max(0, p - 1);
      else if (p < P.length - 1) p++;
      else { forEl.scrollIntoView({ behavior: REDUCERAD ? 'auto' : 'smooth', block: 'start' }); return; }
      ritaPromenad();
    });

    // förhöret
    const DEC = D.pi.decimaler;
    let pos = 0, fel = 0, missPa = {}, start = 0, igang = false, klocka = null;

    function forhorStart() {
      forEl.innerHTML = `<h3>Testa dig</h3>
        <p>Blunda och gå promenaden i huvudet. Skriv sedan alla 30 decimalerna. Tiden går från första siffran.</p>
        <div class="knapprad"><button class="knapp" type="button" data-start>Jag är redo ▶</button></div>`;
      $('[data-start]', forEl).addEventListener('click', forhorKor);
    }

    function forhorKor() {
      pos = 0; fel = 0; missPa = {}; start = 0; igang = true;
      forEl.innerHTML = `
        <div class="ov-topp"><span data-kvar></span><span data-klocka>0 s</span></div>
        <div class="pi-forhor-tal" data-tal aria-live="polite"></div>
        <p class="pi-tips" data-tips></p>
        <div data-knappar></div>`;
      $('[data-knappar]', forEl).appendChild(knappsats(skriv, { tio: true }));
      ritaTal();
      iSikte(forEl);
    }

    function ritaTal() {
      let html = '<span class="par">3,</span>';
      for (let n = 0; n < DEC.length; n += 2) {
        html += `<span class="par${n % 4 === 0 && n ? ' ny-plats' : ''}">`;
        for (const k of [n, n + 1]) {
          html += k < pos ? `<span${missPa[k] ? ' class="miss"' : ''}>${DEC[k]}</span>`
            : k === pos ? '<span class="nu">_</span>' : '<span class="tom">•</span>';
        }
        html += '</span>';
      }
      $('[data-tal]', forEl).innerHTML = html;
      $('[data-kvar]', forEl).textContent = `${DEC.length - pos} kvar`;
    }

    function skriv(t) {
      if (!igang || !/^\d$/.test(t)) return;
      if (!start) {
        start = Date.now();
        clearInterval(klocka);
        klocka = setInterval(() => { const k = $('[data-klocka]', forEl); if (k && igang) k.textContent = sekunder(start) + ' s'; }, 500);
      }
      const tips = $('[data-tips]', forEl);
      if (t === DEC[pos]) {
        pos++;
        tips.textContent = '';
        ritaTal();
        if (pos === DEC.length) forhorKlart();
        return;
      }
      fel++;
      missPa[pos] = (missPa[pos] || 0) + 1;
      const tal = $('[data-tal]', forEl);
      tal.classList.remove('skaka'); void tal.offsetWidth; tal.classList.add('skaka');
      // tipsen blir tydligare för varje miss på samma siffra
      const n = Math.floor(pos / 4);
      tips.textContent = missPa[pos] === 1 ? `Tänk på plats ${n + 1}: ${D.palats[n].toLowerCase()}.`
        : missPa[pos] === 2 ? `Plats ${n + 1}: ${P[n].par.map(ordFor).join(' och ')}.`
        : `Siffran är ${DEC[pos]}.`;
    }

    function forhorKlart() {
      igang = false;
      clearInterval(klocka);
      const sek = sekunder(start);
      const bast = lagra.hamta('pi-bast', null);
      const battre = !bast || fel < bast.fel || (fel === bast.fel && sek < bast.sek);
      if (battre) lagra.spara('pi-bast', { sek, fel });
      statistik('pi_klart', { sek, fel });
      forEl.innerHTML = resultatHTML(fel ? sekText(sek) : 'Felfritt!',
        `Du kan de 30 första decimalerna av pi${fel ? `, med ${fel} fel på vägen` : ` på ${sekText(sek)}`}.
        ${battre && bast ? 'Nytt rekord! ' : ''}Bara 13&nbsp;178 decimaler kvar, så är du ikapp mig …`);
      $('[data-igen]', forEl).addEventListener('click', forhorKor);
      iSikte(forEl);
    }

    tangenter.pi = k => {
      if (igang) { if (/^\d$/.test(k)) { skriv(k); return true; } return false; }
      if (k === 'ArrowRight' && p < P.length - 1) { p++; ritaPromenad(); return true; }
      if (k === 'ArrowLeft' && p > 0) { p--; ritaPromenad(); return true; }
      return false;
    };

    ritaPromenad();
    forhorStart();
  }

  // ════════════════════════════════════════════════════════════════════
  // 7. DITT EGET TAL
  // ════════════════════════════════════════════════════════════════════
  function dittTal() {
    const inn = $('#dittal-in'), ut = $('#dittal-ut'), karta = $('#dittal-karta');
    let raknad = false;
    inn.addEventListener('input', () => {
      const siffror = inn.value.replace(/\D/g, '');
      const s = siffror.slice(0, 60);
      $$('.ring', karta).forEach(ring => ring.parentNode.removeChild(ring));
      if (!s) { ut.innerHTML = ''; return; }
      if (!raknad) { raknad = true; statistik('dittal_anvant'); }
      const par = s.match(/\d{1,2}/g);
      const platser = [];
      for (let n = 0; n < par.length; n += 2) platser.push(par.slice(n, n + 2));
      karta.insertAdjacentHTML('beforeend', platser.map((_, n) => `<span class="ring liten" style="${ringStil(n)}"></span>`).join(''));
      ut.innerHTML = platser.map((pp, n) => `<li><span class="pn">${n + 1}. ${esc(D.palats[n])}</span>
        ${pp.map(t => `<b>${t}</b> ${esc(ordFor(t))}`).join(' &nbsp;+&nbsp; ')}</li>`).join('') +
        (siffror.length > 60 ? '<li class="liten">Jag tog de första 60 siffrorna.</li>' : '');
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // STEGEN
  // ════════════════════════════════════════════════════════════════════
  const VYER = ['alfabetet', 'ord', 'tal', 'lathund', 'artal', 'pi', 'dittal'];
  function visaVy(id, forsta = false) {
    if (!VYER.includes(id)) id = 'alfabetet';
    const byte = id !== aktivVy;
    aktivVy = id;
    for (const v of VYER) $(`#vy-${v}`).hidden = v !== id;
    $$('.steg-nav a').forEach(a => {
      if (a.getAttribute('href') === '#' + id) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (!forsta) {
      // börja nya steget överst
      const y = $('.steg-nav').getBoundingClientRect().top + scrollY;
      if (scrollY > y) scrollTo({ top: y, behavior: 'auto' });
    }
    if (byte || forsta) statistik('flik', { flik: id });
  }

  // ── igång ──
  alfabet();
  alfabetQuiz();
  ordTillSiffror();
  siffrorTillOrd();
  lathund();
  artal();
  pi();
  dittTal();

  addEventListener('hashchange', () => visaVy(location.hash.slice(1)));
  visaVy(location.hash.slice(1) || 'alfabetet', true);
})();
