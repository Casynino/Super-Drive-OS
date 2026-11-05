import type { PermissionKey } from "@/lib/permissions";

type PermissionHolder = { isSuperAdmin: boolean; permissions: ReadonlySet<string> };

/** Super admins always pass; everyone else needs the permission on their role. Pure - safe to import anywhere. */
export function can(user: PermissionHolder, key: PermissionKey) {
  return user.isSuperAdmin || user.permissions.has(key);
}

export function canAny(user: PermissionHolder, keys: readonly PermissionKey[]) {
  return keys.some((k) => can(user, k));
}
