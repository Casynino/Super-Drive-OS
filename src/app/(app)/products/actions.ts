"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { diffFields, writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import { fail, formString, formValues, guarded, isUniqueViolation, type ActionState } from "@/lib/action";
import { parseMoney } from "@/lib/money";
import { generateSku, nextBarcode, uniqueSku } from "@/lib/product-codes";
import { ImageError, processProductImage } from "@/lib/product-images";
import { getCurrency } from "@/lib/settings";

const D = Prisma.Decimal;

const basicSchema = z.object({
  name: z.string().trim().min(2, "Enter the product name.").max(150, "Too long."),
  // empty = the system makes the code from the name
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9._\-/]{0,39}$/, "Use letters, numbers and - _ . / only (max 40 characters).")
    .or(z.literal("")),
  barcode: z.string().trim().max(64, "Too long.").optional(),
  categoryId: z.string().min(1, "Choose a category."),
  brandId: z.string().optional(),
  packagingType: z.string().trim().max(60, "Too long.").optional(),
  size: z.string().trim().max(30, "Too long.").optional(),
  description: z.string().trim().max(1000, "Too long.").optional(),
  baseUnitId: z.string().optional(),
});

const unitRowSchema = z.array(
  z.object({
    unitId: z.string().min(1),
    factor: z.string(),
    sellingPrice: z.string().optional(),
    wholesalePrice: z.string().optional(),
  }),
);

type Snapshot = {
  name: string;
  sku: string;
  barcode: string | null;
  categoryId: string;
  brandId: string | null;
  packagingType: string | null;
  description: string | null;
  minStock: string;
  purchasePrice: string;
  sellingPrice: string;
  wholesalePrice: string | null;
  status: string;
  defaultSalesUnitId: string | null;
  defaultPurchaseUnitId: string | null;
  allowPieceSales: boolean;
  units: { unitId: string; factor: string; sellingPrice: string | null; wholesalePrice: string | null }[];
};

const PRICE_KEYS = ["purchasePrice", "sellingPrice", "wholesalePrice", "units"] as const;
const dec = (v: Prisma.Decimal | string | null | undefined) => (v === null || v === undefined ? null : new D(v).toString());

type ProductWithUnits = Prisma.ProductGetPayload<{ include: { units: true } }>;
function snapshot(p: ProductWithUnits): Snapshot {
  return {
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    categoryId: p.categoryId,
    brandId: p.brandId,
    packagingType: p.packagingType,
    description: p.description,
    minStock: dec(p.minStock)!,
    purchasePrice: dec(p.purchasePrice)!,
    sellingPrice: dec(p.sellingPrice)!,
    wholesalePrice: dec(p.wholesalePrice),
    status: p.status,
    defaultSalesUnitId: p.defaultSalesUnitId,
    defaultPurchaseUnitId: p.defaultPurchaseUnitId,
    allowPieceSales: p.allowPieceSales,
    units: p.units
      .map((u) => ({ unitId: u.unitId, factor: dec(u.factor)!, sellingPrice: dec(u.sellingPrice), wholesalePrice: dec(u.wholesalePrice) }))
      .sort((a, b) => a.unitId.localeCompare(b.unitId)),
  };
}

type HistoryRow = { productId: string; field: string; unitLabel: string | null; oldValue: Prisma.Decimal | null; newValue: Prisma.Decimal | null; changedById: string };
const asDec = (v: string | null | undefined) => (v === null || v === undefined ? null : new D(v));

/** One row per price that actually changed (base prices and packaging-unit overrides). */
function priceHistoryRows(productId: string, userId: string, before: Snapshot | null, after: Snapshot, symbols: Map<string, string>): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const field of ["sellingPrice", "wholesalePrice", "purchasePrice"] as const) {
    if ((before?.[field] ?? null) !== (after[field] ?? null)) rows.push({ productId, field, unitLabel: null, oldValue: asDec(before?.[field]), newValue: asDec(after[field]), changedById: userId });
  }
  for (const a of after.units) {
    const b = before?.units.find((u) => u.unitId === a.unitId);
    for (const [key, field] of [["sellingPrice", "unitSellingPrice"], ["wholesalePrice", "unitWholesalePrice"]] as const) {
      if ((b?.[key] ?? null) !== (a[key] ?? null)) rows.push({ productId, field, unitLabel: symbols.get(a.unitId) ?? null, oldValue: asDec(b?.[key]), newValue: asDec(a[key]), changedById: userId });
    }
  }
  return rows;
}

