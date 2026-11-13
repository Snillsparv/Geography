// ── Innehållet till siffror.html: sifferalfabetet, lathunden 00–99, ──
// ── övningsorden, årtalen och pi-promenaden. ──
// Allt kommer från kapitel 9 (»Bli ett siffergeni!«) i »Så får du ett
// superminne«, där lathunden ligger på kapitlets sista sida. Bildförslagen
// till årtalen är nyskrivna i samma anda.
window.SIFFROR = {

  // 0–9: ljuden och minnesreglerna
  alfabet: [
    { s: '0', ljud: ['S', 'Z', 'C'], regel: 'En nolla ser ut som en sol, och sol börjar på S.' },
    { s: '1', ljud: ['T', 'D'], regel: 'T och D har ett lodrätt streck, precis som en etta.' },
    { s: '2', ljud: ['N', 'ng'], regel: 'Ett N har två lodräta streck.' },
    { s: '3', ljud: ['M'], regel: 'Knuffa omkull ett M, så ser det ut som en trea!' },
    { s: '4', ljud: ['R'], regel: 'Säg fyRRRa högt för dig själv några gånger.' },
    { s: '5', ljud: ['L'], regel: 'Håll upp vänsterhanden med fem fingrar och sträck ut tummen: där är ett L.' },
    { s: '6', ljud: ['J', 'sj', 'sch'], regel: 'En spegelvänd sexa liknar ett J. Eller slå en sexa med tärningen och ropa »JAAA!«.' },
    { s: '7', ljud: ['K', 'G'], regel: 'Tänk på ordet sjuK.' },
    { s: '8', ljud: ['F', 'V'], regel: 'Ett f i skrivstil har två öglor, som en åtta. Eller gör ett seger-V med två fingrar.' },
    { s: '9', ljud: ['P', 'B'], regel: 'Spegelvänd nian, så blir den ett P. Gick du i 9B får du den gratis!' },
  ],

  // ljuden att fråga om i alfabetsquizet (siffra → möjliga ljud)
  quizljud: {
    0: ['S', 'Z', 'C'], 1: ['T', 'D'], 2: ['N', 'ng'], 3: ['M'], 4: ['R'],
    5: ['L'], 6: ['J', 'sj', 'sch'], 7: ['K', 'G'], 8: ['F', 'V'], 9: ['P', 'B'],
  },

  // lathunden 00–99: [ord, förtydligande]
  lathund: [
    ['sås'], ['sudd'], ['snö'], ['söm', 'nål och tråd'], ['sår'],
    ['sil'], ['sej', 'fisken'], ['såg'], ['soffa'], ['sopp', 'svamp'],
    ['dass'], ['tuta'], ['ton', 'vikt'], ['Tom', '& Jerry'], ['Tor', 'åskguden'],
    ['tall'], ['doja'], ['tåg'], ['duva'], ['tupp'],
    ['Nasse', 'från Nalle Puh'], ['nät'], ['nunna'], ['Nemo', 'fisken'], ['Nero', 'romersk kejsare'],
    ['nål'], ['Anja', 'Pärson'], ['anka'], ['nova', 'stjärnexplosion'], ['napp'],
    ['Musse', 'Pigg'], ['matta'], ['mun'], ['mamma'], ['Mario', 'Super Mario'],
    ['mål'], ['maj', 'majblomma'], ['mick'], ['muff'], ['mupp'],
    ['ros'], ['ratt'], ['rån'], ['ram'], ['rör'],
    ['rulle', 't.ex. en tejprulle'], ['arg', 'arg gubbe'], ['rocka'], ['räv'], ['rep'],
    ['lås'], ['låda'], ['linne'], ['lamm'], ['lur'],
    ['Lilo', '& Stitch'], ['olja'], ['lok'], ['löv'], ['lupp'],
    ['juice'], ['jätte'], ['Janne', 'Långben'], ['Jimmy', 'Neutron'], ['Jr.', 'liten kille'],
    ['hjul'], ['jo-jo'], ['Jack', 'Sparrow'], ['Jaffa', 'läsken'], ['Japp', 'godiset'],
    ['Keso'], ['kudde'], ['Ken', '& Barbie'], ['gumma'], ['kar', 'badkar'],
    ['Kalle', 'Anka'], ['koja'], ['kaka'], ['gåva', 'paket med snöre'], ['kopp'],
    ['Vasa', 'Gustav, eller knäckebröd'], ['fot'], ['Fan', 'djävulen'], ['femma'], ['fyr'],
    ['val'], ['Fia', 'med knuff'], ['våg'], ['vovve'], ['Foppa'],
    ['påse'], ['båt'], ['ben'], ['bom'], ['bur'],
    ['pil'], ['paj'], ['puck'], ['biff'], ['pappa'],
  ],

  // ord för en ensam siffra (när ett tal har udda antal siffror)
  ensam: [
    'is', 'te', 'ön', 'emu', 'åra',
    'ål', 'sjö', 'ko', 'fe', 'bi',
  ],

  // ord → siffror: bokens övning. svar = facit, not = förklaring efter svaret
  ordovning: [
    { ord: 'ål', svar: '5' },
    { ord: 'rör', svar: '44' },
    { ord: 'ton', svar: '12' },
    { ord: 'anka', svar: '27', not: 'N:et i anka uttalas som ng.' },
    { ord: 'Marabou', svar: '349' },
    { ord: 'bollhav', svar: '958', not: 'H är fritt, och ll är ett enda L-ljud.' },
    { ord: 'Nutella', svar: '215' },
    { ord: 'tvålen', svar: '1852' },
    { ord: 'skjorta', svar: '641', not: 'Skj låter som sj.' },
    { ord: 'rufsig', svar: '4807' },
    { ord: 'frimärke', svar: '84347' },
    { ord: 'multiplikationstabell', svar: '351957620195', not: '-tion låter som »sjon«.' },
    { ord: 'deoxiribonukleinsyra', svar: '17049275204', not: 'X låter som k + s.' },
    { ord: 'realisationsvinstbeskattning', svar: '4506208201907122', not: '-tion låter som »sjon«, och -ning har både ett N och ett ng.' },
  ],

  // siffror → ord: bokens tal med Jonas förslag
  boktal: [
    ['33', 'mamma'], ['95', 'pil'], ['143', 'trumma'], ['191', 'tapet'], ['520', 'lins'],
    ['865', 'fjäll'], ['7435', 'karamell'], ['32017274', 'minnestekniker!'],
  ],

  // årtal på 1900-talet: tal = de två sista siffrorna, ord = lathundens ord
  artal: [
    { tal: '12', ar: '1912', ord: 'ton', text: 'Titanic sjunker, och OS hålls i Stockholm.', bild: 'Titanic sjunker för att en vikt på ett ton dunsar ner på däcket.' },
    { tal: '21', ar: '1921', ord: 'nät', text: 'Kvinnor röstar för första gången i Sverige.', bild: 'Alla valsedlar fångas upp i ett jättelikt fisknät på väg till valurnan.' },
    { tal: '28', ar: '1928', ord: 'nova', text: 'Penicillinet upptäcks.', bild: 'En stjärna exploderar i en nova och regnar mögel över Alexander Flemings petriskålar.' },
    { tal: '29', ar: '1929', ord: 'napp', text: 'Börskraschen som inleder den stora depressionen.', bild: 'Börsmäklarna tröstar sig med varsin napp när kurserna rasar.' },
    { tal: '52', ar: '1952', ord: 'linne', text: 'Poliovaccinet skapas.', bild: 'Doktorn som ger det första poliovaccinet har bara ett linne på sig.' },
    { tal: '53', ar: '1953', ord: 'lamm', text: 'Färg-tv, DNA-molekylens struktur upptäcks och Mount Everest bestigs för första gången.', bild: 'Ett regnbågsfärgat lamm klättrar upp för Mount Everest längs en DNA-spiral.' },
    { tal: '61', ar: '1961', ord: 'jätte', text: 'Första människan i rymden.', bild: 'En jätte kastar upp Jurij Gagarin i rymden.' },
    { tal: '67', ar: '1967', ord: 'Jack', text: 'Summer of love.', bild: 'Jack Sparrow dansar barfota med blommor i håret.' },
    { tal: '73', ar: '1973', ord: 'gumma', text: 'Norrmalmstorgsdramat, och kungen blir kung.', bild: 'En gumma tar sig in i banken på Norrmalmstorg och kröner kungen därinne.' },
    { tal: '75', ar: '1975', ord: 'Kalle', text: 'Vietnamkriget tar slut.', bild: 'Kalle Anka viftar med en vit fredsflagga.' },
    { tal: '77', ar: '1977', ord: 'kaka', text: 'Elvis dör och Star Wars kommer ut.', bild: 'Elvis och Darth Vader slåss om den sista kakan.' },
    { tal: '86', ar: '1986', ord: 'Fia', text: 'Kärnkraftsolyckan i Tjernobyl.', bild: 'Ett Fia med knuff-spel som glöder radioaktivt grönt.' },
    { tal: '89', ar: '1989', ord: 'Foppa', text: 'Berlinmuren faller.', bild: 'Foppa skjuter pucken rakt igenom Berlinmuren.' },
    { tal: '90', ar: '1990', ord: 'påse', text: 'Internet kommer.', bild: 'Hela internet kommer hem i en papperspåse från affären.' },
    { tal: '91', ar: '1991', ord: 'båt', text: 'Första VM i minne, och Jonas föds!', bild: 'Bebis-Jonas kommer seglande i en båt, raka vägen till minnes-VM.' },
    { tal: '95', ar: '1995', ord: 'pil', text: 'Sverige går med i EU.', bild: 'En pil skjuts rakt in i mitten av EU-flaggans stjärncirkel.' },
  ],

  // minnespalatset från kapitel 2
  palats: [
    'Utanför ytterdörren', 'På hallmattan', 'Vid klädhängaren',
    'I toalettstolen', 'I badkaret', 'Under trappan',
    'På köksbordet', 'I diskhon', 'I tvättkorgen',
    'I tvättmaskinen', 'På strykbrädan', 'På väg upp för trappan',
    'I soffan', 'I tv-apparaten', 'I bokhyllan',
  ],
  // var platserna ligger på bokens karta (assets/siffror/palats.webp), i procent
  palatsPos: [
    [41.3, 97.9], [38.1, 83.4], [11.0, 76.6], [7.8, 50.1], [19.8, 58.8],
    [35.8, 67.5], [74.9, 67.9], [93.7, 64.3], [93.2, 41.8], [78.9, 33.8],
    [65.7, 32.6], [43.1, 34.2], [31.8, 18.6], [7.8, 16.4], [21.7, 5.1],
  ],

  // pi: de 30 första decimalerna, två par per plats. Första bilden gör
  // något med den andra, så att ordningen sitter.
  pi: {
    decimaler: '141592653589793238462643383279',
    platser: [
      { par: ['14', '15'], bild: 'Tor fäller en tall med sin hammare, rakt framför ytterdörren.' },
      { par: ['92', '65'], bild: 'Ett jättelikt ben rullar runt på hallmattan på små hjul.' },
      { par: ['35', '89'], bild: 'Ett fotbollsmål jagar Foppa runt klädhängaren.' },
      { par: ['79', '32'], bild: 'En kopp med en egen mun sitter i toalettstolen och pratar.' },
      { par: ['38', '46'], bild: 'En muff skäller ut en arg gubbe som sitter i badkaret.' },
      { par: ['26', '43'], bild: 'Anja Pärson åker slalom rakt igenom en tavelram under trappan.' },
      { par: ['38', '32'], bild: 'En muff med en jättelik mun äter upp allt på köksbordet.' },
      { par: ['79'], bild: 'En ensam kopp ligger och skvalpar i diskhon.' },
    ],
  },
};
