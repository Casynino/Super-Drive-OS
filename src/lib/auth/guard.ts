import { redirect } from "next/navigation";
import type { PermissionKey } from "@/lib/permissions";
import { can, canAny } from "./can";
import { getSessionUser, type SessionUser } from "./session";

export class AuthError extends Error {
  constructor() {
    super("Not signed in");
  }
}
export class ForbiddenError extends Error {
  constructor(public permission: string) {
    super(`Missing permission: ${permission}`);
  }
}

export { can, canAny };

/** For pages / layouts: redirects to login when signed out. */
export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** For pages: redirects to /forbidden when the permission is missing. */
export async function requirePagePermission(key: PermissionKey) {
  const user = await requireUser();
  if (!can(user, key)) redirect("/forbidden");
  return user;
}

/** For server actions / route handlers: throws, never redirects. Always call this FIRST in every mutation. */
export async function authorize(key: PermissionKey): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError();
  if (!can(user, key)) throw new ForbiddenError(key);
  return user;
}
