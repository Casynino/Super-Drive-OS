"""Turns the real shop photos into clean POS pictures.

For each photo: cut the product out (mask from mask.swift), remove the carton it is standing on when
there is one, and place it on a soft studio background with a contact shadow. Also draws two clean
illustrated stand-ins for products that have no photo yet.

usage: python3 compose.py <photos dir> <masks dir> <output dir>
"""
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

SIZE = 1000

# photo -> (sku, standing on a carton?)
PHOTOS = {
    "923": ("TOT-20W50-5L", True),
    "935": ("TOT-15W40-5L", True),
    "933": ("TOT-20W50-1L", True),
    "934": ("CAS-20W50-5L", False),
    "936": ("CAS-15W40-5L", True),
    "932": ("TOY-TCCVT-4L", False),
    "931": ("TOY-T4-4L", False),
    "929": ("NIS-NS2-4L", False),
    "928": ("NIS-5W30NS-4L", False),
}
# how many pixels below the detected carton edge to cut (the bottle base sits a little lower)
CARTON_EXTRA = {"933": 48, "923": 34, "936": 38, "935": 22}
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
FONT = "/System/Library/Fonts/Supplemental/Arial.ttf"


def studio_background() -> Image.Image:
    bg = Image.new("RGB", (SIZE, SIZE), "#ffffff")
    px = bg.load()
    for y in range(SIZE):
        t = y / (SIZE - 1)
        c = (int(255 - 20 * t), int(255 - 14 * t), int(255 - 8 * t))  # white fading to a soft cool grey
        for x in range(SIZE):
            px[x, y] = c
    glow = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(glow).ellipse([100, 80, 900, 760], fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    return Image.composite(Image.new("RGB", (SIZE, SIZE), "#ffffff"), bg, glow)


def cut_off_carton(mask: Image.Image, extra: int = 0) -> Image.Image:
    """Keeps only the product standing on a carton: finds the row where the outline suddenly widens
    (the top of the carton) and removes everything below it. `extra` moves the cut lower (pixels)."""
    m = mask.point(lambda v: 255 if v > 128 else 0)
    x0, y0, x1, y1 = m.getbbox()
    widths = []
    for y in range(y0, y1):
        row = m.crop((0, y, m.width, y + 1)).getbbox()
        widths.append((row[2] - row[0]) if row else 0)
    k = 5
    smooth = [sum(widths[max(i - k, 0): i + k + 1]) / len(widths[max(i - k, 0): i + k + 1]) for i in range(len(widths))]
    win = 40
    start = int(len(widths) * 0.08)
    jump = max(range(start, len(widths) - win), key=lambda i: smooth[i + win] - smooth[i])
    out = mask.copy()
    d = ImageDraw.Draw(out)
    d.rectangle([0, y0 + jump + extra, mask.width, mask.height], fill=0)
    # The bottle is never wider than its body: drop any carton edge sticking out beside the base.
    body = m.crop((0, y0 + int(jump * 0.25), m.width, y0 + int(jump * 0.75))).getbbox()
    if body:
        pad = 6
        d.rectangle([0, 0, body[0] - pad, mask.height], fill=0)
        d.rectangle([body[2] + pad, 0, mask.width, mask.height], fill=0)
    return out


def tidy_mask(mask: Image.Image) -> Image.Image:
    m = mask.point(lambda v: 255 if v > 128 else 0)
    m = m.filter(ImageFilter.MinFilter(5))  # eat the 2 px halo of old background
    return m.filter(ImageFilter.GaussianBlur(1.4))


def place(product: Image.Image, max_w=720, max_h=800, base_y=905) -> Image.Image:
    """product: RGBA cropped to its outline."""
    bg = studio_background()
    scale = min(max_w / product.width, max_h / product.height)
    p = product.resize((round(product.width * scale), round(product.height * scale)), Image.LANCZOS)
    x = (SIZE - p.width) // 2
    y = base_y - p.height
    # contact shadow: a flat blurred ellipse under the base plus a softer wide one
    shadow = Image.new("L", (SIZE, SIZE), 0)
    d = ImageDraw.Draw(shadow)
    w = p.width
    d.ellipse([SIZE // 2 - w * 0.46, base_y - 16, SIZE // 2 + w * 0.46, base_y + 22], fill=150)
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    wide = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(wide).ellipse([SIZE // 2 - w * 0.6, base_y - 6, SIZE // 2 + w * 0.6, base_y + 46], fill=60)
    wide = wide.filter(ImageFilter.GaussianBlur(30))
    shade = ImageChops.add(shadow, wide)
    bg = Image.composite(Image.new("RGB", (SIZE, SIZE), "#2b3445"), bg, shade.point(lambda v: min(v, 140)))
    bg.paste(p, (x, y), p)
    return bg


def finish(img: Image.Image) -> Image.Image:
    img = ImageEnhance.Contrast(img).enhance(1.05)
    img = ImageEnhance.Color(img).enhance(1.06)
    return img.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=3))


def from_photo(photos: str, masks: str, key: str, on_carton: bool) -> Image.Image:
    im = ImageOps.exif_transpose(Image.open(os.path.join(photos, key + ".JPG"))).convert("RGB")
    m = Image.open(os.path.join(masks, key + "_inst1.png")).convert("L").resize(im.size)
    if on_carton:
        m = cut_off_carton(m, extra=CARTON_EXTRA.get(key, 18))
    m = tidy_mask(m)
    rgba = im.copy()
    rgba.putalpha(m)
    return place(rgba.crop(m.point(lambda v: 255 if v > 40 else 0).getbbox()))


# ───────── illustrated stand-ins (no photo available yet) ─────────

def _gradient_h(w, h, left, right):
    g = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(g)
    for x in range(w):
        t = x / max(w - 1, 1)
        d.line([(x, 0), (x, h)], fill=tuple(int(left[i] + (right[i] - left[i]) * t) for i in range(3)))
    return g


def stand_in_bottle() -> Image.Image:
    """Total 15W-40 1L: a dark 1-litre bottle with a plain label."""
    S = 3
    w, h = 330 * S, 700 * S
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    body = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(body)
    d.rounded_rectangle([20 * S, 190 * S, 310 * S, 690 * S], radius=46 * S, fill=255)  # body
    d.polygon([(70 * S, 200 * S), (260 * S, 200 * S), (215 * S, 110 * S), (115 * S, 110 * S)], fill=255)  # shoulders
    d.rectangle([115 * S, 70 * S, 215 * S, 125 * S], fill=255)  # neck
    colour = _gradient_h(w, h, (74, 62, 56), (40, 33, 30))
    shine = Image.new("L", (w, h), 0)
    ImageDraw.Draw(shine).rounded_rectangle([48 * S, 230 * S, 78 * S, 650 * S], radius=14 * S, fill=70)
    colour = Image.composite(Image.new("RGB", (w, h), "#b9aaa0"), colour, shine.filter(ImageFilter.GaussianBlur(8 * S)))
    img.paste(colour, (0, 0), body)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([108 * S, 20 * S, 222 * S, 82 * S], radius=10 * S, fill="#1d1d21")  # cap
    for i in range(7):
        d.line([(120 * S + i * 14 * S, 26 * S), (120 * S + i * 14 * S, 76 * S)], fill="#2c2c32", width=2 * S)
    # label
    d.rounded_rectangle([46 * S, 300 * S, 284 * S, 600 * S], radius=26 * S, fill="#f5f1ea")
    d.rectangle([46 * S, 300 * S, 284 * S, 342 * S], fill="#c8102e")
    d.rectangle([46 * S, 342 * S, 284 * S, 350 * S], fill="#c9a24b")
    f1, f2, f3 = ImageFont.truetype(FONT_BOLD, 52 * S), ImageFont.truetype(FONT_BOLD, 70 * S), ImageFont.truetype(FONT, 28 * S)
    d.text((165 * S, 400 * S), "TOTAL", font=f1, fill="#1c2a4a", anchor="mm")
    d.text((165 * S, 482 * S), "15W-40", font=f2, fill="#c8102e", anchor="mm")
    d.text((165 * S, 556 * S), "ENGINE OIL 1L", font=f3, fill="#4a4f5c", anchor="mm")
    img = img.resize((w // S, h // S), Image.LANCZOS)
    return place(img.crop(img.getbbox()), max_w=520, max_h=800)


def stand_in_jug() -> Image.Image:
    """Castrol 5W-30 5L: a white 5-litre jug with a red cap and green label."""
    S = 3
    w, h = 560 * S, 700 * S
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    body = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(body)
    d.rounded_rectangle([30 * S, 150 * S, 530 * S, 690 * S], radius=70 * S, fill=255)
    d.polygon([(30 * S, 220 * S), (210 * S, 120 * S), (530 * S, 120 * S), (530 * S, 220 * S)], fill=255)
    d.rounded_rectangle([300 * S, 60 * S, 520 * S, 150 * S], radius=34 * S, fill=255)  # handle top
    d.rounded_rectangle([335 * S, 95 * S, 480 * S, 205 * S], radius=30 * S, fill=0)  # handle hole
    colour = _gradient_h(w, h, (252, 252, 250), (214, 218, 222))
    img.paste(colour, (0, 0), body)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([100 * S, 40 * S, 200 * S, 135 * S], radius=14 * S, fill="#b3121f")  # cap
    d.rounded_rectangle([96 * S, 120 * S, 204 * S, 150 * S], radius=8 * S, fill="#8f0e19")
    # green label with a white swoosh and a red band
    label = Image.new("L", (w, h), 0)
    ImageDraw.Draw(label).rounded_rectangle([66 * S, 260 * S, 494 * S, 650 * S], radius=52 * S, fill=255)
    green = _gradient_h(w, h, (14, 120, 52), (6, 86, 36))
    img.paste(green, (0, 0), label)
    d = ImageDraw.Draw(img)
    d.polygon([(66 * S, 330 * S), (494 * S, 300 * S), (494 * S, 400 * S), (66 * S, 430 * S)], fill="#ffffff")
    d.polygon([(66 * S, 430 * S), (494 * S, 400 * S), (494 * S, 450 * S), (66 * S, 480 * S)], fill="#c8102e")
    f1, f2, f3 = ImageFont.truetype(FONT_BOLD, 62 * S), ImageFont.truetype(FONT_BOLD, 88 * S), ImageFont.truetype(FONT_BOLD, 34 * S)
    d.text((280 * S, 372 * S), "Castrol", font=f1, fill="#c8102e", anchor="mm")
    d.text((280 * S, 548 * S), "5W-30", font=f2, fill="#ffffff", anchor="mm")
    d.text((280 * S, 610 * S), "ENGINE OIL · 5 L", font=f3, fill="#dff3e5", anchor="mm")
    img = img.resize((w // S, h // S), Image.LANCZOS)
    return place(img.crop(img.getbbox()), max_w=620, max_h=780)


def main(photos, masks, out):
    os.makedirs(out, exist_ok=True)
    for key, (sku, on_carton) in PHOTOS.items():
        finish(from_photo(photos, masks, key, on_carton)).save(os.path.join(out, sku + ".jpg"), quality=90)
        print("saved", sku)
    finish(stand_in_bottle()).save(os.path.join(out, "TOT-15W40-1L.jpg"), quality=90)
    finish(stand_in_jug()).save(os.path.join(out, "CAS-5W30-5L.jpg"), quality=90)
    print("saved stand-ins")


if __name__ == "__main__":
    main(*sys.argv[1:4])
