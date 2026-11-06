import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock, Mail, Pencil, Phone, Plus, Search, ShieldCheck, UserCog, Users } from "lucide-react";
import KpiCard from "@/components/dashboard/KpiCard";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";

export const metadata = { title: "Employees" };

const AVATAR = ["bg-navy-700", "bg-emerald-600", "bg-violet-600", "bg-orange-500", "bg-sky-600", "bg-rose-600"] as const;
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(d);

/** "Today 13:27", "3 days ago" or "Never signed in". */
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

/** The team: positions with how many people hold each, and a card for every employee. */
export default async function EmployeesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (!canAny(user, ["employees.view", "employees.manage"])) redirect("/forbidden");
  const canManage = can(user, "employees.manage");
  const sp = await searchParams;
  const q = sp.q?.trim().toLowerCase() ?? "";

  const [employees, roles] = await Promise.all([
    db.user.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }], include: { role: { select: { id: true, name: true, isSuperAdmin: true } } } }),
    db.role.findMany({ orderBy: [{ isSuperAdmin: "desc" }, { name: "asc" }], select: { id: true, name: true, description: true } }),
  ]);
  const showInactive = sp.status === "all";
  const base = employees.filter((e) => (showInactive ? true : e.status === "ACTIVE") && (!q || [e.name, e.username, e.phone ?? "", e.email ?? ""].some((x) => x.toLowerCase().includes(q))));
  const shown = base.filter((e) => !sp.role || e.role.id === sp.role);
  const countOf = (id: string) => base.filter((e) => e.role.id === id).length;
  const activeCount = employees.filter((e) => e.status === "ACTIVE").length;
  const today = dayKey(new Date());
  const signedInToday = employees.filter((e) => e.status === "ACTIVE" && e.lastLoginAt && dayKey(e.lastLoginAt) === today).length;
  const never = employees.filter((e) => e.status === "ACTIVE" && !e.lastLoginAt).length;

  const link = (over: Partial<Search>) => {
    const m = { role: sp.role, q: sp.q, status: sp.status, ...over } as Record<string, string | undefined>;
    const qs = new URLSearchParams(Object.entries(m).filter(([, v]) => v) as [string, string][]).toString();
    return `/employees${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Employees"
        description="Your team and what each position can do."
        actions={
          <>
            {can(user, "roles.manage") && (
              <Link href="/settings/roles" className="btn-secondary">
                <ShieldCheck size={16} /> Positions
              </Link>
            )}
            {canManage && (
              <Link href="/employees/new" className="btn-primary">
                <Plus size={16} /> Add employee
              </Link>
            )}
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fit,minmax(14rem,1fr))]">
        <KpiCard icon={Users} tone="navy" label="Team" value={String(activeCount)} hint={`${roles.length} positions`} />
        <KpiCard icon={Clock} tone="green" label="Signed in today" value={String(signedInToday)} hint="Active people" />
        <KpiCard icon={UserCog} tone={never > 0 ? "yellow" : "slate"} label="Never signed in" value={String(never)} hint={never > 0 ? "Not started yet" : "Everyone has signed in"} />
      </div>

      <section className="mb-5" aria-label="Positions">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Positions</h2>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
          {roles.map((r) => (
            <Link key={r.id} href={link({ role: sp.role === r.id ? undefined : r.id })} aria-current={sp.role === r.id ? "page" : undefined} className={cn("card block px-4 py-3 transition hover:border-navy-200 hover:shadow-md", sp.role === r.id && "border-navy-500 ring-1 ring-navy-500/40")}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">{r.name}</p>
                <span className="rounded-full bg-slate-100 px-2 text-xs font-semibold text-slate-600">{countOf(r.id)}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-slate-500">{r.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <form method="get" className="card card-pad mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
        {sp.role && <input type="hidden" name="role" value={sp.role} />}
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search name, username or phone" className="input pl-9" aria-label="Search employees" />
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
          <EmptyState icon={<UserCog size={22} />} title="No employees match" description="Try another position or clear the search." />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
          {shown.map((e, i) => (
            <div key={e.id} className={cn("card relative flex flex-col overflow-hidden", e.status !== "ACTIVE" && "opacity-70")}>
              <div className="flex items-start gap-3 px-4 py-4">
                <span className={cn("grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-lg font-bold text-white", e.role.isSuperAdmin ? "bg-oil-400 text-[#0a1424]" : AVATAR[i % AVATAR.length])} aria-hidden>
                  {e.name.trim().charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-base font-semibold text-slate-900">
                      {canManage ? (
                        <Link href={`/employees/${e.id}`} className="after:absolute after:inset-0 after:content-[''] hover:text-navy-700">
                          {e.name}
                        </Link>
                      ) : (
                        e.name
                      )}
                    </h3>
                    {e.id === user.id && <span className="text-xs text-slate-400">(you)</span>}
                  </div>
                  <p className="truncate text-xs text-slate-500">@{e.username}</p>
                  <span className={cn("mt-1.5 inline-block", e.role.isSuperAdmin ? "badge-yellow" : "badge-blue")}>{e.role.name}</span>
                </div>
                <StatusBadge status={e.status} />
              </div>
              <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line bg-slate-50/60 px-4 py-2 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <Clock size={12} /> {lastSeen(e.lastLoginAt)}
                </span>
                {e.phone && (
                  <span className="inline-flex items-center gap-1.5">
                    <Phone size={12} /> {e.phone}
                  </span>
                )}
                {e.email && !e.phone && (
                  <span className="inline-flex items-center gap-1.5">
                    <Mail size={12} /> {e.email}
                  </span>
                )}
                {canManage && (
                  <span className="relative z-10 inline-flex items-center gap-1 font-medium text-navy-700">
                    <Pencil size={12} /> Edit
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
