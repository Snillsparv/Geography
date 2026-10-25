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
   ytan som ingen delstat når (Kodiak, Aleuterna, barriäröar, sömhål)
   går till närmaste delstat, så USA täcks exakt en gång.
2. DEKOR. Konst som ligger ute i havet blir egna features med dekor: 1
   (samma id → samma feature-state). Spelet målar dem i havsfärg medan
   delstaten är täckt och visar konsten när den avslöjas, precis som
   Malaysias ögon och spröt. Konst över grannländerna kastas ur täcket —
   grannens gröna yta döljer den redan.
3. REMSOR. Världens USA-yta läcker in i Mexiko (Tamaulipas-kusten, Baja,
   Sonora): där räckte Mexikos konst inte ut och USA:s underlag fyllde i.
   De bitarna blir en egen feature (remsa: 1) som spelet målar grön i
   delstatsregionen, i stället för att världens USA-flagga skymtar fram.
   En HAVSMASK (mask: 1) täcker allt runt USA utom världens USA-yta och
   dekordelarna: den målar havsfärg över de konstrester som pixelägar-
   skapet aldrig fångade (fartstreckens tunna svansar, kustens frans).
4. LINJER. usa-borders får en yttre kontur (yttre: 1) ur SAMMA geometri
   som täcket, och delstatsgränserna klipps till USA-ytan. I världens
   art-borders bryts linjerna längs världens USA-kant ut till en egen
   feature (usakant: 1) som spelet släcker i delstatsregionen — då har
   varje kant exakt en linje, och den ligger där täcket slutar.
"""
import json
import os

from shapely import distance as sh_distance, points as sh_points, set_precision
from shapely.affinity import translate
from shapely.geometry import LineString, box, shape
from shapely.ops import unary_union
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
    if redan:
        # täcke och linjer härleds ur make-tiles råa export — en andra körning
        # på redan klippt data skulle bara flytta splitter fram och tillbaka
        print('usa-regions/usa-borders: redan efterbearbetade (kör make-tiles '
              '--dataset usa först för att göra om dem)')
    else:
        bearbeta_delstater(usa_reg, usa_bor, W, US, Wus, grannar)
        spara('assets/usa-regions.json', usa_reg)
        spara('assets/usa-borders.json', usa_bor)
    bryt_ut_usakant(varld_bor, W)
    print('klart')


def bearbeta_delstater(usa_reg, usa_bor, W, US, Wus, grannar):
    # ── 1–3: täcke, dekor, remsor ──
    stater = usa_reg['features']
    karna, dekor = {}, {}
    W_marg = W.buffer(DEKOR_MARGINAL)
    for f in stater:
        S = giltig(shape(f['geometry']))
        karna[f['id']] = ytor(S.intersection(Wus))
        hav = S.difference(W_marg).difference(grannar)
        dekor[f['id']] = [p for p in ytor(hav) if p.area >= DEKOR_SPLITTER]
    tackt = unary_union([p for ps in karna.values() for p in ps])
    rest = ytor(Wus.difference(tackt))
    narmast = {gid: vast_om_datumgransen(unary_union(ps)) for gid, ps in karna.items() if ps}
    tilldelade = 0
    for bit in rest:
        if bit.area < SPLITTER * 1e-3:
            continue
        b = vast_om_datumgransen(bit)
        gid = min(narmast, key=lambda g: narmast[g].distance(b))
        karna[gid].append(bit)
        tilldelade += 1

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
    for f in stater:
        # dekordelen breddas med konstens frans (antialiasing, tunna svansar
        # under ägarskapets alfagräns) så att havsfärgen sväljer den medan
        # delstaten är täckt — men aldrig in över USA-ytan eller grannarna
        delar = dekor.get(f['id'], [])
        if delar:
            delar = ytor(unary_union(delar).buffer(MASK_FRANS, quad_segs=2)
                         .simplify(KONTUR_FORENKLING).difference(W).difference(grannar))
            dekor[f['id']] = delar
        geom = multipolygon(delar, DEKOR_SPLITTER)
        if geom:
            nya.append({'type': 'Feature', 'id': f['id'],
                        'properties': dict(f['properties'], dekor=1),
                        'geometry': geom})
            n_dekor += 1
    remsor = ytor(W.difference(US))
    remsa_geom = multipolygon(remsor, SPLITTER)
    if remsa_geom:
        nya.append({'type': 'Feature', 'id': REMSA_GID,
                    'properties': {'gid': REMSA_GID, 'key': 'usa/_remsa', 'namn': '', 'remsa': 1},
                    'geometry': remsa_geom})
    # havsmasken: allt runt USA utom världens USA-yta och dekordelarna.
    # Den ligger mellan delstatskonsten och täcket och
    # målar havsfärg över konstrester som pixelägarskapet aldrig fångade —
    # fartstreckens tunna svansar och antialiasing utanför kusten
    allt = unary_union([giltig(shape(f['geometry'])) for f in stater])
    minx, miny, maxx, maxy = allt.bounds
    ram = box(minx - MASK_RAM, miny - MASK_RAM, maxx + MASK_RAM, maxy + MASK_RAM)
    dekor_yta = unary_union([p for ps in dekor.values() for p in ps])
    mask = ram.difference(unary_union([W, dekor_yta])).simplify(KONTUR_FORENKLING)
    mask_geom = multipolygon(ytor(mask), SPLITTER)
    nya.append({'type': 'Feature', 'id': MASK_GID,
                'properties': {'gid': MASK_GID, 'key': 'usa/_mask', 'namn': '', 'mask': 1},
                'geometry': mask_geom})
    usa_reg['features'] = nya
    print(f'usa-regions: {len(stater)} delstater klippta till världens USA-yta, '
          f'{tilldelade} otäckta bitar tilldelade, {n_dekor} dekorfeatures, '
          f'{len(remsa_geom["coordinates"]) if remsa_geom else 0} remsdelar')

    # ── 4a: delstatslinjer ur samma geometri som täcket ──
    inre = [f for f in usa_bor['features'] if not f['properties'].get('yttre')]
    inre_linjer = [LineString(l) for f in inre for l in f['geometry']['coordinates'] if len(l) >= 2]
    yta = Wus.buffer(GRANS_MARGINAL)
    klippta = [l for ls in inre_linjer for l in linjer(ls.intersection(yta)) if l.length > 0]
    tackyta = unary_union([giltig(shape(f['geometry'])) for f in nya
                           if f['id'] < MASK_GID and not f['properties'].get('dekor')])
    yttre = linjer(tackyta.boundary)
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
    print(f'usa-borders: {len(klippta)} delstatsgränser, {len(yttre)} yttre konturlinjer')



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
