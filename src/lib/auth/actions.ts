"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { fail, zodErrors, formString, isUniqueViolation, type ActionState } from "@/lib/action";
import { getDummyHash, hashPassword, passwordSchema, verifyPassword } from "./password";
import { SESSION_COOKIE, createSession, destroySession, getSessionUser } from "./session";

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const loginSchema = z.object({
  email: z.string().trim().min(1, "Enter your email address.").max(254),
  password: z.string().min(1, "Enter your password.").max(200),
});

export async function login(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({ email: formString(formData, "email"), password: formData.get("password") });
  if (!parsed.success) return zodErrors(parsed.error);

  const email = parsed.data.email.toLowerCase();
  const keep = { email: parsed.data.email }; // the typed email stays in the box after a failed attempt
  const genericError = fail("Invalid email or password.", undefined, keep);
  const user = await db.user.findUnique({ where: { email } });

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    return fail(`Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`, undefined, keep);
  }

  const valid = await verifyPassword(parsed.data.password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !valid) {
    if (user) {
      const failed = user.failedLoginCount + 1;
      const lock = failed >= MAX_FAILED;
      await db.user.update({
        where: { id: user.id },
        data: { failedLoginCount: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60000) : null },
      });
      await writeAudit(db, {
        user: { id: user.id, name: user.name },
        action: lock ? "auth.locked" : "auth.login_failed",
        entityType: "User",
        entityId: user.id,
      });
    } else {
      // somebody typed an email that does not exist: the Admin should know
      await writeAudit(db, { user: null, action: "auth.login_unknown", entityType: "User", reference: email.slice(0, 64) });
    }
    return genericError;
  }

  if (user.status !== "ACTIVE") return fail("This account has been deactivated. Contact the business owner.", undefined, keep);

  await db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await createSession(user.id);
  await writeAudit(db, { user: { id: user.id, name: user.name }, action: "auth.login", entityType: "User", entityId: user.id });
  redirect("/dashboard");
}

export async function logout() {
  const user = await getSessionUser();
  await destroySession();
  if (user) await writeAudit(db, { user: { id: user.id, name: user.name }, action: "auth.logout", entityType: "User", entityId: user.id });
  redirect("/login");
}

const profileSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name.").max(100, "Too long."),
  phone: z.string().trim().max(30, "Too long.").optional(),
});

/** A signed-in person edits their OWN name, email (the sign-in name) and phone. Role and status stay with the owner (Employees). */
export async function updateProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSessionUser();
  if (!session) return fail("Your session has expired. Please sign in again.");
  const values = { name: formString(formData, "name"), email: formString(formData, "email"), phone: formString(formData, "phone") };

  const parsed = profileSchema.safeParse({ name: values.name, phone: values.phone || undefined });
  const errors: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message;
  const email = values.email.toLowerCase();
  if (!email) errors.email = "Enter your email address: it is how you sign in.";
  else if (!z.email().safeParse(email).success) errors.email = "Enter a valid email.";
  if (Object.keys(errors).length > 0 || !parsed.success) return fail("Please fix the highlighted fields.", errors, values);

  const before = await db.user.findUniqueOrThrow({ where: { id: session.id }, select: { name: true, email: true, phone: true } });
  const after = { name: parsed.data.name, email, phone: parsed.data.phone ?? null };
  if (after.email && after.email !== before.email && (await db.user.findUnique({ where: { email: after.email }, select: { id: true } }))) {
    return fail("Please fix the highlighted fields.", { email: "This email is already used by another employee." }, values);
  }
  if (before.name === after.name && before.email === after.email && before.phone === after.phone) return { ok: true, message: "Nothing to change.", values };

  try {
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: session.id }, data: after });
      await writeAudit(tx, { user: { id: session.id, name: after.name }, action: "auth.profile_updated", entityType: "User", entityId: session.id, before, after });
    });
  } catch (e) {
    if (isUniqueViolation(e)) return fail("Please fix the highlighted fields.", { email: "This email is already used by another employee." }, values);
    throw e;
  }
  revalidatePath("/", "layout"); // the name in the menu and header changes everywhere
  return { ok: true, message: "Your details are saved.", values };
}

const changeSchema = z
  .object({
    current: z.string().min(1, "Enter your current password."),
    next: passwordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { path: ["confirm"], message: "Passwords do not match." })
  .refine((v) => v.next !== v.current, { path: ["next"], message: "Choose a different password from the current one." });

export async function changePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await getSessionUser();
  if (!session) return fail("Your session has expired. Please sign in again.");

  const parsed = changeSchema.safeParse({
    current: formData.get("current"),
    next: formData.get("next"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return zodErrors(parsed.error);

  const user = await db.user.findUniqueOrThrow({ where: { id: session.id } });
  if (!(await verifyPassword(parsed.data.current, user.passwordHash))) {
    return fail("Please fix the highlighted fields.", { current: "Current password is incorrect." });
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(parsed.data.next), mustChangePassword: false } });
    await tx.session.deleteMany({ where: { userId: user.id } }); // sign out everywhere
    await writeAudit(tx, { user: { id: user.id, name: user.name }, action: "auth.password_changed", entityType: "User", entityId: user.id });
  });

  (await cookies()).delete(SESSION_COOKIE);
  await createSession(user.id);
  redirect("/dashboard");
}
