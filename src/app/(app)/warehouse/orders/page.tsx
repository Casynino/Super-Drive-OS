import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardList } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { Prisma, type PickupStatus } from "@/generated/prisma/client";
import { AUTH_LABEL, OPEN_STATUSES, STATUS_LABEL, STATUS_TEXT } from "@/lib/warehouse/labels";
import { formatDateTime } from "@/lib/utils";
import { cn } from "@/lib/utils";

export const metadata = { title: "Collections" };

const PAGE = 40;
const FILTERS = [
  { key: "open", label: "Waiting", statuses: OPEN_STATUSES },
  { key: "new", label: "New", statuses: ["NEW"] },
  { key: "preparing", label: "Preparing", statuses: ["PREPARING"] },
  { key: "ready", label: "Ready", statuses: ["READY"] },
  { key: "partial", label: "Partly collected", statuses: ["PARTIAL"] },
  { key: "done", label: "Collected", statuses: ["COMPLETED"] },
  { key: "cancelled", label: "Cancelled", statuses: ["CANCELLED"] },
] as const satisfies readonly { key: string; label: string; statuses: readonly PickupStatus[] }[];

/** Every sale that has to be collected from the warehouse, with its status. */
export default async function CollectionsPage({ searchParams }: { searchParams: Promise<{ f?: string; q?: string; page?: string }> }) {
  const user = await requireUser();
  if (!canAny(user, ["warehouse.operate", "warehouse.view"])) redirect("/forbidden");
  const sp = await searchParams;
  const filter = FILTERS.find((f) => f.key === sp.f) ?? FILTERS[0];
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const where: Prisma.PickupNoteWhereInput = {
    status: { in: [...filter.statuses] },
    ...(q ? { OR: [{ noteNo: { contains: q, mode: "insensitive" } }, { sale: { saleNo: { contains: q, mode: "insensitive" } } }, { sale: { customer: { name: { contains: q, mode: "insensitive" } } } }, { items: { some: { product: { name: { contains: q, mode: "insensitive" } } } } }] } : {}),
  };
  const [notes, total, counts] = await Promise.all([
    db.pickupNote.findMany({
      where,
      orderBy: filter.key === "done" || filter.key === "cancelled" ? { createdAt: "desc" } : { createdAt: "asc" }, // waiting ones: the oldest first
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { sale: { select: { saleNo: true, customer: { select: { name: true, reseller: { select: { id: true } } } }, salesperson: { select: { name: true } } } }, items: { select: { quantity: true, product: { select: { name: true } } } } },
    }),
    db.pickupNote.count({ where }),
    db.pickupNote.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const n = (s: readonly PickupStatus[]) => counts.filter((c) => s.includes(c.status)).reduce((t, c) => t + c._count._all, 0);
  const href = (over: Record<string, string | undefined>) => {
    const m = { f: filter.key === "open" ? undefined : filter.key, q: q || undefined, ...over };
    const qs = new URLSearchParams(Object.entries(m).filter(([, v]) => v) as [string, string][]).toString();
    return `/warehouse/orders${qs ? `?${qs}` : ""}`;
  };
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <>
      <PageHeader title="Collections" description="Every sale that has to be collected from the warehouse." />
      <div className="mb-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link key={f.key} href={href({ f: f.key === "open" ? undefined : f.key, page: undefined })} className={cn("rounded-full border px-3 py-1.5 text-sm font-medium transition", filter.key === f.key ? "border-navy-600 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900")}>
            {f.label} <span className="text-xs opacity-80">{n(f.statuses)}</span>
          </Link>
        ))}
      </div>
      <form method="get" className="card card-pad mb-4 flex gap-3">
        {filter.key !== "open" && <input type="hidden" name="f" value={filter.key} />}
        <input name="q" defaultValue={q} placeholder="Search a note number, customer, sale or product" className="input flex-1" aria-label="Search collections" />
        <button className="btn-primary" type="submit">
          Search
        </button>
      </form>

      {notes.length === 0 ? (
        <div className="card">
          <EmptyState icon={<ClipboardList size={22} />} title="Nothing here" description={filter.key === "open" ? "No sale is waiting to be collected." : "No notes match this filter."} />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="table-wrap">
            <table className="table w-full md:table-fixed">
              <colgroup>
                <col className="md:w-[13%]" />
                <col className="md:w-[17%]" />
                <col className="md:w-[14%]" />
                <col className="md:w-[24%]" />
                <col className="md:w-[12%]" />
                <col className="md:w-[10%]" />
                <col className="md:w-[10%]" />
              </colgroup>
              <thead>
                <tr>
                  <th>Note</th>
                  <th>Customer</th>
                  <th className="hidden md:table-cell">Sold by</th>
                  <th>Products</th>
                  <th className="hidden md:table-cell">Payment</th>
                  <th className="hidden md:table-cell">Time</th>
                  <th className="text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {notes.map((p) => (
                  <tr key={p.id} className="relative">
                    <td className="font-mono text-[13px] font-medium">
                      <Link href={`/warehouse/orders/${p.id}`} className="after:absolute after:inset-0 after:content-[''] hover:text-navy-700">
                        {p.noteNo}
                      </Link>
                    </td>
                    <td className="truncate">
                      {p.sale.customer?.name ?? <span className="text-slate-400">Walk-in</span>}
                      {p.sale.customer?.reseller && <span className="ml-2 rounded-full bg-oil-400/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-800 dark:text-oil-400">Winga</span>}
                    </td>
                    <td className="hidden truncate text-slate-600 md:table-cell">{p.sale.salesperson.name}</td>
                    <td className="truncate text-slate-600">
                      {p.items.slice(0, 2).map((i) => i.product.name).join(", ")}
                      {p.items.length > 2 ? ` +${p.items.length - 2}` : ""}
                    </td>
                    <td className="hidden truncate text-slate-600 md:table-cell">{AUTH_LABEL[p.auth].split(",")[0]}</td>
                    <td className="hidden whitespace-nowrap text-slate-500 md:table-cell">{formatDateTime(p.createdAt)}</td>
                    <td className={cn("text-right", STATUS_TEXT[p.status])}>{STATUS_LABEL[p.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > PAGE && (
            <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-slate-600">
              <span>
                Page {page} of {pages} · {total} notes
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
