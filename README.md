# Sydamerika – Forma-spelet

Ett Seterra-liknande kartspel där du ska identifiera Sydamerikas länder utifrån deras form!

## Hur man spelar

1. Öppna `index.html` i en webbläsare
2. En landform (siluett) visas till höger
3. Välj rätt land bland fyra alternativ
4. Landet markeras på kartan när du svarat
5. Spela igenom alla 13 länder och se ditt resultat!

## Länder

Argentina, Bolivia, Brasilien, Chile, Colombia, Ecuador, Franska Guyana, Guyana, Paraguay, Peru, Surinam, Uruguay, Venezuela

## Hämta ändringar från Codex-branch

Om du vill hämta en branch som Codex har skapat i GitHub till din lokala dator:

```bash
git fetch origin
git branch -r
git switch --track origin/<branch-namn>
```

Exempel:

```bash
git switch --track origin/claude/plan-fixes-review-GQCU8
```

Om din Git-version inte har `switch`, använd:

```bash
git checkout -b <branch-namn> origin/<branch-namn>
```

Tips: om du fastnar i pagern efter `git branch -r`, tryck `q` och kör nästa kommando i vanlig prompt.

## Snabbtest (2 minuter)

Om du snabbt vill verifiera exakt det jag kört, använd denna sekvens:

```bash
git fetch origin
git switch --track origin/work   # eller den branch du hämtat
python -m http.server 8000
```

Öppna sedan:

- `http://localhost:8000/index.html`

Snabb checklista i webbläsaren:

1. Startskärmen visas med regionkort.
2. Du kan välja region och komma in i spelvyn.
3. Lägena **Utforska** och **Quiz** går att växla.
4. Klick på karta ger rätt/fel-markering.

Om du får cache-problem: kör hård uppdatering med `Ctrl+F5`.
