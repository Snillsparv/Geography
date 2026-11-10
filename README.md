# Jonas geografi

Huvudspelet är jordgloben i `glob.html` — den serveras som förstasida på
webben. Den äldre kartsidan finns kvar som `klassisk.html`.

`siffror.html` är en fristående övningssida för sifferalfabetet (julkalenderns
lucka 12, bygger på kapitel 9 i *Så får du ett superminne*). Den hänger inte
ihop med spelet: innehållet ligger i `siffror-data.js`, ljudreglerna i
`siffror-ljud.js` och logiken i `siffror.js`. Kör `node test/siffror.mjs` efter
att du ändrat ord eller regler — testet kollar att varje ord blir rätt tal.
Sidan är formgiven som boken och hålls så enkel som möjligt: varje steg har en
teckning, en rubrik, en kort text och en övning. Boksidan ligger som ett papper
på en mörk botten med lysande siffror, som `siffror-bakgrund.js` ritar på två
canvas. Teckningarna i
`assets/siffror/` är Jonas egna ur boken (linjeteckningarna omritade till SVG),
och rubrikfonten League Gothic (SIL OFL, licensen ligger bredvid) står in för
bokens Kapra.

## Hur man spelar (gamla kartsidan)

1. Öppna `klassisk.html` i en webbläsare
2. En landform (siluett) visas till höger
3. Välj rätt land bland fyra alternativ
4. Landet markeras på kartan när du svarat
5. Spela igenom alla 13 länder och se ditt resultat!

## Länder

Argentina, Bolivia, Brasilien, Chile, Colombia, Ecuador, Franska Guyana, Guyana, Paraguay, Peru, Surinam, Uruguay, Venezuela
