import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, ClipboardList, ScanLine } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { can, canAny } from "@/lib/auth/can";
import { largestPack, qtyText } from "@/lib/qty";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { Prisma, type PickupStatus } from "@/generated/prisma/client";
import { AUTH_LABEL, OPEN_STATUSES, STATUS_LABEL, STATUS_TEXT } from "@/lib/warehouse/labels";
import { cn } from "@/lib/utils";

const ago = (d: Date) => {
  const m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60_000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

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
  const operate = can(user, "warehouse.operate");

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
      include: { sale: { select: { saleNo: true, customer: { select: { name: true, reseller: { select: { id: true } } } }, salesperson: { select: { name: true } } } }, items: { select: { quantity: true, releasedQty: true, cancelledQty: true, product: { select: { name: true, baseUnit: { select: { symbol: true } }, units: { select: { factor: true, unit: { select: { symbol: true } } } } } } } } },
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
      <PageHeader
        title="Collections"
        description={filter.key === "open" && notes[0] ? `${total} order${total === 1 ? "" : "s"} waiting · the oldest came ${ago(notes[0].createdAt)}` : "Every sale that has to be collected from the warehouse."}
        actions={
          operate ? (
            <Link href="/warehouse/scan" className="btn-primary">
              <ScanLine size={16} /> Scan &amp; release
            </Link>
          ) : undefined
        }
      />
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
        <div>
          <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {notes.map((p) => {
              const open = (OPEN_STATUSES as readonly PickupStatus[]).includes(p.status);
              const lines = p.items
                .map((i) => {
                  const pack = largestPack(i.product.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor })));
                  const qty = open ? Number(i.quantity.minus(i.releasedQty).minus(i.cancelledQty)) : Number(i.quantity);
                  return { id: `${p.id}-${i.product.name}`, name: i.product.name, qty, text: qtyText(qty, pack, i.product.baseUnit.symbol).main };
                })
                .filter((l) => !open || l.qty > 0);
              const customer = p.sale.customer?.name;
              return (
                <li key={p.id} className="card flex flex-col overflow-hidden">
                  <Link href={`/warehouse/orders/${p.id}`} className="block flex-1 px-4 py-3.5 transition hover:bg-slate-50/60">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-mono text-[13px] font-semibold text-slate-900">{p.noteNo}</span>
                      <span className={cn("text-xs", STATUS_TEXT[p.status])}>{STATUS_LABEL[p.status]}</span>
                    </div>
                    <p className="mt-2 flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900">
                      {customer ?? <span className="font-medium text-slate-400">Walk-in customer</span>}
                      {p.sale.customer?.reseller && <span className="rounded-full bg-oil-400/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-800 dark:text-oil-400">Winga</span>}
                    </p>
                    <p className="text-xs text-slate-500">
                      Sold by {p.sale.salesperson.name} · {ago(p.createdAt)}
                    </p>
                    <ul className="mt-3 space-y-1.5 border-t border-line pt-3 text-sm">
                      {lines.slice(0, 4).map((l) => (
                        <li key={l.id} className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 truncate text-slate-700">{l.name}</span>
                          <span className="shrink-0 font-semibold tabular-nums text-slate-900">{l.text}</span>
                        </li>
                      ))}
                      {lines.length > 4 && <li className="text-xs text-slate-500">+ {lines.length - 4} more product{lines.length - 4 === 1 ? "" : "s"}</li>}
                      {lines.length === 0 && <li className="text-xs text-slate-500">Nothing left to hand over.</li>}
                    </ul>
                  </Link>
                  <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
                    <span className={cn("text-xs font-medium", p.auth === "PAID" ? "text-emerald-600" : "text-amber-600")}>{AUTH_LABEL[p.auth].split(",")[0]}</span>
                    {open && operate ? (
                      <Link href={`/warehouse/orders/${p.id}`} className="btn-primary btn-sm">
                        Release <ChevronRight size={14} />
                      </Link>
                    ) : (
                      <Link href={`/warehouse/orders/${p.id}`} className="text-sm font-medium text-navy-700 hover:underline">
                        Open
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
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
