// ── Bakgrunden: lysande siffror på svart botten ──
// Ritas en gång på två canvas bakom sidan, och om när fönstret blir större.
// Siffrorna delas på de två lagren, som lyser upp och dämpas om vartannat
// med CSS.
(() => {
  'use strict';
  const lager = [document.getElementById('bakgrund'), document.getElementById('glod')];
  if (!lager[0] || !lager[1] || !lager[0].getContext) return;
  const FONT = "'League Gothic', 'Arial Narrow', Impact, sans-serif";
  let ritadB = 0, ritadH = 0;

  function rita() {
    const b = innerWidth, h = Math.max(innerHeight, screen.height || 0);
    if (b === ritadB && h <= ritadH) return;
    ritadB = b; ritadH = h;
    // skarpt i mobilen, men högst fyra megapixel per lager
    const dpr = Math.min(devicePixelRatio || 1, 2, Math.sqrt(4e6 / (b * h)));
    const k = lager.map(c => {
      c.width = Math.round(b * dpr); c.height = Math.round(h * dpr);
      c.style.width = b + 'px'; c.style.height = h + 'px';
      const x = c.getContext('2d');
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.shadowColor = 'rgba(255,110,30,.95)'; x.fillStyle = 'rgba(255,205,150,.95)';
      return x;
    });

    // samma mönster varje gång: en enkel slumpgenerator med fast frö. Av
    // siffrorna på ett mellanavstånd får var tolfte lysa, resten ritas inte.
    let fro = 271828;
    const slump = () => (fro = (fro * 16807) % 2147483647) / 2147483647;
    const lista = [];
    for (let n = Math.min(2500, Math.round(b * h / 900)); n > 0; n--) {
      const d = { z: slump(), x: slump() * b, y: slump() * h, rot: (slump() - .5) * .7, l: slump(), s: String(Math.floor(slump() * 10)) };
      if (d.l < .08 && d.z > .45 && d.z < .9) lista.push(d);
    }
    // längst bort först: de små bakom de stora
    lista.sort((a, c) => a.z - c.z);
    for (const d of lista) {
      const st = 8 + Math.pow(d.z, 4) * 160;
      const x = k[d.l < .04 ? 0 : 1];
      x.setTransform(dpr, 0, 0, dpr, d.x * dpr, d.y * dpr);
      x.rotate(d.rot);
      x.font = st + 'px ' + FONT;
      x.shadowBlur = (8 + st * .3) * dpr;   // skuggan räknas i bildpunkter
      x.fillText(d.s, 0, 0);
    }
  }

  let vantar = 0;
  addEventListener('resize', () => { clearTimeout(vantar); vantar = setTimeout(rita, 150); });
  const typsnitt = document.fonts && document.fonts.load ? document.fonts.load('20px "League Gothic"') : Promise.resolve();
  typsnitt.then(rita, rita);
})();
