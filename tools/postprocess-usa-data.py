#!/usr/bin/env python3
"""Efterbearbetning av delstatsdatan som make-tiles.mjs --dataset usa skriver.

Körs EFTER en omgenerering av assets/usa-regions.json, usa-borders.json
och usa-markers.json, och efter postprocess-art-data.py om världsfilerna
också genererats om (idempotent: säkert att köra flera gånger).

Varför: delstaternas täcke (den krämvita ytan innan man klickat) spåras ur
delstatskonstens pixelägarskap, men konturen runt USA ritades av världens
linjer — två olika källor. Konsten är målad förbi kusten (North Carolinas
fartstreck ut i Atlanten, Floridas bläckkant, Washingtons hårtofs uppe i
Kanada, Pennsylvaniabiten i Ontario) och snäpp-passets klipp når inte
dit, så täcket blev pappersformer i havet och över Kanada/Mexiko medan
världens kustlinjer löpte tvärs igenom det krämvita.

Här görs det på samma sätt som världskartan:

1. TÄCKET klipps till världens målade USA-yta (art-regions nordamerika/usa)
   inom det verkliga USA (Natural Earth med lite marginal). Bitar av den
   ytan som ingen delstat når (Kodiak, Aleuterna, barriäröar) går till
   närmaste delstat; sömhål mellan två delstater delas mitt itu mellan
   dem, och smala instängda remsor av en delstat inne i grannens yta
   (Illinois-strecket i Wisconsins del av Michigansjön) går till grannen.
   Världens USA-yta blir då täckt utan hål (överlapp som finns i själva
   konsten, ett par hundradels kvadratgrader, ligger kvar).
2. DEKOR. Konst som ligger ute i havet blir egna features med dekor: 1
   (samma id → samma feature-state). Spelet målar dem i havsfärg medan
   delstaten är täckt och visar konsten när den avslöjas, precis som
   Malaysias ögon och spröt. Konst över grannländerna kastas ur täcket —
   grannens gröna yta döljer den redan.
3. REMSOR. Världens USA-yta läcker in i Mexiko (Tamaulipas-kusten, Baja,
   Sonora): där räckte Mexikos konst inte ut och USA:s underlag fyllde i.
   De bitarna blir en egen feature (remsa: 1) som spelet målar grön i
   delstatsregionen, i stället för att världens USA-flagga skymtar fram.
   Samma feature fyller de smala GLIPORNA mellan världens USA-yta och
   grannländerna (ytorna förenklades var för sig och möts inte alltid —
   där låg världens gränslinje förut och dolde dem). En HAVSMASK (mask: 1) täcker allt runt USA utom världens USA-yta och
   dekordelarna: den målar havsfärg över de konstrester som pixelägar-
   skapet aldrig fångade (fartstreckens tunna svansar, kustens frans).
4. LINJER. usa-borders får en yttre kontur (yttre: 1) ur SAMMA geometri
   som täcket, och delstatsgränserna klipps till USA-ytan. I världens
   art-borders bryts linjerna längs världens USA-kant ut till en egen
   feature (usakant: 1) som spelet släcker i delstatsregionen — då har
   varje kant exakt en linje, och den ligger där täcket slutar.
   Delstatslinjer som efter flyttarna i steg 1 har samma delstat på båda
   sidor tas bort.

Delstatsdelen (1–4a) görs bara på make-tiles råa export: är usa-regions
redan efterbearbetad hoppar skriptet över den. Havsmasken bär en
fingeravtryckssumma av världens USA-yta; har världskartan bakats om
sedan dess avbryts skriptet i stället för att lämna ett täcke klippt
mot den gamla ytan.
"""
import hashlib
import json
import os

from shapely import (STRtree, distance as sh_distance, points as sh_points,
                     segmentize, set_precision)
