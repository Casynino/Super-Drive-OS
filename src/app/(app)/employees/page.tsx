import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Clock, Phone, Plus, Search, SlidersHorizontal, UserCog } from "lucide-react";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { byPositionRank } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export const metadata = { title: "Roles" };

const AVATAR = ["bg-navy-700", "bg-emerald-600", "bg-violet-600", "bg-orange-500", "bg-sky-600", "bg-rose-600"] as const;
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

type Search = { role?: string; q?: string; status?: string };

/** The Roles page: just the members, each with their role. Press a member to open them; add a member from the button. */
export default async function EmployeesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (!canAny(user, ["employees.view", "employees.manage"])) redirect("/forbidden");
  const canManage = can(user, "employees.manage");
  const sp = await searchParams;
  const q = sp.q?.trim().toLowerCase() ?? "";

  const [employees, rolesRaw] = await Promise.all([
    db.user.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }], include: { role: { select: { id: true, name: true, isSuperAdmin: true } } } }),
    db.role.findMany({ select: { id: true, key: true, name: true, isSuperAdmin: true } }),
  ]);
  const roles = [...rolesRaw].sort(byPositionRank); // lowest role first, the owner last
  const showInactive = sp.status === "all";
  const base = employees.filter((e) => (showInactive ? true : e.status === "ACTIVE") && (!q || [e.name, e.username, e.phone ?? "", e.email ?? ""].some((x) => x.toLowerCase().includes(q))));
  const shown = base.filter((e) => !sp.role || e.role.id === sp.role);

  const link = (over: Partial<Search>) => {
    const m = { role: sp.role, q: sp.q, status: sp.status, ...over } as Record<string, string | undefined>;
    const qs = new URLSearchParams(Object.entries(m).filter(([, v]) => v) as [string, string][]).toString();
    return `/employees${qs ? `?${qs}` : ""}`;
  };
  const pill = (on: boolean) => cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition", on ? "border-navy-600 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900");

  return (
    <>
      <PageHeader
        title="Roles"
        description="The team and the role each person holds."
        actions={
          canManage && (
            <Link href="/employees/new" className="btn-primary">
              <Plus size={16} /> Add member
            </Link>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2" aria-label="Filter by role">
        <Link href={link({ role: undefined })} className={pill(!sp.role)}>
          All <span className="text-xs opacity-80">{base.length}</span>
        </Link>
        {roles.map((r) => (
          <Link key={r.id} href={link({ role: sp.role === r.id ? undefined : r.id })} className={pill(sp.role === r.id)}>
            {r.name} <span className="text-xs opacity-80">{base.filter((e) => e.role.id === r.id).length}</span>
          </Link>
        ))}
      </div>

      <form method="get" className="card card-pad mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
        {sp.role && <input type="hidden" name="role" value={sp.role} />}
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
        {(sp.q || sp.role || sp.status) && (
          <Link href="/employees" className="btn-secondary">
            Clear
          </Link>
        )}
      </form>

      {shown.length === 0 ? (
        <div className="card">
          <EmptyState icon={<UserCog size={22} />} title="Nobody found" description="Try another role or clear the search." />
        </div>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {shown.map((e, i) => (
            <li key={e.id} className={cn(e.status !== "ACTIVE" && "opacity-70")}>
              <Link href={`/employees/${e.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50">
                <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full text-base font-bold text-white", e.role.isSuperAdmin ? "bg-oil-400 text-[#0a1424]" : AVATAR[i % AVATAR.length])} aria-hidden>
                  {e.name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="truncate text-sm font-semibold text-slate-900">{e.name}</span>
                    {e.id === user.id && <span className="text-xs text-slate-400">(you)</span>}
                    <span className={e.role.isSuperAdmin ? "badge-yellow" : "badge-blue"}>{e.role.name}</span>
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-slate-500">
                    <span>@{e.username}</span>
                    {e.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone size={11} /> {e.phone}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Clock size={11} /> {lastSeen(e.lastLoginAt)}
                    </span>
                  </span>
                </span>
                <span className="hidden sm:block">
                  <StatusBadge status={e.status} />
                </span>
                <ChevronRight size={16} className="shrink-0 text-slate-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {can(user, "roles.manage") && (
        <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <SlidersHorizontal size={14} /> What each role can do:
          </span>
          {roles
            .filter((r) => !r.isSuperAdmin)
            .map((r) => (
              <Link key={r.id} href={`/settings/roles/${r.id}`} className="font-medium text-navy-700 hover:underline">
                {r.name}
              </Link>
            ))}
        </p>
      )}
    </>
  );
}
