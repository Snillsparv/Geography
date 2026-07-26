#!/usr/bin/env python3
"""Efterbearbetning av art-datafilerna som make-tiles.mjs skriver.

Körs EFTER en omgenerering av assets/art-regions.json, art-borders.json
och art-markers.json — annars försvinner fixarna som spelet förlitar sig
på (idempotent: säkert att köra flera gånger).

1. DEKORDELAR. Vissa länders konst har delar ritade ute i havet:
   Malaysias mal har ögon, mun och spröt mellan halvön och Borneo, och
   Kubas cigarr ryker in över Bahamas. Pipelinens pixelägarskap gör dem
   till klickpolygoner och konturlinjer, och utan delning målas de som
   pappersformer när landet är täckt. Här bryts de ut till egna features
   med dekor: 1 (samma id → samma feature-state), som spelet döljer i
   havsfärg och släcker konturerna för, precis som havs-emblemen.
   Vilka delar som är dekor avgörs geometriskt: en del vars yta ligger
   utanför landets VERKLIGA gränser (world-borders.json, med lite
   marginal) är ritad i havet.
   Räcker inte geometrin får landet en FÄRGMASK i stället
   (tools/data/dekor-masker.json, se dekor-fran-farg.py): Ecuadors
   vattenstråle sprutar tvärs över den ritade kusten, och eftersom den
   handritade kartan ligger ~1° öster om den verkliga geografin träffar
   "utanför kustlinjen" helt fel — men blått och vitt mot grönt och rött
   är entydigt.

2. EMBLEMLÄNDER. Bahamas är ritat som bananer utspridda över ögruppen —
   som pappersform ser den inte ut som ett land. Landet befordras därför
   till "emblem" (badge): konstblobben döljs i havsfärg medan landet är
   täckt, och i stället visas landets riktiga Natural Earth-form plus
   den klickbara cirkeln. Samma mekanism som Malta, Monaco och de andra
   ö-nationerna redan använder.

3. SMAL (tjocklek) i art-markers. omfang är längsta bbox-axeln — avlånga
   länder (Kuba: 10,75° långt men under 1° tjockt) räknades som "stora
   nog att klicka på" och fick aldrig sin prick. smal = max över
   artpolygondelarna av (yta / längsta axel), dvs. tjockleken på den
   fetaste delen. Spelet visar prick när smal är under ~8 px på skärmen
   (glob-spel.js: prickSyns). Emblemländer hoppas över — deras prickar
   styrs av landets verkliga storlek, inte den stora konstblobben.
"""
import json
import math
import os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# konstdelar i havet bryts ut till dekor-features för de här länderna
# (Malaysias ögon och spröt, Kubas cigarrök, Ecuadors vattenstråle)
DEKOR_LANDER = ['asien/malaysia', 'nordamerika/kuba', 'sydamerika/eciador']
# länder som befordras till emblem: konsten döljs, riktiga formen visas
EMBLEM_LANDER = ['vastindien/bahamas']
# hur långt utanför den verkliga landytan en del måste ligga för att
# räknas som dekor (grader) och hur stor andel av delen som får ligga på
# riktig mark
MARK_BUFFERT = 0.25
MARK_ANDEL = 50
# klippsplitter mindre än så här (kvadratgrader) kastas
SPLITTER_YTA = 0.0004
# hur långt utanför verklig kustlinje konsten får gå innan den räknas som
# havsritad dekor (konturerna är handritade och spiller alltid lite)
HAVS_BUFFERT = 0.08
# hur långt utanför färgmaskens kant en konturlinje räknas som dekor, och
# hur korta linjestumpar klippet får kasta (grader)
KONTUR_MARGINAL = 0.02
KONTUR_MINSTA = 0.01


_land_cache = []


def varldens_land(varlden):
    """Hela världens landyta som en shapely-geometri (byggs en gång)."""
    from shapely.geometry import shape
    from shapely.ops import unary_union
    if not _land_cache:
        _land_cache.append(unary_union([shape(f['geometry']).buffer(0)
                                        for f in varlden['features']]))
    return _land_cache[0]


# ── geometrihjälpare ──────────────────────────────────────────────────
def part_bbox(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


def shoelace(ring):
    a = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i][:2]
        x2, y2 = ring[i + 1][:2]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2


