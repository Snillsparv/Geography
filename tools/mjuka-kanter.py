"""Förstorar en hårdkantad teckning N gånger med mjuka kanter men utan
mellanfärger, inför vektoriseringen. Vektoriserade i PSD-upplösning tappade
Jonas omritningar ögon, tänder och askprickar, och bara förstorade fick de
trappsteg.

  python3 tools/mjuka-kanter.py in.png ut.png 3               (Hawaii)
  python3 tools/mjuka-kanter.py in.png ut.png 3 --sudda 0.5   (Alaska)

Utan --sudda: Lanczos ger den mjuka formen, och varje pixel får sedan den
av de fyra närmaste källpixlarnas färger som ligger närmast (så att svart
mot grått aldrig blir en lila fransrand).

Med --sudda S: teckningens enkla kantutjämning (en rad pixlar i en
mellanfärg mellan svart och fyllningen) blev med sättet ovan en grå kontur
runt allt svart när kartan zoomas in, och kanterna fick trappsteg. Här är
varje riktig färg (en färg som bildar minst tio 3×3-block) och det
genomskinliga en andelskarta. Kantpixlar i andra färger delas mellan de två
grannfärger vars blandning bäst förklarar dem. Kartorna förstoras bikubiskt
och mjukas med en Gauss på S källpixlar, och varje utpixel får färgen med
störst andel. En rad på en pixel i en riktig färg (Alaskas mörkgrå kant runt
håret och ögonbrynen, samma grå som kavajen) försvinner då också, liksom
mellanrum på en pixel mellan två svarta prickar; större former mjukas
bara. Hawaiis högra pupill smälte då ihop med ögats kontur, så Hawaii görs
utan --sudda.

I båda lägena görs först halvgenomskinliga pixlar INNE i teckningen opaka
med sin egen färg: de som inte hänger ihop (4-grannar) med det genomskinliga
runt teckningen. Alaskas omritning hade 1 831 sådana runt grå prickar och
fläckar, mest i pannhandtaget och längs sydkusten (Kenai, Prince William
Sound), några på Kodiak och Alaskahalvön; de blev hål i SVG:n, och bakningens
utfyllnad fyllde hålen med vita och ljusgrå fläckar. Helt genomskinliga
hål lämnas här (deras färg betyder inget). Med --sudda får dessutom varje
genomskinlig ficka i resultatet som inte når bildkanten grannens färg."""
import sys
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

arg = [a for a in sys.argv[1:]]
SUDDA = None
MIN_BLOCK = 10   # 3×3-block en riktig färg måste bilda (--sudda)
if '--sudda' in arg:
    i = arg.index('--sudda'); SUDDA = float(arg[i + 1]); del arg[i:i + 2]
src, dst, N = arg[0], arg[1], int(arg[2])
im = Image.open(src).convert('RGBA')
H, W = im.height, im.width


def innesluten(mask):
    """De pixlar i mask som inte hänger ihop (4-grannar) med bildkanten."""
    m = np.pad(mask, 1, constant_values=True).astype(np.uint8) * 255
    # copy(): fromarray delar en skrivskyddad buffert, och floodfill skrev
    # då ingenting
    m = Image.fromarray(m).copy()
    ImageDraw.floodfill(m, (0, 0), 128)
    return np.asarray(m)[1:-1, 1:-1] == 255


def skifta(x, dy, dx, fyll):
    """x flyttad (dy, dx) steg utan omslag; det tomma fylls med fyll."""
    ut = np.full_like(x, fyll)
    h, w = x.shape
    ut[max(dy, 0):h + min(dy, 0), max(dx, 0):w + min(dx, 0)] = \
        x[max(-dy, 0):h + min(-dy, 0), max(-dx, 0):w + min(-dx, 0)]
    return ut


def tata_inre(im):
    a = np.asarray(im).copy()
    inre = innesluten(a[..., 3] < 255) & (a[..., 3] > 0)
    a[inre, 3] = 255
    return Image.fromarray(a), int(inre.sum())


im, n_inre = tata_inre(im)
if n_inre:
    print(f'{n_inre} halvgenomskinliga pixlar inne i teckningen gjorda opaka')


def lanczos_snapp():
    S = np.asarray(im).astype(float)
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
    return ut


