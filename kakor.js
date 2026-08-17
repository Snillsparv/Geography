// ── Kakor & statistik: PostHog med samtycke, och kakrutan där Jonas ──
// ── käkar upp kakan om man inte bestämmer sig ──
//
// Spårningens tre lägen:
//  · inget svar ännu / "nej tack" → HELT ANONYMT: inga kakor, inget sparat
//    i webbläsaren (minnes-läge), ingen sessionsinspelning. Besök och spel
//    räknas, men ingen kan kännas igen mellan besöken.
//  · "ja" → webbläsaren minns besökaren (då funkar retention/återbesök)
//    och sessioner kan spelas in så vi ser var folk fastnar.
//  · lokalt/förhandskanaler (--pr) spåras ALDRIG — utom när
//    localStorage.kaktest === '1' (verifieringskörningar).
//
// Spelet rapporterar händelser via window.kakSpara?.(namn, egenskaper) —
// funktionen finns alltid, men skickar bara när PostHog är igång.
(() => {
  const TOKEN = 'phc_ADbD7ENhThE54GinNPoTv5XAWDkTSUPu2MmWkyAHJo4x';
  const VAL_NYCKEL = 'kakval';           // 'ja' | 'nej'
  const LOKAL = /^(127\.|localhost)/.test(location.hostname)
    || location.hostname.includes('--pr');
  const AKTIV = !LOKAL || localStorage.getItem('kaktest') === '1';
  const val = () => { try { return localStorage.getItem(VAL_NYCKEL); } catch (e) { return 'nej'; } };

  window.kakSpara = (namn, props) => {
    try { if (AKTIV && window.posthog && posthog.capture) posthog.capture(namn, props || {}); }
    catch (e) { /* statistiken får aldrig störa spelet */ }
  };

  if (AKTIV) {
    // PostHogs officiella laddsnutt (eu-molnet): skapar en kö-stub direkt,
    // riktiga skriptet strömmar in i bakgrunden
    !function (t, e) { var o, n, p, r; e.__SV || (window.posthog = e, e._i = [], e.init = function (i, s, a) { function g(t, e) { var o = e.split("."); 2 == o.length && (t = t[o[0]], e = o[1]), t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))) } } (p = t.createElement("script")).type = "text/javascript", p.crossOrigin = "anonymous", p.async = !0, p.src = s.api_host.replace(".i.posthog.com", "-assets.i.posthog.com") + "/static/array.js", (r = t.getElementsByTagName("script")[0]).parentNode.insertBefore(p, r); var u = e; for (void 0 !== a ? u = e[a] = [] : a = "posthog", u.people = u.people || [], u.toString = function (t) { var e = "posthog"; return "posthog" !== a && (e += "." + a), t || (e += " (stub)"), e }, u.people.toString = function () { return u.toString(1) + ".people (stub)" }, o = "init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey canRenderSurveyAsync identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug getPageViewId captureTraceFeedback captureTraceMetric".split(" "), n = 0; n < o.length; n++)g(u, o[n]); e._i.push([i, s, a]) }, e.__SV = 1) }(document, window.posthog || []);
    posthog.init(TOKEN, {
      api_host: 'https://eu.i.posthog.com',
      ui_host: 'https://eu.posthog.com',
      defaults: '2025-05-24',
      // utan samtycke: allt stannar i minnet — ingen kaka, ingen lagring
      persistence: val() === 'ja' ? 'localStorage+cookie' : 'memory',
      capture_pageview: true,
      capture_pageleave: true,          // ger sessionslängder
      capture_exceptions: true,         // JS-fel → Error tracking
      capture_performance: true,        // nätverkstider + web vitals
      autocapture: true,
      disable_session_recording: val() !== 'ja',
      session_recording: { maskAllInputs: true },
    });
  }

  // ── samtyckesväxeln ──
  function sagJa() {
    try { localStorage.setItem(VAL_NYCKEL, 'ja'); } catch (e) {}
    if (AKTIV && window.posthog) {
      try {
        posthog.set_config({ persistence: 'localStorage+cookie',
                             disable_session_recording: false });
        posthog.startSessionRecording();
        posthog.capture('kakor_svar', { val: 'ja' });
      } catch (e) {}
    }
  }
  function sagNej() {
    try { localStorage.setItem(VAL_NYCKEL, 'nej'); } catch (e) {}
    window.kakSpara('kakor_svar', { val: 'nej' });   // anonym minnespinne
  }

  // ── kakrutan ──
  if (val()) return;                       // redan svarat — ingen ruta
  const REDUCERAD = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const stil = document.createElement('style');
  stil.textContent = `
#kakruta { position: fixed; left: 12px; bottom: 0; z-index: 380;
  display: flex; align-items: flex-end; max-width: min(480px, calc(100vw - 16px));
  opacity: 0; transform: translateY(28px); transition: opacity .5s, transform .5s cubic-bezier(.2,.9,.3,1.15); }
#kakruta.inne { opacity: 1; transform: none; }
#kakruta.ut, #kakruta.undan { opacity: 0; transform: translateY(34px); pointer-events: none; }
.kak-jonas { width: 200px; aspect-ratio: 896 / 1200; position: relative; flex: none;
  margin-right: -30px; margin-bottom: -8px; z-index: 2; pointer-events: none;
  filter: drop-shadow(0 10px 22px #000a); }
.kak-jonas img { position: absolute; display: block; user-select: none; }
.kak-kropp { inset: 0; width: 100%; }
.kak-arm { position: absolute; left: 2.79%; top: 29.67%; width: 42.63%; height: 62.33%;
  transform-origin: 32.7% 88.8%;
  transition: transform .9s cubic-bezier(.55,-.12,.32,1.12); }
.kak-arm > img { inset: 0; width: 100%; z-index: 1; }
#kakruta.vaken .kak-arm { animation: kak-svaj 3.8s ease-in-out infinite alternate; }
#kakruta .kak-arm.bett { animation: none;
  transform: translate(8.8%, -29.5%) rotate(44deg); }
@keyframes kak-svaj { from { transform: rotate(-1.7deg); } to { transform: rotate(1.5deg); } }
/* kakan kläms i tumgreppet: halva utanför handflatans kant, BAKOM tummen
   (tumkopian ritas ovanpå) men framför handflatan */
.kak-kaka { position: absolute; left: 50.8%; top: 20.9%; width: 46.1%;
  transform: rotate(-9deg); z-index: 2; }
.kak-kaka svg { display: block; width: 100%; }
.kak-arm > img.kak-tumme { inset: auto; left: 73.8%; top: 27.8%; width: 26.2%;
  z-index: 3; filter: drop-shadow(-3px 3px 3px rgba(20, 8, 0, .38)); }
/* framme vid munnen byter kakan och handen z-plats: handen stoppar in kakan
   (kakan bakom handflatan) medan tummen hamnar bakom kakan */
.kak-arm.framme > img:not(.kak-tumme) { z-index: 3; }
.kak-arm.framme > img.kak-tumme { z-index: 1; }
.kak-kaka[data-bett="0"] .b1, .kak-kaka[data-bett="0"] .b2, .kak-kaka[data-bett="0"] .b3,
.kak-kaka[data-bett="1"] .b2, .kak-kaka[data-bett="1"] .b3,
.kak-kaka[data-bett="2"] .b3 { display: none; }
.kak-kaka[data-bett="4"] { display: none; }
.kak-smulor { position: absolute; left: 65.3%; top: 50.8%; width: 0; height: 0; }
.kak-smulor span { position: absolute; width: 5px; height: 4px; border-radius: 2px;
  background: #b5762f; animation: kak-fall .8s ease-in forwards; }
@keyframes kak-fall { to { transform: translate(var(--dx, 0px), 48px) rotate(160deg); opacity: 0; } }
/* vit pratbubbla — samma manér som rundturens Jonas-bubblor */
.kak-kort { position: relative; background: #fff; color: #14243a;
  border-radius: 18px; padding: 14px 16px 12px; margin-bottom: 118px;
  box-shadow: 0 10px 34px #000b; }
.kak-kort::after { content: ""; position: absolute; left: -14px; bottom: 22px;
  border: 10px solid transparent; border-right-color: #fff; border-left-width: 6px; }
.kak-kort h3 { font-size: 1.03rem; margin: 0 0 6px; }
.kak-kort p { font-size: .87rem; line-height: 1.45; color: #3c5068; margin: 0 0 11px;
  font-weight: 600; }
.kak-knappar { display: flex; gap: 9px; flex-wrap: wrap; }
.kak-knappar button { border: none; border-radius: 10px; padding: 9px 16px;
  font: inherit; font-size: .9rem; font-weight: 800; cursor: pointer; }
#kak-ja { background: #ffdc32; color: #08131f; box-shadow: 0 3px 0 #0005;
  transition: transform .08s; }
#kak-ja:hover { transform: translateY(2px); box-shadow: 0 1px 0 #0005; }
#kak-nej { background: #e8eef4; color: #56718c; }
#kak-nej:hover { background: #dce6ef; }
@media (max-width: 700px) {
  #kakruta { left: 6px; right: 6px; max-width: none; }
  .kak-jonas { width: 132px; margin-right: -20px; }
  .kak-kort { padding: 11px 12px 10px; margin-bottom: 82px; }
  .kak-kort h3 { font-size: .94rem; } .kak-kort p { font-size: .8rem; }
  .kak-knappar button { font-size: .84rem; padding: 8px 13px; }
}`;
  document.head.appendChild(stil);

  const V = (document.currentScript && (document.currentScript.src.split('?v=')[1] || '')) || '';
  const q = V ? '?v=' + V : '';
  const ruta = document.createElement('div');
  ruta.id = 'kakruta';
  ruta.setAttribute('role', 'dialog');
  ruta.setAttribute('aria-label', 'Fråga om kakor');
  ruta.innerHTML = `
  <div class="kak-jonas" aria-hidden="true">
    <img class="kak-kropp" src="assets/jonas/kak-kropp.webp${q}" alt="">
    <div class="kak-arm">
      <img src="assets/jonas/kak-arm.webp${q}" alt="">
      <div class="kak-kaka" data-bett="0"><svg viewBox="0 0 200 200">
        <defs>
          <radialGradient id="kakgrad" cx="42%" cy="38%" r="80%">
            <stop offset="0%" stop-color="#e9b169"/>
            <stop offset="62%" stop-color="#d4914a"/>
            <stop offset="100%" stop-color="#b5762f"/>
          </radialGradient>
          <clipPath id="kakklipp"><circle cx="100" cy="100" r="84"/></clipPath>
          <mask id="kakmask">
            <rect width="200" height="200" fill="#fff"/>
            <g fill="#000">
              <g class="b1"><circle cx="152" cy="30" r="25"/><circle cx="171" cy="53" r="22"/><circle cx="133" cy="21" r="4"/></g>
              <g class="b2"><circle cx="184" cy="88" r="26"/><circle cx="177" cy="63" r="22"/><circle cx="193" cy="112" r="5"/></g>
              <g class="b3"><circle cx="110" cy="13" r="26"/><circle cx="136" cy="20" r="23"/><circle cx="88" cy="9" r="4"/></g>
            </g>
          </mask>
        </defs>
        <g mask="url(#kakmask)">
          <circle cx="100" cy="100" r="84" fill="url(#kakgrad)"/>
          <g fill="#5b371c" stroke="#3a2410" stroke-width="2">
            <ellipse cx="72" cy="58" rx="9" ry="7" transform="rotate(-15 72 58)"/>
            <ellipse cx="121" cy="76" rx="8" ry="6" transform="rotate(20 121 76)"/>
            <ellipse cx="58" cy="108" rx="8" ry="7" transform="rotate(10 58 108)"/>
            <ellipse cx="101" cy="131" rx="9" ry="7" transform="rotate(-25 101 131)"/>
            <ellipse cx="140" cy="118" rx="7" ry="6"/>
            <ellipse cx="82" cy="163" rx="7" ry="5" transform="rotate(15 82 163)"/>
          </g>
          <circle cx="100" cy="100" r="84" fill="none" stroke="#3a2410" stroke-width="7"/>
          <g clip-path="url(#kakklipp)" fill="none" stroke="#3a2410" stroke-width="14">
            <g class="b1"><circle cx="152" cy="30" r="25"/><circle cx="171" cy="53" r="22"/></g>
            <g class="b2"><circle cx="184" cy="88" r="26"/><circle cx="177" cy="63" r="22"/></g>
            <g class="b3"><circle cx="110" cy="13" r="26"/><circle cx="136" cy="20" r="23"/></g>
          </g>
        </g>
      </svg></div>
      <img class="kak-tumme" src="assets/jonas/kak-tumme.webp${q}" alt="">
    </div>
    <div class="kak-smulor" aria-hidden="true"></div>
  </div>
  <div class="kak-kort">
    <h3 id="kak-rubrik">Får jag bjuda på en kaka? 🍪</h3>
    <p id="kak-brod">Kakor hjälper mig se hur spelet används så att jag kan
      göra det ännu bättre. Säger du nej tack spelar du helt anonymt!</p>
    <div class="kak-knappar">
      <button id="kak-ja">Ja, det är lugnt!</button>
      <button id="kak-nej">Nej tack</button>
    </div>
  </div>`;

  const meny = () => {
    document.body.appendChild(ruta);
    requestAnimationFrame(() => requestAnimationFrame(() => ruta.classList.add('inne', 'vaken')));

    const arm = ruta.querySelector('.kak-arm');
    const kaka = ruta.querySelector('.kak-kaka');
    const smulor = ruta.querySelector('.kak-smulor');
    const brod = ruta.querySelector('#kak-brod');
    const jaKnapp = ruta.querySelector('#kak-ja');
    let bett = 0, timer = null, stangd = false;

    // smulregn vid munnen när ett bett tas
    const smula = () => {
      for (let i = 0; i < 6; i++) {
        const s = document.createElement('span');
        s.style.setProperty('--dx', (Math.random() * 46 - 20) + 'px');
        s.style.left = (Math.random() * 14 - 7) + 'px';
        s.style.top = (Math.random() * 10) + 'px';
        s.style.animationDelay = (Math.random() * 0.12) + 's';
        smulor.appendChild(s);
        setTimeout(() => s.remove(), 1100);
      }
    };

    const taEttBett = () => {
      if (stangd || document.hidden || ruta.classList.contains('undan')) { planera(); return; }
      ruta.classList.remove('vaken');          // svajet pausar under resan
      arm.classList.add('bett');
      setTimeout(() => {                       // framme vid munnen
        if (stangd) return;
        arm.classList.add('framme');           // handen stoppar in kakan
        bett++;
        kaka.dataset.bett = bett;
        smula();
        setTimeout(() => {                     // en liten tugg-paus
          if (stangd) return;
          arm.classList.remove('bett', 'framme');
          if (bett >= 4) {                     // kakan är slut
            brod.textContent = 'Mm … nu åt jag tyvärr upp hela kakan. Men frågan kvarstår!';
            jaKnapp.textContent = 'Ja — och bjud på en ny kaka 🍪';
          } else {
            ruta.classList.add('vaken');
            planera();
          }
        }, 420);
      }, 920);
    };
    const planera = () => {
      if (REDUCERAD || bett >= 4 || stangd) return;
      clearTimeout(timer);
      timer = setTimeout(taEttBett, bett === 0 ? 6000 : 6500);
    };
    planera();

    const stang = () => {
      stangd = true;
      clearTimeout(timer);
      ruta.classList.add('ut');
      setTimeout(() => ruta.remove(), 600);
    };
    ruta.querySelector('#kak-ja').addEventListener('click', () => { sagJa(); stang(); });
    ruta.querySelector('#kak-nej').addEventListener('click', () => { sagNej(); stang(); });

    // drar en tur eller notis igång medan rutan syns (hjälpknappen, install-
    // notisen …) kliver den undan och kommer tillbaka när Jonas pratat klart
    const intro = document.getElementById('intro-overlay');
    if (intro) {
      const synka = () => {
        if (stangd) return;
        if (intro.style.display !== 'none') ruta.classList.add('undan');
        else setTimeout(() => {
          if (!stangd && intro.style.display === 'none') ruta.classList.remove('undan');
        }, 1200);
      };
      new MutationObserver(synka).observe(intro, { attributes: true, attributeFilter: ['style'] });
    }
  };

  // ── turordning: Jonas kan bara prata på ett ställe i taget ──
  // Rundturen (startsidan) och spelgenomgången (regionsidorna) går före —
  // kakfrågan väntar tills de körts klart eller hoppats över, och visas
  // aldrig medan intro-overlayen (turer och notiser) är uppe.
  const introDold = () => {
    const el = document.getElementById('intro-overlay');
    return !el || el.style.display === 'none';
  };
  const params = new URLSearchParams(location.search);
  // undersidor (lärarsidan m.fl.) har ingen rundtur att vänta på
  const spelsida = location.pathname === '/' || /glob\.html$/.test(location.pathname);
  const vantarPa = !spelsida ? null
    : params.get('region') ? 'speltur-klar'
    : params.get('utmaning') ? null : 'rundtur-klar';
  const turKlar = () => {
    if (!vantarPa) return true;
    try { return !!localStorage.getItem(vantarPa); } catch (e) { return true; }
  };
  const prova = () => {
    if (!turKlar() || !introDold()) { setTimeout(prova, 700); return; }
    meny();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(prova, 1400));
  } else setTimeout(prova, 1400);
})();