def point_in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][:2]
        xj, yj = ring[j][:2]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def dist_to_ring(x, y, ring):
    best = float('inf')
    for i in range(len(ring) - 1):
        x1, y1 = ring[i][:2]
        x2, y2 = ring[i + 1][:2]
        dx, dy = x2 - x1, y2 - y1
        L2 = dx * dx + dy * dy
        t = 0 if L2 == 0 else max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / L2))
        d = math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))
        if d < best:
            best = d
    return best


def ringar(geom):
    if geom['type'] == 'Polygon':
        return [geom['coordinates'][0]]
    return [poly[0] for poly in geom['coordinates']]


def prov_i_ring(ring, rutor=12):
    """Rutnätsprov av punkter inuti ringen (minst centroiden)."""
    x0, y0, x1, y1 = part_bbox(ring)
    steg = max(x1 - x0, y1 - y0) / rutor
    prov = []
    if steg > 0:
        y = y0
        while y <= y1:
            x = x0
            while x <= x1:
                if point_in_ring(x, y, ring):
                    prov.append((x, y))
                x += steg
            y += steg
    if not prov:
        prov = [(sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))]
    return prov


def pa_riktig_mark(ring, sanna_ringar):
    """Andel (%) av delens yta som ligger på landets verkliga geografi."""
    prov = prov_i_ring(ring)
    traff = sum(1 for (x, y) in prov
                if any(point_in_ring(x, y, sr) or dist_to_ring(x, y, sr) < MARK_BUFFERT
                       for sr in sanna_ringar))
    return traff * 100 // len(prov)


def spara(path, data):
    with open(path, 'w') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))


def hitta(features, key):
    return next((f for f in features
                 if f['properties'].get('key') == key and not f['properties'].get('dekor')), None)


def sanna_ringar_for(varlden, namn):
    return [sr for f in varlden['features']
            if (f['properties'].get('namn') or f['properties'].get('name')) == namn
            for sr in ringar(f['geometry'])]


def unwrap(geom, ref_lng):
    """Lyft longituderna kring landets mittpunkt (Fiji över antimeridianen)."""
    def fix(ring):
        ut = []
        for lng, lat in [(p[0], p[1]) for p in ring]:
            while lng - ref_lng > 180:
                lng -= 360
            while lng - ref_lng < -180:
                lng += 360
            ut.append([round(lng, 5), round(lat, 5)])
        return ut
    polys = [geom['coordinates']] if geom['type'] == 'Polygon' else geom['coordinates']
    return {'type': 'MultiPolygon', 'coordinates': [[fix(r) for r in poly] for poly in polys]}


# ── 1. dekordelar ─────────────────────────────────────────────────────
def _multi(geom):
    """shapely-geometri → MultiPolygon-koordinater, småsplitter bortstädat."""
    from shapely.geometry import Polygon, MultiPolygon
    bitar = [geom] if isinstance(geom, Polygon) else list(geom.geoms)
    ut = []
    for p in bitar:
        if not isinstance(p, Polygon) or p.is_empty or p.area < SPLITTER_YTA:
            continue
        ringar_ = [[[round(x, 5), round(y, 5)] for x, y in p.exterior.coords]]
        for inre in p.interiors:
            ringar_.append([[round(x, 5), round(y, 5)] for x, y in inre.coords])
        ut.append(ringar_)
    return ut


def las_fargmasker():
    """Färgklassade dekorytor från dekor-fran-farg.py (om filen finns)."""
    from shapely.geometry import shape
    from shapely.ops import unary_union
    p = os.path.join(REPO, 'tools/data/dekor-masker.json')
    if not os.path.exists(p):
        return {}
    return {key: unary_union([shape({'type': 'Polygon', 'coordinates': poly}).buffer(0)
                              for poly in polys])
            for key, polys in json.load(open(p)).items()}


def slain_dekor(regions, borders, key):
    """Slå tillbaka en tidigare utbruten dekordel i landet igen.

    Gör skriptet omkörbart: delningen kan räknas om från nya masker utan
    att art-datafilerna först måste genereras om."""
    from shapely.geometry import shape
    from shapely.ops import unary_union
    dek = [f for f in regions['features']
           if f['properties'].get('key') == key and f['properties'].get('dekor')]
    if not dek:
        return
    land = hitta(regions['features'], key)
    hel = unary_union([shape(f['geometry']).buffer(0) for f in dek + [land]])
    land['geometry'] = {'type': 'MultiPolygon', 'coordinates': _multi(hel)}
    for f in dek:
        regions['features'].remove(f)
    gid = land['properties']['gid']
    linjer = [f for f in borders['features']
              if f['properties'].get('gid') == gid and f['properties'].get('dekor')]
    for f in linjer:
        borders['features'][0]['geometry']['coordinates'] += f['geometry']['coordinates']
        borders['features'].remove(f)
    print(f'  {key}: gammal dekordelning återställd '
          f'({len(dek)} ytor, {len(linjer)} linjefeatures)')


