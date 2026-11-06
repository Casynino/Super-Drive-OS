// Product codes are made by the system so nobody types them: a readable code from the name (CAS-15W40-5L) and a
// unique barcode for the shelf and the scanner. Call these inside the same transaction that creates the product.
import type { Tx } from "@/lib/inventory/engine";
import { internalBarcode } from "./barcode";

const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "");

/**
 * A short readable code from the name: the first three letters of the brand (or of the first word), then the rest of
 * the name with the dashes squeezed out. "Castrol 15W-40 5L" with brand Castrol becomes CAS-15W40-5L.
 */
export function generateSku(name: string, brand?: string | null): string {
  let tokens = name.trim().split(/\s+/).filter(Boolean);
  let prefix: string;
  if (brand && brand.trim()) {
    prefix = clean(brand).slice(0, 3);
    if (name.trim().toLowerCase().startsWith(brand.trim().toLowerCase())) tokens = name.trim().slice(brand.trim().length).trim().split(/\s+/).filter(Boolean);
  } else {
    prefix = clean(tokens.shift() ?? "").slice(0, 3);
  }
  const code = [prefix, ...tokens.map(clean)].filter(Boolean).join("-").slice(0, 32).replace(/-+$/, "");
  return code || "ITEM";
}

/** The code, or the code with -2, -3 ... when another product already has it. */
export async function uniqueSku(tx: Pick<Tx, "product">, base: string): Promise<string> {
  let sku = base;
  for (let i = 2; await tx.product.findUnique({ where: { sku }, select: { id: true } }); i++) sku = `${base}-${i}`;
  return sku;
}

/** The next free barcode. The counter rolls back with the transaction, so numbers are not wasted on failed saves. */
export async function nextBarcode(tx: Tx): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const rows = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO "DocumentCounter" ("key", "value") VALUES ('PRODUCT-BARCODE', 1)
      ON CONFLICT ("key") DO UPDATE SET "value" = "DocumentCounter"."value" + 1
      RETURNING "value"`;
    const code = internalBarcode(rows[0]!.value);
    if (!(await tx.product.findUnique({ where: { barcode: code }, select: { id: true } }))) return code;
  }
  throw new Error("Could not find a free barcode");
}

/** Gives every active or inactive product that has no barcode one. Safe to run again. Returns how many were filled. */
export async function backfillBarcodes(db: { product: Tx["product"]; $transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T> }): Promise<number> {
  const missing = await db.product.findMany({ where: { barcode: null }, orderBy: { createdAt: "asc" }, select: { id: true } });
  for (const p of missing) {
    await db.$transaction(async (tx) => {
      const code = await nextBarcode(tx);
      await tx.product.update({ where: { id: p.id }, data: { barcode: code } });
    });
  }
  return missing.length;
}