from shapely.affinity import translate
from shapely.geometry import LineString, Point, Polygon, box, shape
from shapely.ops import split, unary_union
from shapely.validation import make_valid

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# remsornas och havsmaskens gid (delstaterna ligger på 1001–1050,
# världen under 1000)
REMSA_GID = 1999
MASK_GID = 1998
# marginal runt Natural Earths USA: där räknas världens USA-yta som USA
# (grader). Utanför den är det läckage in i grannlandet.
USA_MARGINAL = 0.15
# konst närmare världens USA-yta än så här räknas inte som havsdekor —
# konturens antialiasing och förenklingen spiller alltid lite (grader)
DEKOR_MARGINAL = 0.002
# bitar mindre än så här kastas (kvadratgrader): förenklingssplitter
SPLITTER = 1e-6
DEKOR_SPLITTER = 2e-5
# världslinjer närmare världens USA-kant än så här räknas som USA-kantens
# linjer (kant och linje kommer ur samma sprickor men förenklas var för
# sig: uppmätt avstånd högst ~1,3 z6-px ≈ 0,015°)
KANT_AVSTAND = 0.02
# delstatsgränser klipps till USA-ytan med den här marginalen (grader)
GRANS_MARGINAL = 0.01
# förenkling av den yttre konturen (grader, under en z7-pixel)
KONTUR_FORENKLING = 0.001
# havsmaskens ram runt delstatskonsten, och hur mycket dekordelarna
# breddas för konstens frans (grader; fransen är 1–2 z6-px)
MASK_RAM = 1.0
MASK_FRANS = 0.02
# glipor mellan världens USA-yta och grannarnas mark som är smalare än
# 2 × GLIPA fylls (grader; de uppmätta är 0,01–0,025° breda). Konstens
# riktiga vatten mellan länderna (fjordarna vid Portland Canal, St Croix-
# mynningen) är bredare eller öppet mot havet och lämnas.
GLIPA = 0.015
# så nära en yta räknas en kant som "mot" den (grader)
KANT_NARA = 0.002
# en delstatsbit räknas som instängd i en granne när så stor del av dess
# kant ligger mot grannens täcke, och som smal när yta/omkrets² är under
# SMAL (Kentucky Bend och andra riktiga exklaver är kompakta)
INSTANGD = 0.8
SMAL = 0.02
INSTANGD_MAX_YTA = 0.03
# en delstatslinje är fel när samma delstat ligger på båda sidor på alla
# de här avstånden (grader; linjen och täckets kant kan skilja en pixel)
LINJE_PROV = (0.004, 0.012, 0.02)
# hål i täcket mindre än så här (kvadratgrader) som ligger i världens
# USA-yta är avrundningsspringor mellan delstater, inga sjöar
MIKROHAL = 1e-4


def las(namn):
    with open(os.path.join(REPO, namn)) as f:
        return json.load(f)


def spara(namn, data):
    with open(os.path.join(REPO, namn), 'w') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))


def ytor(g):
    """Alla polygoner i en geometri (GeometryCollection-säkert)."""
    if g is None or g.is_empty:
        return []
    if g.geom_type == 'Polygon':
        return [g]
    if g.geom_type in ('MultiPolygon', 'GeometryCollection'):
        return [p for d in g.geoms for p in ytor(d)]
    return []


def linjer(g):
    if g is None or g.is_empty:
        return []
    if g.geom_type == 'LineString':
        return [g]
    if g.geom_type in ('MultiLineString', 'GeometryCollection'):
        return [p for d in g.geoms for p in linjer(d)]
    if g.geom_type in ('Polygon', 'MultiPolygon'):
        return [p for d in ytor(g) for p in linjer(d.boundary)]
    return []


def giltig(g):
    return make_valid(g).buffer(0)


def avrunda_ring(ring):
    ut = []
    for x, y in ring:
        p = [round(x, 5), round(y, 5)]
        if not ut or ut[-1] != p:
            ut.append(p)
    return ut


def multipolygon(polys, minsta):
    """GeoJSON-MultiPolygon av polygonerna, splitter bortsorterade."""
    delar = []
    # rutnätet som koordinaterna avrundas till (5 decimaler): snäpp FÖRE
    # avrundningen så polygonerna förblir giltiga
    polys = ytor(set_precision(unary_union([p for p in polys if p.area >= minsta]), 1e-5)) if polys else []
    for p in polys:
        if p.area < minsta:
            continue
        yttre = avrunda_ring(p.exterior.coords)
        if len(yttre) < 4:
            continue
        halen = [avrunda_ring(h.coords) for h in p.interiors]
        delar.append([yttre] + [h for h in halen if len(h) >= 4])
    return {'type': 'MultiPolygon', 'coordinates': delar} if delar else None


def vast_om_datumgransen(g):
    """Bitar öster om 180° (Aleuternas västligaste öar ligger på +172…+180)
    flyttas −360° för avståndsmätning, så närmaste delstat blir Alaska."""
    minx, _, maxx, _ = g.bounds
    if minx > 0:
        return translate(g, xoff=-360)
    return g


