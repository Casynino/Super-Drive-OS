"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { diffFields, writeAudit } from "@/lib/audit";
import { fail, formString, formValues, guarded, isUniqueViolation, type ActionState } from "@/lib/action";
import { hashPassword, passwordSchema } from "@/lib/auth/password";
import type { SessionUser } from "@/lib/auth/session";

const profileSchema = z.object({
  name: z.string().trim().min(2, "Enter the full name.").max(100, "Too long."),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,32}$/, "3–32 characters: letters, numbers, dot, dash or underscore."),
  phone: z.string().trim().max(30, "Too long.").optional(),
  roleId: z.string().min(1, "Choose a role."),
});

function readEmail(fd: FormData): { email: string | null; error?: string } {
  const raw = formString(fd, "email").toLowerCase();
  if (!raw) return { email: null };
  return z.email().safeParse(raw).success ? { email: raw } : { email: null, error: "Enter a valid email." };
}

const bad = (fieldErrors: Record<string, string>, values: Record<string, string>) => fail("Please fix the highlighted fields.", fieldErrors, values);

/** Only a Super Admin may create, edit or reset another Super Admin (no privilege escalation by lower roles). */
const mayTouch = (actor: SessionUser, targetIsSuperAdmin: boolean) => actor.isSuperAdmin || !targetIsSuperAdmin;

export async function createEmployee(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  const result = await guarded("employees.manage", async (actor) => {
    const parsed = profileSchema.safeParse({
      name: formString(fd, "name"),
      username: formString(fd, "username"),
      phone: formString(fd, "phone") || undefined,
      roleId: formString(fd, "roleId"),
    });
    const pw = passwordSchema.safeParse(fd.get("password"));
    const mail = readEmail(fd);
    const errors: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message;
    if (!pw.success) errors.password = pw.error.issues[0]!.message;
    if (mail.error) errors.email = mail.error;
    if (Object.keys(errors).length || !parsed.success || !pw.success) return bad(errors, values);

    const role = await db.role.findUnique({ where: { id: parsed.data.roleId } });
    if (!role) return bad({ roleId: "Unknown role." }, values);
    if (!mayTouch(actor, role.isSuperAdmin)) return fail("Only a Super Admin can create another Super Admin.", undefined, values);

    const [dupUser, dupMail] = await Promise.all([
      db.user.findUnique({ where: { username: parsed.data.username } }),
      mail.email ? db.user.findUnique({ where: { email: mail.email } }) : null,
    ]);
    if (dupUser) return bad({ username: "This username is taken." }, values);
    if (dupMail) return bad({ email: "This email is already used by another employee." }, values);

    try {
      const created = await db.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            name: parsed.data.name,
            username: parsed.data.username,
            email: mail.email,
            phone: parsed.data.phone ?? null,
            roleId: role.id,
            passwordHash: await hashPassword(pw.data),
            mustChangePassword: true,
          },
        });
        await writeAudit(tx, {
          user: actor,
          action: "user.create",
          entityType: "User",
          entityId: u.id,
          reference: u.username,
          after: { name: u.name, username: u.username, email: u.email, phone: u.phone, role: role.name },
        });
        return u;
      });
      revalidatePath("/employees");
      return { ok: true, message: created.id };
    } catch (e) {
      if (isUniqueViolation(e)) return bad({ username: "This username or email is already used." }, values);
      throw e;
    }
  });
  if (result.ok && result.message) redirect(`/employees/${result.message}?created=1`);
  return result;
}

