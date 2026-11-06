"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { diffFields, writeAudit } from "@/lib/audit";
import { fail, formString, formValues, guarded, isUniqueViolation, zodErrors, type ActionState } from "@/lib/action";

const duplicate = (field: string, what: string, values: Record<string, string>) =>
  fail("Please fix the highlighted fields.", { [field]: `${what} already exists.` }, values);

function invalid(err: z.ZodError, values: Record<string, string>): ActionState {
  return { ...zodErrors(err), values };
}

// ───────────── Categories ─────────────

const categorySchema = z.object({
  name: z.string().trim().min(2, "Enter a name.").max(80, "Too long."),
  description: z.string().trim().max(300, "Too long.").optional(),
});

export async function saveCategory(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  return guarded("catalog.manage", async (user) => {
    const id = formString(fd, "id") || null;
    const parsed = categorySchema.safeParse({ name: formString(fd, "name"), description: formString(fd, "description") || undefined });
    if (!parsed.success) return invalid(parsed.error, values);
    const { name, description } = parsed.data;

    const dup = await db.category.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(id ? { NOT: { id } } : {}) } });
    if (dup) return duplicate("name", "A category with this name", values);

    try {
      await db.$transaction(async (tx) => {
        if (!id) {
          const c = await tx.category.create({ data: { name, description: description ?? null } });
          await writeAudit(tx, { user, action: "category.create", entityType: "Category", entityId: c.id, after: { name, description } });
          return;
        }
        const before = await tx.category.findUniqueOrThrow({ where: { id } });
        await tx.category.update({ where: { id }, data: { name, description: description ?? null } });
        const d = diffFields({ name: before.name, description: before.description }, { name, description: description ?? null });
        if (d.changed) await writeAudit(tx, { user, action: "category.update", entityType: "Category", entityId: id, before: d.before, after: d.after });
      });
    } catch (e) {
      if (isUniqueViolation(e)) return duplicate("name", "A category with this name", values);
      throw e;
    }
    revalidatePath("/settings");
    return { ok: true, message: id ? "Category saved." : "Category added." };
  });
}

// ───────────── Brands ─────────────

export async function saveBrand(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  return guarded("catalog.manage", async (user) => {
    const id = formString(fd, "id") || null;
    const parsed = z.object({ name: z.string().trim().min(2, "Enter a name.").max(80, "Too long.") }).safeParse({ name: formString(fd, "name") });
    if (!parsed.success) return invalid(parsed.error, values);
    const { name } = parsed.data;

    const dup = await db.brand.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(id ? { NOT: { id } } : {}) } });
    if (dup) return duplicate("name", "A brand with this name", values);

    try {
      await db.$transaction(async (tx) => {
        if (!id) {
          const b = await tx.brand.create({ data: { name } });
          await writeAudit(tx, { user, action: "brand.create", entityType: "Brand", entityId: b.id, after: { name } });
          return;
        }
        const before = await tx.brand.findUniqueOrThrow({ where: { id } });
        if (before.name === name) return;
        await tx.brand.update({ where: { id }, data: { name } });
        await writeAudit(tx, { user, action: "brand.update", entityType: "Brand", entityId: id, before: { name: before.name }, after: { name } });
      });
    } catch (e) {
      if (isUniqueViolation(e)) return duplicate("name", "A brand with this name", values);
      throw e;
    }
    revalidatePath("/settings");
    return { ok: true, message: id ? "Brand saved." : "Brand added." };
  });
}

// ───────────── Units ─────────────

const unitSchema = z.object({
  name: z.string().trim().min(2, "Enter a name.").max(40, "Too long."),
  symbol: z.string().trim().min(1, "Enter a symbol.").max(10, "Max 10 characters."),
});