def w_summa(w_feat):
    return hashlib.sha1(json.dumps(w_feat['geometry'], sort_keys=True).encode()).hexdigest()[:16]


def kant_andel(kant, yta):
    """Hur stor del av kantlinjen som ligger mot ytan (0–1)."""
    return kant.intersection(yta.buffer(KANT_NARA)).length / kant.length if kant.length else 0


def glipor(W, grannar):
    """Smala glipor på land mellan världens USA-yta och grannarnas mark:
    stängning (buffra ut, buffra in) av W ∪ grannar i gränszonen, och av
    det som fylls behålls bara bitar som nästan helt omges av W och
    grannarna — en havsvik vid en gränsmynning har en öppen sida."""
    zon = W.boundary.buffer(2 * GLIPA).intersection(grannar.buffer(2 * GLIPA))
    land = unary_union([W, grannar]).intersection(zon.buffer(3 * GLIPA))
    stangd = land.buffer(GLIPA, quad_segs=4).buffer(-GLIPA, quad_segs=4)
    landkant = unary_union([W, grannar])
    ut = []
    for q in ytor(stangd.difference(land).intersection(zon)):
        if q.area < SPLITTER:
            continue
        k = q.boundary
        if kant_andel(k, W) >= 0.2 and kant_andel(k, grannar) >= 0.2 and kant_andel(k, landkant) >= 0.9:
            ut.append(q)
    return ut


def dela_skarv(bit, kand, tacke, linjetrad, linjelista):
    """Ett sömhål som rör flera delstater delas längs delstatslinjerna som
    går genom det (konstens ritade gräns ligger mitt i skarven), och varje
    del går till den delstat den har längst kant mot — i stället för att
    hela biten går till en av dem."""
    nara = [linjelista[i] for i in linjetrad.query(bit) if linjelista[i].intersects(bit)]
    delar = [bit]
    if nara:
        try:
            delar = ytor(split(bit, unary_union(nara))) or [bit]
        except Exception:
            delar = [bit]
    ut = {}
    for d in delar:
        mot = {g: kant_andel(d.exterior, tacke[g]) for g in kand}
        g = max(mot, key=mot.get)
        if mot[g] == 0:
            g = min(kand, key=lambda g: tacke[g].distance(d))
        ut.setdefault(g, []).append(d)
    return ut


def flytta_instangda(karna):
    """Smala bitar av en delstat som ligger instängda i en grannes täcke
    (konstens pixelägarskap har ett streck av fel delstat) går till grannen."""
    flyttade = 0
    hela = {g: unary_union(ps) for g, ps in karna.items() if ps}
    for gid in list(karna):
        delar = ytor(unary_union(karna[gid]))
        if len(delar) < 2:
            continue
        storst = max(delar, key=lambda p: p.area)
        behall = [storst]
        for d in delar:
            if d is storst:
                continue
            if d.area > INSTANGD_MAX_YTA or d.area / d.length ** 2 > SMAL:
                behall.append(d)
                continue
            mot = {g: kant_andel(d.exterior, h) for g, h in hela.items()
                   if g != gid and h.distance(d) < KANT_NARA}
            if mot and sum(mot.values()) >= INSTANGD:
                karna[max(mot, key=mot.get)].append(d)
                flyttade += 1
                if os.environ.get('USA_DEBUG'):
                    c = d.representative_point()
                    print(f'  instängd {gid}→{max(mot, key=mot.get)} yta {d.area:.5f} '
                          f'smal {d.area / d.length ** 2:.4f} vid ({c.x:.3f},{c.y:.3f})')
            else:
                behall.append(d)
        karna[gid] = behall
    return flyttade


def rensa_inre_linjer(linjelista, tacken):
    """Tar bort de delar av delstatslinjerna som har samma delstat på båda
    sidor (provat på flera avstånd vinkelrätt mot linjen)."""
    ids = list(tacken)
    geoms = [tacken[g] for g in ids]
    trad = STRtree(geoms)

    def agare(x, y):
        p = Point(x, y)
        return {ids[i] for i in trad.query(p, predicate='intersects')}

    ut, borttaget = [], 0.0
    for l in linjelista:
        c = list(segmentize(l, 0.02).coords)
        fel = []
        for (x0, y0), (x1, y1) in zip(c, c[1:]):
            dx, dy = x1 - x0, y1 - y0
            n = (dx * dx + dy * dy) ** 0.5
            if n == 0:
                fel.append(False)
                continue
            mx, my, nx, ny = (x0 + x1) / 2, (y0 + y1) / 2, -dy / n, dx / n
            samma = True
            for d in LINJE_PROV:
                v, h = agare(mx + nx * d, my + ny * d), agare(mx - nx * d, my - ny * d)
                if not (len(v) == 1 and v == h):
                    samma = False
                    break
            fel.append(samma)
        start = 0
        for i in range(1, len(fel) + 1):
            if i == len(fel) or fel[i] != fel[start]:
                bit = LineString(c[start:i + 1])
                if fel[start]:
                    borttaget += bit.length
                else:
                    ut.append(bit.simplify(1e-9))
                start = i
    return ut, borttaget


