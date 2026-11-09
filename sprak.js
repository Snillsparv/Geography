// ──────────────────────────────────────────────────────────────────────────
// Språk och webbplats: jonasgeografi (svenska) eller allusstates (engelska,
// bara USA). Laddas först i <head>, före kakor.js och glob-spel.js, som
// läser window.SPRAK redan när de laddas (data-URL:er, topplistenycklar).
//
// SPRAK.t(svenskText, värden) ger texten på sidans språk. På svenska är den
// alltid exakt den svenska texten (bara {platshållare} fylls i), så den
// svenska sidan kan inte ändras av översättningen. Engelskan ligger i
// sprak-en.js (window.SPRAK_EN), nycklad på den svenska texten.
//
// Vilken webbplats det är avgörs av <html data-sajt> (den engelska
// startsidan allusstates.html sätter den) eller av värdnamnet. På
// utvecklings- och förhandsvisningsadresser kan ?lang=en / ?lang=sv byta
// språk för test; valet sparas i sessionStorage för resten av besöket.
// ──────────────────────────────────────────────────────────────────────────
(() => {
  const SAJTER = {
    jonasgeografi: {
      lang: 'sv', regioner: null, startRegion: null, hsPrefix: '', besokPrefix: '',
      varumarke: 'Jonas geografi', ikon: '🌍', datum: 'sv-SE', decimal: ',',
    },
    allusstates: {
      lang: 'en', regioner: ['usa'], startRegion: 'usa', hsPrefix: 'en-', besokPrefix: 'en-',
      varumarke: 'All US States', ikon: '🇺🇸', datum: 'en-US', decimal: '.',
    },
  };
  const rot = document.documentElement;
  const h = location.hostname;
  // lokala servrar, Firebase-förhandsvisningar (<sajt>--<kanal>-<hash>.web.app)
  // och githack-förhandslänkar
  const dev = /^(127\.|localhost$|\[::1\]$)/.test(h) || /--/.test(h) || /\.githack\.com$/.test(h);
  const fast = rot.dataset.sajt;   // satt i den genererade engelska startsidan
  let id = fast || (/^allusstates(--|-com--|\.)|(^|\.)allusstates\.com$/.test(h) ? 'allusstates' : 'jonasgeografi');
  if (dev && !fast) {
    const q = new URLSearchParams(location.search).get('lang');
    const val = q === 'en' ? 'allusstates' : q === 'sv' ? 'jonasgeografi' : null;
    try {
      if (val) sessionStorage.setItem('sajt', val);
      id = sessionStorage.getItem('sajt') || id;
    } catch (e) { if (val) id = val; }
  }
  if (!SAJTER[id]) id = 'jonasgeografi';
  const P = { ...SAJTER[id], id, dev };
  // testresultat från förhandsvisningar hamnar inte på den riktiga listan
  if (dev && P.hsPrefix) P.hsPrefix = 'test-' + P.hsPrefix;

  const fyll = (s, v) => v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : s;
  const saknade = new Set();
  P.t = (sv, v) => {
    if (P.lang === 'sv') return fyll(sv, v);
    let s = window.SPRAK_EN && window.SPRAK_EN.strangar ? window.SPRAK_EN.strangar[sv] : undefined;
    if (s == null) {
      if (!saknade.has(sv)) { saknade.add(sv); console.warn('saknar en:', sv); }
      s = sv;
    }
    return fyll(typeof s === 'function' ? s(v || {}) : s, v);
  };
  P.saknade = saknade;
  // världens länder (klick utanför USA i delstatsquizet) heter på svenska i
  // datan; på engelska slås namnet upp på nyckeln (art-regions.json key)
  P.landnamn = (key, sv) => (P.lang === 'sv' ? sv
    : (window.SPRAK_EN && window.SPRAK_EN.landnamn && window.SPRAK_EN.landnamn[key]) || sv);
  P.tillat = r => !P.regioner || P.regioner.includes(r);
  // Översätter markup med data-t (texten), data-t-html (innerHTML, nyckeln
  // i attributet) och data-t-title/-placeholder/-alt/-aria-label. Nyckeln
  // är elementets svenska text (blanksteg hopslagna) om attributet är tomt.
  P.oversattDom = (rotEl) => {
    if (P.lang === 'sv') return;
    const r = rotEl || document;
    const norm = s => s.replace(/\s+/g, ' ').trim();
    r.querySelectorAll('[data-t]').forEach(el => {
      const nyckel = el.dataset.t || norm(el.textContent);
      el.textContent = P.t(nyckel);
    });
    r.querySelectorAll('[data-t-html]').forEach(el => {
      el.innerHTML = P.t(el.dataset.tHtml || norm(el.innerHTML));
    });
    for (const attr of ['title', 'placeholder', 'alt', 'aria-label']) {
      const d = 'data-t-' + attr;
      r.querySelectorAll('[' + d + ']').forEach(el => {
        const nyckel = el.getAttribute(d) || norm(el.getAttribute(attr) || '');
        el.setAttribute(attr, P.t(nyckel));
      });
    }
  };
  rot.lang = P.lang;
  rot.dataset.sajt = id;
  // ?lang=en på den svenska sidan (test): hämta engelskan synkront medan
  // <head> fortfarande tolkas. Den engelska startsidan har redan taggen.
  if (P.lang !== 'sv' && !fast && !window.SPRAK_EN) {
    const me = document.currentScript && document.currentScript.src;
    const v = me && /[?&]v=([^&]+)/.exec(me);
    document.write('<script src="sprak-' + P.lang + '.js' + (v ? '?v=' + v[1] : '') + '"><\/script>');
  }
  window.SPRAK = P;
})();
