import Link from "next/link";
import { ScrollText, Search } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Audit logs" };

const PAGE_SIZE = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requirePagePermission("audit.view");
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const where: Prisma.AuditLogWhereInput = q
    ? {
        OR: [
          { action: { contains: q, mode: "insensitive" } },
          { entityType: { contains: q, mode: "insensitive" } },
          { userName: { contains: q, mode: "insensitive" } },
          { reference: { contains: q, mode: "insensitive" } },
        ],
      }
    : {};

  const [logs, total] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.auditLog.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => `/audit?${new URLSearchParams({ ...(q ? { q } : {}), ...(p > 1 ? { page: String(p) } : {}) }).toString()}`;

  return (
    <>
      <PageHeader title="Audit logs" description="A permanent record of who did what. Entries cannot be edited or deleted." />

      <form method="get" className="card card-pad mb-4 flex gap-3">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={q} placeholder="Search action, person, record…" className="input pl-9" aria-label="Search audit log" />
        </div>
        <button className="btn-primary" type="submit">
          Search
        </button>
        {q && (
          <Link href="/audit" className="btn-secondary">
            Clear
          </Link>
        )}
      </form>

      <div className="card overflow-hidden">
        {logs.length === 0 ? (
          <EmptyState icon={<ScrollText size={22} />} title="No audit entries found" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th className="hidden md:table-cell">Record</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="align-top">
                    <td className="whitespace-nowrap text-slate-600">{formatDateTime(l.createdAt)}</td>
                    <td>{l.userName ?? <span className="text-slate-400">System</span>}</td>
                    <td>
                      <span className="badge-blue">{l.action}</span>
                    </td>
                    <td className="hidden text-slate-600 md:table-cell">
                      {l.entityType}
                      {l.reference ? ` · ${l.reference}` : ""}
                    </td>
                    <td>
                      {l.before || l.after || l.reason ? (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-navy-700">View</summary>
                          {l.reason && <p className="mt-1 text-slate-600">Reason: {l.reason}</p>}
                          {l.before != null && <pre className="mt-1 max-w-xs overflow-x-auto rounded bg-slate-50 p-2">Before: {JSON.stringify(l.before, null, 1)}</pre>}
                          {l.after != null && <pre className="mt-1 max-w-xs overflow-x-auto rounded bg-slate-50 p-2">After: {JSON.stringify(l.after, null, 1)}</pre>}
                        </details>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-slate-600">
            <span>
              Page {page} of {pages} · {total} entries
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={href(page - 1)} className="btn-secondary btn-sm">
                  Previous
                </Link>
              )}
              {page < pages && (
                <Link href={href(page + 1)} className="btn-secondary btn-sm">
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
