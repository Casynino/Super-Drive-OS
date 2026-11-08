import { describe, expect, it } from "vitest";
import { BinaryBitmap, HybridBinarizer, PlanarYUVLuminanceSource, QRCodeReader } from "@zxing/library";
import { randomBytes } from "node:crypto";
import { pickupQrText, qrSvg, PICKUP_QR_PREFIX } from "./qr";
import { parseScan } from "./warehouse/pickup";

/** Draws the generated SVG into a grey picture (like a camera would see it) and reads it back with the same reader the scanner page bundles. */
async function readSvg(svg: string, scale = 8): Promise<string> {
  const size = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)![1]);
  const d = /<path[^>]*stroke="#000000"[^>]*d="([^"]+)"/.exec(svg)![1]!;
  const dark = new Set<string>();
  let x = 0;
  let y = 0;
  for (const m of d.matchAll(/([Mmh])\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+))?/g)) {
    const [, cmd, a, b] = m;
    if (cmd === "M") { x = Number(a); y = Number(b); }
    else if (cmd === "m") { x += Number(a); y += Number(b); }
    else { for (let i = 0; i < Number(a); i++) dark.add(`${Math.floor(x + i)},${Math.floor(y)}`); x += Number(a); }
  }
  const px = size * scale;
  const grey = new Uint8ClampedArray(px * px).fill(255);
  for (const key of dark) {
    const [mx, my] = key.split(",").map(Number) as [number, number];
    for (let j = 0; j < scale; j++) for (let i = 0; i < scale; i++) grey[(my * scale + j) * px + mx * scale + i] = 0;
  }
  const bitmap = new BinaryBitmap(new HybridBinarizer(new PlanarYUVLuminanceSource(grey, px, px, 0, 0, px, px, false)));
  return new QRCodeReader().decode(bitmap).getText();
}

describe("pickup note QR code", () => {
  it("is readable by the scanner's own reader and says exactly SDOPU:<token>", async () => {
    const token = randomBytes(24).toString("base64url");
    const text = pickupQrText(token);
    expect(text).toBe(`${PICKUP_QR_PREFIX}${token}`);
    expect(await readSvg(await qrSvg(text))).toBe(text);
  });

  it("gives every note its own code", async () => {
    const a = await qrSvg(pickupQrText(randomBytes(24).toString("base64url")));
    const b = await qrSvg(pickupQrText(randomBytes(24).toString("base64url")));
    expect(a).not.toBe(b);
  });

  it("carries only a token: reading it back finds the note by token, and nothing else in the text is trusted", async () => {
    const token = randomBytes(24).toString("base64url");
    const read = await readSvg(await qrSvg(pickupQrText(token)));
    expect(parseScan(read)).toEqual({ token });
    // a hand-made code with prices or names in it is not understood
    expect(parseScan("SDOPU:abc?total=0&customer=Boss paid")).toEqual({ token: "abc?total=0&customer=Boss paid" });
    expect(parseScan("https://example.com/pickup/PU-2026-000001")).toBeNull();
  });
});
