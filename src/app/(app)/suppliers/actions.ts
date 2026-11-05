"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { diffFields, writeAudit } from "@/lib/audit";
import { fail, formString, formValues, guarded, isUniqueViolation, zodErrors, type ActionState } from "@/lib/action";

const schema = z.object({
  name: z.string().trim().min(2, "Enter the supplier name.").max(120, "Too long."),
  contactPerson: z.string().trim().max(100, "Too long.").optional(),
  phone: z.string().trim().max(30, "Too long.").optional(),
  email: z.union([z.literal(""), z.email("Enter a valid email.")]).optional(),
  address: z.string().trim().max(200, "Too long.").optional(),
  notes: z.string().trim().max(500, "Too long.").optional(),
});

export async function saveSupplier(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  const result = await guarded("suppliers.manage", async (user) => {
    const id = formString(fd, "id") || null;
    const parsed = schema.safeParse({
      name: formString(fd, "name"),
      contactPerson: formString(fd, "contactPerson") || undefined,
      phone: formString(fd, "phone") || undefined,
      email: formString(fd, "email").toLowerCase(),
      address: formString(fd, "address") || undefined,
      notes: formString(fd, "notes") || undefined,
    });
    if (!parsed.success) return { ...zodErrors(parsed.error), values };
    const status = formString(fd, "status") === "INACTIVE" ? "INACTIVE" : "ACTIVE";
    const d = parsed.data;
    const data = { name: d.name, contactPerson: d.contactPerson ?? null, phone: d.phone ?? null, email: d.email || null, address: d.address ?? null, notes: d.notes ?? null };

    const dup = await db.supplier.findFirst({ where: { name: { equals: data.name, mode: "insensitive" }, ...(id ? { NOT: { id } } : {}) } });
    if (dup) return fail("Please fix the highlighted fields.", { name: "A supplier with this name already exists." }, values);

    try {
      return await db.$transaction(async (tx) => {
        if (!id) {
          const s = await tx.supplier.create({ data });
          await writeAudit(tx, { user, action: "supplier.create", entityType: "Supplier", entityId: s.id, reference: s.name, after: data });
          return { ok: true, message: s.id } as ActionState;
        }
        const before = await tx.supplier.findUniqueOrThrow({ where: { id } });
        await tx.supplier.update({ where: { id }, data: { ...data, status } });
        const prev = { name: before.name, contactPerson: before.contactPerson, phone: before.phone, email: before.email, address: before.address, notes: before.notes, status: before.status };
        const d2 = diffFields(prev, { ...data, status });
        if (d2.changed) await writeAudit(tx, { user, action: "supplier.update", entityType: "Supplier", entityId: id, reference: data.name, before: d2.before, after: d2.after });
        return { ok: true, message: "Supplier saved." } as ActionState;
      });
    } catch (e) {
      if (isUniqueViolation(e)) return fail("Please fix the highlighted fields.", { name: "A supplier with this name already exists." }, values);
      throw e;
    } finally {
      revalidatePath("/suppliers");
    }
  });
  if (result.ok && !formString(fd, "id") && result.message) redirect(`/suppliers/${result.message}?created=1`);
  return result;
}
