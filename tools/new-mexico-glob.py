"""New Mexicos globbild: flaggans gröna fält förlängs 40 px nedåt.

Teckningens gröna fält slutade ~30 px ovanför den riktiga gränsen mot
Mexiko (bootheel, se psd/delstatsmallar/11-new_mexico-*.png). Kolumnerna
från flaggstångens högerkant till linjen mellan grönt och vitt får 40 px
rent grönt infogat strax ovanför flaggans nederkant, så kanten och
konturen hamnar strax utanför gränsen (bakningen klipper där och spelets
kantband ritar gränsen); kilen mot den lutande stången fylls ut.
Stången och handen rörs inte.

  python3 tools/new-mexico-glob.py <New Mexico-lagret ur USA.psd>.png ut.png 1.5

Skalan (1.5) är USA.psd mot config-duken. Resultatet ligger i
psd/omritade/new_mexico-glob.png; SVG:n görs med tools/vectorize.mjs och
webp:en är PNG:n nerskalad 2/3, som för New York.
"""
import sys, bisect
from PIL import Image
import numpy as np
src, dst = sys.argv[1], sys.argv[2]
k = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
w = np.asarray(Image.open(src).convert('RGBA')).copy()
H, W = w.shape[:2]
D, X0, X1 = round(40 * k), round(74 * k), round(202 * k)
out = np.zeros((H + D, W, 4), dtype=np.uint8)
out[:H] = w
svart = lambda p: p[3] > 128 and max(p[:3]) < 80
gron = lambda p: p[3] > 200 and p[1] > 80 and p[0] < 40
yins = {}
for x in range(X0, X1 + 1):
    seen = False; hit = None
    for y in range(round(486 * k), H):
        p = w[y, x]
        if gron(p): seen = True
        elif seen and svart(p): hit = y; break
    yins[x] = hit
xs = [x for x in yins if yins[x] is not None]
for x in range(X0, X1 + 1):
    if yins[x] is None:
        i = bisect.bisect_left(xs, x)
        a = xs[max(0, i - 1)]; b = xs[min(len(xs) - 1, i)]
        yins[x] = yins[a] if a == b else round(yins[a] + (yins[b] - yins[a]) * (x - a) / (b - a))
# flaggans gröna (vanligaste gröna pixeln i fältet) — de infogade raderna
# får den rena färgen i stället för radens brus, så vektoriseringen inte
# ritar strimmor
falt = w[round(300 * k):round(480 * k), round(90 * k):round(190 * k)].reshape(-1, 4)
falt = falt[(falt[:, 3] > 200) & (falt[:, 1] > 80) & (falt[:, 0] < 40)]
vals, cnt = np.unique(falt, axis=0, return_counts=True)
ren = vals[cnt.argmax()]
for x in range(X0, X1 + 1):
    yi = yins[x] - 2
    col = w[:, x]
    p = col[yi - 1]
    out[yi:yi + D, x] = ren if gron(p) else p
    out[yi + D:H + D, x] = col[yi:H]
# stångens högerkant lutar inåt nedåt: kilen mellan den och det förlängda
# fältets vänsterkant fylls rad för rad med fältets kantpixel (grönt, och
# den svarta nederkanten), så att flaggans nedre kontur möter stången
for y in range(H + D):
    v = out[y, X0]
    if v[3] < 128:
        continue
    x = X0 - 1
    while x >= 0 and out[y, x, 3] < 128:
        x -= 1
    if X0 - x > 25 * k:           # under stångens fot: ingen kil
        continue
    out[y, x + 1:X0] = v
Image.fromarray(out).save(dst)
print(out.shape, 'yins', yins[X0], yins[(X0 + X1) // 2], yins[X1])