def main():
    usa_reg = las('assets/usa-regions.json')
    usa_bor = las('assets/usa-borders.json')
    varld_reg = las('assets/art-regions.json')
    varld_bor = las('assets/art-borders.json')
    ne = las('tools/data/ne_50m_countries.geojson')

    w_feat = next(f for f in varld_reg['features']
                  if f['properties'].get('key') == 'nordamerika/usa' and not f['properties'].get('dekor'))
    W = giltig(shape(w_feat['geometry']))
    ne_usa = next(f for f in ne['features']
                  if f['properties'].get('ADM0_A3') == 'USA' or f['properties'].get('GU_A3') == 'USA')
    US = giltig(shape(ne_usa['geometry'])).buffer(USA_MARGINAL)
    Wus = W.intersection(US)
    # grannarnas mark: alla andra länders målade yta (havsritade emblem och
    # dekordelar är inte mark)
    narheten = W.buffer(2).envelope
    grannar = giltig(unary_union([
        giltig(shape(f['geometry'])) for f in varld_reg['features']
        if f['properties'].get('key') != 'nordamerika/usa'
        and not f['properties'].get('dekor')
        and not (f['properties'].get('badge') and f['properties'].get('hav'))
        and shape(f['geometry']).intersects(narheten)]))

    redan = any(f['properties'].get('dekor') or f['properties'].get('remsa')
                or f['properties'].get('mask') for f in usa_reg['features'])
    summa = w_summa(w_feat)
    if redan:
        # täcke och linjer härleds ur make-tiles råa export — en andra körning
        # på redan klippt data skulle bara flytta splitter fram och tillbaka
        mask = next((f for f in usa_reg['features'] if f['properties'].get('mask')), None)
        if not mask or mask['properties'].get('w_summa') != summa:
            raise SystemExit('usa-regions är efterbearbetad mot en ANNAN världs-USA-yta än '
                             'art-regions.json har nu — kör make-tiles --dataset usa igen och '
                             'sedan det här skriptet')
        print('usa-regions/usa-borders: redan efterbearbetade (kör make-tiles '
              '--dataset usa först för att göra om dem)')
    else:
        bearbeta_delstater(usa_reg, usa_bor, W, US, Wus, grannar, summa)
        spara('assets/usa-regions.json', usa_reg)
        spara('assets/usa-borders.json', usa_bor)
    bryt_ut_usakant(varld_bor, W)
    print('klart')


