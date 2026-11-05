import { notFound } from "next/navigation";
import { Alert, PageHeader } from "@/components/ui";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { PERMISSIONS, type PermissionKey } from "@/lib/permissions";
import PermissionMatrix from "./PermissionMatrix";

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
      <PageHeader title={role.name} description={role.description ?? undefined} back={{ href: "/settings/roles", label: "Roles & permissions" }} />
      {role.isSuperAdmin ? (
        <Alert kind="info">The Super Admin role always has every permission. It cannot be restricted, so the business can never be locked out.</Alert>
      ) : (
        <PermissionMatrix
          roleId={role.id}
          groups={groups}
          granted={role.permissions.map((rp) => rp.permission.key)}
          lockedKeys={PERMISSIONS.filter((p) => !can(user, p.key as PermissionKey)).map((p) => p.key)}
        />
      )}
    </>
  );
}