export async function saveUnit(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  return guarded("catalog.manage", async (user) => {
    const id = formString(fd, "id") || null;
    const parsed = unitSchema.safeParse({ name: formString(fd, "name"), symbol: formString(fd, "symbol") });
    if (!parsed.success) return invalid(parsed.error, values);
    const { name, symbol } = parsed.data;
    const allowsDecimal = fd.get("allowsDecimal") === "on";

    const [dupName, dupSymbol] = await Promise.all([
      db.unit.findFirst({ where: { name: { equals: name, mode: "insensitive" }, ...(id ? { NOT: { id } } : {}) } }),
      db.unit.findFirst({ where: { symbol: { equals: symbol, mode: "insensitive" }, ...(id ? { NOT: { id } } : {}) } }),
    ]);
    if (dupName) return duplicate("name", "A unit with this name", values);
    if (dupSymbol) return duplicate("symbol", "A unit with this symbol", values);

    try {
      return await db.$transaction(async (tx) => {
        if (!id) {
          const u = await tx.unit.create({ data: { name, symbol, allowsDecimal } });
          await writeAudit(tx, { user, action: "unit.create", entityType: "Unit", entityId: u.id, after: { name, symbol, allowsDecimal } });
          return { ok: true, message: "Unit added." } as ActionState;
        }
        const before = await tx.unit.findUniqueOrThrow({ where: { id } });
        if (before.allowsDecimal !== allowsDecimal) {
          // Changing this after use could make existing stock quantities invalid.
          const inUse = await tx.product.count({ where: { OR: [{ baseUnitId: id }, { units: { some: { unitId: id } } }] } });
          if (inUse > 0) return fail("This unit is already used by products, so fractions cannot be turned on or off.", undefined, values);
        }
        await tx.unit.update({ where: { id }, data: { name, symbol, allowsDecimal } });
        const d = diffFields({ name: before.name, symbol: before.symbol, allowsDecimal: before.allowsDecimal }, { name, symbol, allowsDecimal });
        if (d.changed) await writeAudit(tx, { user, action: "unit.update", entityType: "Unit", entityId: id, before: d.before, after: d.after });
        return { ok: true, message: "Unit saved." } as ActionState;
      });
    } catch (e) {
      if (isUniqueViolation(e)) return fail("This unit name or symbol already exists.", undefined, values);
      throw e;
    } finally {
      revalidatePath("/settings");
    }
  });
}

// ───────────── Locations ─────────────

const locationSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,12}$/, "2–12 letters or numbers."),
  name: z.string().trim().min(2, "Enter a name.").max(80, "Too long."),
  type: z.enum(["WAREHOUSE", "SHOP", "OTHER"]),
  address: z.string().trim().max(200, "Too long.").optional(),
});

export async function saveLocation(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  return guarded("settings.manage", async (user) => {
    const id = formString(fd, "id") || null;
    const parsed = locationSchema.safeParse({
      code: formString(fd, "code"),
      name: formString(fd, "name"),
      type: formString(fd, "type") || "WAREHOUSE",
      address: formString(fd, "address") || undefined,
    });
    if (!parsed.success) return invalid(parsed.error, values);
    const data = { ...parsed.data, address: parsed.data.address ?? null };
    const makeDefault = fd.get("isDefault") === "on";

    const [dupCode, dupName] = await Promise.all([
      db.location.findFirst({ where: { code: data.code, ...(id ? { NOT: { id } } : {}) } }),
      db.location.findFirst({ where: { name: { equals: data.name, mode: "insensitive" }, ...(id ? { NOT: { id } } : {}) } }),
    ]);
    if (dupCode) return duplicate("code", "A location with this code", values);
    if (dupName) return duplicate("name", "A location with this name", values);

    try {
      await db.$transaction(async (tx) => {
        if (!id) {
          if (makeDefault) await tx.location.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
          const hasDefault = await tx.location.count({ where: { isDefault: true } });
          const l = await tx.location.create({ data: { ...data, isDefault: makeDefault || hasDefault === 0 } });
          await writeAudit(tx, { user, action: "location.create", entityType: "Location", entityId: l.id, after: { ...data, isDefault: l.isDefault } });
          return;
        }
        const before = await tx.location.findUniqueOrThrow({ where: { id } });
        // The default can only be moved by making another location the default.
        const isDefault = before.isDefault ? true : makeDefault;
        if (isDefault && !before.isDefault) await tx.location.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
        await tx.location.update({ where: { id }, data: { ...data, isDefault } });
        const d = diffFields(
          { code: before.code, name: before.name, type: before.type, address: before.address, isDefault: before.isDefault },
          { ...data, isDefault },
        );
        if (d.changed) await writeAudit(tx, { user, action: "location.update", entityType: "Location", entityId: id, before: d.before, after: d.after });
      });
    } catch (e) {
      if (isUniqueViolation(e)) return fail("This location code or name already exists.", undefined, values);
      throw e;
    }
    revalidatePath("/settings");
    return { ok: true, message: id ? "Location saved." : "Location added." };
  });
}

