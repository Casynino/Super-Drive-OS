import EmployeeForm from "@/components/employees/EmployeeForm";
import { PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { byPositionRank } from "@/lib/permissions";
import { createEmployee } from "../actions";

export const metadata = { title: "Add member" };

export default async function NewEmployeePage() {
  const user = await requirePagePermission("employees.manage");
  const rolesRaw = await db.role.findMany({
    where: user.isSuperAdmin ? {} : { isSuperAdmin: false },
    orderBy: [{ isSuperAdmin: "desc" }, { name: "asc" }],
    include: { permissions: { select: { permission: { select: { module: true } } } } },
  });
  const roles = [...rolesRaw].sort(byPositionRank);

  return (
    <>
      <PageHeader title="Add member" description="Who they are, their role, and a password for the first sign-in." back={{ href: "/employees", label: "Roles" }} />
      <EmployeeForm action={createEmployee} roles={roles.map((r) => ({ id: r.id, name: r.name, description: r.description ?? "", full: r.isSuperAdmin, modules: [...new Set(r.permissions.map((p) => p.permission.module))] }))} />
    </>
  );
}
