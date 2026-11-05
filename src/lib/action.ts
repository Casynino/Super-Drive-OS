import type { ZodError } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { AuthError, ForbiddenError, authorize } from "@/lib/auth/guard";
import type { SessionUser } from "@/lib/auth/session";
import type { PermissionKey } from "@/lib/permissions";

export type ActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Echo of submitted text values so the form can keep what the user typed after a validation error. */
  values?: Record<string, string>;
};

export const fail = (error: string, fieldErrors?: Record<string, string>, values?: Record<string, string>): ActionState => ({
  error,
  fieldErrors,
  values,
});

/** Submitted text fields (never includes passwords or files). */
export function formValues(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !/password|current|next|confirm/i.test(k)) out[k] = v;
  return out;
}

export function zodErrors(err: ZodError): ActionState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { error: "Please fix the highlighted fields.", fieldErrors };
}

/** Runs a mutation only after the server-side permission check. Unexpected errors still surface to Next's error boundary. */
export async function guarded(
  permission: PermissionKey,
  fn: (user: SessionUser) => Promise<ActionState>,
): Promise<ActionState> {
  try {
    const user = await authorize(permission);
    return await fn(user);
  } catch (e) {
    if (e instanceof AuthError) return fail("Your session has expired. Please sign in again.");
    if (e instanceof ForbiddenError) return fail("You do not have permission to do this.");
    throw e;
  }
}

/** True when the error is a Postgres unique-constraint violation (Prisma P2002). */
export function isUniqueViolation(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export function formString(fd: FormData, name: string) {
  const v = fd.get(name);
  return typeof v === "string" ? v.trim() : "";
}
