"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { canGrant } from "@/lib/auth/can";
import { fail, formString, guarded, type ActionState } from "@/lib/action";
import { DEFAULT_ROLES, PERMISSION_KEYS, type PermissionKey } from "@/lib/permissions";

export async function saveRolePermissions(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded("roles.manage", async (user) => {
    const roleId = formString(fd, "roleId");
    const role = await db.role.findUnique({ where: { id: roleId }, include: { permissions: { include: { permission: true } } } });
    if (!role) return fail("This role no longer exists.");
    if (role.isSuperAdmin) return fail("The Director role always has full access and cannot be edited.");

    const requested = [...new Set(fd.getAll("perm").filter((v): v is string => typeof v === "string"))];
    if (requested.some((k) => !PERMISSION_KEYS.includes(k))) return fail("Unknown permission submitted.");

    const current = new Set(role.permissions.map((rp) => rp.permission.key));

    // Nobody can hand out (or take away) access they do not have themselves. Those checkboxes are
    // disabled in the UI, so they are not submitted; keep whatever the role already has for them.
    const untouchable = new Set(PERMISSION_KEYS.filter((k) => !canGrant(user, k as PermissionKey)));
    const crafted = requested.filter((k) => untouchable.has(k) && !current.has(k));
    if (crafted.length) return fail(`You cannot grant permissions you do not have: ${crafted.join(", ")}.`);
    const final = [...new Set([...requested.filter((k) => !untouchable.has(k)), ...[...current].filter((k) => untouchable.has(k))])];

    const added = final.filter((k) => !current.has(k));
    const removed = [...current].filter((k) => !final.includes(k));
    if (added.length === 0 && removed.length === 0) return { ok: true, message: "No changes." };

    const permRows = await db.permission.findMany({ where: { key: { in: final } }, select: { id: true } });
    await db.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({ data: permRows.map((p) => ({ roleId, permissionId: p.id })) });
      await writeAudit(tx, {
        user,
        action: "role.permissions_changed",
        entityType: "Role",
        entityId: roleId,
        reference: role.name,
        before: { removedOrKept: [...current].sort() },
        after: { added, removed, total: final.length },
      });
    });
    // Sessions read permissions on every request, so the change applies immediately.
    revalidatePath("/settings/roles");
    revalidatePath(`/settings/roles/${roleId}`);
    return { ok: true, message: `Saved. ${added.length} added, ${removed.length} removed.` };
  });
}

/** Puts a built-in role back to the recommended permissions (and name). Owner-only, audited. */
export async function resetRoleToDefaults(fd: FormData): Promise<void> {
  const roleId = formString(fd, "roleId");
  const result = await guarded("roles.manage", async (user) => {
    const role = await db.role.findUnique({ where: { id: roleId }, include: { permissions: { include: { permission: true } } } });
    if (!role || !role.isSystem || role.isSuperAdmin) return fail("This role has no defaults to restore.");
    const def = DEFAULT_ROLES.find((r) => r.key === role.key);
    if (!def) return fail("This role has no defaults to restore.");
    const untouchable = def.permissions.filter((k) => !canGrant(user, k));
    if (untouchable.length) return fail(`You cannot grant permissions you do not have: ${untouchable.join(", ")}.`);

    const before = role.permissions.map((rp) => rp.permission.key).sort();
    const perms = await db.permission.findMany({ where: { key: { in: def.permissions } }, select: { id: true } });
    await db.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId, permissionId: p.id })) });
      await tx.role.update({ where: { id: roleId }, data: { name: def.name, description: def.description } });
      await writeAudit(tx, { user, action: "role.reset_to_defaults", entityType: "Role", entityId: roleId, reference: def.name, before: { permissions: before, name: role.name }, after: { permissions: [...def.permissions].sort(), name: def.name } });
    });
    revalidatePath("/settings/roles");
    revalidatePath(`/settings/roles/${roleId}`);
    return { ok: true };
  });
  if (result.error) throw new Error(result.error);
}
