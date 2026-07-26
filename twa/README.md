# Jonas geografi i Google Play — steg för steg

Appen paketeras som en **Trusted Web Activity (TWA)**: ett tunt Android-skal
runt www.jonasgeografi.se. Det betyder att appen ÄR hemsidan — varje uppdatering
av sajten syns direkt i appen utan ny granskning, och alla resultat sparas
precis som vanligt (samma lagring som webbläsaren).

> **Adressen måste vara `www.jonasgeografi.se` överallt.** Sajten serveras
> från www-värden; `jonasgeografi.se` utan www svarar med en 301-omdirigering
> dit. Googles verifiering av Digital Asset Links följer inte omdirigeringar,
> så pekar appen på adressen utan www misslyckas verifieringen tyst och appen
> öppnas med en webbläsarrad högst upp i stället för i helskärm.

## Det Jonas gör (kräver BankID-liknande ID-koll hos Google)

1. **Skapa utvecklarkonto**: https://play.google.com/console → logga in med
   Google-kontot → betala engångsavgiften (25 USD) → verifiera identitet.
   (Välj "personligt konto" om du inte har ett företag.) ID-kollen tar några
   dagar; **"Skapa app" är utgråad tills den är klar**. Räkna också med att
   nya personliga konton kan behöva köra ett stängt test med ett antal
   testare under ett par veckor innan produktion öppnas — kontrollera vad
   konsolen säger när verifieringen gått igenom, kraven ändras då och då.
2. **Bygg app-paketet med PWABuilder** (gratis, i webbläsaren):
   - Gå till https://www.pwabuilder.com → klistra in
     `https://www.jonasgeografi.se` (med www — se rutan ovan)
   - Klicka **Package for stores → Android**
   - Package ID: `se.jonasgeografi.app` (samma som i `twa-manifest.json` här)
   - App name: `Jonas geografi`, Launcher name: `Geografi`
   - Ladda ner zip-filen — den innehåller `app-release.aab` (paketet),
     `signing.keystore` + lösenord (SPARA SÄKERT, t.ex. i lösenordshanteraren!)
     och en `assetlinks.json`.
3. **Skapa appen i Play Console**: Alla appar → Skapa app → namn
   "Jonas geografi", app (inte spel funkar bra), gratis.
4. **Ladda upp paketet**: Produktion → Skapa ny utgåva → ladda upp
   `app-release.aab`.
5. **Hämta signerings-fingeravtrycket**: Play Console →
   Inställningar → App-integritet → App-signering → kopiera
   **SHA-256-certifikatets fingeravtryck** (Googles, inte upload-nyckelns).
6. **Skicka fingeravtrycket till Claude** — då läggs
   `.well-known/assetlinks.json` upp på sajten (mallen finns i
   `assetlinks-mall.json`; utan den visar appen en webbläsarrad högst upp).
7. **Fyll i butikssidan**: beskrivning, ikon 512×512
   (`assets/design/ikon-512.png`), funktionsbild 1024×500 och minst
   2 skärmdumpar (be Claude generera!), innehållsklassning (barnvänligt),
   dataskyddsformuläret ("appen samlar inte in några personuppgifter" —
   topplistenamn är frivilliga alias), målgrupp och integritetspolicy-URL
   (be Claude lägga upp en enkel policysida på sajten).
8. **Skicka in för granskning** — brukar ta några dagar.

## Målgrupp barn — viktigt i formulären

Sidan har inga annonser, ingen spårning och inga konton — det uppfyller
Googles familjepolicy. Ange målgrupp ärligt (t.ex. "5–12 år och äldre");
då granskas appen mot familjereglerna, vilket den klarar.

## Filerna i den här mappen

- `twa-manifest.json` — appens konfiguration (samma värden som PWABuilder
  ska få; funkar också med verktyget Bubblewrap om man hellre bygger lokalt)
- `assetlinks-mall.json` — mall för `.well-known/assetlinks.json`; det enda
  som saknas är SHA-256-fingeravtrycket från Play Console (steg 5–6)

`firebase.json` är redan förberedd så att `.well-known/` publiceras när
filen läggs dit.