def etiketter(sig):
    S = np.asarray(im).astype(np.int64)
    alfa = S[..., 3] / 255.0
    nyckel = (S[..., 0] << 16) | (S[..., 1] << 8) | S[..., 2]
    opak = S[..., 3] >= 128
    nk = np.where(opak, nyckel, -1)
    pad = np.pad(nk, 1, constant_values=-2)
    inre = np.ones((H, W), bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            inre &= pad[1 + dy:1 + dy + H, 1 + dx:1 + dx + W] == nk
    # minst MIN_BLOCK block: Alaskas opakgjorda pixlar bildar fem enstaka
    # block i nästan svart, (15,0,15) och (6,0,4) (pannhandtaget, Kenai,
    # Alaskahalvön, vid armen), som inte är teckningens färger
    riktiga, antal = np.unique(nk[inre & opak], return_counts=True)
    riktiga = riktiga[antal >= MIN_BLOCK]
    R = len(riktiga)
    farg = np.array([[(k >> 16) & 255, (k >> 8) & 255, k & 255] for k in riktiga], float)
    klass = np.full((H, W), -1)
    for i, k in enumerate(riktiga):
        klass[nyckel == k] = i
    A = np.zeros((R + 1, H, W), np.float32)   # sista kartan = genomskinligt
    A[R] = 1 - alfa
    m = klass >= 0
    yy, xx = np.nonzero(m)
    A[klass[m], yy, xx] = alfa[m]
    ys, xs = np.nonzero(~m & (S[..., 3] > 0))
    riktig_pix = m & opak
    for y, x in zip(ys, xs):
        g = sorted({int(klass[y + dy, x + dx]) for dy in (-2, -1, 0, 1, 2) for dx in (-2, -1, 0, 1, 2)
                    if 0 <= y + dy < H and 0 <= x + dx < W and riktig_pix[y + dy, x + dx]})
        c = S[y, x, :3].astype(float)
        if not g:
            i = int(((farg - c) ** 2).sum(1).argmin()); A[i, y, x] = alfa[y, x]; continue
        bast = None
        for a in g:
            for b in g:
                ab = farg[b] - farg[a]
                t = 0.0 if a == b else float(np.clip(np.dot(c - farg[a], ab) / max(np.dot(ab, ab), 1e-9), 0, 1))
                fel = ((farg[a] + t * ab - c) ** 2).sum()
                if bast is None or fel < bast[0]:
                    bast = (fel, a, b, t)
        _, a, b, t = bast
        A[a, y, x] += alfa[y, x] * (1 - t)
        A[b, y, x] += alfa[y, x] * t
    print(f'{R} riktiga färger, {len(ys)} kantpixlar delade')
    basta = val = None
    for i in range(R + 1):
        k = Image.fromarray(np.clip(A[i] * 255 + 0.5, 0, 255).astype(np.uint8), 'L')
        k = k.resize((W * N, H * N), Image.BICUBIC)
        if sig > 0:
            k = k.filter(ImageFilter.GaussianBlur(sig * N))
        v = np.asarray(k).astype(np.int16)
        if basta is None:
            basta = v.copy(); val = np.zeros(v.shape, np.int16)
        else:
            b = v > basta
            basta[b] = v[b]; val[b] = i
    # genomskinliga fickor som inte når bildkanten får grannens färg.
    # Utjämningen stänger ibland en vik med halvgenomskinliga pixlar vid en
    # ökant (Alaskahalvön), och bakningens utfyllnad fyllde fickan ljusgrå
    hal = innesluten(val == R)
    if hal.any():
        print(f'{int(hal.sum())} px genomskinliga fickor fyllda med grannfärg')
    while hal.any():
        fore = int(hal.sum())
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            g = skifta(val, dy, dx, R)
            ta = hal & ~skifta(hal, dy, dx, True) & (g != R)
            val[ta] = g[ta]
            hal &= ~ta
        if int(hal.sum()) == fore:
            break
    ut = np.zeros((H * N, W * N, 4), np.uint8)
    gen = val == R
    ut[..., :3] = farg[np.minimum(val, R - 1)].astype(np.uint8)
    ut[..., 3] = np.where(gen, 0, 255)
    ut[gen, :3] = 0
    return ut


Image.fromarray(lanczos_snapp() if SUDDA is None else etiketter(SUDDA)).save(dst)
