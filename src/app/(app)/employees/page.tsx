import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { byPositionRank } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export const metadata = { title: "Roles" };

const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(d);

/** "Today 13:27", "Yesterday 09:10", "3 days ago" or "Never signed in". */
function lastSeen(d: Date | null) {
  if (!d) return "Never signed in";
  const today = dayKey(new Date());
  const day = dayKey(d);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }).format(d);
  if (day === today) return `Today ${time}`;
  const n = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
  return n === 1 ? `Yesterday ${time}` : `${n} days ago`;
}

type Search = { q?: string; status?: string };

/**
 * The Roles page: the three roles, Director on top, and under each one the people who hold it.
 * Press a person to open them (their details and everything they have done); add a member from the button.
 */
export default async function EmployeesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (!canAny(user, ["employees.view", "employees.manage"])) redirect("/forbidden");
  const canManage = can(user, "employees.manage");
  const sp = await searchParams;
  const q = sp.q?.trim().toLowerCase() ?? "";

  const [employees, rolesRaw] = await Promise.all([
    db.user.findMany({ orderBy: [{ name: "asc" }], include: { role: { select: { id: true } } } }),
    db.role.findMany({ select: { id: true, key: true, name: true, description: true, isSuperAdmin: true } }),
  ]);
  const roles = [...rolesRaw].sort(byPositionRank); // Admin first
  const showInactive = sp.status === "all";
  const shown = employees.filter((e) => (showInactive ? true : e.status === "ACTIVE") && (!q || [e.name, e.username, e.phone ?? "", e.email ?? ""].some((x) => x.toLowerCase().includes(q))));

  return (
    <>
      <PageHeader
        title="Roles"
        description="Director, warehouse / store and sales / shop: who holds each role."
        actions={
          canManage && (
            <Link href="/employees/new" className="btn-primary">
              <Plus size={16} /> Add member
            </Link>
          )
        }
      />

      <form method="get" className="card card-pad mb-5 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search name, username or phone" className="input pl-9" aria-label="Search members" />
        </div>
        <select name="status" defaultValue={sp.status ?? ""} className="input" aria-label="Status">
          <option value="">Active only</option>
          <option value="all">Including inactive</option>
        </select>
        <button className="btn-primary" type="submit">
          Apply
        </button>
        {(sp.q || sp.status) && (
          <Link href="/employees" className="btn-secondary">
            Clear
          </Link>
        )}
      </form>

      <div className="space-y-6">
        {roles.map((r) => {
          const people = shown.filter((e) => e.role.id === r.id);
          return (
            <section key={r.id} aria-label={r.name}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2 className="text-base font-semibold text-slate-900">
                  {r.name} <span className="ml-1 text-sm font-normal text-slate-500">{people.length}</span>
                </h2>
                {can(user, "roles.manage") && !r.isSuperAdmin && (
                  <Link href={`/settings/roles/${r.id}`} className="text-sm font-medium text-navy-700 hover:underline">
                    What this role can do
                  </Link>
                )}
              </div>
              <div className="card overflow-hidden">
                {people.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-slate-500">Nobody holds this role yet.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="table w-full md:table-fixed">
                      {/* the same column widths in every role, so names, phones and dates line up from one role to the next */}
                      <colgroup>
                        <col className="md:w-[27%]" />
                        <col className="md:w-[19%]" />
                        <col className="md:w-[19%]" />
                        <col className="md:w-[22%]" />
                        <col className="md:w-[13%]" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Username</th>
                          <th className="hidden sm:table-cell">Phone</th>
                          <th className="hidden md:table-cell">Last sign-in</th>
                          <th className="text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {people.map((e) => (
                          <tr key={e.id} className={cn("relative", e.status !== "ACTIVE" && "opacity-60")}>
                            <td className="font-medium">
                              <Link href={`/employees/${e.id}`} className="after:absolute after:inset-0 after:content-[''] hover:text-navy-700">
                                {e.name}
                              </Link>
                              {e.id === user.id && <span className="ml-2 text-xs font-normal text-slate-400">(you)</span>}
                            </td>
                            <td className="text-slate-600">@{e.username}</td>
                            <td className="hidden text-slate-600 sm:table-cell">{e.phone ?? "—"}</td>
                            <td className="hidden text-slate-600 md:table-cell">{lastSeen(e.lastLoginAt)}</td>
                            <td className={cn("text-right text-sm", e.status === "ACTIVE" ? "text-emerald-600" : "text-slate-500")}>{e.status === "ACTIVE" ? "Active" : "Inactive"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
