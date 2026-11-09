"""Plockar ut de engelska delstatsbilderna ur Jonas engelska USA-PSD och
lägger dem i USA.psd-upplösning, så att de kan ersätta de svenska.

  python3 -I tools/engelska-lager.py "/mnt/project-files/HELA USA TOTAL in ENGLISH kopiera.psd"

Den engelska PSD:n (11230 × 7220) är samma karta som psd/USA.psd (6000 ×
3857) i högre upplösning: skalan 6000/11230 lägger varje lager exakt på det
svenska (konturerna sammanfaller, IoU ~0,997). Jonas skickade bara lagren
som skiljer: 12 delstater. Michigan är samma vante som på svenska men med
en fisk, i två lager: FISH BACK under vanten och FISH FRONT överst i hela
filen; de läggs ihop till en bild. Minnesota och Arkansas finns i två
versioner (med och utan sodaburken, med och utan sågen); de översta, med,
används.

Varje bild skalas om på USA.psd:s rutnät (premultiplicerad Lanczos via
resize med box) och skärs ut med hörnet och storleken på hela tredjedels
PSD-pixlar, så att den hamnar på hela pixlar på spelets duk (USA.psd / 1,5).
Lösa prickar långt från teckningen tas bort: småbitar (under SMABIT px)
som ligger mer än MARGINAL px utanför det svenska lagret. Nevada hade
prickar i Kalifornien och South Dakota i Nebraska och Minnesota; Michigans
fiskfenor ute i Huronsjön är större och står kvar.

Resultatet: psd/engelska/<filnamn>.png och psd/engelska/lagen.json med
läget i USA.psd-pixlar (x, y, b, h) per delstat."""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from psd_tools import PSDImage
from scipy import ndimage

SMABIT = 300     # px i USA.psd-upplösning
MARGINAL = 20    # px utanför det svenska lagrets täckning

ROT = Path(__file__).resolve().parent.parent
UT = ROT / 'psd' / 'engelska'
SV_BREDD = 6000

# engelskt lager (sökväg i PSD:n, grupp/namn) -> svenskt delstatsnamn
LAGER = {
    'U V/Nevada': 'Nevada',
    'U V/Kansas': 'Kansas',
    'U V/North Dakota': 'North Dakota',
    'U V/South Dakota': 'South Dakota',
    'N V/Arizona': 'Arizona',
    'U H/Pennsylvania': 'Pennsylvania',
    'U H/Delaware': 'Delaware',
    'U H/Massachusetts': 'Massachusetts',
    'U H/Michigan': 'Michigan',
    'U H/Minnesota med soda': 'Minnesota',
    'U H/Arkansas': 'Arkansas',
    'Mississippi': 'Mississippi',
}
# lager som läggs ihop med delstaten: (lager, under eller över)
EXTRA = {'U H/Michigan': [('U H/FISH BACK', 'under'), ('FISH FRONT', 'over')]}


def lagerkarta(psd):
    ut = {}

    def gå(grupp, prefix=''):
        for lager in grupp:
            if lager.is_group():
                gå(lager, prefix + lager.name + '/')
            else:
                ut[prefix + lager.name] = lager
    gå(psd)
    return ut


def bild(lager):
    im = lager.topil()
    if im is None:
        raise SystemExit(f'tomt lager: {lager.name}')
    return im.convert('RGBA'), lager.bbox[:2]


def ihop(delar):
    """[(RGBA, (x, y))] i ritordning -> (RGBA, (x, y)) över deras union."""
    x0 = min(p[0] for _, p in delar)
    y0 = min(p[1] for _, p in delar)
    x1 = max(p[0] + im.width for im, p in delar)
    y1 = max(p[1] + im.height for im, p in delar)
    duk = Image.new('RGBA', (x1 - x0, y1 - y0), (0, 0, 0, 0))
    for im, p in delar:
        duk.alpha_composite(im, (p[0] - x0, p[1] - y0))
    return duk, (x0, y0)


