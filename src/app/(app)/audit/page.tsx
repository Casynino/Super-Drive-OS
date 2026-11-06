import Link from "next/link";
import { ScrollText, Search } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { describeAction } from "@/lib/audit-text";
import { businessDay } from "@/lib/cash/ledger";
import { shiftDay } from "@/lib/reports/period";
import { cn } from "@/lib/utils";

export const metadata = { title: "Audit" };

const PAGE_SIZE = 60;
const TABS = [
  { key: "all", label: "Everything", kinds: ["sign", "action", "page"] },
  { key: "sign", label: "Sign-ins", kinds: ["sign"] },
  { key: "action", label: "Changes", kinds: ["action"] },
  { key: "page", label: "Pages opened", kinds: ["page"] },
] as const;
const RANGES = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "all", label: "All time" },
] as const;

type Search = { tab?: string; who?: string; range?: string; q?: string; page?: string };
type Row = { kind: string; id: string; createdAt: Date; userId: string | null; userName: string | null; what: string; detail: string | null; reason: string | null; ip: string | null; before: unknown; after: unknown };
type Person = { id: string; name: string; status: string; role: string; lastLoginAt: Date | null; lastPageAt: Date | null; lastTitle: string | null; lastActionAt: Date | null; actionsToday: bigint; pagesToday: bigint };

const TZ = "Africa/Dar_es_Salaam";
const dayLabel = (d: Date) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ }).format(d);
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const timeOf = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: TZ }).format(d);
const START = (ymd: string) => new Date(`${ymd}T00:00:00+03:00`);

