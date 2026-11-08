// Makes the icons and the link-preview picture from the real logo and the product photo. Run: node scripts/make-brand-images.mjs
// icon.png      tab icon: the red O with the oil drop, big, on navy (the full logo is unreadable at 16 px)
// apple-icon    home-screen icon on iPhone / iPad: the full logo
// app-*.png     the app icons of the installed web app (manifest.ts)
// og-share.png  the picture WhatsApp, Facebook, LinkedIn and others show when the link is shared (1200 x 630)
import sharp from "sharp";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const NAVY = { r: 10, g: 26, b: 51, alpha: 1 };
const logo = join(root, "public/brand/logo-full-dark.png"); // 900 x 456, transparent
const products = join(root, "public/brand/banner-products.webp"); // 1700 x 470, transparent

const roundMask = (size, r) => Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}"/></svg>`);
async function tile(size, input, widthPct, { round = 0 } = {}) {
  const img = await sharp(input).resize({ width: Math.round(size * widthPct) }).toBuffer();
  let out = sharp({ create: { width: size, height: size, channels: 4, background: NAVY } }).composite([{ input: img, gravity: "center" }]);
  let png = await out.png().toBuffer();
  if (round) png = await sharp(png).composite([{ input: roundMask(size, round), blend: "dest-in" }]).png().toBuffer();
  return png;
}

// the O with the drop, cut out of the full logo
const cut = await sharp(logo).extract({ left: 556, top: 138, width: 288, height: 190 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
for (let i = 0; i < cut.data.length; i += 4) {
  const [r, g, b] = [cut.data[i], cut.data[i + 1], cut.data[i + 2]];
  if (r > 190 && g > 190 && b > 190) cut.data[i + 3] = 0; // white and lavender parts of the other letters
}
const mark = await sharp(cut.data, { raw: { width: cut.info.width, height: cut.info.height, channels: 4 } }).trim().png().toBuffer();

await sharp(await tile(256, mark, 0.84, { round: 56 })).toFile(join(root, "src/app/icon.png"));
await sharp(await tile(180, logo, 0.84)).toFile(join(root, "src/app/apple-icon.png"));
await sharp(await tile(192, logo, 0.82)).toFile(join(root, "public/brand/app-192.png"));
await sharp(await tile(512, logo, 0.82)).toFile(join(root, "public/brand/app-512.png"));
await sharp(await tile(512, logo, 0.62)).toFile(join(root, "public/brand/app-maskable-512.png")); // keeps inside the safe circle

// the share picture: the logo, and the shop's real products under it
const W = 1200;
const H = 630;
const logoImg = await sharp(logo).resize({ width: 560 }).toBuffer();
const ramp = (w, h, horizontal, a, b) =>
  Buffer.from(`<svg width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="${horizontal ? 1 : 0}" y2="${horizontal ? 0 : 1}"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="${a}" stop-color="#fff" stop-opacity="1"/><stop offset="${b}" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/></svg>`);
const prodRaw = await sharp(products).resize({ width: 1000 }).toBuffer();
const prodMeta = await sharp(prodRaw).metadata();
const softV = await sharp(prodRaw).composite([{ input: ramp(prodMeta.width, prodMeta.height, false, 0.3, 0.88), blend: "dest-in" }]).png().toBuffer();
const prodImg = await sharp(softV).composite([{ input: ramp(prodMeta.width, prodMeta.height, true, 0.1, 0.9), blend: "dest-in" }]).png().toBuffer();
const prodH = (await sharp(prodImg).metadata()).height;
await sharp({ create: { width: W, height: H, channels: 4, background: NAVY } })
  .composite([
    { input: logoImg, left: Math.round((W - 560) / 2), top: 44 },
    { input: prodImg, left: Math.round((W - 1000) / 2), top: H - prodH - 36 },
  ])
  .flatten({ background: NAVY })
  .png({ compressionLevel: 9, palette: false })
  .toFile(join(root, "public/brand/og-share.png"));
console.log("done");