export async function saveProduct(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = formString(fd, "id") || null;
  const values = formValues(fd);

  return guarded(id ? "products.edit" : "products.create", async (user) => {
    const currency = await getCurrency();
    const canPrice = can(user, "products.price");
    const canCost = can(user, "products.cost");
    const errors: Record<string, string> = {};

    const basic = basicSchema.safeParse({
      name: formString(fd, "name"),
      sku: formString(fd, "sku"),
      barcode: formString(fd, "barcode") || undefined,
      categoryId: formString(fd, "categoryId"),
      brandId: formString(fd, "brandId") || undefined,
      packagingType: formString(fd, "packagingType") || undefined,
      size: formString(fd, "size") || undefined,
      description: formString(fd, "description") || undefined,
      baseUnitId: formString(fd, "baseUnitId") || undefined,
    });
    if (!basic.success) for (const i of basic.error.issues) errors[String(i.path[0])] ??= i.message;

    const existing = id ? await db.product.findUnique({ where: { id }, include: { units: true } }) : null;
    if (id && !existing) return fail("This product no longer exists.");

    const baseUnitId = existing?.baseUnitId ?? basic.data?.baseUnitId;
    if (!baseUnitId) errors.baseUnitId = "Choose the base unit.";
    const baseUnit = baseUnitId ? await db.unit.findUnique({ where: { id: baseUnitId } }) : null;
    if (baseUnitId && !baseUnit) errors.baseUnitId = "Unknown unit.";

    // Money. Fields the user may not touch keep their stored value (edit) or default to 0 (create).
    const money = (field: string, required: boolean) => {
      const raw = formString(fd, field);
      if (!raw) {
        if (required) errors[field] = "Required.";
        return null;
      }
      const v = parseMoney(raw, currency.decimals);
      if (!v) errors[field] = currency.decimals === 0 ? "Enter a whole amount (no decimals)." : `Enter a valid amount (max ${currency.decimals} decimals).`;
      return v;
    };
    // When adding a product the prices can wait (the shipment form asks for them too); when editing they stay required.
    const sellingPrice = canPrice ? money("sellingPrice", Boolean(id)) : null;
    const wholesalePrice = canPrice ? money("wholesalePrice", false) : null;
    const purchasePrice = canCost ? money("purchasePrice", Boolean(id)) : null;

    const minRaw = formString(fd, "minStock") || "0";
    let minStock = new D(0);
    try {
      minStock = new D(minRaw);
      const allowsDecimal = baseUnit?.allowsDecimal ?? true;
      if (!minStock.isFinite() || minStock.lt(0) || minStock.decimalPlaces() > 3 || (!allowsDecimal && !minStock.isInteger())) {
        errors.minStock = allowsDecimal ? "Enter a number (max 3 decimals)." : "Enter a whole number.";
      }
    } catch {
      errors.minStock = "Enter a valid number.";
    }

    // Packaging conversions
    let unitRows: z.infer<typeof unitRowSchema> = [];
    try {
      unitRows = unitRowSchema.parse(JSON.parse(formString(fd, "unitsJson") || "[]"));
    } catch {
      errors.units = "Packaging units are invalid.";
    }
    const seen = new Set<string>();
    const parsedUnits: { unitId: string; factor: Prisma.Decimal; sellingPrice: Prisma.Decimal | null; wholesalePrice: Prisma.Decimal | null }[] = [];
    for (const row of unitRows) {
      if (row.unitId === baseUnitId) errors.units = "A packaging unit cannot be the same as the base unit.";
      else if (seen.has(row.unitId)) errors.units = "Each packaging unit can only be added once.";
      seen.add(row.unitId);
      const factorRaw = row.factor.trim();
      const factor = /^\d+(\.\d{1,4})?$/.test(factorRaw) ? new D(factorRaw) : null;
      if (!factor || factor.lte(0)) {
        errors.units = "Enter how many base units each packaging unit contains (greater than zero, max 4 decimals).";
        continue;
      }
      const old = existing?.units.find((u) => u.unitId === row.unitId);
      const sp = canPrice ? (row.sellingPrice?.trim() ? parseMoney(row.sellingPrice, currency.decimals) : null) : (old?.sellingPrice ?? null);
      const wp = canPrice ? (row.wholesalePrice?.trim() ? parseMoney(row.wholesalePrice, currency.decimals) : null) : (old?.wholesalePrice ?? null);
      if (canPrice && ((row.sellingPrice?.trim() && !sp) || (row.wholesalePrice?.trim() && !wp))) errors.units = "Packaging prices are invalid.";
      parsedUnits.push({ unitId: row.unitId, factor, sellingPrice: sp ? new D(sp) : null, wholesalePrice: wp ? new D(wp) : null });
    }

    if (Object.keys(errors).length > 0 || !basic.success) return fail("Please fix the highlighted fields.", errors, values);
    const b = basic.data;
    // a chosen default must be the base unit or one of this product's packs; anything else falls back to the biggest pack
    const biggestPack = [...parsedUnits].sort((x, y) => y.factor.comparedTo(x.factor))[0]?.unitId ?? null;
    const pickDefaultUnit = (raw: string): string | null => (raw && (raw === baseUnitId || parsedUnits.some((u) => u.unitId === raw)) ? raw : biggestPack);

    // Friendly uniqueness checks (the DB unique indexes remain the real guard)
    const dupSku = b.sku ? await db.product.findFirst({ where: { sku: b.sku, ...(id ? { NOT: { id } } : {}) }, select: { id: true } }) : null;
    if (dupSku) return fail("Please fix the highlighted fields.", { sku: "This SKU is already used by another product." }, values);
    if (b.barcode) {
      const dupBar = await db.product.findFirst({ where: { barcode: b.barcode, ...(id ? { NOT: { id } } : {}) }, select: { id: true } });
      if (dupBar) return fail("Please fix the highlighted fields.", { barcode: "This barcode is already used by another product." }, values);
    }
    const [cat, brand] = await Promise.all([
      db.category.findUnique({ where: { id: b.categoryId } }),
      b.brandId ? db.brand.findUnique({ where: { id: b.brandId } }) : null,
    ]);
    if (!cat) return fail("Please fix the highlighted fields.", { categoryId: "Unknown category." }, values);
    if (b.brandId && !brand) return fail("Please fix the highlighted fields.", { brandId: "Unknown brand." }, values);
    const unitCount = await db.unit.count({ where: { id: { in: parsedUnits.map((u) => u.unitId) } } });
    if (unitCount !== parsedUnits.length) return fail("Please fix the highlighted fields.", { units: "A packaging unit no longer exists." }, values);

    const data = {
      name: b.name,
      categoryId: b.categoryId,
      brandId: b.brandId ?? null,
      packagingType: b.packagingType ?? null,
      size: b.size ?? null,
      description: b.description ?? null,
      minStock,
      purchasePrice: canCost ? (purchasePrice ?? new D(0)) : (existing?.purchasePrice ?? new D(0)),
      sellingPrice: canPrice ? (sellingPrice ?? new D(0)) : (existing?.sellingPrice ?? new D(0)),
      wholesalePrice: canPrice ? wholesalePrice : (existing?.wholesalePrice ?? null),
      // Carton-first: the unit forms start with, and whether single pieces may be sold. Left empty it means the biggest pack (the carton).
      defaultSalesUnitId: pickDefaultUnit(formString(fd, "defaultSalesUnitId")),
      defaultPurchaseUnitId: pickDefaultUnit(formString(fd, "defaultPurchaseUnitId")),
      allowPieceSales: formString(fd, "allowPieceSales") === "on",
    };

    // A picture can be added while creating the product (optional); it is checked and shrunk before anything is saved.
    let image: Awaited<ReturnType<typeof processProductImage>> | null = null;
    const file = fd.get("image");
    if (!existing && file instanceof File && file.size > 0) {
      try {
        image = await processProductImage(Buffer.from(await file.arrayBuffer()));
      } catch (e) {
        if (e instanceof ImageError) return fail("Please fix the highlighted fields.", { image: e.message }, values);
        throw e;
      }
    }

    try {
      let productId = id;
      await db.$transaction(async (tx) => {
        // Codes are made by the system: a readable code from the name and a unique barcode. Typed ones are kept; stored ones are never lost.
        const sku = b.sku || existing?.sku || (await uniqueSku(tx, generateSku(b.name, brand?.name)));
        const barcode = b.barcode || existing?.barcode || (await nextBarcode(tx));

        if (!existing) {
          const created = await tx.product.create({
            data: {
              ...data,
              sku,
              barcode,
              baseUnitId: baseUnitId!,
              createdById: user.id,
              units: { create: parsedUnits },
            },
            include: { units: true },
          });
          productId = created.id;
          if (image) await tx.productImage.create({ data: { productId: created.id, mime: image.mime, full: new Uint8Array(image.full), thumb: new Uint8Array(image.thumb), width: image.width, height: image.height, updatedById: user.id } });
          const symbols = new Map((await tx.unit.findMany({ select: { id: true, symbol: true } })).map((u) => [u.id, u.symbol]));
          const initial = priceHistoryRows(created.id, user.id, null, snapshot(created), symbols).filter((r) => r.newValue && !r.newValue.isZero());
          if (initial.length) await tx.productPriceHistory.createMany({ data: initial });
          await writeAudit(tx, { user, action: "product.create", entityType: "Product", entityId: created.id, after: snapshot(created), reference: created.sku });
          return;
        }

        const before = snapshot(existing);
        await tx.product.update({ where: { id: existing.id }, data: { ...data, sku, barcode } });

        // Sync packaging units: remove the ones no longer listed, upsert the rest.
        const keep = parsedUnits.map((u) => u.unitId);
        await tx.productUnit.deleteMany({ where: { productId: existing.id, unitId: { notIn: keep } } });
        for (const u of parsedUnits) {
          await tx.productUnit.upsert({
            where: { productId_unitId: { productId: existing.id, unitId: u.unitId } },
            update: { factor: u.factor, sellingPrice: u.sellingPrice, wholesalePrice: u.wholesalePrice },
            create: { productId: existing.id, ...u },
          });
        }

        const fresh = await tx.product.findUniqueOrThrow({ where: { id: existing.id }, include: { units: true } });
        const diff = diffFields(before as unknown as Record<string, unknown>, snapshot(fresh) as unknown as Record<string, unknown>);
        if (!diff.changed) return;

        const priceChanged = Object.keys(diff.after).filter((k) => (PRICE_KEYS as readonly string[]).includes(k));
        const otherChanged = Object.keys(diff.after).filter((k) => !(PRICE_KEYS as readonly string[]).includes(k));
        if (priceChanged.length) {
          const symbols = new Map((await tx.unit.findMany({ select: { id: true, symbol: true } })).map((u) => [u.id, u.symbol]));
          const rows = priceHistoryRows(existing.id, user.id, before, snapshot(fresh), symbols);
          if (rows.length) await tx.productPriceHistory.createMany({ data: rows });
          await writeAudit(tx, {
            user,
            action: "product.price_change",
            entityType: "Product",
            entityId: existing.id,
            reference: fresh.sku,
            before: Object.fromEntries(priceChanged.map((k) => [k, diff.before[k]])),
            after: Object.fromEntries(priceChanged.map((k) => [k, diff.after[k]])),
          });
        }
        if (otherChanged.length) {
          await writeAudit(tx, {
            user,
            action: "product.update",
            entityType: "Product",
            entityId: existing.id,
            reference: fresh.sku,
            before: Object.fromEntries(otherChanged.map((k) => [k, diff.before[k]])),
            after: Object.fromEntries(otherChanged.map((k) => [k, diff.after[k]])),
          });
        }
      });
      revalidatePath("/products");
      if (!id) redirect(`/products/${productId}?created=1`);
      revalidatePath(`/products/${id}`);
      return { ok: true, message: "Product saved." };
    } catch (e) {
      if (isUniqueViolation(e)) return fail("This SKU or barcode is already used by another product.", undefined, values);
      throw e;
    }
  });
}

export async function setProductStatus(formData: FormData): Promise<void> {
  const id = formString(formData, "id");
  const status = formString(formData, "status") === "INACTIVE" ? "INACTIVE" : "ACTIVE";
  const result = await guarded("products.deactivate", async (user) => {
    await db.$transaction(async (tx) => {
      const before = await tx.product.findUnique({ where: { id }, select: { status: true, sku: true } });
      if (!before || before.status === status) return;
      await tx.product.update({ where: { id }, data: { status } });
      await writeAudit(tx, {
        user,
        action: status === "INACTIVE" ? "product.deactivate" : "product.activate",
        entityType: "Product",
        entityId: id,
        reference: before.sku,
        before: { status: before.status },
        after: { status },
      });
    });
    return { ok: true };
  });
  if (result.error) throw new Error(result.error);
  revalidatePath("/products");
  revalidatePath(`/products/${id}`);
}
