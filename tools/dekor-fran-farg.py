#!/usr/bin/env python3
"""Hittar dekordelar i konsten genom att LÄSA FÄRGERNA i de bakade rutorna.

Bakgrund: några länder är ritade som en sak som sträcker sig långt utanför
landet — Ecuador är en trädgårdsslang som SPRUTAR VATTEN snett ut i Stilla
havet. Vattenstrålen är en del av bilden (den förklarar ju vad man ser) men
inte en del av landet, så när bilden är dold ska bara slangen synas.

Att skilja ut strålen geometriskt går inte: den handritade kartan ligger
inte exakt på den verkliga geografin (Ecuadors ritade kust ligger ~1° öster
om den riktiga), så "utanför den verkliga kustlinjen" träffar fel. Färgen
däremot är entydig — slangen är grön och röd, strålen är blå och vit.

Skriptet samplar därför de färdigbakade rutorna (tiles-build/, som finns
kvar efter en bakning) inuti landets artpolygon, klassar varje punkt som
LAND eller DEKOR utifrån färgen, låter de svarta konturlinjerna ärva
närmaste klassade granne och skriver ut dekorytan som en polygon i
tools/data/dekor-masker.json. postprocess-art-data.py klipper sedan med
den masken i stället för att gissa geometriskt.

Körs bara om när kartan bakas om (masken är i geokoordinater och gäller så
länge rutorna ser likadana ut):

    python3 tools/dekor-fran-farg.py
"""
import json
import math
import os

from PIL import Image
from shapely.geometry import shape, box
from shapely.ops import unary_union

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUTOR = os.path.join(REPO, 'tiles-build')      # från `make-tiles --save`
UT = os.path.join(REPO, 'tools/data/dekor-masker.json')

Z = 7                    # djupaste bakade nivån = finaste färgprovet
TS = 512
STEG = 0.004             # samplingsavstånd i grader (≈ en rutpixel)

# vilka länder som ska färgklassas, och vad som är dekor i deras bild
LANDER = {
    'sydamerika/eciador': 'vatten',   # slangens stråle
}


def ar_vatten(r, g, b):
    """Blå eller vit = vattenstråle. Grönt/rött = slangen."""
    if b > r + 12 and b > g + 6:
        return True
    return min(r, g, b) >= 205 and max(r, g, b) - min(r, g, b) <= 30


def ar_land(r, g, b):
    if g > r + 12 and g > b + 12:
        return True                    # grön slang
    return r > g + 60 and r > b + 60   # röd kran


class Rutor:
    """Färguppslag i de bakade rutorna."""

    def __init__(self):
        self.cache = {}
        self.n = 1 << Z

    def _tile(self, tx, ty):
        if (tx, ty) not in self.cache:
            p = os.path.join(RUTOR, str(Z), str(tx), f'{ty}.webp')
            self.cache[(tx, ty)] = Image.open(p).convert('RGB').load() if os.path.exists(p) else None
        return self.cache[(tx, ty)]

    def farg(self, lon, lat):
        s = math.sin(math.radians(lat))
        fx = (lon + 180) / 360 * self.n
        fy = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * self.n
        tx, ty = int(fx), int(fy)
        if not (0 <= tx < self.n and 0 <= ty < self.n):
            return None
        t = self._tile(tx, ty)
        if t is None:
            return None
        return t[min(TS - 1, int((fx - tx) * TS)), min(TS - 1, int((fy - ty) * TS))]


def klassa(konst, rutor):
    """Rutnät över landets konst: 1 = land, 2 = dekor, 0 = okänt (kontur)."""
    x0, y0, x1, y1 = konst.bounds
    nx = int((x1 - x0) / STEG) + 1
    ny = int((y1 - y0) / STEG) + 1
    # shapely-frågor en och en är alldeles för långsamt — prepared geometry
    from shapely import prepared
    inne = prepared.prep(konst)
    from shapely.geometry import Point
    rutnat = [[0] * nx for _ in range(ny)]
    for j in range(ny):
        lat = y0 + j * STEG
        for i in range(nx):
            lon = x0 + i * STEG
            if not inne.contains(Point(lon, lat)):
                rutnat[j][i] = -1          # utanför konsten
                continue
            f = rutor.farg(lon, lat)
            if f is None:
                rutnat[j][i] = -1
                continue
            r, g, b = f
            rutnat[j][i] = 2 if ar_vatten(r, g, b) else (1 if ar_land(r, g, b) else 0)
    return rutnat, x0, y0, nx, ny