def dela_dekor(regions, varlden, key, mask=None):
    """Klipp ut den konst som inte hör till landet och lägg den i en
    dekor-feature. Med en färgmask klipps exakt det som är ritat i en annan
    färg (Ecuadors vattenstråle); utan mask klipps geometriskt, allt som är
    ritat utanför världens landyta (Malaysias ögon, Kubas rök)."""
    from shapely.geometry import shape
    from shapely.ops import unary_union
    idx = next((i for i, f in enumerate(regions['features'])
                if f['properties'].get('key') == key), None)
    if idx is None:
        print(f'  {key}: finns inte i art-regions — hoppar över')
        return None
    land = regions['features'][idx]
    gid = land['properties']['gid']
    konst = unary_union([shape(land['geometry']).buffer(0)])
    if mask is not None:
        mark_g = konst.difference(mask)
        dekor_g = konst.intersection(mask)
        varfor = 'färgmask'
    else:
        sant = [f for f in varlden['features']
                if (f['properties'].get('namn') or f['properties'].get('name'))
                == land['properties']['namn']]
        if not sant:
            print(f'  {key}: saknar verklig geometri i world-borders — hoppar över')
            return None
        # Det som ska döljas är konst ritad ute i HAVET — inte konst som
        # råkar ligga över grannlandet.
        verklig = varldens_land(varlden).buffer(HAVS_BUFFERT)
        mark_g = konst.intersection(verklig)
        dekor_g = konst.difference(verklig)
        varfor = 'utanför landytan'
    mark = _multi(mark_g)
    dekor = _multi(dekor_g)
    if not dekor:
        print(f'  {key}: inget att bryta ut ({varfor})')
        return None
    if not mark:
        print(f'  {key}: HELA konsten skulle brytas ut — hoppar över (kolla datan!)')
        return None
    land['geometry'] = {'type': 'MultiPolygon', 'coordinates': mark}
    regions['features'].insert(idx + 1, {
        'type': 'Feature', 'id': gid,
        'properties': {'gid': gid, 'key': key, 'namn': land['properties']['namn'], 'dekor': 1},
        'geometry': {'type': 'MultiPolygon', 'coordinates': dekor},
    })
    print(f'  {key}: {dekor_g.area:.2f}° dekor utbruten ({varfor}, {len(dekor)} bitar), '
          f'{mark_g.area:.2f}° kvar som land')
    return {'gid': gid, 'namn': land['properties']['namn'], 'polys': dekor,
            'mask': mask is not None}


def dela_konturer(borders, dekor_polys, egenskaper):
    """Klipp konturlinjerna längs dekorytan i stället för att flytta hela
    linjer. Ecuadors kontur är EN kedja runt både slangen och strålen, så
    den måste skäras: strålens del ska släckas när landet är täckt, kustens
    del ska lysa kvar."""
    from shapely.geometry import shape, LineString, MultiLineString
    from shapely.ops import unary_union
    gid = egenskaper['gid']
    if any(f['properties'].get('gid') == gid and f['properties'].get(egenskaper['flagga'])
           for f in borders['features']):
        return 0
    inne = unary_union([shape({'type': 'Polygon', 'coordinates': p}).buffer(0)
                        for p in dekor_polys]).buffer(KONTUR_MARGINAL)
    gen = borders['features'][0]

    def delar(g):
        if g.is_empty:
            return []
        if isinstance(g, LineString):
            return [g] if g.length > KONTUR_MINSTA else []
        if isinstance(g, MultiLineString):
            return [l for l in g.geoms if l.length > KONTUR_MINSTA]
        return [l for bit in getattr(g, 'geoms', []) for l in delar(bit)]

    kvar, flyttade = [], []
    for line in gen['geometry']['coordinates']:
        ls = LineString([(p[0], p[1]) for p in line])
        if not ls.intersects(inne):
            kvar.append(line)
            continue
        for bit in delar(ls.difference(inne)):
            kvar.append([[round(x, 5), round(y, 5)] for x, y in bit.coords])
        for bit in delar(ls.intersection(inne)):
            flyttade.append([[round(x, 5), round(y, 5)] for x, y in bit.coords])
    if not flyttade:
        return 0
    gen['geometry']['coordinates'] = kvar
    borders['features'].append({
        'type': 'Feature', 'id': gid,
        'properties': {'gid': gid, 'namn': egenskaper['namn'], egenskaper['flagga']: 1},
        'geometry': {'type': 'MultiLineString', 'coordinates': flyttade},
    })
    return len(flyttade)


