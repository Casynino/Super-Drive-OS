"""Builds the owner home banner picture from the shop's real product photos.

Cuts each product out (masks from mask.swift, the carton removed where the product stands on one), stands the
products in a row on one ground line with soft contact shadows and a soft light behind them, and fades the left
edge to transparent so the greeting stays readable. The result is a transparent WebP, so it sits on the banner's
own gradient in both the dark and the light theme.

usage: python3 banner.py <photos dir> <masks dir> <output.webp>
"""
import importlib.util
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("compose", os.path.join(HERE, "compose.py"))
compose = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compose)

W, H = 1700, 470
GROUND = 410
# left to right: photo, standing height in the banner, on a carton in the photo?
ROW = [
    ("935", 360, True),   # Total Rubia 15W-40 5L
    ("934", 385, False),  # Castrol GTX 20W-50 5L
    ("932", 340, False),  # Toyota TC CVT 4L
    ("928", 345, False),  # Nissan Motor Oil 5W-30 4L
    ("931", 345, False),  # Toyota ATF T-IV 4L
]


def cut(photos: str, masks: str, key: str, on_carton: bool) -> Image.Image:
    im = ImageOps.exif_transpose(Image.open(os.path.join(photos, key + ".JPG"))).convert("RGB")
    m = Image.open(os.path.join(masks, key + "_inst1.png")).convert("L").resize(im.size)
    if on_carton:
        m = compose.cut_off_carton(m, extra=compose.CARTON_EXTRA.get(key, 18))
    m = compose.tidy_mask(m)
    rgba = im.copy()
    rgba.putalpha(m)
    rgba = rgba.crop(m.point(lambda v: 255 if v > 40 else 0).getbbox())
    if on_carton:
        # trim the last pixels at the base and the thin slivers of carton that can survive beside it
        a = rgba.getchannel("A").filter(ImageFilter.MinFilter(9)).filter(ImageFilter.GaussianBlur(1.2))
        rgba = rgba.crop((0, 0, rgba.width, rgba.height - 12))
        a = a.crop((0, 0, a.width, a.height - 12))
        rgba.putalpha(a)
    # a little punch so the labels read well on a dark banner
    rgb = ImageEnhance.Contrast(rgba.convert("RGB")).enhance(1.08)
    rgb = ImageEnhance.Color(rgb).enhance(1.08)
    out = rgb.convert("RGBA")
    out.putalpha(rgba.getchannel("A"))
    return out


def main(photos: str, masks: str, out: str) -> None:
    items = []
    for key, height, on_carton in ROW:
        p = cut(photos, masks, key, on_carton)
        s = height / p.height
        items.append(p.resize((round(p.width * s), round(p.height * s)), Image.LANCZOS))
    overlap = -0.06  # a small gap between products
    total = sum(p.width for p in items) - sum(int(p.width * overlap) for p in items[1:])
    x = W - 60 - total

    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    # warm glow behind the row, in the brand's oil yellow
    glow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(glow).ellipse([x + total * 0.05, 90, x + total * 0.95, H + 80], fill=80)
    glow = glow.filter(ImageFilter.GaussianBlur(100))
    canvas.alpha_composite(Image.merge("RGBA", (*Image.new("RGB", (W, H), (150, 190, 255)).split(), glow)))

    # shadows first (one soft pool under the whole row, one tight shadow under each product), then the products
    shadow = Image.new("L", (W, H), 0)
    sd = ImageDraw.Draw(shadow)
    sd.ellipse([x - 30, GROUND - 18, x + total + 30, GROUND + 34], fill=140)
    cx = x
    pos = []
    for p in items:
        pos.append(cx)
        sd.ellipse([cx + p.width * 0.04, GROUND - 14, cx + p.width * 0.96, GROUND + 22], fill=190)
        cx += p.width - int(p.width * overlap)
    shadow = shadow.filter(ImageFilter.GaussianBlur(16))
    canvas.alpha_composite(Image.merge("RGBA", (*Image.new("RGB", (W, H), (3, 8, 18)).split(), shadow)))
    for p, px in zip(items, pos):
        canvas.alpha_composite(p, (px, GROUND - p.height))

    # fade the left edge out so the text on the banner stays clean
    fade = Image.new("L", (W, H), 255)
    fd = ImageDraw.Draw(fade)
    start, end = int(W * 0.06), int(W * 0.30)
    for i in range(W):
        v = 0 if i < start else 255 if i > end else int(255 * (i - start) / (end - start))
        fd.line([(i, 0), (i, H)], fill=v)
    canvas.putalpha(ImageChops.multiply(canvas.getchannel("A"), fade))
    canvas.save(out, "WEBP", quality=88, method=6)
    print("saved", out, canvas.size, round(os.path.getsize(out) / 1024), "KB")


if __name__ == "__main__":
    main(*sys.argv[1:4])