def bearbeta_delstater(usa_reg, usa_bor, W, US, Wus, grannar, summa):
    # ── 1–3: täcke, dekor, remsor ──
    stater = usa_reg['features']
    # glipor mot grannarna räknas som grannmark: ingen dekor där, och de
    # målas gröna med remsorna
    gl = glipor(W, grannar)
    grannmark = unary_union([grannar] + gl)
    karna, dekor = {}, {}
    W_marg = W.buffer(DEKOR_MARGINAL)
    for f in stater:
        S = giltig(shape(f['geometry']))
        karna[f['id']] = ytor(S.intersection(Wus))
        hav = S.difference(W_marg).difference(grannmark)
        dekor[f['id']] = [p for p in ytor(hav) if p.area >= DEKOR_SPLITTER]
    tackt = unary_union([p for ps in karna.values() for p in ps])
    rest = ytor(Wus.difference(tackt))
    tacke = {gid: unary_union(ps) for gid, ps in karna.items() if ps}
    narmast = {gid: vast_om_datumgransen(g) for gid, g in tacke.items()}
    trad_ids = list(tacke)
    trad = STRtree([tacke[g] for g in trad_ids])
    inre_rå = [LineString(l) for f in usa_bor['features'] if not f['properties'].get('yttre')
               for l in f['geometry']['coordinates'] if len(l) >= 2]
    linjetrad = STRtree(inre_rå)
    tilldelade = delade = 0
    for bit in rest:
        if bit.area < SPLITTER * 1e-3:
            continue
        kand = [trad_ids[i] for i in trad.query(bit.buffer(KANT_NARA))
                if tacke[trad_ids[i]].distance(bit) < 1e-5]
        if len(kand) > 1:
            for gid, delar in dela_skarv(bit, kand, tacke, linjetrad, inre_rå).items():
                karna[gid].extend(delar)
            delade += 1
        else:
            if not kand:
                b = vast_om_datumgransen(bit)
                kand = [min(narmast, key=lambda g: narmast[g].distance(b))]
            karna[kand[0]].append(bit)
        tilldelade += 1
    instangda = flytta_instangda(karna)

    nya = []
    for f in stater:
        g = unary_union(karna[f['id']])
        geom = multipolygon(ytor(g), SPLITTER)
        if geom is None:
            raise SystemExit(f"{f['properties']['namn']}: inget täcke kvar efter klippet")
        nf = dict(f)
        nf['geometry'] = geom
        nya.append(nf)
    n_dekor = 0
    ra_dekor = {gid: unary_union(ps) for gid, ps in dekor.items() if ps}
    for f in stater:
        # dekordelen breddas med konstens frans (antialiasing, tunna svansar
        # under ägarskapets alfagräns) så att havsfärgen sväljer den medan
        # delstaten är täckt — men aldrig in över USA-ytan, grannarna eller
        # en annan delstats konst (då skulle den skära av grannens streck
        # när grannen är avslöjad och den här inte)
        delar = dekor.get(f['id'], [])
        if delar:
            andras = unary_union([g for gid, g in ra_dekor.items() if gid != f['id']])
            delar = ytor(unary_union(delar).buffer(MASK_FRANS, quad_segs=2)
                         .simplify(KONTUR_FORENKLING).difference(W).difference(grannmark)
                         .difference(andras))
            dekor[f['id']] = delar
        geom = multipolygon(delar, DEKOR_SPLITTER)
        if geom:
            nya.append({'type': 'Feature', 'id': f['id'],
                        'properties': dict(f['properties'], dekor=1),
                        'geometry': geom})
            n_dekor += 1
    remsor = ytor(unary_union(ytor(W.difference(US)) + gl))
    remsa_geom = multipolygon(remsor, SPLITTER)
    if remsa_geom:
        nya.append({'type': 'Feature', 'id': REMSA_GID,
                    'properties': {'gid': REMSA_GID, 'key': 'usa/_remsa', 'namn': '', 'remsa': 1},
                    'geometry': remsa_geom})
    # havsmasken: allt runt USA utom världens USA-yta, remsorna och
    # dekordelarna. Den ligger mellan delstatskonsten och täcket och
    # målar havsfärg över konstrester som pixelägarskapet aldrig fångade —
    # fartstreckens tunna svansar och antialiasing utanför kusten.
    # Ramen räknas med Aleuterna väster om datumgränsen flyttade −360°
    # och delas vid 180° om den sticker över
    allt = unary_union([vast_om_datumgransen(p) for f in stater
                        for p in ytor(giltig(shape(f['geometry'])))])
    minx, miny, maxx, maxy = allt.bounds
    minx, miny, maxx, maxy = minx - MASK_RAM, miny - MASK_RAM, maxx + MASK_RAM, maxy + MASK_RAM
    ram = box(max(minx, -180), miny, min(maxx, 180), maxy)
    if minx < -180:
        ram = ram.union(box(minx + 360, miny, 180, maxy))
    dekor_yta = unary_union([p for ps in dekor.values() for p in ps])
    mask = ram.difference(unary_union([W, dekor_yta] + remsor)).simplify(KONTUR_FORENKLING)
    mask_geom = multipolygon(ytor(mask), SPLITTER)
    nya.append({'type': 'Feature', 'id': MASK_GID,
                'properties': {'gid': MASK_GID, 'key': 'usa/_mask', 'namn': '', 'mask': 1,
                               'w_summa': summa},
                'geometry': mask_geom})
    usa_reg['features'] = nya
    print(f'usa-regions: {len(stater)} delstater klippta till världens USA-yta, '
          f'{tilldelade} otäckta bitar tilldelade (varav {delade} delade mellan '
          f'delstater), {instangda} instängda remsor flyttade, {n_dekor} dekorfeatures, '
          f'{len(gl)} glipor fyllda, '
          f'{len(remsa_geom["coordinates"]) if remsa_geom else 0} remsdelar')

    # ── 4a: delstatslinjer ur samma geometri som täcket ──
    inre = [f for f in usa_bor['features'] if not f['properties'].get('yttre')]
    inre_linjer = [LineString(l) for f in inre for l in f['geometry']['coordinates'] if len(l) >= 2]
    yta = Wus.buffer(GRANS_MARGINAL)
    klippta = [l for ls in inre_linjer for l in linjer(ls.intersection(yta)) if l.length > 0]
    slutliga = {f['id']: giltig(shape(f['geometry'])) for f in nya
                if f['id'] < MASK_GID and not f['properties'].get('dekor')}
    klippta, borttaget = rensa_inre_linjer(klippta, slutliga)
    tackyta = unary_union(list(slutliga.values()))
    # konturen är täckets yttre kant och riktiga hål i världens USA-yta
    # (sjöar) — inte de mikroskopiska springor mellan två delstaters
    # avrundade kanter som annars blir svarta prickar längs gränserna
    yttre = []
    for p in ytor(tackyta):
        yttre.append(LineString(p.exterior.coords))
        for h in p.interiors:
            hal = Polygon(h)
            if hal.area >= MIKROHAL or hal.difference(W).area > hal.area / 2:
                yttre.append(LineString(h.coords))
    # remsornas havskust (där remsan möter Mexiko eller täcket behövs ingen
    # linje: grönt mot grönt, och täckets egen kant ritas redan)
    if remsor:
        upptaget = unary_union([grannar, tackyta]).buffer(GRANS_MARGINAL)
        yttre += [l for r in remsor for l in linjer(r.boundary.difference(upptaget))]
    yttre = [l.simplify(KONTUR_FORENKLING) for l in yttre if l.length > 0]

    def koord(ls):
        return [[[round(x, 5), round(y, 5)] for x, y in l.coords] for l in ls if len(l.coords) >= 2]

    usa_bor['features'] = [
        {'type': 'Feature', 'properties': {},
         'geometry': {'type': 'MultiLineString', 'coordinates': koord(klippta)}},
        {'type': 'Feature', 'properties': {'yttre': 1},
         'geometry': {'type': 'MultiLineString', 'coordinates': koord(yttre)}},
    ]
    print(f'usa-borders: {len(klippta)} delstatsgränser ({borttaget:.2f}° linje med samma '
          f'delstat på båda sidor borttagen), {len(yttre)} yttre konturlinjer')