// ───────────── Activate / deactivate ─────────────

const statusSchema = z.object({
  entity: z.enum(["category", "brand", "unit", "location"]),
  id: z.string().min(1),
  status: z.enum(["ACTIVE", "INACTIVE"]),
});

export async function setEntityStatus(fd: FormData): Promise<void> {
  const parsed = statusSchema.parse({ entity: formString(fd, "entity"), id: formString(fd, "id"), status: formString(fd, "status") });
  const result = await guarded(parsed.entity === "location" ? "settings.manage" : "catalog.manage", async (user) => {
    const { entity, id, status } = parsed;
    await db.$transaction(async (tx) => {
      if (status === "INACTIVE") {
        if (entity === "unit") {
          const inUse = await tx.product.count({ where: { baseUnitId: id, status: "ACTIVE" } });
          if (inUse > 0) throw new Error("This unit is the base unit of active products and cannot be deactivated.");
        }
        if (entity === "location") {
          const loc = await tx.location.findUniqueOrThrow({ where: { id } });
          if (loc.isDefault) throw new Error("Make another location the default before deactivating this one.");
        }
      }
      const delegate = tx[entity] as unknown as {
        findUniqueOrThrow(args: object): Promise<{ status: string }>;
        update(args: object): Promise<unknown>;
      };
      const before = await delegate.findUniqueOrThrow({ where: { id } });
      if (before.status === status) return;
      await delegate.update({ where: { id }, data: { status } });
      await writeAudit(tx, {
        user,
        action: `${entity}.${status === "ACTIVE" ? "activate" : "deactivate"}`,
        entityType: entity[0]!.toUpperCase() + entity.slice(1),
        entityId: id,
        before: { status: before.status },
        after: { status },
      });
    });
    return { ok: true };
  });
  if (result.error) throw new Error(result.error);
  revalidatePath("/settings");
}

// ───────────── Business profile ─────────────

const profileSchema = z.object({
  businessName: z.string().trim().min(2, "Enter the business name.").max(80, "Too long."),
  businessPhone: z.string().trim().max(40, "Too long."),
  businessAddress: z.string().trim().max(200, "Too long."),
  paymentAccounts: z.string().trim().max(600, "Too long (600 characters at most)."),
  creditTermsDays: z.coerce.number({ error: "Enter a number of days." }).int("Whole days only.").min(0, "0 or more.").max(365, "At most 365."),
});

export async function saveBusinessProfile(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  return guarded("settings.manage", async (user) => {
    const parsed = profileSchema.safeParse({
      businessName: formString(fd, "businessName"),
      businessPhone: formString(fd, "businessPhone"),
      businessAddress: formString(fd, "businessAddress"),
      paymentAccounts: formString(fd, "paymentAccounts").replace(/\r\n/g, "\n"),
      creditTermsDays: formString(fd, "creditTermsDays") || "30",
    });
    if (!parsed.success) return invalid(parsed.error, values);
    const next: Record<string, string | number> = { ...parsed.data };

    const rows = await db.setting.findMany({ where: { key: { in: Object.keys(next) } } });
    const before = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    await db.$transaction(async (tx) => {
      for (const [key, value] of Object.entries(next)) {
        await tx.setting.upsert({ where: { key }, update: { value, updatedById: user.id }, create: { key, value, updatedById: user.id } });
      }
      const d = diffFields(before as Record<string, unknown>, next);
      if (d.changed) await writeAudit(tx, { user, action: "setting.update", entityType: "Setting", entityId: "businessProfile", before: d.before, after: d.after });
    });
    revalidatePath("/", "layout");
    return { ok: true, message: "Business details saved." };
  });
}
