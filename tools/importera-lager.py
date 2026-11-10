#!/usr/bin/env python3
"""Importera ett lager ur en regions PSD till spelets assets (klassiska vyn).

Configens positioner är lagrets ruta i PSD:n skalad till configens duk
(canvasHeight / PSD-höjd, t.ex. 4000/7680 för Sverige). Verktyget gör
exakt den skalningen, så ett nytt landskap ritat direkt i master-PSD:n
hamnar rätt utan handpassning:

  python3 tools/importera-lager.py sverige Åland \\
      --desc "Faktatext …" --minnesbild "Minnesregel …" --karta

  REGION     regionens slug (sverige, europa, …)
  LAGER      lagrets namn i PSD:n, t.ex. "Åland" (blir namnet i spelet)
  --desc     faktatexten i infokortet (krävs för ett NYTT lager)
  --minnesbild  minnesregeln (krävs för ett NYTT lager)
  --karta    skriv även om map.webp och overlay.webp ur lagren Karta och
             Overlay (behövs när landets silhuett/kontur lagts till där)
  --torr     visa vad som skulle hända utan att skriva något

Ett befintligt lager uppdateras på plats (position + bild); desc och
minnesregel behålls om de inte anges. Kör från reporoten.
"""
import argparse
import json
import sys
from pathlib import Path

import psd_tools
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from importlib import import_module
_ex = import_module('extract-psd')          # samma PSD-tabell och namnregel
PSDS, norm = _ex.PSDS, _ex.norm

WEBP_KVALITET = 90


def skala(img, w, h):
    return img.resize((max(1, w), max(1, h)), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('region')
    ap.add_argument('lager')
    ap.add_argument('--desc')
    ap.add_argument('--minnesbild')
    ap.add_argument('--karta', action='store_true')
    ap.add_argument('--torr', action='store_true')
    a = ap.parse_args()

    bas = Path('assets') / a.region
    cfg_fil = bas / 'config.json'
    cfg = json.loads(cfg_fil.read_text())
    psd = psd_tools.PSDImage.open(PSDS[a.region])
    # höjden är exakt (4000/7680); canvasWidth är själv avrundad (2083),
    # så skalan tas ur höjden — annars hamnar allt en pixel fel
    k = cfg['canvasHeight'] / psd.height
    if abs(cfg['canvasWidth'] / psd.width - k) > 0.002:
        sys.exit(f'Duken skalar olika i x och y ({k:.4f} / '
                 f'{cfg["canvasWidth"] / psd.width:.4f}) — avbryter')

    lagren = {l.name: l for l in psd}
    if a.lager not in lagren:
        sys.exit(f'Inget lager "{a.lager}" i {PSDS[a.region]}. Finns: '
                 + ', '.join(lagren))
    lager = lagren[a.lager]
    x0, y0, x1, y1 = lager.bbox
    filnamn = norm(a.lager)
    post = next((c for c in cfg['countries'] if c.get('filename') == filnamn), None)
    ny = post is None
    if ny and not (a.desc and a.minnesbild):
        sys.exit('Nytt lager: ange både --desc och --minnesbild')

    pos = {'left': round(x0 * k), 'top': round(y0 * k),
           'width': round((x1 - x0) * k), 'height': round((y1 - y0) * k)}
    print(f'{a.lager}: PSD-ruta {lager.bbox} → spelets duk {pos}'
          + (' (NYTT)' if ny else ' (uppdateras)'))

    if a.karta:
        kb = lagren['Karta'].bbox
        karta_pos = {'left': round(kb[0] * k), 'top': round(kb[1] * k)}
        karta_mått = (round((kb[2] - kb[0]) * k), round((kb[3] - kb[1]) * k))
        print(f'Karta/Overlay: ruta {kb} → offset {karta_pos}, storlek {karta_mått}')

    if a.torr:
        return

    bild = lager.composite()
    skala(bild, pos['width'], pos['height']).save(
        bas / 'countries' / f'{filnamn}.webp', quality=WEBP_KVALITET, method=6)

    if ny:
        post = {'name': a.lager, 'file': f'countries/{filnamn}.webp',
                'filename': filnamn}
        cfg['countries'].append(post)
    post.update(pos)
    if a.desc:
        post['desc'] = a.desc
    if a.minnesbild:
        post['imageAssociation'] = a.minnesbild

    if a.karta:
        for psd_namn, fil in (('Karta', 'map.webp'), ('Overlay', 'overlay.webp')):
            l = lagren[psd_namn]
            skala(l.composite(), *karta_mått).save(bas / fil, quality=WEBP_KVALITET, method=6)
        cfg['mapOffset'] = karta_pos
        cfg['mapWidth'], cfg['mapHeight'] = karta_mått

    cfg_fil.write_text(json.dumps(cfg, ensure_ascii=False, indent=2))
    print('Klart:', cfg_fil, '+', f'countries/{filnamn}.webp',
          '+ map.webp/overlay.webp' if a.karta else '')


if __name__ == '__main__':
    main()
