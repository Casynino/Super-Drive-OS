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
import { getCurrency } from "@/lib/settings";

const D = Prisma.Decimal;

const basicSchema = z.object({
  name: z.string().trim().min(2, "Enter the product name.").max(150, "Too long."),
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9._\-/]{0,39}$/, "Use letters, numbers and - _ . / only (max 40 characters)."),
  barcode: z.string().trim().max(64, "Too long.").optional(),
  categoryId: z.string().min(1, "Choose a category."),
  brandId: z.string().optional(),
  packagingType: z.string().trim().max(60, "Too long.").optional(),
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
    units: p.units
      .map((u) => ({ unitId: u.unitId, factor: dec(u.factor)!, sellingPrice: dec(u.sellingPrice), wholesalePrice: dec(u.wholesalePrice) }))
      .sort((a, b) => a.unitId.localeCompare(b.unitId)),
  };
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
    const sellingPrice = canPrice ? money("sellingPrice", true) : null;
    const wholesalePrice = canPrice ? money("wholesalePrice", false) : null;
    const purchasePrice = canCost ? money("purchasePrice", true) : null;

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

    // Friendly uniqueness checks (the DB unique indexes remain the real guard)
    const dupSku = await db.product.findFirst({ where: { sku: b.sku, ...(id ? { NOT: { id } } : {}) }, select: { id: true } });
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
      sku: b.sku,
      barcode: b.barcode ?? null,
      categoryId: b.categoryId,
      brandId: b.brandId ?? null,
      packagingType: b.packagingType ?? null,
      description: b.description ?? null,
      minStock,
      purchasePrice: canCost ? purchasePrice! : (existing?.purchasePrice ?? new D(0)),
      sellingPrice: canPrice ? sellingPrice! : (existing?.sellingPrice ?? new D(0)),
      wholesalePrice: canPrice ? wholesalePrice : (existing?.wholesalePrice ?? null),
    };

    try {
      let productId = id;
      await db.$transaction(async (tx) => {
        if (!existing) {
          const created = await tx.product.create({
            data: {
              ...data,
              baseUnitId: baseUnitId!,
              createdById: user.id,
              units: { create: parsedUnits },
            },
            include: { units: true },
          });
          productId = created.id;
          await writeAudit(tx, { user, action: "product.create", entityType: "Product", entityId: created.id, after: snapshot(created), reference: created.sku });
          return;
        }

        const before = snapshot(existing);
        await tx.product.update({ where: { id: existing.id }, data });

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