def bryt_ut_usakant(varld_bor, W):
    # ── 4b: världens linjer längs USA-kanten får en egen feature ──
    if any(f['properties'].get('usakant') for f in varld_bor['features']):
        print('art-borders: USA-kanten redan utbruten')
    else:
        gen = next(f for f in varld_bor['features']
                   if not f['properties'] and f['geometry']['type'] == 'MultiLineString')
        kant = W.boundary
        minx, miny, maxx, maxy = W.buffer(1).bounds
        kvar, flyttade = [], []
        for line in gen['geometry']['coordinates']:
            xs = [p[0] for p in line]
            ys = [p[1] for p in line]
            if max(xs) < minx or min(xs) > maxx or max(ys) < miny or min(ys) > maxy:
                kvar.append(line)
                continue
            d = sh_distance(sh_points(line), kant)
            mitt = sh_points([[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] for a, b in zip(line, line[1:])])
            dm = sh_distance(mitt, kant)
            pa = [d[i] < KANT_AVSTAND and d[i + 1] < KANT_AVSTAND and dm[i] < KANT_AVSTAND
                  for i in range(len(line) - 1)]
            # dela linjen i körningar av på/av-kant-segment
            start = 0
            for i in range(1, len(pa) + 1):
                if i == len(pa) or pa[i] != pa[start]:
                    bit = line[start:i + 1]
                    (flyttade if pa[start] else kvar).append(bit)
                    start = i
        gen['geometry']['coordinates'] = kvar
        varld_bor['features'].append({
            'type': 'Feature', 'properties': {'usakant': 1},
            'geometry': {'type': 'MultiLineString', 'coordinates': flyttade}})
        print(f'art-borders: {len(flyttade)} linjebitar längs USA-kanten utbrutna')
        spara('assets/art-borders.json', varld_bor)


if __name__ == '__main__':
    main()