def flytta_konturer(borders, mal, egenskaper):
    """Flytta konturlinjerna som ligger på mal-polygonerna till egen feature."""
    gid = egenskaper['gid']
    if any(f['properties'].get('gid') == gid and f['properties'].get(egenskaper['flagga'])
           for f in borders['features']):
        return 0
    gen = borders['features'][0]      # den generella, egenskapslösa linjefeaturen
    mal_ringar = [poly[0] for poly in mal]
    boxar = [part_bbox(r) for r in mal_ringar]

    def pa_malet(x, y):
        for box, ring in zip(boxar, mal_ringar):
            if x < box[0] - 0.1 or x > box[2] + 0.1 or y < box[1] - 0.1 or y > box[3] + 0.1:
                continue
            if point_in_ring(x, y, ring) or dist_to_ring(x, y, ring) < 0.05:
                return True
        return False

    kvar, flyttade = [], []
    for line in gen['geometry']['coordinates']:
        (flyttade if all(pa_malet(p[0], p[1]) for p in line) else kvar).append(line)
    if not flyttade:
        return 0
    gen['geometry']['coordinates'] = kvar
    props = {'gid': gid, 'namn': egenskaper['namn'], egenskaper['flagga']: 1}
    borders['features'].append({
        'type': 'Feature', 'id': gid, 'properties': props,
        'geometry': {'type': 'MultiLineString', 'coordinates': flyttade},
    })
    return len(flyttade)


# ── 2. emblemländer ───────────────────────────────────────────────────
def befordra_emblem(regions, markers, varlden, key):
    """Dölj konstblobben och visa landets riktiga form + cirkel i stället."""
    land = hitta(regions['features'], key)
    if land is None:
        print(f'  {key}: finns inte i art-regions — hoppar över')
        return None
    if land['properties'].get('badge') == 1:
        print(f'  {key}: är redan emblem')
        return None
    gid = land['properties']['gid']
    namn = land['properties']['namn']
    sant = next((f for f in varlden['features']
                 if (f['properties'].get('namn') or f['properties'].get('name')) == namn), None)
    if sant is None:
        print(f'  {key}: saknar verklig geometri i world-borders — hoppar över')
        return None
    land['properties']['badge'] = 1
    punkt = next((f for f in markers['features']
                  if f['properties'].get('gid') == gid and f['geometry']['type'] == 'Point'), None)
    if punkt is None:
        print(f'  {key}: saknar markörpunkt — hoppar över')
        return None
    punkt['properties']['badge'] = 1
    # utspridda ö-nationer (över 2° långa) behåller alltid sin cirkel
    punkt['properties']['spridd'] = 1 if punkt['properties'].get('omfang', 0) > 2 else 0
    punkt['properties'].pop('smal', None)      # emblem styrs av verklig storlek
    if not any(f['properties'].get('gid') == gid and f['properties'].get('form') == 1
               for f in markers['features']):
        markers['features'].append({
            'type': 'Feature', 'id': gid,
            'properties': {'gid': gid, 'namn': namn, 'form': 1},
            'geometry': unwrap(sant['geometry'], punkt['geometry']['coordinates'][0]),
        })
    print(f'  {key}: befordrat till emblem (spridd={punkt["properties"]["spridd"]})')
    return {'gid': gid, 'namn': namn, 'polys': land['geometry']['coordinates']}