def fyll_okanda(rutnat, nx, ny):
    """Konturlinjerna (svarta, klass 0) ärver närmaste klassade granne.

    Det som ändå inte når någon färg är helsvarta öar — bläckstänken i
    strålen — och de räknas som dekor (`stada` sorterar bort de svarta
    prickar som ligger inne i själva landet)."""
    for _ in range(60):
        kvar = 0
        andring = []
        for j in range(ny):
            for i in range(nx):
                if rutnat[j][i] != 0:
                    continue
                grannar = []
                for dj, di in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    aj, ai = j + dj, i + di
                    if 0 <= aj < ny and 0 <= ai < nx and rutnat[aj][ai] in (1, 2):
                        grannar.append(rutnat[aj][ai])
                if grannar:
                    andring.append((j, i, 2 if grannar.count(2) > grannar.count(1) else 1))
                else:
                    kvar += 1
        for j, i, v in andring:
            rutnat[j][i] = v
        if not andring:
            break
    for j in range(ny):
        for i in range(nx):
            if rutnat[j][i] == 0:
                rutnat[j][i] = 2
    return kvar


def mask_polygon(rutnat, x0, y0, nx, ny):
    """Alla dekorrutor → en polygon (radvisa rektanglar som slås ihop)."""
    h = STEG / 2
    rutor = []
    for j in range(ny):
        i = 0
        while i < nx:
            if rutnat[j][i] != 2:
                i += 1
                continue
            k = i
            while k + 1 < nx and rutnat[j][k + 1] == 2:
                k += 1
            rutor.append(box(x0 + i * STEG - h, y0 + j * STEG - h,
                             x0 + k * STEG + h, y0 + j * STEG + h))
            i = k + 1
    if not rutor:
        return None
    return unary_union(rutor).buffer(STEG).buffer(-STEG).simplify(STEG)


def bitar(geom):
    from shapely.geometry import Polygon
    return [geom] if isinstance(geom, Polygon) else [p for p in geom.geoms
                                                     if p.geom_type == 'Polygon']


def stada(mask, konst):
    """Ta bort brus och svälj de sista dropparna.

    Enstaka ljusa pixlar och svarta prickar inne i slangen (kantutjämning
    mot konturlinjerna) blir små maskfläckar som skulle stansa havsfärgade
    hål mitt i landet — bara den stora sammanhängande strålen behålls.
    Sedan sväljer masken de småbitar av KONSTEN som blivit kvar ute i
    strålen (enskilda stänk, helsvarta bläckprickar); annars står de kvar
    som pappersöar i havet när landet är täckt."""
    delar = sorted(bitar(mask), key=lambda p: -p.area)
    mask = unary_union([p for p in delar if p.area >= delar[0].area * 0.2])
    rester = sorted(bitar(konst.difference(mask)), key=lambda p: -p.area)
    extra = [p for p in rester[1:]
             if p.area < rester[0].area * 0.02 and p.distance(mask) < 0.5]
    if extra:
        mask = unary_union([mask] + extra)
    print(f'    städat: {len(delar)} maskdelar → {len(bitar(mask))}, '
          f'{len(extra)} konstöar uppslukade')
    return mask


def geojson(geom):
    ut = []
    for p in bitar(geom):
        if p.is_empty:
            continue
        ut.append([[[round(x, 4), round(y, 4)] for x, y in p.exterior.coords]])
    return ut


def main():
    if not os.path.isdir(RUTOR):
        raise SystemExit(f'{RUTOR} saknas — kör bakningen med --save tiles-build först')
    regions = json.load(open(os.path.join(REPO, 'assets/art-regions.json')))
    rutor = Rutor()
    ut = {}
    for key in LANDER:
        delar = [shape(f['geometry']).buffer(0) for f in regions['features']
                 if f['properties'].get('key') == key]
        if not delar:
            print(f'  {key}: finns inte i art-regions — hoppar över')
            continue
        # både landet och en redan utbruten dekordel hör till samma bild
        konst = unary_union(delar)
        rutnat, x0, y0, nx, ny = klassa(konst, rutor)
        kvar = fyll_okanda(rutnat, nx, ny)
        mask = mask_polygon(rutnat, x0, y0, nx, ny)
        if mask is None or mask.is_empty:
            print(f'  {key}: hittade ingen dekorfärg')
            continue
        mask = stada(mask, konst)
        andel = 100 * mask.intersection(konst).area / konst.area
        print(f'  {key}: dekorfärg {mask.area:.2f}° ({andel:.0f}% av konsten), '
              f'{nx}×{ny} prov, {kvar} oklassade kvar')
        ut[key] = geojson(mask)
    os.makedirs(os.path.dirname(UT), exist_ok=True)
    with open(UT, 'w') as f:
        json.dump(ut, f, ensure_ascii=False, separators=(',', ':'))
    print(f'skrev {UT}')


if __name__ == '__main__':
    main()
