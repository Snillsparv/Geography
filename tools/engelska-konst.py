"""Den engelska USA-kartans 12 omritade delstater som spelbilder.

  python3 -I tools/engelska-konst.py [--blak <mapp>]

Läser psd/engelska/<fil>.png och lagen.json (utplockade ur Jonas engelska
PSD av tools/engelska-lager.py, i USA.psd-pixlar) och skriver

  - assets/usa/countries/<fil>-en.webp: PNG:n nerskalad 2/3 (4000/6000,
    som de svenska bilderna) med förmultiplicerad alfa, kvalitet 85
  - assets/usa/config.en.json: file/left/top/width/height för de 12 (duk-
    pixlar = USA.psd/1.5; lagren är utskurna på jämna 3 PSD-px så måtten
    blir hela pixlar), och "overlay": "overlay-en.webp". Övriga fält
    (namn, texter) lämnas orörda.
  - assets/usa/overlay-en.webp: originalkartans konturlinjer. Den svenska
    overlay.webp är 3861×2397 och börjar på duken vid 81,75, men spelet
    sträcker den över map.webp (3889×2495 vid 53,76), så linjerna hamnar
    upp till ~100 px fel längst ner. Här läggs den på kartans ram (förskjuten
    +28, −1). Linjerna under Michigans fiskhuvud och -stjärt (som Jonas
    ritat ovanpå allt, psd/engelska/michigan-fisk-front.png) suddas ut.

--blak <mapp> skriver också arizona-blak.png: Arizonas svarta bläck runt
ZONE A/B och pilarna, som vektoriseras för sig och läggs överst i SVG:n
(vektoriseringen tappar konturerna runt bokstäverna, som i den svenska).

SVG:erna (bakningen läser <fil>-en.svg bredvid webp:en), se tools/README.md.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROT = Path(__file__).resolve().parent.parent
KALLA = ROT / 'psd' / 'engelska'
UT = ROT / 'assets' / 'usa' / 'countries'
CONFIG = ROT / 'assets' / 'usa' / 'config.en.json'
SKALA = 1.5      # USA.psd (6000) → duken (4000)
KVALITET = 85


def nerskala(png, b, h):
    im = Image.open(png).convert('RGBA')
    # förmultiplicerad alfa: genomskinliga pixlars färg får inte blöda in
    return im.convert('RGBa').resize((b, h), Image.LANCZOS).convert('RGBA')


def arizona_blak(png, ut):
    from scipy import ndimage as ndi
    a = np.asarray(Image.open(png).convert('RGBA')).astype(int)
    rgb, al = a[..., :3], a[..., 3]
    mx, mn = rgb.max(2), rgb.min(2)
    blak = (al >= 128) & (mx < 40)
    # ljusgrå bokstäver och pilar på den mörka skylten (högra delen)
    ljus = (al >= 128) & (mn > 150) & (mx - mn < 25)
    omr = np.zeros_like(blak)
    omr[:, 450:] = True
    val = blak & omr & ndi.binary_dilation(ljus & omr, iterations=5)
    bild = np.zeros(al.shape + (4,), np.uint8)
    bild[val] = (11, 11, 11, 255)
    Image.fromarray(bild).save(ut)
    print(f'{ut}: {int(val.sum())} px bläck')


def overlay_en(cfg_sv, michigan):
    ov = Image.open(ROT / 'assets' / 'usa' / 'overlay.webp').convert('RGBA')
    mw, mh = cfg_sv['mapWidth'], cfg_sv['mapHeight']
    ml, mt = cfg_sv['mapOffset']['left'], cfg_sv['mapOffset']['top']
    OV_L, OV_T = 81, 75      # overlay.webp:s hörn på duken (mätt mot PSD:n)
    dx, dy = OV_L - ml, OV_T - mt
    ram = Image.new('RGBA', (mw, mh), (0, 0, 0, 0))
    ram.alpha_composite(ov, (max(dx, 0), max(dy, 0)), (max(-dx, 0), max(-dy, 0)))
    a = np.asarray(ram).copy()
    r = michigan
    fram = Image.open(KALLA / 'michigan-fisk-front.png').resize((r['width'], r['height']), Image.LANCZOS)
    fram = np.asarray(fram) >= 128
    x0, y0 = r['left'] - ml, r['top'] - mt
    under = a[y0:y0 + r['height'], x0:x0 + r['width'], 3]
    suddat = int((fram & (under > 0)).sum())
    under[fram] = 0
    Image.fromarray(a).save(ROT / 'assets' / 'usa' / 'overlay-en.webp', 'WEBP', quality=KVALITET)
    print(f'overlay-en.webp: {mw}×{mh}, {suddat} px kontur under fiskhuvudet/-stjärten bort')


def main():
    lagen = json.loads((KALLA / 'lagen.json').read_text(encoding='utf-8'))
    sv = json.loads((ROT / 'assets' / 'usa' / 'config.json').read_text(encoding='utf-8'))
    namn_till_fil = {c['name']: (c.get('filename') or c['file'].replace('countries/', '').replace('.webp', ''))
                     for c in sv['countries']}
    cfg = json.loads(CONFIG.read_text(encoding='utf-8'))
    per = {c['filename']: c for c in cfg['countries']}
    for stat, l in lagen.items():
        fil = namn_till_fil[stat]
        if any(v % 3 for v in (l['x'], l['y'], l['b'], l['h'])):
            sys.exit(f'{stat}: lagret ligger inte på jämna 3 PSD-px')
        r = {k: round(l[s] / SKALA) for k, s in
             (('left', 'x'), ('top', 'y'), ('width', 'b'), ('height', 'h'))}
        bild = nerskala(KALLA / l['fil'], r['width'], r['height'])
        bild.save(UT / f'{fil}-en.webp', 'WEBP', quality=KVALITET)
        c = per[fil]
        c['file'] = f'countries/{fil}-en.webp'
        c.update(r)
        print(f'{stat:14s} {r["left"]:5d} {r["top"]:5d} {r["width"]:4d}×{r["height"]:<4d} → {fil}-en.webp')
    cfg['overlay'] = 'overlay-en.webp'
    overlay_en(sv, per['michigan'])
    CONFIG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if '--blak' in sys.argv:
        mapp = Path(sys.argv[sys.argv.index('--blak') + 1])
        mapp.mkdir(parents=True, exist_ok=True)
        arizona_blak(KALLA / 'arizona.png', mapp / 'arizona-blak.png')


if __name__ == '__main__':
    main()
