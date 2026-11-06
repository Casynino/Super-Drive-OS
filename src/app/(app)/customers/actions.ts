"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma, type CustomerType } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { diffFields, writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import { fail, formString, formValues, guarded, type ActionState } from "@/lib/action";
import { parseMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";
import { customerTypeSchema } from "./types";

const baseSchema = z.object({
  name: z.string().trim().min(2, "Enter the customer or business name.").max(120, "Too long."),
  contactPerson: z.string().trim().max(100, "Too long.").optional(),
  phone: z.string().trim().max(30, "Too long.").optional(),
  businessLocation: z.string().trim().max(150, "Too long.").optional(),
  type: customerTypeSchema,
  notes: z.string().trim().max(500, "Too long.").optional(),
});

/** Same name AND same phone is almost certainly the same customer registered twice. */
async function findDuplicate(name: string, phone: string | null, exceptId: string | null) {
  return db.customer.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, phone: phone ?? null, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  });
}

export async function saveCustomer(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  const id = formString(fd, "id") || null;
  const result = await guarded(id ? "customers.edit" : "customers.create", async (user) => {
    const currency = await getCurrency();
    const parsed = baseSchema.safeParse({
      name: formString(fd, "name"),
      contactPerson: formString(fd, "contactPerson") || undefined,
      phone: formString(fd, "phone") || undefined,
      businessLocation: formString(fd, "businessLocation") || undefined,
      type: formString(fd, "type") || "RETAIL",
      notes: formString(fd, "notes") || undefined,
    });
    const errors: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message;

    // Credit limit: only people allowed to set limits can change it (new customers start at 0 = no credit).
    const canLimit = can(user, "credit.set_limit");
    let creditLimit: Prisma.Decimal | null = null;
    if (canLimit) {
      const raw = formString(fd, "creditLimit") || "0";
      creditLimit = parseMoney(raw, currency.decimals);
      if (!creditLimit) errors.creditLimit = currency.decimals === 0 ? "Enter a whole amount (0 = no credit)." : "Enter a valid amount.";
    }
    if (Object.keys(errors).length || !parsed.success) return fail("Please fix the highlighted fields.", errors, values);
    const d = parsed.data;

    const existing = id ? await db.customer.findUnique({ where: { id } }) : null;
    if (id && !existing) return fail("This customer no longer exists.");
    // A customer who can buy on credit must be registered with a phone number: it is how we remind them when payment is late.
    if ((creditLimit ?? existing?.creditLimit ?? new Prisma.Decimal(0)).gt(0) && !d.phone) {
      return fail("Please fix the highlighted fields.", { phone: "A phone number is needed for customers who buy on credit (for payment reminders)." }, values);
    }
    if (await findDuplicate(d.name, d.phone ?? null, id)) {
      return fail("Please fix the highlighted fields.", { name: "A customer with this name and phone number already exists." }, values);
    }

    const canDeactivate = can(user, "customers.deactivate");
    const status = existing && canDeactivate && formString(fd, "status") === "INACTIVE" ? "INACTIVE" : existing && canDeactivate ? "ACTIVE" : (existing?.status ?? "ACTIVE");
    const data = {
      name: d.name,
      contactPerson: d.contactPerson ?? null,
      phone: d.phone ?? null,
      businessLocation: d.businessLocation ?? null,
      type: d.type as CustomerType,
      notes: d.notes ?? null,
      creditLimit: creditLimit ?? existing?.creditLimit ?? new Prisma.Decimal(0),
      status,
    };

    const saved = await db.$transaction(async (tx) => {
      if (!existing) {
        const c = await tx.customer.create({ data: { ...data, createdById: user.id } });
        await writeAudit(tx, { user, action: "customer.create", entityType: "Customer", entityId: c.id, reference: c.name, after: { ...data, creditLimit: data.creditLimit.toString() } });
        return c;
      }
      const c = await tx.customer.update({ where: { id: existing.id }, data });
      const before = { name: existing.name, contactPerson: existing.contactPerson, phone: existing.phone, businessLocation: existing.businessLocation, type: existing.type, notes: existing.notes };
      const diff = diffFields(before, { name: data.name, contactPerson: data.contactPerson, phone: data.phone, businessLocation: data.businessLocation, type: data.type, notes: data.notes });
      const base = { user, entityType: "Customer", entityId: c.id, reference: c.name };
      if (diff.changed) await writeAudit(tx, { ...base, action: "customer.update", before: diff.before, after: diff.after });
      if (!existing.creditLimit.eq(data.creditLimit)) {
        await writeAudit(tx, { ...base, action: "customer.credit_limit_change", before: { creditLimit: existing.creditLimit.toString() }, after: { creditLimit: data.creditLimit.toString() } });
      }
      if (existing.status !== status) {
        await writeAudit(tx, { ...base, action: status === "INACTIVE" ? "customer.deactivate" : "customer.activate", before: { status: existing.status }, after: { status } });
      }
      return c;
    });
    revalidatePath("/customers");
    return { ok: true, message: existing ? "Customer saved." : saved.id };
  });
  if (result.ok && !id && result.message) redirect(`/customers/${result.message}?created=1`);
  return result;
}

export type QuickCustomer = { id: string; name: string; phone: string | null; type: string };

/** Called from the POS to register a customer in a few seconds (name, phone, type). Credit limit starts at 0. */
export async function quickCreateCustomer(input: { name: string; phone: string; type: string }): Promise<{ ok: true; customer: QuickCustomer } | { ok: false; error: string }> {
  const out: { customer?: QuickCustomer } = {};
  const result = await guarded("customers.create", async (user) => {
    const parsed = baseSchema.pick({ name: true, phone: true, type: true }).safeParse({ name: input.name?.trim(), phone: input.phone?.trim() || undefined, type: input.type || "RETAIL" });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the details.");
    const { name, phone, type } = parsed.data;
    if (await findDuplicate(name, phone ?? null, null)) return fail("A customer with this name and phone number already exists. Search for them instead.");
    const c = await db.$transaction(async (tx) => {
      const created = await tx.customer.create({ data: { name, phone: phone ?? null, type: type as CustomerType, createdById: user.id } });
      await writeAudit(tx, { user, action: "customer.create", entityType: "Customer", entityId: created.id, reference: name, after: { name, phone, type, source: "POS quick add" } });
      return created;
    });
    out.customer = { id: c.id, name: c.name, phone: c.phone, type: c.type };
    return { ok: true };
  });
  if (result.error || !out.customer) return { ok: false, error: result.error ?? "Could not add the customer." };
  return { ok: true, customer: out.customer };
}
