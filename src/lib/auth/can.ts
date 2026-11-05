import { SHOP_FLOOR_PERMISSIONS, type PermissionKey } from "@/lib/permissions";

type PermissionHolder = { isSuperAdmin: boolean; permissions: ReadonlySet<string> };

/**
 * Whether the person may DO something. A Super Admin (the business owner) has every management permission,
 * but NOT the shop-floor jobs (selling, receiving, payments, expenses, closing): those only count when the
 * role explicitly has them. Pure - safe to import anywhere.
 */
export function can(user: PermissionHolder, key: PermissionKey) {
  if (user.permissions.has(key)) return true;
  return user.isSuperAdmin && !SHOP_FLOOR_PERMISSIONS.has(key);
}

/** Whether the person may HAND OUT a permission to a role. The owner may grant shop-floor permissions to staff even though the owner does not use them personally. */
export function canGrant(user: PermissionHolder, key: PermissionKey) {
  return user.isSuperAdmin || user.permissions.has(key);
}

export function canAny(user: PermissionHolder, keys: readonly PermissionKey[]) {
  return keys.some((k) => can(user, k));
}
