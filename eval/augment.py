import io
import random

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter


def _perspective_coeffs(src, dst):
    rows = []
    for (x, y), (u, v) in zip(dst, src):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    a = np.array(rows, dtype=float)
    b = np.array(src, dtype=float).reshape(8)
    return np.linalg.solve(a, b).tolist()


def _background(rng: random.Random, size) -> Image.Image:
    w, h = size
    base = np.array([rng.randint(60, 230) for _ in range(3)], dtype=float)
    shade = np.linspace(rng.uniform(0.75, 1.0), rng.uniform(0.85, 1.15), h)[:, None, None]
    noise = np.random.default_rng(rng.randint(0, 2**31)).normal(0, 6, (h, w, 3))
    arr = np.clip(base[None, None, :] * shade + noise, 0, 255).astype(np.uint8)
    return Image.fromarray(arr, "RGB")


def phone_like(img: Image.Image, rng: random.Random) -> tuple[bytes, dict]:
    img = img.convert("RGB")
    img.thumbnail((900, 900))
    w, h = img.size
    p = {}

    pad = rng.uniform(0.06, 0.2)
    p["pad"] = round(pad, 3)
    cw, ch = int(w * (1 + 2 * pad)), int(h * (1 + 2 * pad))
    canvas = _background(rng, (cw, ch))
    ox, oy = (cw - w) // 2, (ch - h) // 2

    j = rng.uniform(0.0, 0.06)
    p["perspective"] = round(j, 3)
    corners = [(0, 0), (w, 0), (w, h), (0, h)]
    moved = [(x + rng.uniform(-j, j) * w, y + rng.uniform(-j, j) * h) for x, y in corners]
    shift = [(x + ox, y + oy) for x, y in moved]
    coeffs = _perspective_coeffs(corners, shift)
    warped = img.transform((cw, ch), Image.Transform.PERSPECTIVE, coeffs, Image.Resampling.BICUBIC)
    mask = Image.new("L", (w, h), 255).transform(
        (cw, ch), Image.Transform.PERSPECTIVE, coeffs, Image.Resampling.BICUBIC
    )
    canvas.paste(warped, (0, 0), mask)

    angle = rng.uniform(-12, 12)
    p["rotate"] = round(angle, 2)
    fill = tuple(int(c) for c in np.array(canvas).reshape(-1, 3).mean(0))
    canvas = canvas.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=fill)

    keep = rng.uniform(0.70, 0.95)
    p["crop_area"] = round(keep, 3)
    side = keep**0.5
    W, H = canvas.size
    nw, nh = int(W * side), int(H * side)
    x0, y0 = rng.randint(0, W - nw), rng.randint(0, H - nh)
    canvas = canvas.crop((x0, y0, x0 + nw, y0 + nh))

    b, c, s = rng.uniform(0.6, 1.35), rng.uniform(0.7, 1.3), rng.uniform(0.8, 1.2)
    p.update(brightness=round(b, 3), contrast=round(c, 3), saturation=round(s, 3))
    canvas = ImageEnhance.Brightness(canvas).enhance(b)
    canvas = ImageEnhance.Contrast(canvas).enhance(c)
    canvas = ImageEnhance.Color(canvas).enhance(s)

    blur = rng.uniform(0.0, 2.0) if rng.random() < 0.8 else 0.0
    p["blur"] = round(blur, 2)
    if blur > 0.05:
        canvas = canvas.filter(ImageFilter.GaussianBlur(blur))

    long_side = rng.randint(640, 1024)
    canvas.thumbnail((long_side, long_side))

    q = rng.randint(40, 70)
    p["jpeg_q"] = q
    return to_jpeg_bytes(canvas, q), p


def to_jpeg_bytes(img: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=quality)
    return buf.getvalue()


def client_compress(data: bytes, max_side: int = 768, quality: int = 80) -> bytes:
    """Giống web nén ảnh trước khi gửi: cạnh dài ≤ 768 px, JPEG q80, ≤ 4 MB."""
    img = Image.open(io.BytesIO(data))
    img = img.convert("RGB")
    img.thumbnail((max_side, max_side))
    out = to_jpeg_bytes(img, quality)
    while len(out) > 4 * 1024 * 1024 and quality > 40:
        quality -= 10
        out = to_jpeg_bytes(img, quality)
    return out
