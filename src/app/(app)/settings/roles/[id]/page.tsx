import { notFound } from "next/navigation";
import { Alert, PageHeader } from "@/components/ui";
import { canGrant } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { PERMISSIONS, type PermissionKey } from "@/lib/permissions";
import PermissionMatrix from "./PermissionMatrix";
import { resetRoleToDefaults } from "../actions";
import { DEFAULT_ROLES } from "@/lib/permissions";

export const metadata = { title: "Edit role" };

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("roles.manage");
  const { id } = await params;
  const role = await db.role.findUnique({ where: { id }, include: { permissions: { include: { permission: { select: { key: true } } } } } });
  if (!role) notFound();

  const groups = [...new Set(PERMISSIONS.map((p) => p.module))].map((module) => ({
    module,
    permissions: PERMISSIONS.filter((p) => p.module === module).map((p) => ({ key: p.key, label: p.label })),
  }));

  return (
    <>
      <PageHeader title={role.name} description={role.description ?? undefined} back={{ href: "/employees", label: "Roles" }} />
      {role.isSuperAdmin ? (
        <Alert kind="info">The Director role holds every management permission and cannot be restricted, so the business can never be locked out. Daily work (selling and taking payments belongs to Sales / Shop; receiving and releasing goods belongs to Warehouse / Store) is deliberately not given to the Director.</Alert>
      ) : (
        <>
        {role.isSystem && DEFAULT_ROLES.some((r) => r.key === role.key) && (
          <form action={resetRoleToDefaults} className="card card-pad mb-4 flex flex-wrap items-center justify-between gap-3">
            <input type="hidden" name="roleId" value={role.id} />
            <p className="text-sm text-slate-600">Want the recommended setup for this role? This replaces its current permissions (recorded in the audit log).</p>
            <button type="submit" className="btn-secondary">
              Restore recommended permissions
            </button>
          </form>
        )}
        <PermissionMatrix
          roleId={role.id}
          groups={groups}
          granted={role.permissions.map((rp) => rp.permission.key)}
          lockedKeys={PERMISSIONS.filter((p) => !canGrant(user, p.key as PermissionKey)).map((p) => p.key)}
        />
        </>
      )}
    </>
  );
}
