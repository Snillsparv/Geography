"""Michigans engelska bild på globen: fisken syns där vanten hamnar i sjön.

  python3 -I tools/fisk-glob.py [--land-krymp 2]

I Jonas teckning simmar fisken genom vanten: FISH BACK ligger under vanten
och FISH FRONT (huvudet, stjärtspetsen) överst. På globen ligger sjölagret
ovanpå konsten, och vanten är större än Michigans riktiga mark: där vanten
täcker fisken ute i Michigan- och Huronsjön (under hakan, vid Saginawbukten)
syntes bara sjön, och fisken såg söndertuggad ut. Fisken ska synas även där
den inte är en del av landskapet, så här vänds ordningen där vanten inte
syns på globen: fiskens bakre halva läggs ovanpå vanten utanför nedre
halvön (Michigans största yta i assets/usa-en-regions.json, genom
bakningens varpnät), och där är bilden exakt psd/engelska/michigan.png.

Läser psd/engelska/michigan-delar/{bak,vante,fram}.png (engelska-lager.py)
och skriver:
  psd/engelska/michigan-glob.png    globens bild (spelbilden och kortet är
                                    fortfarande michigan.png)
  psd/engelska/michigan-fisk.png    det som syns av fisken på globen (alfa):
                                    främre halvan, plus den bakre utom där
                                    vanten ligger på nedre halvön
  assets/usa/countries/michigan-en.svg  vektoriserad ur michigan-glob.png

Marken krymps LAND_KRYMP PSD-px, så att fisken går en bit in över stranden
och täcker kustbandet: annars blev det en tunn rand sjö mellan fisken och
vanten. Mark som teckningen inte når, där närmaste färg är fiskens, får
vantens röda under teckningen (bakningen fyllde den annars med en platt
ljusblå fläck bredvid fiskhuvudet). Därefter make-fisk-geojson.mjs (konturen) och en engelsk bakning,
se tools/README.md."""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import shapely
from PIL import Image
from scipy import ndimage
from shapely.geometry import shape

ROT = Path(__file__).resolve().parent.parent
KEY = 'usa/michigan'
KALLA = ROT / 'psd' / 'engelska'
DELAR = KALLA / 'michigan-delar'
BILD = KALLA / 'michigan.png'
GLOB = KALLA / 'michigan-glob.png'
FISK = KALLA / 'michigan-fisk.png'
SVG = ROT / 'assets' / 'usa' / 'countries' / 'michigan-en.svg'
REGIONER = ROT / 'assets' / 'usa-en-regions.json'
KONFIG = ROT / 'assets' / 'usa' / 'config.en.json'
MORK = 60 / 255   # mörkare än så (största kanalen) är kontur, som i make-usa-utstickare.mjs
NARA = 0.2        # grader runt Michigans yta där marken intill fisken målas röd

argv = sys.argv[1:]
LAND_KRYMP = float(argv[argv.index('--land-krymp') + 1]) if '--land-krymp' in argv else 2.0


def las(p):
    im = Image.open(p)
    if im.mode != 'RGBA':
        raise SystemExit(f'{p}: {im.mode}, väntade RGBA')
    return np.asarray(im).astype(np.float64) / 255


def premult(a):
    return np.concatenate([a[..., :3] * a[..., 3:], a[..., 3:]], axis=-1)


def over(a, b):
    """a över b, båda premultiplicerade."""
    return a + b * (1 - a[..., 3:])


def varpnat():
    """Michigans varpnät (dukpx → enhetsmercator), ur bakningens egen kod."""
    with tempfile.TemporaryDirectory() as tmp:
        fil = Path(tmp) / 'varpnat.json'
        subprocess.run(['node', str(ROT / 'tools' / 'make-tiles.mjs'), '--dataset', 'usa', '--lang', 'en',
                        '--varpnat', str(fil)], check=True, stdout=subprocess.DEVNULL)
        regioner = json.loads(fil.read_text())
    r = next(x for x in regioner if any(c['key'] == KEY for c in x['countries']))
    return r['grid'], next(c for c in r['countries'] if c['key'] == KEY)


