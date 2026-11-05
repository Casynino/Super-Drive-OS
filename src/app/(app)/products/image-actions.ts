"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { fail, formString, guarded, type ActionState } from "@/lib/action";
import { ImageError, processProductImage } from "@/lib/product-images";

export async function uploadProductImage(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded("products.edit", async (user) => {
    const productId = formString(fd, "productId");
    const file = fd.get("image");
    if (!(file instanceof File) || file.size === 0) return fail("Choose a picture first.");
    const product = await db.product.findUnique({ where: { id: productId }, select: { id: true, sku: true } });
    if (!product) return fail("This product no longer exists.");

    let processed;
    try {
      processed = await processProductImage(Buffer.from(await file.arrayBuffer()));
    } catch (e) {
      if (e instanceof ImageError) return fail(e.message);
      throw e;
    }
    await db.$transaction(async (tx) => {
      const data = { mime: processed.mime, full: new Uint8Array(processed.full), thumb: new Uint8Array(processed.thumb), width: processed.width, height: processed.height, updatedById: user.id };
      await tx.productImage.upsert({ where: { productId }, update: data, create: { productId, ...data } });
      await writeAudit(tx, { user, action: "product.image_change", entityType: "Product", entityId: productId, reference: product.sku, after: { width: processed.width, height: processed.height, bytes: processed.full.length } });
    });
    revalidatePath(`/products/${productId}`);
    revalidatePath("/pos");
    revalidatePath("/products");
    return { ok: true, message: "Picture saved." };
  });
}

export async function removeProductImage(fd: FormData): Promise<void> {
  const productId = formString(fd, "productId");
  const result = await guarded("products.edit", async (user) => {
    const product = await db.product.findUnique({ where: { id: productId }, select: { sku: true } });
    if (!product) return fail("This product no longer exists.");
    await db.$transaction(async (tx) => {
      await tx.productImage.deleteMany({ where: { productId } });
      await writeAudit(tx, { user, action: "product.image_remove", entityType: "Product", entityId: productId, reference: product.sku });
    });
    return { ok: true };
  });
  if (result.error) throw new Error(result.error);
  revalidatePath(`/products/${productId}`);
  revalidatePath("/pos");
}
