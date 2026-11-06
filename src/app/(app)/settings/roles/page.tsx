import Link from "next/link";
import { Plus, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";

export const metadata = { title: "Roles & permissions" };

export default async function RolesPage() {
  await requirePagePermission("roles.manage");
  const roles = await db.role.findMany({
    orderBy: [{ isSuperAdmin: "desc" }, { name: "asc" }],
    include: { _count: { select: { users: true, permissions: true } } },
  });

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="Choose exactly what each role can see and do. Changes apply immediately, no code needed."
        back={{ href: "/settings", label: "Settings" }}
        actions={
          <Link href="/settings/roles/new" className="btn-primary">
            <Plus size={16} /> Add a position
          </Link>
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        {roles.map((r) => (
          <Link key={r.id} href={`/settings/roles/${r.id}`} className="card card-pad block transition hover:border-navy-200 hover:shadow-md">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy-50 text-navy-700">
                  <ShieldCheck size={18} />
                </span>
                <h2 className="text-base font-semibold text-slate-900">{r.name}</h2>
              </div>
              <span className={r.isSuperAdmin ? "badge-yellow" : "badge-blue"}>
                {r.isSuperAdmin ? "Full access" : `${r._count.permissions} of ${PERMISSIONS.length}`}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-500">{r.description}</p>
            <p className="mt-3 text-xs font-medium text-slate-500">
              {r._count.users} {r._count.users === 1 ? "person" : "people"}
            </p>
          </Link>
        ))}
      </div>
    </>
  );
}