def till_usa_psd(im, pos, s):
    """Skalar om ett lager till USA.psd:s rutnät, skuret på hela 3-pixlar."""
    ex0, ey0 = pos
    X0 = 3 * math.floor(ex0 * s / 3)
    Y0 = 3 * math.floor(ey0 * s / 3)
    X1 = 3 * math.ceil((ex0 + im.width) * s / 3)
    Y1 = 3 * math.ceil((ey0 + im.height) * s / 3)
    # marginal så att boxen alltid ligger inne i bilden
    M = 8
    pad = Image.new('RGBA', (im.width + 2 * M, im.height + 2 * M), (0, 0, 0, 0))
    pad.paste(im, (M, M))
    box = (X0 / s - ex0 + M, Y0 / s - ey0 + M, X1 / s - ex0 + M, Y1 / s - ey0 + M)
    ut = pad.convert('RGBa').resize((X1 - X0, Y1 - Y0), Image.LANCZOS, box=box)
    return ut.convert('RGBA'), (X0, Y0)


def stada(ut, pos, svlager):
    """Tar bort småbitar långt från det svenska lagret. Returnerar antal px."""
    a = np.asarray(ut).copy()
    sv = np.zeros(a.shape[:2], bool)
    sim = np.asarray(svlager.topil().convert('RGBA'))[..., 3] > 0
    sx, sy = svlager.bbox[0] - pos[0], svlager.bbox[1] - pos[1]
    ys, xs = np.nonzero(sim)
    ys, xs = ys + sy, xs + sx
    ok = (ys >= 0) & (ys < sv.shape[0]) & (xs >= 0) & (xs < sv.shape[1])
    sv[ys[ok], xs[ok]] = True
    nara = ndimage.binary_dilation(sv, iterations=MARGINAL)
    etik, n = ndimage.label(a[..., 3] > 0, structure=np.ones((3, 3)))
    bort = 0
    for i, sl in enumerate(ndimage.find_objects(etik), 1):
        bit = etik[sl] == i
        if bit.sum() < SMABIT and not (bit & nara[sl]).any():
            a[sl][..., 3][bit] = 0
            bort += int(bit.sum())
    return Image.fromarray(a), bort


def main():
    psd = PSDImage.open(sys.argv[1])
    s = SV_BREDD / psd.width
    karta = lagerkarta(psd)
    svenska = {lager.name: lager for lager in PSDImage.open(ROT / 'psd' / 'USA.psd')}
    config = json.loads((ROT / 'assets' / 'usa' / 'config.json').read_text())
    filnamn = {c['name']: c['filename'] for c in config['countries']}
    UT.mkdir(parents=True, exist_ok=True)
    lagen = {}
    for väg, stat in LAGER.items():
        delar = [bild(karta[väg])]
        for extra, var in EXTRA.get(väg, []):
            b = bild(karta[extra])
            delar = [b] + delar if var == 'under' else delar + [b]
        im, pos = ihop(delar) if len(delar) > 1 else delar[0]
        ut, (X0, Y0) = till_usa_psd(im, pos, s)
        ut, bort = stada(ut, (X0, Y0), svenska[stat])
        # skär om efter städningen, fortfarande på hela 3-pixlar
        bx0, by0, bx1, by1 = ut.getchannel('A').getbbox()
        bx0, by0 = 3 * (bx0 // 3), 3 * (by0 // 3)
        bx1 = min(ut.width, 3 * math.ceil(bx1 / 3))
        by1 = min(ut.height, 3 * math.ceil(by1 / 3))
        ut = ut.crop((bx0, by0, bx1, by1))
        X0, Y0 = X0 + bx0, Y0 + by0
        namn = filnamn[stat]
        ut.save(UT / f'{namn}.png', optimize=True)
        lagen[stat] = {'fil': f'{namn}.png', 'x': X0, 'y': Y0, 'b': ut.width, 'h': ut.height}
        print(f'{stat}: {ut.width}×{ut.height} vid {X0}, {Y0}' + (f', {bort} px lösa prickar bort' if bort else ''))
    (UT / 'lagen.json').write_text(json.dumps(lagen, ensure_ascii=False, indent=1) + '\n')


main()
