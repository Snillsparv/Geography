"""Förstorar en hårdkantad teckning N gånger med mjuka kanter men utan
mellanfärger, inför vektoriseringen: Lanczos ger den mjuka formen, och varje
pixel får sedan den av de fyra närmaste källpixlarnas färger som ligger
närmast (så att svart mot grått aldrig blir en lila eller grå fransrand).

  python3 tools/mjuka-kanter.py in.png ut.png 3

Hawaiis globbild (psd/omritade/hawaii-glob.png) är ritad utan
kantutjämning: vektoriserad i PSD-upplösning tappade den ögon och tänder,
och bara förstorad fick den trappsteg."""
import sys
from PIL import Image
import numpy as np
src, dst, N = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src).convert('RGBA')
S = np.asarray(im).astype(float)
H, W = S.shape[:2]
up = im.convert('RGBa').resize((W * N, H * N), Image.LANCZOS).convert('RGBA')
U = np.asarray(up).astype(float)
Y, X = np.mgrid[0:H * N, 0:W * N]
sx = (X + 0.5) / N - 0.5; sy = (Y + 0.5) / N - 0.5
fx = np.floor(sx).astype(int); fy = np.floor(sy).astype(int)
x0 = np.clip(fx, 0, W - 1); x1 = np.clip(fx + 1, 0, W - 1)
y0 = np.clip(fy, 0, H - 1); y1 = np.clip(fy + 1, 0, H - 1)
kand = np.stack([S[y0, x0], S[y0, x1], S[y1, x0], S[y1, x1]], axis=2)  # H W 4 4
opak = kand[..., 3] >= 128
d = ((kand[..., :3] - U[:, :, None, :3]) ** 2).sum(-1)
d = np.where(opak, d, np.inf)
val = d.argmin(-1)
farg = np.take_along_axis(kand, val[..., None, None].repeat(4, -1), axis=2)[:, :, 0]
alla_genom = ~opak.any(-1)
ut = np.zeros_like(U, dtype=np.uint8)
ut[..., :3] = farg[..., :3]
ut[..., 3] = np.where((U[..., 3] >= 128) & ~alla_genom, 255, 0)
Image.fromarray(ut).save(dst)
