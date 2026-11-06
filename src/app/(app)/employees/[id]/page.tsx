import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, PageHeader } from "@/components/ui";
import EntityForm from "@/components/EntityForm";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { describeAction } from "@/lib/audit-text";
import { db } from "@/lib/db";
import { businessDay } from "@/lib/cash/ledger";
import { cn } from "@/lib/utils";
import { resetEmployeePassword, updateEmployee } from "../actions";

export const metadata = { title: "Member" };

const TZ = "Africa/Dar_es_Salaam";
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const dayLabel = (d: Date) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: TZ }).format(d);
const timeOf = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(d);
const dateTime = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(d) : "Never");

function ago(d: Date) {
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} day${Math.floor(s / 86400) === 1 ? "" : "s"} ago`;
}

/** One member: who they are and their role, how active they are, the details to edit, and everything they have done. */
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
  const seeActivity = can(actor, "audit.view");
  const todayStart = new Date(`${businessDay()}T00:00:00+03:00`);
  const since30 = new Date(Date.now() - 30 * 86_400_000);

  const [employee, roles, audit, pages, signins, changesToday, pagesToday] = await Promise.all([
    db.user.findUnique({ where: { id }, include: { role: true } }),
    db.role.findMany({ select: { id: true, name: true, isSuperAdmin: true } }),
    seeActivity ? db.auditLog.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, action: true, entityType: true, reference: true, reason: true, createdAt: true } }) : Promise.resolve([]),
    seeActivity ? db.activityLog.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, title: true, path: true, createdAt: true } }) : Promise.resolve([]),
    seeActivity ? db.auditLog.count({ where: { userId: id, action: "auth.login", createdAt: { gte: since30 } } }) : Promise.resolve(0),
    seeActivity ? db.auditLog.count({ where: { userId: id, createdAt: { gte: todayStart }, NOT: { action: { startsWith: "auth." } } } }) : Promise.resolve(0),
    seeActivity ? db.activityLog.count({ where: { userId: id, createdAt: { gte: todayStart } } }) : Promise.resolve(0),
  ]);
  if (!employee) notFound();

  const locked = employee.role.isSuperAdmin && !actor.isSuperAdmin;
  const isSelf = employee.id === actor.id;
  const roleOptions = roles
    .sort((a, b) => Number(b.isSuperAdmin) - Number(a.isSuperAdmin) || a.name.localeCompare(b.name))
    .filter((r) => actor.isSuperAdmin || !r.isSuperAdmin)
    .map((r) => ({ value: r.id, label: r.name }));
  if (!roleOptions.some((o) => o.value === employee.roleId)) roleOptions.unshift({ value: employee.roleId, label: employee.role.name });

  // everything they did, newest first: pages opened, changes made, sign-ins
  type Entry = { key: string; at: Date; text: string; detail: string | null; reason: string | null };
  const timeline: Entry[] = [
    ...audit.map((a) => ({ key: `a${a.id}`, at: a.createdAt, text: describeAction(a.action), detail: a.reference ?? (a.action.startsWith("auth.") ? null : a.entityType), reason: a.reason })),
    ...pages.map((p) => ({ key: `p${p.id}`, at: p.createdAt, text: `Opened ${p.title || p.path}`, detail: null, reason: null })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 60);
  const groups: { day: string; label: string; rows: Entry[] }[] = [];
  for (const e of timeline) {
    const k = dayKey(e.at);
    if (groups.at(-1)?.day !== k) groups.push({ day: k, label: k === businessDay() ? "Today" : dayLabel(e.at), rows: [] });
    groups.at(-1)!.rows.push(e);
  }

  const lastSeen = [employee.lastLoginAt, audit[0]?.createdAt ?? null, pages[0]?.createdAt ?? null].filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const online = lastSeen !== null && Date.now() - lastSeen.getTime() < 5 * 60_000;
  const stat = (label: string, value: string, sub?: string, tone?: string) => (
    <div className="px-4 py-3.5 sm:px-5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn("mt-1 text-lg font-semibold tabular-nums text-slate-900", tone)}>{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );

  return (
    <>
      <PageHeader title={employee.name} description={`@${employee.username} · ${employee.role.name}${employee.status === "ACTIVE" ? "" : " · Inactive"}`} back={{ href: "/employees", label: "Roles" }} />
      {sp.created && (
        <div className="mb-4">
          <Alert kind="success">Member added. Give them their username and temporary password.</Alert>
        </div>
      )}
      {locked && (
        <div className="mb-4">
          <Alert kind="info">This is a Director account. Only a Director can change it.</Alert>
        </div>
      )}

      {seeActivity && (
        <section className="card mb-5 grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x" aria-label="Activity summary">
          {stat("Now", online ? "Online" : lastSeen ? `Seen ${ago(lastSeen)}` : "Never signed in", lastSeen ? dateTime(lastSeen) : undefined, online ? "text-emerald-600" : undefined)}
          {stat("Sign-ins, last 30 days", String(signins), `Last sign-in: ${dateTime(employee.lastLoginAt)}`)}
          {stat("Pages opened today", String(pagesToday))}
          {stat("Changes made today", String(changesToday), "sales, payments, stock and more")}
        </section>
      )}

      <div className={cn("grid items-start gap-5", seeActivity && "lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]")}>
        <div className="space-y-5">
          <div className="card card-pad">
            <h2 className="mb-4 text-base font-semibold text-slate-900">Details &amp; role</h2>
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
            <div className="card card-pad">
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

        {seeActivity && (
          <section className="card overflow-hidden" aria-label="Activity">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
              <h2 className="text-base font-semibold text-slate-900">What {employee.name.split(" ")[0]} did</h2>
              <Link href={`/audit?who=${employee.id}&range=30d`} className="text-sm font-medium text-navy-700 hover:underline">
                Full audit
              </Link>
            </div>
            {groups.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">Nothing recorded yet. Signing in, opening pages and changes will show here.</p>
            ) : (
              <div className="max-h-[44rem] overflow-y-auto">
                {groups.map((g) => (
                  <div key={g.day}>
                    <p className="sticky top-0 border-b border-line bg-slate-50 px-4 py-1.5 text-xs font-semibold text-slate-600 sm:px-5">{g.label}</p>
                    <ul className="divide-y divide-line">
                      {g.rows.map((e) => (
                        <li key={e.key} className="grid grid-cols-[3.2rem_1fr] gap-3 px-4 py-2 text-sm sm:px-5">
                          <span className="tabular-nums text-slate-500">{timeOf(e.at)}</span>
                          <span className="min-w-0">
                            <span className="text-slate-900">{e.text}</span>
                            {e.detail && <span className="ml-2 text-slate-500">{e.detail}</span>}
                            {e.reason && <span className="block text-xs text-slate-500">“{e.reason}”</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </>
  );
}