function ago(d: Date) {
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} day${Math.floor(s / 86400) === 1 ? "" : "s"} ago`;
}

/** The Director's window on the whole business: who is working now, and everything anyone signed in to, opened or changed. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requirePagePermission("audit.view");
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const range = RANGES.find((r) => r.key === sp.range)?.key ?? "7d";
  const q = sp.q?.trim() ?? "";
  const who = sp.who?.trim() || "";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const today = businessDay();
  const todayStart = START(today);
  const from = range === "today" ? todayStart : range === "yesterday" ? START(shiftDay(today, -1)) : range === "7d" ? START(shiftDay(today, -6)) : range === "30d" ? START(shiftDay(today, -29)) : null;
  const to = range === "yesterday" ? todayStart : null;

  const conds: Prisma.Sql[] = [Prisma.sql`t."kind" IN (${Prisma.join([...tab.kinds])})`];
  if (who) conds.push(Prisma.sql`t."userId" = ${who}`);
  if (from) conds.push(Prisma.sql`t."createdAt" >= ${from}`);
  if (to) conds.push(Prisma.sql`t."createdAt" < ${to}`);
  if (q) {
    const like = `%${q}%`;
    conds.push(Prisma.sql`(t."what" ILIKE ${like} OR t."detail" ILIKE ${like} OR t."userName" ILIKE ${like} OR t."reason" ILIKE ${like})`);
  }
  const where = Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}`;

  const union = Prisma.sql`
    SELECT CASE WHEN a."action" LIKE 'auth.%' THEN 'sign' ELSE 'action' END AS "kind", a."id", a."createdAt", a."userId", a."userName",
           a."action" AS "what", CASE WHEN a."action" LIKE 'auth.%' THEN a."reference" ELSE COALESCE(a."reference", a."entityType") END AS "detail", a."reason", a."ipAddress" AS "ip", a."before", a."after"
      FROM "AuditLog" a
    UNION ALL
    SELECT 'page', p."id", p."createdAt", p."userId", p."userName", COALESCE(NULLIF(p."title", ''), p."path"), p."path", NULL, p."ipAddress", NULL::jsonb, NULL::jsonb
      FROM "ActivityLog" p`;

  const [rows, count, people, everyone] = await Promise.all([
    db.$queryRaw<Row[]>`SELECT t.* FROM (${union}) t ${where} ORDER BY t."createdAt" DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM (${union}) t ${where}`,
    db.$queryRaw<Person[]>`
      SELECT u."id", u."name", u."status"::text AS "status", r."name" AS "role", u."lastLoginAt",
             (SELECT MAX(p."createdAt") FROM "ActivityLog" p WHERE p."userId" = u."id") AS "lastPageAt",
             (SELECT p."title" FROM "ActivityLog" p WHERE p."userId" = u."id" ORDER BY p."createdAt" DESC LIMIT 1) AS "lastTitle",
             (SELECT MAX(a."createdAt") FROM "AuditLog" a WHERE a."userId" = u."id") AS "lastActionAt",
             (SELECT COUNT(*) FROM "AuditLog" a WHERE a."userId" = u."id" AND a."createdAt" >= ${todayStart} AND a."action" NOT LIKE 'auth.%') AS "actionsToday",
             (SELECT COUNT(*) FROM "ActivityLog" p WHERE p."userId" = u."id" AND p."createdAt" >= ${todayStart}) AS "pagesToday"
        FROM "User" u JOIN "Role" r ON r."id" = u."roleId" WHERE u."status" = 'ACTIVE' ORDER BY u."name"`,
    db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const total = Number(count[0]?.n ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (over: Partial<Search>) => {
    const m = { tab: tab.key === "all" ? undefined : tab.key, who: who || undefined, range: range === "7d" ? undefined : range, q: q || undefined, ...over } as Record<string, string | undefined>;
    const qs = new URLSearchParams(Object.entries(m).filter(([, v]) => v) as [string, string][]).toString();
    return `/audit${qs ? `?${qs}` : ""}`;
  };
  const pill = (on: boolean) => cn("rounded-full border px-3 py-1.5 text-sm font-medium transition", on ? "border-navy-600 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900");

  // newest first, grouped by day
  const days: { day: string; label: string; rows: Row[] }[] = [];
  for (const r of rows) {
    const k = dayKey(r.createdAt);
    if (days.at(-1)?.day !== k) days.push({ day: k, label: k === today ? `Today · ${dayLabel(r.createdAt)}` : dayLabel(r.createdAt), rows: [] });
    days.at(-1)!.rows.push(r);
  }

  const now = Date.now();
  const seen = (p: Person) => [p.lastLoginAt, p.lastPageAt, p.lastActionAt].filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  return (
    <>
      <PageHeader title="Audit" description="Everything people do: when they sign in, what they open and what they change. Nothing here can be edited or deleted." />

      <section className="card mb-5 overflow-hidden" aria-label="Who is working">
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <h2 className="text-base font-semibold text-slate-900">Who is working</h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Now</th>
                <th className="hidden md:table-cell">Last opened</th>
                <th className="text-right">Today</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const last = seen(p);
                const online = last !== null && now - last.getTime() < 5 * 60_000;
                return (
                  <tr key={p.id} className="relative">
                    <td className="font-medium">
                      <Link href={href({ who: p.id, page: undefined })} className="after:absolute after:inset-0 after:content-[''] hover:text-navy-700">
                        {p.name}
                      </Link>
                    </td>
                    <td className="text-slate-600">{p.role}</td>
                    <td className={online ? "font-medium text-emerald-600" : "text-slate-500"}>{online ? "Online now" : last ? `Last seen ${ago(last)}` : "Never signed in"}</td>
                    <td className="hidden text-slate-600 md:table-cell">{p.lastTitle ?? "—"}</td>
                    <td className="text-right tabular-nums text-slate-600">
                      {Number(p.actionsToday)} changes · {Number(p.pagesToday)} pages
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={href({ tab: t.key === "all" ? undefined : t.key, page: undefined })} className={pill(tab.key === t.key)}>
            {t.label}
          </Link>
        ))}
      </div>

      <form method="get" className="card card-pad mb-4 grid gap-3 sm:grid-cols-[1fr_12rem_11rem_auto]">
        {tab.key !== "all" && <input type="hidden" name="tab" value={tab.key} />}
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={q} placeholder="Search a person, page, action or record" className="input pl-9" aria-label="Search the audit" />
        </div>
        <select name="who" defaultValue={who} className="input" aria-label="Person">
          <option value="">Everyone</option>
          {everyone.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select name="range" defaultValue={range} className="input" aria-label="Period">
          {RANGES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <button className="btn-primary" type="submit">
            Show
          </button>
          {(q || who || sp.range || sp.tab) && (
            <Link href="/audit" className="btn-secondary">
              Clear
            </Link>
          )}
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="card">
          <EmptyState icon={<ScrollText size={22} />} title="Nothing found" description="Try another person, period or search." />
        </div>
      ) : (
        <div className="space-y-4">
          {days.map((d) => (
            <section key={d.day} className="card overflow-hidden">
              <h3 className="border-b border-line bg-slate-50/60 px-4 py-2 text-sm font-semibold text-slate-700 sm:px-5">
                {d.label} <span className="ml-1 font-normal text-slate-400">{d.rows.length}</span>
              </h3>
              <div className="table-wrap">
                <table className="table w-full md:table-fixed">
                  <colgroup>
                    <col className="md:w-[9%]" />
                    <col className="md:w-[17%]" />
                    <col className="md:w-[30%]" />
                    <col className="md:w-[30%]" />
                    <col className="md:w-[14%]" />
                  </colgroup>
                  <tbody>
                    {d.rows.map((r) => (
                      <tr key={`${r.kind}-${r.id}`} className="align-top">
                        <td className="whitespace-nowrap tabular-nums text-slate-500">{timeOf(r.createdAt)}</td>
                        <td className="font-medium">{r.userName ?? <span className="font-normal text-slate-400">Not signed in</span>}</td>
                        <td>
                          {r.kind === "page" ? <span className="text-slate-700">Opened {r.what}</span> : <span className={cn(r.kind === "sign" && /failed|Wrong|Locked|unknown/i.test(describeAction(r.what)) ? "font-medium text-brand-red-dark" : "text-slate-900")}>{describeAction(r.what)}</span>}
                        </td>
                        <td className="break-words text-slate-600">
                          {r.detail ?? ""}
                          {r.reason && <span className="block text-xs text-slate-500">“{r.reason}”</span>}
                          {r.before != null || r.after != null ? (
                            <details className="mt-1 text-xs">
                              <summary className="cursor-pointer text-navy-700">View changes</summary>
                              {r.before != null && <pre className="mt-1 max-w-md overflow-x-auto rounded bg-slate-50 p-2">Before: {JSON.stringify(r.before, null, 1)}</pre>}
                              {r.after != null && <pre className="mt-1 max-w-md overflow-x-auto rounded bg-slate-50 p-2">After: {JSON.stringify(r.after, null, 1)}</pre>}
                            </details>
                          ) : null}
                        </td>
                        <td className="hidden text-right font-mono text-xs text-slate-400 md:table-cell">{r.ip ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
          <span>
            Page {page} of {pages} · {total.toLocaleString("en-US")} entries
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={href({ page: String(page - 1) })} className="btn-secondary btn-sm">
                Previous
              </Link>
            )}
            {page < pages && (
              <Link href={href({ page: String(page + 1) })} className="btn-secondary btn-sm">
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  );
}
