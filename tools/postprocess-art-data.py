#!/usr/bin/env python3
"""Efterbearbetning av art-datafilerna som make-tiles.mjs skriver.

Körs EFTER en omgenerering av assets/art-regions.json, art-borders.json
och art-markers.json — annars försvinner två fixar som spelet förlitar
sig på (idempotent: säkert att köra flera gånger):

1. MALAYSIAS ANSIKTE (dekor-delning). Malaysias mal är ritad med ögon,
   mun och spröt i öppet hav mellan halvön och Borneodelen. Pipelinens
   pixelägarskap gör havsdelarna till klickpolygoner och konturlinjer,
   och utan delning målas de som pappersfärgade ansiktssiluetter när
   landet är täckt. Här bryts de ut till egna features med dekor: 1
   (samma id 109 → samma feature-state), som spelet döljer i havsfärg
   och släcker konturerna för, precis som havs-badges.

2. SMAL (tjocklek) i art-markers. omfang är längsta bbox-axeln — avlånga
   länder (Kuba: 10,75° långt men under 1° tjockt) räknades som "stora
   nog att klicka på" och fick aldrig sin prick. smal = max över
   artpolygondelarna av (yta / längsta axel), dvs. tjockleken på den
   fetaste delen. Spelet visar prick när smal är under ~8 px på skärmen
   (glob-spel.js: prickSyns). Badge-länder hoppas över (deras prickar
   ska styras av landets verkliga storlek, inte den stora badge-blobben).
"""
import json
import math
import os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MALAYSIA_GID = 109


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


def spara(path, data):
    with open(path, 'w') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))


def dela_malaysia(regions):
    """Bryt ut Malaysias havsritade ansiktsdelar till en dekor-feature."""
    if any(f['properties'].get('dekor') and f['properties'].get('gid') == MALAYSIA_GID
           for f in regions['features']):
        print('art-regions: dekor-delningen finns redan — hoppar över')
        return None
    idx, mal = next((i, f) for i, f in enumerate(regions['features'])
                    if f['properties'].get('gid') == MALAYSIA_GID)
    polys = mal['geometry']['coordinates']
    # landdelarna = de två största (halvön + Borneodelen), resten är ansiktet
    ordnade = sorted(range(len(polys)), key=lambda i: shoelace(polys[i][0]), reverse=True)
    land_idx = sorted(ordnade[:2])
    face_idx = sorted(ordnade[2:])
    if not face_idx:
        print('art-regions: Malaysia har inga havsdelar — inget att dela')
        return None
    face_polys = [polys[i] for i in face_idx]
    mal['geometry']['coordinates'] = [polys[i] for i in land_idx]
    regions['features'].insert(idx + 1, {
        'type': 'Feature', 'id': MALAYSIA_GID,
        'properties': {'gid': MALAYSIA_GID, 'key': mal['properties']['key'],
                       'namn': mal['properties']['namn'], 'dekor': 1},
        'geometry': {'type': 'MultiPolygon', 'coordinates': face_polys},
    })
    print(f'art-regions: {len(face_polys)} ansiktsdelar utbrutna till dekor-feature')
    return face_polys


def dela_borders(borders, face_polys):
    """Flytta ansiktsdelarnas konturlinjer till en egen dekor-feature."""
    if any(f['properties'].get('dekor') for f in borders['features']):
        print('art-borders: dekor-featuren finns redan — hoppar över')
        return
    gen = borders['features'][0]          # den generella, egenskapslösa linjefeaturen
    face_rings = [poly[0] for poly in face_polys]
    face_boxes = [part_bbox(r) for r in face_rings]

    def nara_ansiktet(x, y):
        for box, ring in zip(face_boxes, face_rings):
            if x < box[0] - 0.1 or x > box[2] + 0.1 or y < box[1] - 0.1 or y > box[3] + 0.1:
                continue
            if point_in_ring(x, y, ring) or dist_to_ring(x, y, ring) < 0.05:
                return True
        return False

    kept, moved = [], []
    for line in gen['geometry']['coordinates']:
        if all(nara_ansiktet(pt[0], pt[1]) for pt in line):
            moved.append(line)
        else:
            kept.append(line)
    gen['geometry']['coordinates'] = kept
    borders['features'].append({
        'type': 'Feature', 'id': MALAYSIA_GID,
        'properties': {'gid': MALAYSIA_GID, 'namn': 'Malaysia', 'dekor': 1},
        'geometry': {'type': 'MultiLineString', 'coordinates': moved},
    })
    print(f'art-borders: {len(moved)} konturlinjer flyttade till dekor-feature')


def satt_smal(markers, regions):
    """smal = tjockleken på landets fetaste artpolygondel (icke-badge)."""
    art_by_gid = {}
    for f in regions['features']:
        if f['properties'].get('dekor'):
            continue
        art_by_gid[f['properties']['gid']] = f['geometry']['coordinates']
    n = 0
    for f in markers['features']:
        if f['geometry']['type'] != 'Point' or f['properties'].get('badge'):
            continue
        polys = art_by_gid.get(f['properties']['gid'])
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
    regions = json.load(open(reg_p))
    borders = json.load(open(bor_p))
    markers = json.load(open(mar_p))

    face_polys = dela_malaysia(regions)
    if face_polys:
        spara(reg_p, regions)
    else:
        # regionerna var redan delade — hämta ansiktet därifrån så att
        # gränserna ändå kan delas om bara art-borders.json regenererats
        dekor = next((f for f in regions['features']
                      if f['properties'].get('dekor') and f['properties'].get('gid') == MALAYSIA_GID), None)
        face_polys = dekor['geometry']['coordinates'] if dekor else None
    if face_polys:
        innan = len(borders['features'])
        dela_borders(borders, face_polys)
        if len(borders['features']) != innan:
            spara(bor_p, borders)
    satt_smal(markers, regions)
    spara(mar_p, markers)
    print('klart')


if __name__ == '__main__':
    main()