# ── 3. emblem på land ─────────────────────────────────────────────────
def emblem_pa_land(regions, markers, varlden):
    """Emblem vars konstblobb ligger på ett annat lands mark kan inte döljas
    i havsfärg — deras blobb målas som papper och silhuetten avslöjar
    konstverket (Vatikanstatens kors mitt i Italien). De får i stället en
    täckradie: spelet ritar en pappersCIRKEL som är stor nog att svälja
    hela konstblobben, så det som syns är en cirkel och inget annat.
    Emblem som visar sig ligga i öppet hav får hav: 1 och döljs som de
    andra ö-emblemen."""
    punkt = {f['properties']['gid']: f for f in markers['features']
             if f['geometry']['type'] == 'Point'}
    # VERKLIG landyta (world-borders) avgör om blobben ligger på land —
    # konstytorna duger inte: emblemet äger sina egna pixlar, så värdlandets
    # artpolygon har ett hål precis där blobben ligger
    land_ringar = []
    for f in varlden['features']:
        for r in ringar(f['geometry']):
            land_ringar.append((part_bbox(r), r))
    andrad = False
    for f in regions['features']:
        p = f['properties']
        if p.get('badge') != 1 or p.get('hav') == 1 or p.get('dekor'):
            continue
        m = punkt.get(p['gid'])
        if not m:
            continue
        andrad = True
        prov = [q for poly in f['geometry']['coordinates'] for q in prov_i_ring(poly[0], 8)]

        def pa_riktigt_land(x, y):
            for (bx0, by0, bx1, by1), r in land_ringar:
                if bx0 <= x <= bx1 and by0 <= y <= by1 and point_in_ring(x, y, r):
                    return True
            return False

        pa_land = sum(1 for (x, y) in prov if pa_riktigt_land(x, y))
        if pa_land * 100 // max(len(prov), 1) < 25:
            p['hav'] = 1                       # ligger i öppet hav ändå
            m['properties'].pop('tackradie', None)
            print(f"  {p['namn']}: konsten ligger i havet → döljs i havsfärg")
        else:
            cx, cy = m['geometry']['coordinates']
            rad = max(math.hypot(q[0] - cx, q[1] - cy)
                      for poly in f['geometry']['coordinates'] for q in poly[0])
            m['properties']['tackradie'] = round(rad * 1.02, 3)
            print(f"  {p['namn']}: på annat lands mark → täckcirkel {rad * 1.02:.2f}°")
    return andrad


# ── 4. smal (tjocklek) ────────────────────────────────────────────────
def satt_smal(markers, regions):
    art = {}
    for f in regions['features']:
        if f['properties'].get('dekor'):
            continue
        art[f['properties']['gid']] = f['geometry']['coordinates']
    n = 0
    for f in markers['features']:
        if f['geometry']['type'] != 'Point':
            continue
        if f['properties'].get('badge'):
            f['properties'].pop('smal', None)
            continue
        polys = art.get(f['properties']['gid'])
        if not polys:
            continue
        best = 0.0
        for poly in polys:
            ring = poly[0]
            x0, y0, x1, y1 = part_bbox(ring)
            lang = max(x1 - x0, y1 - y0)
            if lang > 0:
                best = max(best, shoelace(ring) / lang)
        if best > 0:
            f['properties']['smal'] = round(min(best, f['properties']['omfang']), 3)
            n += 1
    print(f'art-markers: smal satt på {n} länder')


def main():
    reg_p = os.path.join(REPO, 'assets/art-regions.json')
    bor_p = os.path.join(REPO, 'assets/art-borders.json')
    mar_p = os.path.join(REPO, 'assets/art-markers.json')
    var_p = os.path.join(REPO, 'assets/world-borders.json')
    regions = json.load(open(reg_p))
    borders = json.load(open(bor_p))
    markers = json.load(open(mar_p))
    varlden = json.load(open(var_p))
    andrad_reg = andrad_bor = False

    print('art-regions: dekordelar')
    masker = las_fargmasker()
    for key in DEKOR_LANDER:
        slain_dekor(regions, borders, key)
        res = dela_dekor(regions, varlden, key, masker.get(key))
        if res:
            andrad_reg = andrad_bor = True
            egenskaper = {'gid': res['gid'], 'namn': res['namn'], 'flagga': 'dekor'}
            n = (dela_konturer(borders, res['polys'], egenskaper) if res['mask']
                 else flytta_konturer(borders, res['polys'], egenskaper))
            if n:
                print(f'    art-borders: {n} konturlinjer utbrutna')

    print('art-regions: emblemländer')
    for key in EMBLEM_LANDER:
        res = befordra_emblem(regions, markers, varlden, key)
        if res:
            andrad_reg = True
            n = flytta_konturer(borders, res['polys'],
                                {'gid': res['gid'], 'namn': res['namn'], 'flagga': 'badge'})
            if n:
                andrad_bor = True
                print(f'    art-borders: {n} konturlinjer flyttade')

    print('art-regions: emblem på land')
    if emblem_pa_land(regions, markers, varlden):
        andrad_reg = True

    satt_smal(markers, regions)
    spara(reg_p, regions)
    spara(bor_p, borders)
    spara(mar_p, markers)
    print('klart')


if __name__ == '__main__':
    main()
