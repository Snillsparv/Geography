// ── Bakgrunden: tusentals lysande siffror på mörk botten ──
// Ritas en gång på två canvas bakom sidan, och om när fönstret blir större.
// De starkaste siffrorna ligger i ett eget lager (#glod) som lyser upp och
// dämpas långsamt med CSS.
(() => {
  'use strict';
  const bas = document.getElementById('bakgrund'), glod = document.getElementById('glod');
  if (!bas || !bas.getContext) return;
  const FONT = "'League Gothic', 'Arial Narrow', Impact, sans-serif";
  let ritadB = 0, ritadH = 0;

  function rita() {
    const b = innerWidth, h = Math.max(innerHeight, screen.height || 0);
    if (b === ritadB && h <= ritadH) return;
    ritadB = b; ritadH = h;
    // skarpt i mobilen, men högst fyra megapixel per lager
    const dpr = Math.min(devicePixelRatio || 1, 2, Math.sqrt(4e6 / (b * h)));
    const [x, g] = [bas, glod].map(c => {
      c.width = Math.round(b * dpr); c.height = Math.round(h * dpr);
      c.style.width = b + 'px'; c.style.height = h + 'px';
      const k = c.getContext('2d');
      k.textAlign = 'center'; k.textBaseline = 'middle';
      return k;
    });

    // samma mönster varje gång: en enkel slumpgenerator med fast frö
    let fro = 271828;
    const slump = () => (fro = (fro * 16807) % 2147483647) / 2147483647;
    const lista = [];
    for (let n = Math.min(2500, Math.round(b * h / 900)); n > 0; n--) {
      lista.push({ z: slump(), x: slump() * b, y: slump() * h, rot: (slump() - .5) * .7, l: slump(), s: String(Math.floor(slump() * 10)) });
    }
    // längst bort först: små och svaga siffror långt bort, stora och suddiga nära
    lista.sort((a, c) => a.z - c.z);
    for (const d of lista) {
      const st = 8 + Math.pow(d.z, 4) * 160;
      const lyser = d.l < .08 && d.z > .45 && d.z < .9;
      const k = lyser ? g : x;
      k.save();
      if (d.z > .92) {
        // ur fokus: bara skuggan syns, själva siffran hamnar utanför bilden
        k.setTransform(1, 0, 0, 1, 0, 0);
        k.font = st * dpr + 'px ' + FONT;
        k.shadowColor = 'rgba(255,120,40,.2)'; k.shadowBlur = st * .14 * dpr; k.shadowOffsetX = 1e5;
        k.fillStyle = '#000'; k.fillText(d.s, d.x * dpr - 1e5, d.y * dpr);
      } else {
        k.setTransform(dpr, 0, 0, dpr, d.x * dpr, d.y * dpr);
        k.rotate(d.rot);
        k.font = st + 'px ' + FONT;
        if (lyser) {
          k.shadowColor = 'rgba(255,110,30,.95)'; k.shadowBlur = (8 + st * .3) * dpr;
          k.fillStyle = 'rgba(255,205,150,.95)';
        } else {
          k.shadowColor = 'rgba(255,110,30,.5)'; k.shadowBlur = (2 + st * .2) * dpr;
          k.fillStyle = 'rgba(255,130,55,' + (.04 + d.l * .26 * (.4 + d.z * .6)).toFixed(3) + ')';
        }
        k.fillText(d.s, 0, 0);
      }
      k.restore();
    }
  }

  let vantar = 0;
  addEventListener('resize', () => { clearTimeout(vantar); vantar = setTimeout(rita, 150); });
  const typsnitt = document.fonts && document.fonts.load ? document.fonts.load('20px "League Gothic"') : Promise.resolve();
  typsnitt.then(rita, rita);
})();
