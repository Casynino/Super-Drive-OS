import Link from "next/link";
import { redirect } from "next/navigation";
import { Search } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { businessDay } from "@/lib/cash/ledger";
import { shiftDay } from "@/lib/reports/period";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Collection history" };

const PAGE = 40;
const RANGES = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "all", label: "All time" },
] as const;

/** Every handover of goods: who released what, to whom, and when. */
export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ range?: string; q?: string; page?: string }> }) {
  const user = await requireUser();
  if (!canAny(user, ["warehouse.operate", "warehouse.view"])) redirect("/forbidden");
  const sp = await searchParams;
  const range = RANGES.find((r) => r.key === sp.range)?.key ?? "7d";
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const today = businessDay();
  const since = range === "today" ? today : range === "7d" ? shiftDay(today, -6) : range === "30d" ? shiftDay(today, -29) : null;
  const where: Prisma.PickupReleaseWhereInput = {
    ...(since ? { createdAt: { gte: new Date(`${since}T00:00:00+03:00`) } } : {}),
    ...(q ? { OR: [{ releaseNo: { contains: q, mode: "insensitive" } }, { note: { noteNo: { contains: q, mode: "insensitive" } } }, { collectedBy: { contains: q, mode: "insensitive" } }, { releasedBy: { name: { contains: q, mode: "insensitive" } } }, { note: { sale: { customer: { name: { contains: q, mode: "insensitive" } } } } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.pickupRelease.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { releasedBy: { select: { name: true } }, note: { select: { id: true, noteNo: true, status: true, sale: { select: { customer: { select: { name: true } } } } } }, items: { include: { product: { select: { name: true } } } } },
    }),
    db.pickupRelease.count({ where }),
  ]);
  const href = (over: Record<string, string | undefined>) => {
    const m = { range: range === "7d" ? undefined : range, q: q || undefined, ...over };
    const qs = new URLSearchParams(Object.entries(m).filter(([, v]) => v) as [string, string][]).toString();
    return `/warehouse/history${qs ? `?${qs}` : ""}`;
  };
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <>
      <PageHeader title="Collection history" description="Every handover of goods from the warehouse, and who did it." />
      <div className="mb-3 flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <Link key={r.key} href={href({ range: r.key === "7d" ? undefined : r.key, page: undefined })} className={cn("rounded-full border px-3 py-1.5 text-sm font-medium transition", range === r.key ? "border-navy-600 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900")}>
            {r.label}
          </Link>
        ))}
      </div>
      <form method="get" className="card card-pad mb-4 flex gap-3">
        {range !== "7d" && <input type="hidden" name="range" value={range} />}
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={q} placeholder="Search a note, customer, attendant or the person who collected" className="input pl-9" aria-label="Search the collection history" />
        </div>
        <button className="btn-primary" type="submit">
          Search
        </button>
      </form>
      {rows.length === 0 ? (
        <div className="card">
          <EmptyState title="No collections" description="Nothing was handed over in this period." />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="table-wrap">
            <table className="table w-full md:table-fixed">
              <colgroup>
                <col className="md:w-[14%]" />
                <col className="md:w-[14%]" />
                <col className="md:w-[16%]" />
                <col className="md:w-[24%]" />
                <col className="md:w-[16%]" />
                <col className="md:w-[16%]" />
              </colgroup>
              <thead>
                <tr>
                  <th>Collection</th>
                  <th>Note</th>
                  <th className="hidden md:table-cell">Customer</th>
                  <th>Products</th>
                  <th className="hidden md:table-cell">Released by</th>
                  <th className="text-right">When</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="relative">
                    <td className="font-mono text-[13px] font-medium">{r.releaseNo}</td>
                    <td className="font-mono text-[13px]">
                      <Link href={`/warehouse/orders/${r.note.id}`} className="after:absolute after:inset-0 after:content-[''] hover:text-navy-700">
                        {r.note.noteNo}
                      </Link>
                    </td>
                    <td className="hidden truncate text-slate-600 md:table-cell">{r.note.sale.customer?.name ?? "Walk-in"}</td>
                    <td className="truncate text-slate-600">
                      {r.items.slice(0, 2).map((i) => `${i.product.name} ×${i.quantity.toString()}`).join(", ")}
                      {r.items.length > 2 ? ` +${r.items.length - 2}` : ""}
                      {r.collectedBy && <span className="block text-xs text-slate-500">taken by {r.collectedBy}</span>}
                    </td>
                    <td className="hidden truncate text-slate-600 md:table-cell">{r.releasedBy.name}</td>
                    <td className="whitespace-nowrap text-right text-slate-500">{formatDateTime(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > PAGE && (
            <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-slate-600">
              <span>
                Page {page} of {pages} · {total} collections
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
        </div>
      )}
    </>
  );
}
