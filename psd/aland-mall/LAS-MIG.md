# Åland i Sverige-kartan — mall för Photoshop

Åland saknas i Sverige-quizet (`klassisk.html?region=sverige`) för att det
aldrig ritats i `psd/Sverige.psd`. Den här mallen visar exakt var ögruppen
ligger på din duk, så du kan rita den direkt i rätt läge.

## Filer

- **aland-mall-4000x7680.png** — själva mallen. Exakt samma storlek som
  Sverige.psd (4000 × 7680), så den hamnar rätt automatiskt.
- **aland-narbild.png** — förhandsvisning: mallen ovanpå din karta, öster om
  Uppland.
- **aland-oversikt.png** — samma sak, hela Sverige nedskalat.

## Så här gör du

1. Öppna `psd/Sverige.psd`.
2. *Arkiv → Placera inbäddad…* → välj `aland-mall-4000x7680.png`. Den
   centreras på duken, och eftersom den är exakt lika stor är det rätt läge.
   Tryck Enter.
3. **Magenta** = Ålands verkliga form och läge (Natural Earth, passat mot din
   Karta-kust kring Stockholms skärgård). Den **cyanfärgade streckade rutan**
   ramar bara in ögruppen.
4. Rita Åland i ett **nytt lager som heter exakt `Åland`**. Rita gärna
   generöst och slå ihop småöarna till en form — precis som Gotland och Öland
   är ritade större och tydligare än i verkligheten. Huvudsaken är att
   tyngdpunkten hamnar ungefär där Fasta Åland ligger (den stora magenta
   ytan).
5. Lägg också till Ålands silhuett i lagret **Karta** och konturen i lagret
   **Overlay**, på samma sätt som för Gotland — annars flyter Åland-bilden i
   havet utan underliggande ö.
6. Ta bort mallagret och spara PSD:n.
7. Skicka mig en **minnesregel** för bilden (som "En glasstrut = ett GOTT
   LAND" för Gotland).

Sedan kör jag ett kommando som tar in allt i spelet:

```bash
python3 tools/importera-lager.py sverige Åland --karta \
    --desc "…" --minnesbild "…"
```

Verktyget skalar lagret till spelets duk, skriver `countries/aland.webp`,
lägger till Åland i `assets/sverige/config.json` och gör om
`map.webp`/`overlay.webp`. Det är provkört på sex befintliga landskap och
kartan: configen blev byte-identisk med dagens.
