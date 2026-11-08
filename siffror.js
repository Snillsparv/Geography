// ── Sifferssidan: sju steg från sifferalfabetet till pi ──
// Fristående från spelet: behöver bara siffror-ljud.js, siffror-data.js och
// (valfritt) kakor.js för statistiken. Framsteg sparas i localStorage.
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
  const tal2 = i => String(i).padStart(2, '0');
  const REDUCERAD = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sekunder = start => Math.max(1, Math.round((Date.now() - start) / 1000));
  const sekText = n => n === 1 ? '1 sekund' : `${n} sekunder`;

  // efter ett svar krymper eller växer övningskortet (knappsatsen byts mot
  // en knapp …) — scrolla så lite som möjligt så att kortet syns igen
  function iSikte(el) {
    if (!el) return;
    const navUnder = $('.flikar').getBoundingClientRect().bottom;
    const r = el.getBoundingClientRect();
    let dy = 0;
    if (r.top < navUnder + 8) dy = r.top - navUnder - 8;
    else if (r.bottom > window.innerHeight - 8) dy = Math.min(r.bottom - window.innerHeight + 8, r.top - navUnder - 8);
    if (Math.abs(dy) > 2) window.scrollBy({ top: dy, behavior: REDUCERAD ? 'auto' : 'smooth' });
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

  // ── lathunden, med egna ord om man bytt ut något ──
  let egna = lagra.hamta('egna', {});
  function ordFor(tal) {
    if (tal.length === 1) {
      const [ord, emoji] = D.ensam[+tal];
      return { ord, emoji, not: '', eget: false };
    }
    const [ord, emoji, not] = D.lathund[+tal];
    if (egna[tal]) return { ord: egna[tal], emoji: '✏️', not: 'ditt eget ord', eget: true, bok: ord };
    return { ord, emoji, not: not || '', eget: false, bok: ord };
  }

  // ── små byggbitar ──
  const sifferHTML = s => [...String(s)].map(c =>
    /\d/.test(c) ? `<span class="sf d${c}">${c}</span>` : esc(c)).join('');

  function uppdelningHTML(delar) {
    return '<span class="upp">' + delar.map(d => {
      if (!d.t.trim()) return '<span class="mellan"></span>';
      if (!d.d) return `<span class="tyst"><b>${esc(d.t)}</b><i></i></span>`;
      return `<span class="ljudet d${d.d[0]}"><b>${esc(d.t)}</b><i>${sifferHTML(d.d)}</i></span>`;
    }).join('') + '</span>';
  }

  const ordHTML = (o, klass = '') =>
    `<div class="stor ord ${klass}"><span class="emoji" aria-hidden="true">${o.emoji}</span>${esc(o.ord)}</div>` +
    (o.not ? `<p class="liten">(${esc(o.not)})</p>` : '');

  // knappsats: 1–9, ⌫, 0, ✓ (eller bara siffrorna i två rader med tio:true)
  function knappsats(tryck, { klar = true, radera = true, tio = false } = {}) {
    const el = document.createElement('div');
    el.className = 'knappsats' + (tio ? ' tio' : '');
    const tangenter = tio ? ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
      : ['1', '2', '3', '4', '5', '6', '7', '8', '9', radera ? 'Backspace' : '', '0', klar ? 'Enter' : ''];
    for (const t of tangenter) {
      const b = document.createElement('button');
      b.type = 'button';
      if (!t) { b.style.visibility = 'hidden'; b.tabIndex = -1; b.setAttribute('aria-hidden', 'true'); }
      else if (t === 'Backspace') { b.className = 'radera'; b.textContent = '⌫'; b.setAttribute('aria-label', 'Radera'); }
      else if (t === 'Enter') { b.className = 'klar'; b.textContent = '✓'; b.setAttribute('aria-label', 'Rätta'); }
      else { b.className = `farg d${t}`; b.textContent = t; }
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
  function rutorHTML(mask, skrivet, { markera = true } = {}) {
    let i = 0, html = '';
    let forstaTomma = true;
    for (const c of mask) {
      if (c === '_') {
        const s = skrivet[i++];
        if (s != null) html += `<span class="ruta">${sifferHTML(s)}</span>`;
        else {
          html += `<span class="ruta${markera && forstaTomma ? ' mark' : ''}"></span>`;
          forstaTomma = false;
        }
      } else html += `<span class="ruta fast">${esc(c)}</span>`;
    }
    return html;
  }
  const fyllMask = (mask, svar) => { let i = 0; return mask.replace(/_/g, () => svar[i++] || '_'); };

  function resultatHTML({ bild, rubrik, text }) {
    return `<div class="resultat">
      <img src="assets/jonas/${bild}.webp" alt="" width="200" height="300">
      <div class="stor">${rubrik}</div>
      <p>${text}</p></div>`;
  }

  // ── tangentbordet: siffror, Enter och pilar går till vyn som syns ──
  const tangenter = {};
  let aktivVy = 'alfabetet';
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if ($('.dialog-bakgrund')) { if (e.key === 'Escape') stangDialog(); return; }
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    // Enter/mellanslag på en fokuserad knapp är knappens eget klick
    if (t && (t.tagName === 'BUTTON' || t.tagName === 'A') && (e.key === 'Enter' || e.key === ' ')) return;
    const f = tangenter[aktivVy];
    if (f && f(e.key)) e.preventDefault();
  });

  // ── dialogrutan ──
  let fokusFore = null;
  function oppnaDialog(html, efter) {
    stangDialog();
    fokusFore = document.activeElement;
    const bg = document.createElement('div');
    bg.className = 'dialog-bakgrund';
    bg.innerHTML = `<div class="dialog" role="dialog" aria-modal="true">
      <button class="stang" type="button" aria-label="Stäng">✕</button>${html}</div>`;
    bg.addEventListener('click', e => { if (e.target === bg) stangDialog(); });
    bg.querySelector('.stang').addEventListener('click', stangDialog);
    document.body.appendChild(bg);
    if (efter) efter(bg.firstElementChild);
    bg.querySelector('.stang').focus();
  }
  function stangDialog() {
    const bg = $('.dialog-bakgrund');
    if (!bg) return;
    bg.remove();
    if (fokusFore && fokusFore.focus) fokusFore.focus();
  }

  // ════════════════════════════════════════════════════════════════════
  // 1. SIFFERALFABETET
  // ════════════════════════════════════════════════════════════════════
  const TRICK = {
    sol: '☀️', streck1: '<small>T D</small>', streck2: 'N',
    m: '<span class="vrid m">M</span>', fyra: '<small>fyRRRa</small>', hand: '✋',
    sexa: '<span class="vrid spegel">6</span>', sjuk: '<small>sjuK</small>',
    seger: '✌️', nia: '<span class="vrid spegel">9</span>',
  };
  const VRID_TIPS = { m: 'Tryck så välter M:et!', sexa: 'Tryck så spegelvänds sexan!', nia: 'Tryck så spegelvänds nian!' };

  function byggAlfabet() {
    const grid = $('#alfa-grid');
    grid.innerHTML = D.alfabet.map(a => `
      <button type="button" class="alfa-kort d${a.s}" aria-pressed="false"
        aria-label="${a.s}: ${a.ljud.join(', ')}. ${esc(a.regel)}">
        <span class="alfa-topp">
          <span class="alfa-siffra">${a.s}</span>
          <span class="alfa-trick" aria-hidden="true">${TRICK[a.trick]}</span>
        </span>
        <span class="alfa-ljud">${a.ljud.map(l => `<span class="ljudbricka">${l}</span>`).join('')}</span>
        <span class="alfa-regel">${esc(a.regel)}</span>
        ${VRID_TIPS[a.trick] ? `<span class="alfa-tips">${VRID_TIPS[a.trick]}</span>` : ''}
      </button>`).join('');
    grid.addEventListener('click', e => {
      const k = e.target.closest('.alfa-kort');
      if (!k) return;
      const pa = k.classList.toggle('visa');
      k.setAttribute('aria-pressed', String(pa));
    });
  }

  // snabbquiz: varje siffra två gånger (siffra → ljud och ljud → siffra)
  const LJUDTEXT = D.alfabet.map(a => a.ljud.join(' / '));
  function alfabetQuiz() {
    const el = $('#alfa-quiz');
    let fragor = [], i = 0, missar = 0, start = 0, klocka = null, last = false, omgang = 0;

    function startsida() {
      clearInterval(klocka);
      const bast = lagra.hamta('alfa-bast', null);
      el.innerHTML = `<h3>Testa dig själv</h3>
        <p>20 snabba frågor, från siffra till ljud och från ljud till siffra. Hur snabbt kan du hela alfabetet?</p>
        ${bast ? `<p class="liten" style="margin-top:6px">Ditt rekord: ${sekText(bast)}</p>` : ''}
        <div class="knapprad" style="justify-content:center"><button class="knapp" type="button" data-start>Starta ▶</button></div>`;
      el.querySelector('[data-start]').addEventListener('click', starta);
      tangenter.alfabetet = null;
    }

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
    }

    function visa() {
      if (i >= fragor.length) return klart();
      const f = fragor[i];
      last = false;
      el.innerHTML = `
        <div class="ov-topp"><span>Fråga ${Math.min(i + 1, 20)} av ${Math.max(20, fragor.length)}</span><span data-klocka>${sekunder(start)} s</span></div>
        <div class="ov-prog"><i style="width:${(i / fragor.length) * 100}%"></i></div>
        ${f.typ === 'ljud'
          ? `<div class="fraga-text">Vilket ljud har</div><div class="stor sf d${f.s}">${f.s}</div>`
          : `<div class="fraga-text">Vilken siffra är ljudet</div><div class="stor">${f.ljud}</div>`}
        <div data-svar></div>
        <div class="aterkoppling" aria-live="polite" data-ak></div>
        <p class="tangenttips">${f.typ === 'ljud' ? 'Tips: tryck på bokstaven på tangentbordet.' : 'Tips: skriv siffran på tangentbordet.'}</p>`;
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
      const tid = sekunder(start);
      const bast = lagra.hamta('alfa-bast', null);
      const rekord = !bast || tid < bast;
      if (rekord) lagra.spara('alfa-bast', tid);
      statistik('alfabet_klart', { sek: tid, missar });
      el.innerHTML = resultatHTML({
        bild: missar ? 'kul' : 'stark',
        rubrik: sekText(tid),
        text: (missar ? `${missar} ${missar === 1 ? 'miss' : 'missar'}, och de kom tillbaka tills du kunde dem. `
          : 'Inte en enda miss! ') + (rekord && bast ? 'Nytt rekord! 🎉' : rekord ? '' : `Ditt rekord är ${sekText(bast)}.`),
      }) + `<div class="knapprad" style="justify-content:center">
          <button class="knapp sekundar" type="button" data-igen>Kör igen</button>
          <a class="knapp" href="#ord">Nästa steg →</a></div>`;
      el.querySelector('[data-igen]').addEventListener('click', starta);
      tangenter.alfabetet = null;
      iSikte(el);
    }

    startsida();
  }

  // ════════════════════════════════════════════════════════════════════
  // 2. ORD → SIFFROR
  // ════════════════════════════════════════════════════════════════════
  function ordTillSiffror() {
    const el = $('#ord-ovning');
    const VAL = [['bok', 'Bokens övning'], ['jul', 'Julord'], ['lathund', 'Lathundens ord']];
    let lista = 'bok', ord = [], i = 0, ratta = 0, skrivet = '', lage = 'svarar';

    const valEl = $('#ord-val');
    valEl.innerHTML = VAL.map(([k, n]) => `<button type="button" data-lista="${k}" aria-pressed="${k === lista}">${n}</button>`).join('');
    valEl.addEventListener('click', e => {
      const b = e.target.closest('[data-lista]');
      if (!b) return;
      lista = b.dataset.lista;
      $$('[data-lista]', valEl).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      starta();
    });

    function starta() {
      if (lista === 'lathund') {
        ord = blanda([...Array(100).keys()]).slice(0, 10).map(n => {
          const t = tal2(n), o = ordFor(t);
          return { ord: o.ord, svar: t, emoji: o.emoji };
        });
      } else ord = D.ordlistor[lista].ord.slice();
      i = 0; ratta = 0;
      visa();
    }

    function visa() {
      if (i >= ord.length) return klart();
      const o = ord[i];
      skrivet = ''; lage = 'svarar';
      const lang = o.ord.length > 12;
      el.innerHTML = `
        <div class="ov-topp"><span>Ord ${i + 1} av ${ord.length}</span><span>✓ ${ratta}</span></div>
        <div class="ov-prog"><i style="width:${(i / ord.length) * 100}%"></i></div>
        <div class="fraga-text">Vilket tal blir</div>
        <div class="stor ord${lang ? ' lang' : ''}">${o.emoji ? `<span class="emoji" aria-hidden="true">${o.emoji}</span>` : ''}${esc(o.ord)}</div>
        <div class="ov-svar" data-rutor aria-live="polite"></div>
        <div class="aterkoppling" aria-live="polite" data-ak></div>
        <div class="forklaring" data-fk></div>
        <div data-knappar></div>
        <p class="tangenttips">Tips: skriv med tangentbordet och tryck Enter.</p>`;
      $('[data-knappar]', el).appendChild(knappsats(tryck));
      ritaRutor();
    }

    function ritaRutor() {
      const r = $('[data-rutor]', el);
      if (!r) return;
      r.innerHTML = skrivet
        ? [...skrivet].map(c => `<span class="ruta">${sifferHTML(c)}</span>`).join('') + (lage === 'svarar' ? '<span class="ruta mark"></span>' : '')
        : '<span class="ruta mark"></span><span class="ruta"></span>';
    }

    function tryck(t) {
      if (lage === 'visar') { if (t === 'Enter') { i++; visa(); iSikte(el.parentElement); } return; }
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
      ak.innerHTML = ratt ? 'Rätt! 🎉' : `Inte riktigt. Rätt svar är <span style="white-space:nowrap">${sifferHTML(o.svar)}</span>`;
      const a = L.analysera(o.ord);
      $('[data-fk]', el).innerHTML = uppdelningHTML(a.delar) + (o.not ? `<p style="margin-top:6px">${esc(o.not)}</p>` : '');
      const kn = $('[data-knappar]', el);
      kn.innerHTML = `<div class="knapprad" style="justify-content:center"><button class="knapp" type="button" data-nasta>${i + 1 < ord.length ? 'Nästa ord →' : 'Se resultatet'}</button></div>`;
      const b = $('[data-nasta]', kn);
      b.addEventListener('click', () => { i++; visa(); iSikte(el.parentElement); });
      b.focus({ preventScroll: true });
      iSikte(el.parentElement);
    }

    function klart() {
      statistik('ord_klart', { lista, ratt: ratta, antal: ord.length });
      const alla = ratta === ord.length;
      el.innerHTML = resultatHTML({
        bild: alla ? 'stark' : 'kul',
        rubrik: `${ratta} av ${ord.length}`,
        text: alla ? 'Alla rätt! Du läser siffror som en minnesatlet.' : 'Bra jobbat! Kör igen eller prova en annan lista.',
      }) + `<div class="knapprad" style="justify-content:center">
        <button class="knapp sekundar" type="button" data-igen>Kör igen</button>
        <a class="knapp" href="#tal">Nästa steg →</a></div>`;
      el.querySelector('[data-igen]').addEventListener('click', starta);
    }

    tangenter.ord = k => {
      if (!$('[data-rutor]', el)) return false;
      if (/^\d$/.test(k) || k === 'Backspace' || k === 'Enter') { tryck(k); return true; }
      return false;
    };
    starta();

    // prova själv
    const inn = $('#prova-in'), ut = $('#prova-ut');
    const prova = () => {
      const v = inn.value.slice(0, 60);
      if (!v.trim()) { ut.innerHTML = '<p class="liten" style="padding-top:22px">Till exempel ditt namn, ditt husdjur eller din favoritmat.</p>'; return; }
      const a = L.analysera(v);
      const lh = a.siffror.length === 2 && ordFor(a.siffror);
      ut.innerHTML = `<div class="stor">${a.siffror ? sifferHTML(a.siffror) : '<span style="color:#9aaab9">–</span>'}</div>${uppdelningHTML(a.delar)}` +
        (lh && lh.ord.toLowerCase() !== v.trim().toLowerCase() ? `<p class="liten" style="margin-top:4px">I lathunden är ${a.siffror} ${lh.emoji} ${esc(lh.ord)}.</p>` : '');
    };
    inn.addEventListener('input', prova);
    prova();
  }

  // ════════════════════════════════════════════════════════════════════
  // 3. SIFFROR → ORD
  // ════════════════════════════════════════════════════════════════════
  function siffrorTillOrd() {
    const el = $('#tal-ovning');
    const VAL = [['bok', 'Bokens tal'], ['tva', 'Tvåsiffriga'], ['tre', 'Tresiffriga']];
    let lista = 'bok', tal = [], i = 0, ratta = 0, lage = 'svarar';

    const valEl = $('#tal-val');
    valEl.innerHTML = VAL.map(([k, n]) => `<button type="button" data-lista="${k}" aria-pressed="${k === lista}">${n}</button>`).join('');
    valEl.addEventListener('click', e => {
      const b = e.target.closest('[data-lista]');
      if (!b) return;
      lista = b.dataset.lista;
      $$('[data-lista]', valEl).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      starta();
    });

    function starta() {
      if (lista === 'bok') tal = D.boktal.map(([t, o]) => ({ tal: t, forslag: o }));
      else if (lista === 'tva') tal = blanda([...Array(100).keys()]).slice(0, 10).map(n => {
        const t = tal2(n);
        return { tal: t, forslag: ordFor(t).ord };
      });
      else tal = blanda(D.tresiffriga).slice(0, 10).map(([t, o]) => ({ tal: t, forslag: o }));
      i = 0; ratta = 0;
      visa();
    }

    function visa() {
      if (i >= tal.length) return klart();
      const t = tal[i].tal;
      lage = 'svarar';
      el.innerHTML = `
        <div class="ov-topp"><span>Tal ${i + 1} av ${tal.length}</span><span>✓ ${ratta}</span></div>
        <div class="ov-prog"><i style="width:${(i / tal.length) * 100}%"></i></div>
        <div class="fraga-text">Hitta på ett ord för</div>
        <div class="stor${t.length > 5 ? ' lang' : ''}">${sifferHTML(t)}</div>
        <div class="ljudtips dold" data-tips>${[...t].map(c => `<span class="d${c}"><b>${c}</b>${D.alfabet[+c].ljud.join('/')}</span>`).join('')}</div>
        <form class="tal-in" data-form autocomplete="off">
          <label class="sr" for="tal-ord">Ditt ord</label>
          <input id="tal-ord" type="text" autocapitalize="off" spellcheck="false" placeholder="Ditt ord …" maxlength="40">
          <button class="knapp" type="submit">Kolla</button>
        </form>
        <div class="aterkoppling" aria-live="polite" data-ak></div>
        <div class="forklaring" data-fk></div>
        <div class="knapprad" style="justify-content:center" data-knappar>
          <button class="knapp sekundar liten-k" type="button" data-tjuvkika>👀 Tjuvkika på ljuden</button>
          <button class="knapp sekundar liten-k" type="button" data-hoppa>Visa ett förslag</button>
        </div>`;
      $('[data-form]', el).addEventListener('submit', e => { e.preventDefault(); kolla(); });
      $('[data-tjuvkika]', el).addEventListener('click', e => {
        $('[data-tips]', el).classList.remove('dold');
        e.currentTarget.remove();
      });
      $('[data-hoppa]', el).addEventListener('click', () => avsluta(false, null));
    }

    function kolla() {
      if (lage !== 'svarar') return;
      const inn = $('#tal-ord');
      const ord = inn.value.trim();
      if (!ord) { inn.focus(); return; }
      const t = tal[i].tal;
      const a = L.analysera(ord);
      const ak = $('[data-ak]', el);
      if (a.siffror === t) return avsluta(true, a);
      ak.className = 'aterkoppling fel';
      ak.innerHTML = a.siffror
        ? `Jag hör ${sifferHTML(a.siffror)} i »${esc(ord)}«.`
        : `Jag hör inga konsonantljud alls i »${esc(ord)}«.`;
      $('[data-fk]', el).innerHTML = uppdelningHTML(a.delar) +
        `<div class="knapprad" style="justify-content:center">
          <button class="knapp sekundar liten-k" type="button" data-igen>Försök igen</button>
          <button class="knapp sekundar liten-k" type="button" data-andra>Jag uttalar det så att det blir ${esc(t)}</button></div>`;
      $('[data-igen]', el).addEventListener('click', () => {
        $('[data-fk]', el).innerHTML = ''; ak.textContent = '';
        inn.select(); inn.focus();
      });
      $('[data-andra]', el).addEventListener('click', () => avsluta(true, a));
    }

    function avsluta(ratt, analys) {
      lage = 'visar';
      const { tal: t, forslag } = tal[i];
      if (ratt) ratta++;
      const ak = $('[data-ak]', el);
      ak.className = 'aterkoppling ' + (ratt ? 'ratt' : '');
      ak.innerHTML = ratt ? 'Snyggt! 🎉' : '';
      const fa = L.analysera(forslag.replace(/!$/, ''));
      $('[data-fk]', el).innerHTML = (analys ? uppdelningHTML(analys.delar) : '') +
        `<div class="bild"><b>${lista === 'bok' ? 'Mitt förslag i boken' : 'Mitt förslag'}:</b> ${esc(forslag)}<br>${uppdelningHTML(fa.delar)}</div>`;
      const inn = $('#tal-ord');
      inn.disabled = true;
      $('[data-form] button', el).disabled = true;
      const kn = $('[data-knappar]', el);
      kn.innerHTML = `<button class="knapp" type="button" data-nasta>${i + 1 < tal.length ? 'Nästa tal →' : 'Se resultatet'}</button>`;
      const b = $('[data-nasta]', kn);
      b.addEventListener('click', () => { i++; visa(); iSikte(el.parentElement); });
      b.focus({ preventScroll: true });
      iSikte(el.parentElement);
    }

    function klart() {
      statistik('tal_klart', { lista, ratt: ratta, antal: tal.length });
      el.innerHTML = resultatHTML({
        bild: ratta === tal.length ? 'stark' : 'kul',
        rubrik: `${ratta} av ${tal.length}`,
        text: 'Ju fler ord du hittar på, desto snabbare går det. Proffsen har ett färdigt ord för varje tal, och det är nästa steg!',
      }) + `<div class="knapprad" style="justify-content:center">
        <button class="knapp sekundar" type="button" data-igen>Kör igen</button>
        <a class="knapp" href="#lathund">Nästa steg →</a></div>`;
      el.querySelector('[data-igen]').addEventListener('click', starta);
    }

    starta();
  }

  // ════════════════════════════════════════════════════════════════════
  // 4. LATHUNDEN
  // ════════════════════════════════════════════════════════════════════
  let niva = lagra.hamta('niva', {});   // '07' → 1 (öva mer) … 5 (sitter)
  const kan = t => (niva[t] || 0) >= 2;

  function ritaLathund() {
    const rut = $('#lathund-rutnat');
    rut.innerHTML = [...Array(100).keys()].map(n => {
      const t = tal2(n);
      return `<button type="button" data-tal="${t}" data-niva="${niva[t] || 0}"${egna[t] ? ' class="eget"' : ''}
        aria-label="${t}: ${esc(ordFor(t).ord)}">${t}</button>`;
    }).join('');
    const antal = Object.keys(niva).filter(kan).length;
    $('#lathund-summa').textContent = antal ? `Du kan ${antal} av 100 ord` : 'Dina 100 ord';
    $('#lathund-lista').innerHTML = [...Array(100).keys()].map(n => {
      const t = tal2(n), o = ordFor(t);
      return `<div><span class="nr">${sifferHTML(t)}</span><span class="em" aria-hidden="true">${o.emoji}</span>
        <span>${esc(o.ord)}${o.not ? `<small>${esc(o.not)}</small>` : ''}</span></div>`;
    }).join('');
  }

  function visaLathundOrd(t) {
    const o = ordFor(t);
    oppnaDialog(`
      <div class="stor">${sifferHTML(t)}</div>
      ${ordHTML(o)}
      ${uppdelningHTML(L.analysera(o.ord).delar)}
      <hr style="border:none;border-top:1px solid var(--linje);margin:14px 0 10px">
      <p style="font-weight:800;text-align:left">Byt till ett eget ord</p>
      <form class="eget-in" data-eget>
        <label class="sr" for="eget-ord">Eget ord för ${t}</label>
        <input id="eget-ord" type="text" maxlength="30" autocapitalize="off" spellcheck="false" value="${o.eget ? esc(o.ord) : ''}" placeholder="Ditt ord för ${t}">
        <button class="knapp liten-k" type="submit">Spara</button>
      </form>
      <div class="eget-status" data-status aria-live="polite"></div>
      ${o.eget ? `<button class="knapp sekundar liten-k" type="button" data-aterstall style="margin-top:6px">Tillbaka till bokens ord: ${esc(o.bok)}</button>` : ''}`,
    dlg => {
      const inn = $('#eget-ord', dlg), status = $('[data-status]', dlg);
      const kontroll = () => {
        const v = inn.value.trim();
        if (!v) { status.textContent = ''; return; }
        const s = L.tillSiffror(v);
        status.style.color = s === t ? 'var(--ratt)' : 'var(--c0)';
        status.innerHTML = s === t ? `✓ Låter rätt: ${sifferHTML(s)}`
          : `Jag hör ${s ? sifferHTML(s) : 'inga konsonanter'}. Du kan spara ändå om du uttalar det annorlunda.`;
      };
      inn.addEventListener('input', kontroll);
      kontroll();
      $('[data-eget]', dlg).addEventListener('submit', e => {
        e.preventDefault();
        const v = inn.value.trim();
        if (v && v !== D.lathund[+t][0]) egna[t] = v; else delete egna[t];
        lagra.spara('egna', egna);
        statistik('eget_ord', { tal: t });
        ritaLathund();
        stangDialog();
      });
      const at = $('[data-aterstall]', dlg);
      if (at) at.addEventListener('click', () => {
        delete egna[t]; lagra.spara('egna', egna); ritaLathund(); stangDialog();
      });
    });
  }

  function lathundOvning() {
    const el = $('#lathund-ovning');
    let lek = '0', hall = 'tal', ko = [], antal = 0, missar = 0, aktuell = null, lage = 'fraga', skrivet = '', omgang = 0;
    const lekEl = $('#lathund-lek'), hallEl = $('#lathund-hall');

    function ritaVal() {
      const svara = Object.keys(niva).filter(t => niva[t] === 1).length;
      const lekar = [...Array(10).keys()].map(n => [String(n), `${n}0–${n}9`]);
      lekar.push(['alla', 'Alla 100']);
      if (svara) lekar.push(['svara', `Öva mer (${svara})`]);
      if (lek === 'svara' && !svara) lek = 'alla';
      lekEl.innerHTML = lekar.map(([k, n]) => `<button type="button" data-lek="${k}" aria-pressed="${k === lek}">${n}</button>`).join('');
      hallEl.innerHTML = [['tal', 'Tal → ord'], ['ord', 'Ord → tal']]
        .map(([k, n]) => `<button type="button" data-hall="${k}" aria-pressed="${k === hall}">${n}</button>`).join('');
    }
    lekEl.addEventListener('click', e => { const b = e.target.closest('[data-lek]'); if (b) { lek = b.dataset.lek; ritaVal(); starta(); } });
    hallEl.addEventListener('click', e => { const b = e.target.closest('[data-hall]'); if (b) { hall = b.dataset.hall; ritaVal(); starta(); } });

    function starta() {
      let tal;
      if (lek === 'alla') {
        // de minst övade först, max 20 åt gången
        tal = blanda([...Array(100).keys()].map(tal2)).sort((a, b) => (niva[a] || 0) - (niva[b] || 0)).slice(0, 20);
      } else if (lek === 'svara') tal = Object.keys(niva).filter(t => niva[t] === 1).slice(0, 20);
      else tal = [...Array(10).keys()].map(n => lek + n);
      ko = blanda(tal); antal = ko.length; missar = 0; omgang++;
      nasta();
    }

    function nasta() {
      if (!ko.length) return klart();
      aktuell = ko.shift();
      lage = 'fraga'; skrivet = '';
      const o = ordFor(aktuell);
      const kvar = ko.length + 1;
      el.innerHTML = `
        <div class="ov-topp"><span>${kvar} kvar</span><span>${missar ? `${missar} ${missar === 1 ? 'miss' : 'missar'}` : ''}</span></div>
        <div class="ov-prog"><i style="width:${((antal - kvar) / antal) * 100}%"></i></div>
        <div class="vandkort" data-kort>
          ${hall === 'tal'
            ? `<div class="stor">${sifferHTML(aktuell)}</div><div data-baksida></div>`
            : `${ordHTML(o)}<div class="ov-svar" data-rutor>${rutorHTML('__', '')}</div>`}
        </div>
        <div class="aterkoppling" aria-live="polite" data-ak></div>
        <div data-knappar></div>
        <p class="tangenttips">${hall === 'tal' ? 'Tips: mellanslag visar ordet, pil höger = kunde, pil vänster = kunde inte.' : 'Tips: skriv talet med tangentbordet.'}</p>`;
      const kn = $('[data-knappar]', el);
      if (hall === 'tal') {
        kn.innerHTML = `<div class="knapprad" style="justify-content:center"><button class="knapp" type="button" data-vand>Visa ordet</button></div>`;
        $('[data-vand]', kn).addEventListener('click', vand);
      } else {
        kn.appendChild(knappsats(skriv, { klar: false }));
      }
    }

    function vand() {
      if (lage !== 'fraga') return;
      lage = 'vand';
      $('[data-baksida]', el).innerHTML = ordHTML(ordFor(aktuell));
      const kn = $('[data-knappar]', el);
      kn.innerHTML = `<div class="knapprad" style="justify-content:center">
        <button class="knapp sekundar" type="button" data-nej>✗ Kunde inte</button>
        <button class="knapp" type="button" data-ja>✓ Kunde</button></div>`;
      $('[data-ja]', kn).addEventListener('click', () => bedom(true));
      $('[data-nej]', kn).addEventListener('click', () => bedom(false));
    }

    function skriv(t) {
      if (lage !== 'fraga') return;
      if (t === 'Backspace') skrivet = skrivet.slice(0, -1);
      else if (/^\d$/.test(t)) skrivet += t;
      $('[data-rutor]', el).innerHTML = rutorHTML('__', skrivet);
      if (skrivet.length === 2) {
        lage = 'vand';
        const ratt = skrivet === aktuell;
        const ak = $('[data-ak]', el);
        ak.className = 'aterkoppling ' + (ratt ? 'ratt' : 'fel');
        ak.innerHTML = ratt ? 'Rätt!' : `Det var ${sifferHTML(aktuell)}`;
        if (!ratt) $('[data-rutor]', el).classList.add('skaka');
        const o = omgang, t = aktuell;
        setTimeout(() => { if (o === omgang && t === aktuell && lage === 'vand') bedom(ratt); }, ratt ? 550 : 1500);
      }
    }

    function bedom(ratt) {
      lage = 'klar';
      const t = aktuell;
      niva[t] = ratt ? Math.min(5, Math.max(2, (niva[t] || 0) + 1)) : 1;
      lagra.spara('niva', niva);
      if (!ratt) { missar++; ko.splice(Math.min(ko.length, 3), 0, t); }
      const cell = $(`#lathund-rutnat [data-tal="${t}"]`);
      if (cell) cell.dataset.niva = niva[t];
      const antalKan = Object.keys(niva).filter(kan).length;
      $('#lathund-summa').textContent = `Du kan ${antalKan} av 100 ord`;
      nasta();
      iSikte(el.parentElement);
    }

    function klart() {
      statistik('lathund_klart', { lek, hall, antal, missar });
      ritaVal();
      const tiotal = /^\d$/.test(lek) && lek !== '9';
      el.innerHTML = resultatHTML({
        bild: missar ? 'kul' : 'stark',
        rubrik: missar ? 'Klart!' : 'Felfritt!',
        text: `${antal} ord${missar ? `, ${missar} ${missar === 1 ? 'miss' : 'missar'} på vägen` : ''}. Repetera i morgon så sitter de ännu bättre.`,
      }) + `<div class="knapprad" style="justify-content:center">
        <button class="knapp sekundar" type="button" data-igen>Kör igen</button>
        ${tiotal ? `<button class="knapp" type="button" data-nasta-lek>Nästa tiotal: ${+lek + 1}0–${+lek + 1}9 →</button>` : ''}</div>`;
      el.querySelector('[data-igen]').addEventListener('click', starta);
      const nl = el.querySelector('[data-nasta-lek]');
      if (nl) nl.addEventListener('click', () => { lek = String(+lek + 1); ritaVal(); starta(); });
    }

    tangenter.lathund = k => {
      if (!aktuell || !$('[data-kort]', el)) return false;
      if (hall === 'tal') {
        if (lage === 'fraga' && (k === ' ' || k === 'Enter')) { vand(); return true; }
        if (lage === 'vand' && (k === 'ArrowRight' || k === 'Enter')) { bedom(true); return true; }
        if (lage === 'vand' && (k === 'ArrowLeft' || k === 'Backspace')) { bedom(false); return true; }
        return false;
      }
      if (/^\d$/.test(k) || k === 'Backspace') { skriv(k); return true; }
      return false;
    };

    ritaVal();
    starta();
  }

  // ════════════════════════════════════════════════════════════════════
  // 5. ÅRTAL OCH SIFFERFAKTA
  // ════════════════════════════════════════════════════════════════════
  function artal() {
    const listaEl = $('#artal-lista'), el = $('#artal-ovning');
    let lista = 'artal';
    const fragor = () => lista === 'artal'
      ? D.artal.map(a => ({ fraga: a.text, under: 'Vilket år?', mask: '19__', svar: a.tal, ord: a.ord, bild: a.bild }))
      : D.fakta.map(f => ({ fraga: f.fraga, under: '', mask: f.mask, svar: f.svar, ord: f.ord, bild: f.bild }));

    const valEl = $('#artal-val');
    valEl.innerHTML = [['artal', '1900-talet'], ['fakta', 'Fler siffror ur boken']]
      .map(([k, n]) => `<button type="button" data-lista="${k}" aria-pressed="${k === lista}">${n}</button>`).join('');
    valEl.addEventListener('click', e => {
      const b = e.target.closest('[data-lista]');
      if (!b) return;
      lista = b.dataset.lista;
      $$('[data-lista]', valEl).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      ritaLista();
      startsida();
    });

    function ritaLista() {
      if (lista === 'artal') {
        listaEl.innerHTML = D.artal.map(a => {
          const o = D.lathund[+a.tal];
          return `<div><span class="ar"><small>19</small>${sifferHTML(a.tal)}</span>
            <span class="h">${esc(a.text)} <b style="white-space:nowrap">${o[1]} ${esc(a.ord)}</b></span>
            <span class="b">💡 ${esc(a.bild)}</span></div>`;
        }).join('');
      } else {
        listaEl.innerHTML = D.fakta.map(f => `<div><span class="ar">${sifferHTML(fyllMask(f.mask, f.svar).replace(/:e$/, ''))}</span>
          <span class="h">${esc(f.fraga)} <b style="white-space:nowrap">${esc(f.ord)}</b></span>
          <span class="b">💡 ${esc(f.bild)}</span></div>`).join('');
      }
    }

    let fr = [], i = 0, ratta = 0, skrivet = '', lage = 'svarar';
    function startsida() {
      el.innerHTML = `<h3>Förhör</h3>
        <p>Har bilderna fastnat? Jag ställer frågorna i blandad ordning.</p>
        <div class="knapprad" style="justify-content:center"><button class="knapp" type="button" data-start>Förhör mig ▶</button></div>`;
      el.querySelector('[data-start]').addEventListener('click', starta);
      lage = 'av';
    }
    function starta() {
      fr = blanda(fragor()).slice(0, 10);
      i = 0; ratta = 0;
      visa();
      iSikte(el);
    }
    $('[data-till-forhor]').addEventListener('click', e => {
      e.preventDefault();
      el.scrollIntoView({ behavior: REDUCERAD ? 'auto' : 'smooth', block: 'center' });
    });
    function visa() {
      if (i >= fr.length) return klart();
      const f = fr[i];
      skrivet = ''; lage = 'svarar';
      el.innerHTML = `
        <div class="ov-topp"><span>Fråga ${i + 1} av ${fr.length}</span><span>✓ ${ratta}</span></div>
        <div class="ov-prog"><i style="width:${(i / fr.length) * 100}%"></i></div>
        <p style="font-size:1.12rem;font-weight:700;color:var(--text);margin-top:12px">${esc(f.fraga)}</p>
        ${f.under ? `<div class="fraga-text">${f.under}</div>` : ''}
        <div class="ov-svar" data-rutor>${rutorHTML(f.mask, '')}</div>
        <div class="aterkoppling" aria-live="polite" data-ak></div>
        <div class="forklaring" data-fk></div>
        <div data-knappar></div>`;
      $('[data-knappar]', el).appendChild(knappsats(tryck));
    }
    function tryck(t) {
      const f = fr[i];
      if (lage === 'visar') { if (t === 'Enter') { i++; visa(); iSikte(el); } return; }
      if (lage !== 'svarar') return;
      if (t === 'Backspace') skrivet = skrivet.slice(0, -1);
      else if (t === 'Enter') { if (skrivet.length === f.svar.length) ratta_(); return; }
      else if (skrivet.length < f.svar.length) skrivet += t;
      $('[data-rutor]', el).innerHTML = rutorHTML(f.mask, skrivet);
      if (skrivet.length === f.svar.length) ratta_();
    }
    function ratta_() {
      const f = fr[i];
      lage = 'visar';
      const ratt = skrivet === f.svar;
      if (ratt) ratta++;
      const ak = $('[data-ak]', el);
      ak.className = 'aterkoppling ' + (ratt ? 'ratt' : 'fel');
      ak.innerHTML = ratt ? 'Rätt! 🎉' : `Rätt svar: ${sifferHTML(fyllMask(f.mask, f.svar))}`;
      if (!ratt) $('[data-rutor]', el).classList.add('skaka');
      const a = L.analysera(f.ord);
      $('[data-fk]', el).innerHTML = `<div class="bild"><b>${esc(f.ord)}</b> ${uppdelningHTML(a.delar)}<br>💡 ${esc(f.bild)}</div>`;
      const kn = $('[data-knappar]', el);
      kn.innerHTML = `<div class="knapprad" style="justify-content:center"><button class="knapp" type="button" data-nasta>${i + 1 < fr.length ? 'Nästa fråga →' : 'Se resultatet'}</button></div>`;
      const b = $('[data-nasta]', kn);
      b.addEventListener('click', () => { i++; visa(); iSikte(el); });
      b.focus({ preventScroll: true });
      iSikte(el);
    }
    function klart() {
      lage = 'av';
      statistik('artal_klart', { lista, ratt: ratta, antal: fr.length });
      el.innerHTML = resultatHTML({
        bild: ratta === fr.length ? 'stark' : 'kul',
        rubrik: `${ratta} av ${fr.length}`,
        text: ratta === fr.length ? 'Alla rätt! Nu kan du briljera på nästa middag.' : 'Läs igenom bilderna en gång till och kör igen!',
      }) + `<div class="knapprad" style="justify-content:center">
        <button class="knapp sekundar" type="button" data-igen>Kör igen</button>
        <a class="knapp" href="#pi">Nästa steg →</a></div>`;
      el.querySelector('[data-igen]').addEventListener('click', starta);
    }

    tangenter.artal = k => {
      if (lage !== 'svarar' && lage !== 'visar') return false;
      if (/^\d$/.test(k) || k === 'Backspace' || k === 'Enter') { tryck(k); return true; }
      return false;
    };

    ritaLista();
    startsida();
  }

  // ════════════════════════════════════════════════════════════════════
  // 6. PI-UTMANINGEN
  // ════════════════════════════════════════════════════════════════════
  function pi() {
    const P = D.pi.platser;
    const promEl = $('#pi-promenad'), forEl = $('#pi-forhor'), radEl = $('#pi-rad');
    let p = 0;

    function ritaRad() {
      radEl.innerHTML = '<span class="sf">3,</span> ' + P.map((pl, n) =>
        pl.par.map(par => `<span class="par${n === p ? ' nu' : ''}">${sifferHTML(par)}</span>`).join(' ')).join(' ');
    }

    function ritaPromenad() {
      const pl = P[p];
      const [namn, rum] = D.palats[p];
      const ord = pl.par.map(ordFor);
      const egnaHar = ord.some(o => o.eget);
      promEl.innerHTML = `
        <h3 style="text-align:left">2. Gå promenaden</h3>
        <div class="plats-nr" style="margin-top:8px">Plats ${p + 1} av ${P.length} · ${rum}</div>
        <div class="plats-namn">${namn}</div>
        <div class="plats-par">${pl.par.map((par, n) => `<div>
          <span class="em" aria-hidden="true">${ord[n].emoji}</span>
          <span class="nr">${sifferHTML(par)}</span><span class="w">${esc(ord[n].ord)}</span></div>`).join('')}</div>
        <p class="plats-bild">${egnaHar
          ? (ord.length === 2 ? `Hitta på en bild där ${esc(ord[0].ord)} gör något med ${esc(ord[1].ord)}.` : `Föreställ dig ${esc(ord[0].ord)} här.`)
          : esc(pl.bild)}</p>
        <div class="prickar">${P.map((_, n) => `<button type="button" data-p="${n}" aria-label="Plats ${n + 1}" aria-current="${n === p}"></button>`).join('')}</div>
        <div class="knapprad" style="justify-content:center">
          <button class="knapp sekundar" type="button" data-forra ${p === 0 ? 'disabled' : ''}>← Förra</button>
          ${p < P.length - 1
            ? '<button class="knapp" type="button" data-nasta>Nästa plats →</button>'
            : '<button class="knapp" type="button" data-testa>Testa dig! ↓</button>'}
        </div>`;
      ritaRad();
    }
    promEl.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.p != null) p = +b.dataset.p;
      else if ('forra' in b.dataset) p = Math.max(0, p - 1);
      else if ('nasta' in b.dataset) p = Math.min(P.length - 1, p + 1);
      else if ('testa' in b.dataset) { forEl.scrollIntoView({ behavior: REDUCERAD ? 'auto' : 'smooth', block: 'start' }); return; }
      ritaPromenad();
    });

    // förhöret
    const DEC = D.pi.decimaler;
    let pos = 0, fel = 0, missPa = {}, start = 0, igang = false;

    function forhorStart() {
      igang = false;
      const bast = lagra.hamta('pi-bast', null);
      forEl.innerHTML = `
        <h3 style="text-align:left">3. Testa dig</h3>
        <img src="assets/jonas/masken.webp" alt="" width="587" height="720" style="width:110px;height:auto;display:block;margin:10px auto 4px">
        <p>Blunda och gå promenaden i huvudet: från ytterdörren, in i hallen och vidare.
          Skriv sedan alla 30 decimalerna. Tiden går från första siffran.</p>
        ${bast ? `<p class="liten" style="margin-top:6px">Ditt rekord: ${sekText(bast.sek)}${bast.fel ? `, ${bast.fel} fel` : ', felfritt'}</p>` : ''}
        <div class="knapprad" style="justify-content:center"><button class="knapp" type="button" data-start>Jag är redo ▶</button></div>`;
      $('[data-start]', forEl).addEventListener('click', forhorKor);
    }

    function forhorKor() {
      pos = 0; fel = 0; missPa = {}; start = 0; igang = true;
      forEl.innerHTML = `
        <div class="ov-topp"><span data-kvar>30 kvar</span><span data-klocka>0 s</span></div>
        <div class="pi-forhor-tal" data-tal aria-live="polite"></div>
        <div class="pi-tips" data-tips></div>
        <div data-knappar></div>
        <p class="tangenttips">Tips: skriv med tangentbordet.</p>`;
      $('[data-knappar]', forEl).appendChild(knappsats(skriv, { tio: true }));
      ritaTal();
      iSikte(forEl);
    }

    let klocka = null;
    function ritaTal() {
      let html = '<span class="par">3,</span>';
      for (let n = 0; n < DEC.length; n += 2) {
        html += `<span class="par${n % 4 === 0 && n ? ' ny-plats' : ''}">`;
        for (const k of [n, n + 1]) {
          const c = DEC[k];
          html += k < pos ? `<span class="sf d${c}${missPa[k] ? ' miss' : ''}">${c}</span>`
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
        if (pos === DEC.length) return forhorKlart();
        return;
      }
      fel++;
      missPa[pos] = (missPa[pos] || 0) + 1;
      const tal = $('[data-tal]', forEl);
      tal.classList.remove('skaka'); void tal.offsetWidth; tal.classList.add('skaka');
      // tipsen blir tydligare för varje miss på samma siffra
      const platsNr = Math.floor(pos / 4);
      const [namn] = D.palats[platsNr];
      const ord = P[platsNr].par.map(ordFor).map(o => `${o.emoji} ${o.ord}`).join(' och ');
      tips.textContent = missPa[pos] === 1 ? `Tänk på plats ${platsNr + 1}: ${namn.toLowerCase()}.`
        : missPa[pos] === 2 ? `Plats ${platsNr + 1}: ${ord}.`
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
      forEl.innerHTML = resultatHTML({
        bild: fel ? 'kul' : 'smash',
        rubrik: fel ? sekText(sek) : 'Felfritt! 🎉',
        text: `Du kan de 30 första decimalerna av pi${fel ? `, med ${fel} fel på vägen` : ` på ${sekText(sek)}`}.
          ${battre && bast ? 'Nytt rekord! ' : ''}Bara 13&nbsp;178 decimaler kvar, så är du ikapp mig …`,
      }) + `<div class="knapprad" style="justify-content:center">
        <button class="knapp sekundar" type="button" data-igen>Testa igen</button>
        <a class="knapp" href="#dittal">Nästa steg →</a></div>`;
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
    return { visad: ritaPromenad };   // egna ord kan ha ändrats sedan sist
  }

  // ════════════════════════════════════════════════════════════════════
  // 7. DITT EGET TAL
  // ════════════════════════════════════════════════════════════════════
  function dittTal() {
    const inn = $('#dittal-in'), ut = $('#dittal-ut');
    let raknad = false;
    function rita() {
      const siffror = inn.value.replace(/\D/g, '');
      const s = siffror.slice(0, 60);
      if (!s) {
        ut.innerHTML = '<p class="liten">Prova med ett telefonnummer, en portkod eller året du föddes.</p>';
        return;
      }
      if (!raknad) { raknad = true; statistik('dittal_anvant'); }
      const par = s.match(/\d{1,2}/g);
      const platser = [];
      for (let n = 0; n < par.length; n += 2) platser.push(par.slice(n, n + 2));
      ut.innerHTML = platser.map((pp, n) => {
        const [namn] = D.palats[n] || [`Plats ${n + 1}`];
        const ord = pp.map(t => { const o = ordFor(t); return `<span class="nr">${sifferHTML(t)}</span> ${o.emoji} ${esc(o.ord)}`; });
        return `<div><div class="pn">Plats ${n + 1}${D.palats[n] ? ' · ' + namn : ''}</div><div class="po">${ord.join(' &nbsp;+&nbsp; ')}</div></div>`;
      }).join('') + (siffror.length > 60 ? '<p class="liten">Jag tog de första 60 siffrorna.</p>' : '') +
        (platser.length ? '<p class="liten">Låt den första bilden göra något med den andra, så sitter ordningen.</p>' : '');
    }
    inn.addEventListener('input', rita);
    rita();
    return { visad: rita };
  }

  // ════════════════════════════════════════════════════════════════════
  // FLIKARNA
  // ════════════════════════════════════════════════════════════════════
  const VYER = ['alfabetet', 'ord', 'tal', 'lathund', 'artal', 'pi', 'dittal'];
  const vidVisning = {};
  function visaVy(id, { scrolla = true } = {}) {
    if (!VYER.includes(id)) id = 'alfabetet';
    const byte = id !== aktivVy;
    aktivVy = id;
    for (const v of VYER) $(`#vy-${v}`).hidden = v !== id;
    $$('.flik').forEach(a => {
      if (a.getAttribute('href') === '#' + id) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    const flik = $(`.flik[href="#${id}"]`);
    if (flik) flik.scrollIntoView({ block: 'nearest', inline: 'center' });
    if (vidVisning[id]) vidVisning[id]();
    if (scrolla) {
      const y = $('.flikar').offsetTop;
      if (window.scrollY > y) window.scrollTo({ top: y, behavior: 'auto' });
    }
    if (byte || !scrolla) statistik('flik', { flik: id });
  }

  function sno() {
    if (REDUCERAD) return;
    const el = $('.sno');
    for (let n = 0; n < 26; n++) {
      const f = document.createElement('i');
      const storlek = 3 + Math.random() * 5;
      f.style.cssText = `left:${Math.random() * 100}%;width:${storlek}px;height:${storlek}px;` +
        `animation-duration:${7 + Math.random() * 9}s;animation-delay:${-Math.random() * 14}s;` +
        `--dx:${Math.round(Math.random() * 60 - 30)}px;opacity:${0.25 + Math.random() * 0.45}`;
      el.appendChild(f);
    }
  }

  // ── igång ──
  sno();
  byggAlfabet();
  alfabetQuiz();
  ordTillSiffror();
  siffrorTillOrd();
  ritaLathund();
  $('#lathund-rutnat').addEventListener('click', e => {
    const b = e.target.closest('[data-tal]');
    if (b) visaLathundOrd(b.dataset.tal);
  });
  lathundOvning();
  artal();
  vidVisning.pi = pi().visad;
  vidVisning.dittal = dittTal().visad;
  vidVisning.lathund = ritaLathund;

  window.addEventListener('hashchange', () => visaVy(location.hash.slice(1)));
  visaVy(location.hash.slice(1) || 'alfabetet', { scrolla: false });
})();