export async function updateEmployee(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  return guarded("employees.manage", async (actor) => {
    const id = formString(fd, "id");
    const parsed = profileSchema.omit({ username: true }).safeParse({
      name: formString(fd, "name"),
      phone: formString(fd, "phone") || undefined,
      roleId: formString(fd, "roleId"),
    });
    const mail = readEmail(fd);
    const status = formString(fd, "status") === "INACTIVE" ? "INACTIVE" : "ACTIVE";
    const errors: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message;
    if (mail.error) errors.email = mail.error;
    if (Object.keys(errors).length || !parsed.success) return bad(errors, values);

    const [target, newRole] = await Promise.all([
      db.user.findUnique({ where: { id }, include: { role: true } }),
      db.role.findUnique({ where: { id: parsed.data.roleId } }),
    ]);
    if (!target) return fail("This employee no longer exists.");
    if (!newRole) return bad({ roleId: "Unknown role." }, values);
    if (!mayTouch(actor, target.role.isSuperAdmin) || !mayTouch(actor, newRole.isSuperAdmin)) {
      return fail("Only a Super Admin can change a Super Admin account or assign that role.", undefined, values);
    }
    const isSelf = target.id === actor.id;
    if (isSelf && (newRole.id !== target.roleId || status !== target.status)) {
      return fail("You cannot change your own role or deactivate your own account.", undefined, values);
    }
    if (mail.email && mail.email !== target.email) {
      const dup = await db.user.findUnique({ where: { email: mail.email } });
      if (dup) return bad({ email: "This email is already used by another employee." }, values);
    }

    const losesSuperAdmin = target.role.isSuperAdmin && target.status === "ACTIVE" && (!newRole.isSuperAdmin || status === "INACTIVE");

    try {
      await db.$transaction(async (tx) => {
        if (losesSuperAdmin) {
          const others = await tx.user.count({ where: { id: { not: target.id }, status: "ACTIVE", role: { isSuperAdmin: true } } });
          if (others === 0) throw new LastSuperAdminError();
        }
        await tx.user.update({
          where: { id },
          data: { name: parsed.data.name, phone: parsed.data.phone ?? null, email: mail.email, roleId: newRole.id, status },
        });
        if (status === "INACTIVE") await tx.session.deleteMany({ where: { userId: id } }); // sign them out now

        const prof = diffFields(
          { name: target.name, phone: target.phone, email: target.email },
          { name: parsed.data.name, phone: parsed.data.phone ?? null, email: mail.email },
        );
        const base = { user: actor, entityType: "User", entityId: id, reference: target.username };
        if (prof.changed) await writeAudit(tx, { ...base, action: "user.update", before: prof.before, after: prof.after });
        if (newRole.id !== target.roleId) {
          await writeAudit(tx, { ...base, action: "user.role_change", before: { role: target.role.name }, after: { role: newRole.name } });
        }
        if (status !== target.status) {
          await writeAudit(tx, {
            ...base,
            action: status === "INACTIVE" ? "user.deactivate" : "user.activate",
            before: { status: target.status },
            after: { status },
          });
        }
      });
    } catch (e) {
      if (e instanceof LastSuperAdminError) return fail("There must always be at least one active Super Admin.", undefined, values);
      if (isUniqueViolation(e)) return bad({ email: "This email is already used by another employee." }, values);
      throw e;
    }
    revalidatePath("/employees");
    revalidatePath(`/employees/${id}`);
    return { ok: true, message: "Employee saved." };
  });
}

class LastSuperAdminError extends Error {}

export async function resetEmployeePassword(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded("employees.manage", async (actor) => {
    const id = formString(fd, "id");
    const pw = passwordSchema.safeParse(fd.get("password"));
    if (!pw.success) return fail("Please fix the highlighted fields.", { password: pw.error.issues[0]!.message });

    const target = await db.user.findUnique({ where: { id }, include: { role: true } });
    if (!target) return fail("This employee no longer exists.");
    if (!mayTouch(actor, target.role.isSuperAdmin)) return fail("Only a Super Admin can reset a Super Admin's password.");
    if (target.id === actor.id) return fail("Use “My account” to change your own password.");

    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { passwordHash: await hashPassword(pw.data), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
      });
      await tx.session.deleteMany({ where: { userId: id } });
      await writeAudit(tx, { user: actor, action: "user.password_reset", entityType: "User", entityId: id, reference: target.username });
    });
    return { ok: true, message: "Password reset. They must choose a new one at next sign-in." };
  });
}
