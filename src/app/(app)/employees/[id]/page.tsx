import { notFound } from "next/navigation";
import { Alert, PageHeader, StatusBadge } from "@/components/ui";
import EntityForm from "@/components/EntityForm";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/utils";
import { resetEmployeePassword, updateEmployee } from "../actions";

export const metadata = { title: "Employee" };

export default async function EmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const actor = await requirePagePermission("employees.manage");
  const { id } = await params;
  const sp = await searchParams;

  const [employee, roles] = await Promise.all([
    db.user.findUnique({ where: { id }, include: { role: true } }),
    db.role.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, isSuperAdmin: true } }),
  ]);
  if (!employee) notFound();

  const locked = employee.role.isSuperAdmin && !actor.isSuperAdmin;
  const isSelf = employee.id === actor.id;
  const roleOptions = roles
    .filter((r) => actor.isSuperAdmin || !r.isSuperAdmin)
    .map((r) => ({ value: r.id, label: r.name }));
  if (!roleOptions.some((o) => o.value === employee.roleId)) roleOptions.unshift({ value: employee.roleId, label: employee.role.name });

  return (
    <>
      <PageHeader
        title={employee.name}
        description={`@${employee.username} · Last sign-in ${formatDateTime(employee.lastLoginAt)}`}
        back={{ href: "/employees", label: "Employees" }}
        actions={<StatusBadge status={employee.status} />}
      />
      {sp.created && (
        <div className="mb-4">
          <Alert kind="success">Employee created. Give them their username and temporary password.</Alert>
        </div>
      )}
      {locked && (
        <div className="mb-4">
          <Alert kind="info">This is a Super Admin account. Only a Super Admin can change it.</Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card card-pad">
          <h2 className="mb-4 text-base font-semibold text-slate-900">Details &amp; access</h2>
          <EntityForm
            action={updateEmployee}
            submitLabel="Save changes"
            hidden={{ id: employee.id, ...(isSelf ? { roleId: employee.roleId, status: employee.status } : {}) }}
            disabled={locked}
            fields={[
              { name: "name", label: "Full name", value: employee.name, required: true, span: 2 },
              { name: "email", label: "Email", type: "email", value: employee.email ?? "" },
              { name: "phone", label: "Phone", value: employee.phone ?? "" },
              {
                name: "roleId",
                label: "Role",
                type: "select",
                value: employee.roleId,
                options: roleOptions,
                disabled: isSelf,
                hint: isSelf ? "You cannot change your own role." : undefined,
              },
              {
                name: "status",
                label: "Status",
                type: "select",
                value: employee.status,
                disabled: isSelf,
                options: [
                  { value: "ACTIVE", label: "Active" },
                  { value: "INACTIVE", label: "Inactive (cannot sign in)" },
                ],
              },
            ]}
          />
          {isSelf && <p className="hint mt-3">Your role and status are kept as they are, so you cannot lock yourself out.</p>}
        </div>

        {!isSelf && !locked && (
          <div className="card card-pad self-start">
            <h2 className="mb-1 text-base font-semibold text-slate-900">Reset password</h2>
            <p className="mb-4 text-sm text-slate-500">Signs them out everywhere. They must choose their own password at next sign-in.</p>
            <EntityForm
              action={resetEmployeePassword}
              submitLabel="Reset password"
              submitClass="btn-danger"
              hidden={{ id: employee.id }}
              fields={[{ name: "password", label: "Temporary password", type: "password", required: true, autoComplete: "new-password", span: 2 }]}
            />
          </div>
        )}
      </div>
    </>
  );
}
