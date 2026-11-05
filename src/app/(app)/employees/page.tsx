import Link from "next/link";
import { Plus, UserCog } from "lucide-react";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Employees" };

export default async function EmployeesPage() {
  const user = await requireUser();
  if (!canAny(user, ["employees.view", "employees.manage"])) redirect("/forbidden");
  const canManage = can(user, "employees.manage");

  const employees = await db.user.findMany({
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: { role: { select: { name: true, isSuperAdmin: true } } },
  });

  return (
    <>
      <PageHeader
        title="Employees"
        description="People who can sign in, and the role that decides what they can do."
        actions={
          canManage && (
            <Link href="/employees/new" className="btn-primary">
              <Plus size={16} /> Add employee
            </Link>
          )
        }
      />
      <div className="card overflow-hidden">
        {employees.length === 0 ? (
          <EmptyState icon={<UserCog size={22} />} title="No employees yet" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="hidden sm:table-cell">Username</th>
                  <th>Role</th>
                  <th className="hidden md:table-cell">Last sign-in</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id}>
                    <td>
                      {canManage ? (
                        <Link href={`/employees/${e.id}`} className="font-medium text-slate-900 hover:text-navy-700 hover:underline">
                          {e.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{e.name}</span>
                      )}
                      {e.id === user.id && <span className="ml-2 text-xs text-slate-400">(you)</span>}
                    </td>
                    <td className="hidden text-slate-600 sm:table-cell">{e.username}</td>
                    <td>
                      <span className={e.role.isSuperAdmin ? "badge-yellow" : "badge-blue"}>{e.role.name}</span>
                    </td>
                    <td className="hidden text-slate-600 md:table-cell">{formatDateTime(e.lastLoginAt)}</td>
                    <td>
                      <StatusBadge status={e.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
