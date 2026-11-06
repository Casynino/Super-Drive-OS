import EmployeeForm from "@/components/employees/EmployeeForm";
import { PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { createEmployee } from "../actions";

export const metadata = { title: "Add employee" };

export default async function NewEmployeePage() {
  const user = await requirePagePermission("employees.manage");
  const roles = await db.role.findMany({
    where: user.isSuperAdmin ? {} : { isSuperAdmin: false },
    orderBy: [{ isSuperAdmin: "desc" }, { name: "asc" }],
    include: { _count: { select: { permissions: true } } },
  });

  return (
    <>
      <PageHeader title="Add employee" description="Who they are, their position, and a password for the first sign-in." back={{ href: "/employees", label: "Employees" }} />
      <div className="card card-pad max-w-3xl">
        <EmployeeForm action={createEmployee} roles={roles.map((r) => ({ id: r.id, name: r.name, description: r.description ?? "", full: r.isSuperAdmin, permissions: r._count.permissions, total: PERMISSIONS.length }))} />
      </div>
    </>
  );
}
