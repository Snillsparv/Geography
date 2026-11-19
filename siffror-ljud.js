// ── Sifferljud: gör om svenska ord till siffror med sifferalfabetet ──
//
//   0 S/Z/C · 1 T/D · 2 N/ng · 3 M · 4 R · 5 L · 6 J/sj/sch · 7 K/G · 8 F/V · 9 P/B
//
// Det är LJUDEN som räknas, inte stavningen: vokaler och H är fria, dubbel-
// teckning (tt, ck, mm …) är ett enda ljud, och »sk« i skjorta, »lj« i ljus
// eller »tion« i station är sj- och j-ljud. Datorn gissar uttalet med en
// handfull svenska uttalsregler – den har inte alltid rätt, och därför får
// den som övar alltid godkänna sitt eget ord ändå.
//
// Sifferljud.analysera('skinka') → { siffror: '627', delar: [{ t: 'sk', d: '6' }, …] }
// Fristående: används av siffror.html och av test/siffror.mjs (Node).
(function (rot) {
  const VOKALER = 'aeiouyåäöéèêëáàâüïîôæø';
  const MJUKA = 'eiyäöé';   // före dessa blir k/g/sk i början av ett ord mjuka

  // ord där k, g eller sk före mjuk vokal ändå uttalas hårt
  const HARDA = new Set(['keso', 'kex', 'keps', 'kebab', 'ken', 'kennel', 'kille',
    'killar', 'killen', 'kick', 'kicka', 'kiwi', 'kimono', 'kidnappa', 'kitsch',
    'gitarr', 'gecko', 'geisha', 'gibbon', 'skelett', 'skeptisk', 'skeptiker']);

  // hela ord med ett ljud som reglerna inte hör: Fia uttalas »Fi-ja«
  const SARSKILDA = {
    fia: [['F', '8'], ['ia', '6']],
  };

  const ENKLA = {
    s: '0', z: '0', t: '1', d: '1', n: '2', m: '3', r: '4', l: '5',
    j: '6', k: '7', g: '7', q: '7', f: '8', v: '8', w: '8', p: '9', b: '9',
  };

  const arBokstav = c => /\p{L}/u.test(c);
  const arVokal = c => VOKALER.includes(c);

  function analysera(text) {
    const orig = String(text == null ? '' : text).normalize('NFC');
    const s = orig.toLowerCase();
    const delar = [];
    let i = 0;
    let ordStart = 0;       // index där nuvarande ord började
    let helaOrdet = '';     // nuvarande ord, för undantagslistan

    const lagg = (n, d) => { delar.push({ t: orig.slice(i, i + n), d }); i += n; };

    while (i < s.length) {
      const c = s[i];
      if (!arBokstav(c)) {   // mellanslag, bindestreck, punkt … skiljer ord åt
        lagg(1, '');
        continue;
      }
      if (i === 0 || !arBokstav(s[i - 1])) {
        ordStart = i;
        let j = i;
        while (j < s.length && arBokstav(s[j])) j++;
        helaOrdet = s.slice(i, j);
        const sarskild = SARSKILDA[helaOrdet];
        if (sarskild) {
          for (const [t, d] of sarskild) lagg(t.length, d);
          continue;
        }
      }
      const forst = i === ordStart;
      const fore = i > ordStart ? s[i - 1] : '';
      const n1 = s[i + 1] || '', n2 = s[i + 2] || '', n3 = s[i + 3] || '';
      const hart = HARDA.has(helaOrdet);

      // dubbelteckning: tt, ll, mm … är ETT ljud — slå ihop med förra delen
      const forra = delar[delar.length - 1];
      if (!forst && c === fore && !arVokal(c) && c !== 'h' && forra && forra.d
          && forra.t.toLowerCase().endsWith(c)) {
        forra.t += orig[i];
        i++;
        continue;
      }

      if (arVokal(c) || c === 'h') { lagg(1, ''); continue; }

      // ── i början av ett ord ──
      if (forst) {
        // lj, dj, gj, hj → j-ljud (ljus, djur, gjuta, hjul)
        if ('ldgh'.includes(c) && n1 === 'j') { lagg(2, '6'); continue; }
        // sk före mjuk vokal → sj-ljud (skida, skön)
        if (c === 's' && n1 === 'k' && MJUKA.includes(n2) && !hart) { lagg(2, '6'); continue; }
        // k före mjuk vokal → tj-ljud (kyrka, kärlek), g → j-ljud (geting, göra)
        if ((c === 'k' || c === 'g') && MJUKA.includes(n1) && !hart) { lagg(1, '6'); continue; }
        // sh → sj-ljud (shorts, show)
        if (c === 's' && n1 === 'h') { lagg(2, '6'); continue; }
        // x i början låter som s (xylofon)
        if (c === 'x') { lagg(1, '0'); continue; }
      }

      // ── ljudkluster var som helst i ordet ──
      const tre = s.slice(i, i + 3);
      if (tre === 'skj' || tre === 'stj' || tre === 'sch') { lagg(3, '6'); continue; }
      // -ssion (mission) och -sion (vision) → sj-ljud
      if (tre === 'ssi' && n3 === 'o' && s[i + 4] === 'n') { lagg(3, '6'); continue; }
      if ((c === 's' || c === 't') && n1 === 'i' && n2 === 'o' && n3 === 'n' && !forst) {
        lagg(2, '6'); continue;              // -tion (station) och -sion (vision)
      }
      if (c === 's' && n1 === 'j') { lagg(2, '6'); continue; }
      if ((c === 't' || c === 'k') && n1 === 'j') { lagg(2, '6'); continue; }   // tj, kj
      if (c === 'c' && n1 === 'h') { lagg(2, '6'); continue; }   // choklad, chef
      if (c === 'c' && n1 === 'k') { lagg(2, '7'); continue; }   // ck = ett k
      if (c === 'n' && n1 === 'g') { lagg(2, '2'); continue; }   // ng-ljudet
      if (c === 'g' && n1 === 'n') { lagg(2, '22'); continue; }  // regn, vagn = ng + n
      if (c === 'p' && n1 === 'h') { lagg(2, '8'); continue; }   // ph = f
      if (c === 'q' && n1 === 'u' && arVokal(n2)) { lagg(2, '78'); continue; }  // quiz = kvis
      if (c === 'x') { lagg(1, '70'); continue; }                // x = k + s
      if (c === 'c') { lagg(1, 'eiy'.includes(n1) ? '0' : '7'); continue; }
      // rg och lg i slutet eller före konsonant/mjuk vokal → j-ljud (arg, berg, älg)
      if (c === 'g' && (fore === 'r' || fore === 'l')
          && (!n1 || !arBokstav(n1) || !arVokal(n1) || MJUKA.includes(n1))) {
        lagg(1, '6'); continue;
      }
      lagg(1, ENKLA[c] || '');
    }
    return { siffror: delar.map(d => d.d).join(''), delar };
  }

  const tillSiffror = text => analysera(text).siffror;

  const api = { analysera, tillSiffror };
  rot.Sifferljud = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
