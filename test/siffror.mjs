// Kontrollerar sifferssidans data mot ljudomvandlaren: varje ord i lathunden,
// övningen, förslagen, årtalen och pi-promenaden ska bli rätt tal.
// Kör:  node test/siffror.mjs
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const rot = new URL('..', import.meta.url);
const ctx = { window: {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('siffror-ljud.js', rot), 'utf8'), ctx);
vm.runInContext(readFileSync(new URL('siffror-data.js', rot), 'utf8'), ctx);
const { tillSiffror } = ctx.window.Sifferljud;
const D = ctx.window.SIFFROR;

let fel = 0, antal = 0;
const kolla = (namn, fick, vantat) => {
  antal++;
  if (fick !== vantat) { fel++; console.log(`FEL  ${namn}: fick ${fick}, väntat ${vantat}`); }
};
const tal2 = i => String(i).padStart(2, '0');

kolla('lathunden har 100 ord', String(D.lathund.length), '100');
D.lathund.forEach(([ord], i) => kolla(`lathund ${tal2(i)} ${ord}`, tillSiffror(ord), tal2(i)));
kolla('tio ensamma siffror', String(D.ensam.length), '10');
D.ensam.forEach((ord, i) => kolla(`ensam ${i} ${ord}`, tillSiffror(ord), String(i)));
for (const o of D.ordovning) kolla(`övningen: ${o.ord}`, tillSiffror(o.ord), o.svar);
for (const [tal, ord] of D.boktal) kolla(`boktal ${tal} ${ord}`, tillSiffror(ord), tal);
for (const a of D.artal) {
  kolla(`årtal ${a.ar} ${a.ord}`, tillSiffror(a.ord), a.tal);
  kolla(`årtal ${a.ar} slutar på talet`, a.ar.slice(2), a.tal);
  kolla(`årtal ${a.ar} = lathundens ord`, D.lathund[+a.tal][0], a.ord);
  kolla(`årtal ${a.ar}: ordet står i bilden`, String(a.bild.toLowerCase().includes(a.ord.toLowerCase())), 'true');
}
// pi-promenaden: paren ska bli decimalerna i rätt ordning
const pipar = D.pi.platser.flatMap(p => p.par).join('');
kolla('pi-paren = decimalerna', pipar, D.pi.decimaler);
kolla('pi: 30 decimaler', String(D.pi.decimaler.length), '30');
kolla('pi stämmer med Math.PI', D.pi.decimaler.slice(0, 15), String(Math.PI).slice(2, 17));
kolla('palatset räcker till pi', String(D.palats.length >= D.pi.platser.length), 'true');
kolla('varje plats finns på kartan', String(D.palatsPos.length), String(D.palats.length));
kolla('kartans platser ligger på bilden', String(D.palatsPos.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 100)), 'true');
// bilderna och typsnittet som sidan använder
const html = readFileSync(new URL('siffror.html', rot), 'utf8') + readFileSync(new URL('siffror.js', rot), 'utf8');
for (const [, fil] of html.matchAll(/assets\/siffror\/([\w-]+\.(?:svg|webp|woff2))/g)) {
  kolla(`${fil} finns`, String(existsSync(new URL(`assets/siffror/${fil}`, rot))), 'true');
}

// några uttalsregler för sig
const regler = {
  hjul: '65', djur: '64', gjuta: '61', geting: '612', kyrka: '647', kille: '75', skida: '61',
  skola: '075', station: '0162', vision: '862', mission: '362', choklad: '6751', quiz: '780',
  regn: '422', berg: '946', älg: '56', Helga: '57', xylofon: '0582', 'Jonas': '620',
  nalle: '25', ängel: '25', 'Tor-Björn': '149642', Fia: '86', fanfar: '8284', juice: '60',
};
for (const [ord, s] of Object.entries(regler)) kolla(`regel ${ord}`, tillSiffror(ord), s);

console.log(`${antal - fel}/${antal} rätt`);
process.exit(fel ? 1 : 0);