def varpa(g, duk, W, H, px, py):
    """PSD-px (bildens rutnät) → lng/lat, samma bilinjära varp som make-fisk-geojson.mjs."""
    x = duk['left'] + px * duk['width'] / W
    y = duk['top'] + py * duk['height'] / H
    fx, fy = (x - g['x0']) / g['step'], (y - g['y0']) / g['step']
    gx = np.clip(np.floor(fx), 0, g['nx'] - 1).astype(int)
    gy = np.clip(np.floor(fy), 0, g['ny'] - 1).astype(int)
    u, v = fx - gx, fy - gy
    U = np.asarray(g['u']).reshape(g['ny'] + 1, g['nx'] + 1, 2)
    A, B, D, C = U[gy, gx], U[gy, gx + 1], U[gy + 1, gx], U[gy + 1, gx + 1]
    w = [((1 - u) * (1 - v))[..., None], (u * (1 - v))[..., None], ((1 - u) * v)[..., None], (u * v)[..., None]]
    m = A * w[0] + B * w[1] + D * w[2] + C * w[3]
    lng = (m[..., 0] - 0.5) * 360
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * m[..., 1]))))
    return lng, lat


def main():
    bild = las(BILD)
    bak, vante, fram = (las(DELAR / f'{n}.png') for n in ('bak', 'vante', 'fram'))
    H, W = bild.shape[:2]
    for n, d in (('bak', bak), ('vante', vante), ('fram', fram)):
        if d.shape != bild.shape:
            raise SystemExit(f'{n}.png {d.shape[1]}×{d.shape[0]}, michigan.png {W}×{H} (kör engelska-lager.py)')

    g, duk = varpnat()
    konf = json.loads(KONFIG.read_text())
    ov = next(c for c in konf['countries'] if c['filename'] == KEY.split('/')[1])
    if any(duk[k] != ov[k] for k in ('left', 'top', 'width', 'height')):
        raise SystemExit('bakningens placering av Michigan är inte config.en.json:s')

    # vanten är nedre halvön: delstatens största yta på globen (utan
    # kustband och grannbitar). Där vanten hamnar på övre halvön eller öarna
    # vid Mackinacsundet skar den annars röda kilar i fisken
    reg = next(f for f in json.loads(REGIONER.read_text())['features']
               if f['properties'].get('key') == KEY and 'kant' not in f['properties'])
    mark = max(getattr(shape(reg['geometry']), 'geoms', [shape(reg['geometry'])]), key=lambda p: p.area)
    shapely.prepare(mark)

    # bara där fiskens bakre halva och vanten möts (plus marginal) spelar
    # marken någon roll
    beror = ndimage.binary_dilation((bak[..., 3] > 0) & (vante[..., 3] > 0), iterations=int(LAND_KRYMP) + 2)
    ys, xs = np.nonzero(beror)
    lng, lat = varpa(g, duk, W, H, xs + 0.5, ys + 0.5)
    land = np.ones((H, W), bool)   # utanför beror-zonen: som michigan.png
    land[ys, xs] = shapely.contains_xy(mark, lng, lat)
    if LAND_KRYMP > 0:
        r = int(np.ceil(LAND_KRYMP))
        yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
        land = ndimage.binary_erosion(land, structure=(xx ** 2 + yy ** 2 <= LAND_KRYMP ** 2 + 1e-9),
                                      border_value=1)
    L = land[..., None].astype(np.float64)

    # globens bild: på land teckningen som den är, utanför ligger fiskens
    # bakre halva ovanpå vanten (främre halvan överst som vanligt)
    vand = over(premult(fram), over(premult(bak), premult(vante)))
    ut = premult(bild) * L + vand * (1 - L)
    ut[bild[..., 3] == 0] = 0          # lösa prickar som engelska-lager.py städat bort

    # mark som teckningen inte når fyller bakningen med närmaste färg inne i
    # teckningen. Väster om fiskhuvudet (övre halvön vid Gardenhalvön) blev
    # det en platt ljusblå fläck utan kontur som såg ut som en trasig
    # fiskbit: där närmaste färg är fiskens målas vantens röda under
    # teckningen i stället.
    #
    # Synlig mark: allt som varken är sjö eller havsmask (Kanada ligger under
    # masken), nära Michigan. Delstatsytan är förenklad och saknar t.ex.
    # Gardenhalvön, där fläcken låg
    feats = json.loads(REGIONER.read_text())['features']
    vatten = shapely.union_all([shape(f['geometry']) for f in feats
                                if f['properties'].get('sjo') or f['properties'].get('mask')])
    nara = shape(reg['geometry']).buffer(NARA)
    shapely.prepare(vatten)
    shapely.prepare(nara)
    yy, xx = np.mgrid[0:H, 0:W]
    plng, plat = varpa(g, duk, W, H, xx + 0.5, yy + 0.5)
    pa_mark = shapely.contains_xy(nara, plng, plat) & ~shapely.contains_xy(vatten, plng, plat)
    inne = (ut[..., 3] > 0.5) & (ut[..., :3].max(axis=-1) / np.maximum(ut[..., 3], 1e-12) > MORK)
    fisken = (fram[..., 3] > 0.5) | ((bak[..., 3] > 0.5) & ~(land & (vante[..., 3] > 0.5)))
    _, (iy, ix) = ndimage.distance_transform_edt(~inne, return_indices=True)
    tom = pa_mark & (ut[..., 3] < 0.5) & fisken[iy, ix]
    tom = ndimage.binary_dilation(tom, iterations=1) & pa_mark & (ut[..., 3] < 1)
    vrod = vante[(vante[..., 3] > 0.99) & (vante[..., 0] - vante[..., 1] > 0.3)][:, :3]
    rod = np.median(vrod, axis=0)
    under = np.zeros_like(ut)
    under[tom] = np.append(rod, 1.0)
    ut = over(ut, under)
    print(f'{int(tom.sum())} px mark intill fisken får vantens röda '
          f'({", ".join(str(round(v * 255)) for v in rod)}) under teckningen')
    a = ut[..., 3:]
    rgb = np.where(a > 0, ut[..., :3] / np.maximum(a, 1e-12), 0)
    Image.fromarray(np.round(np.concatenate([rgb, a], axis=-1) * 255).astype(np.uint8), 'RGBA').save(GLOB, optimize=True)

    fisk = np.maximum(fram[..., 3], bak[..., 3] * (1 - vante[..., 3] * land))
    fisk[bild[..., 3] == 0] = 0
    Image.fromarray(np.round(fisk * 255).astype(np.uint8), 'L').save(FISK, optimize=True)
    flytt = int(((bak[..., 3] > 0.5) & (vante[..., 3] > 0.5) & ~land).sum())
    print(f'{GLOB.relative_to(ROT)}: fiskens bakre halva ovanpå vanten på {flytt} px utanför nedre halvön '
          f'(marken krympt {LAND_KRYMP:g} px)')
    print(f'{FISK.relative_to(ROT)}: {int((fisk > 0.5).sum())} px fisk')

    # vektorisera som de andra engelska bilderna (tools/vectorize.mjs)
    with tempfile.TemporaryDirectory() as tmp:
        kopia = Path(tmp) / 'michigan-en.png'
        shutil.copyfile(GLOB, kopia)
        subprocess.run(['node', str(ROT / 'tools' / 'vectorize.mjs'), tmp, '--force'], check=True,
                       stdout=subprocess.DEVNULL)
        shutil.copyfile(Path(tmp) / 'michigan-en.svg', SVG)
    print(f'{SVG.relative_to(ROT)}: vektoriserad ur {GLOB.name}')


if __name__ == '__main__':
    main()
