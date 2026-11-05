// Receipts and deposit slips: a small photo, checked and re-encoded like product pictures
// (real file type verified, EXIF/GPS dropped, resized, stored as WebP in the database).
import sharp from "sharp";
import type { Tx } from "@/lib/inventory/engine";
import { ImageError, MAX_UPLOAD_BYTES } from "@/lib/product-images";

export { ImageError };

const ALLOWED = new Set(["jpeg", "png", "webp"]);

export async function processDocumentImage(input: Buffer): Promise<Buffer> {
  if (input.length === 0) throw new ImageError("The file is empty.");
  if (input.length > MAX_UPLOAD_BYTES) throw new ImageError("The photo is too large (max 8 MB).");
  let format: string | undefined;
  try {
    format = (await sharp(input, { limitInputPixels: 80_000_000 }).metadata()).format;
  } catch {
    throw new ImageError("This file is not a readable picture.");
  }
  if (!format || !ALLOWED.has(format)) throw new ImageError("Use a JPG, PNG or WebP picture.");
  return sharp(input, { limitInputPixels: 80_000_000 })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: 1400, height: 1800, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
}

export async function saveAttachment(tx: Pick<Tx, "attachment">, input: { kind: "EXPENSE_RECEIPT" | "DEPOSIT_SLIP"; data: Buffer; userId: string }) {
  return tx.attachment.create({ data: { kind: input.kind, mime: "image/webp", data: new Uint8Array(input.data), sizeBytes: input.data.length, createdById: input.userId }, select: { id: true } });
}
