import sharp from "sharp";

export class ImageError extends Error {}

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(["jpeg", "png", "webp"]);

export type ProcessedImage = { mime: "image/webp"; full: Buffer; thumb: Buffer; width: number; height: number };

/**
 * Turns an uploaded photo into two small web images (WebP): a 900 px one for product pages and a 320 px
 * thumbnail for POS cards. Orientation is fixed from the phone's EXIF data, then ALL metadata (including
 * GPS location) is dropped, transparency is flattened onto white, and the file type is verified from its
 * real content (not its name).
 */
export async function processProductImage(input: Buffer): Promise<ProcessedImage> {
  if (input.length === 0) throw new ImageError("The file is empty.");
  if (input.length > MAX_UPLOAD_BYTES) throw new ImageError("The photo is too large (max 8 MB).");

  let format: string | undefined;
  try {
    format = (await sharp(input, { limitInputPixels: 80_000_000 }).metadata()).format;
  } catch {
    throw new ImageError("This file is not a readable picture.");
  }
  if (!format || !ALLOWED.has(format)) throw new ImageError("Use a JPG, PNG or WebP picture.");

  const base = sharp(input, { limitInputPixels: 80_000_000 }).rotate().flatten({ background: "#ffffff" });
  const [full, thumb] = await Promise.all([
    base.clone().resize({ width: 900, height: 900, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true }),
    base.clone().resize({ width: 320, height: 320, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer(),
  ]);
  return { mime: "image/webp", full: full.data, thumb, width: full.info.width, height: full.info.height };
}
