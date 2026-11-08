import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, ClipboardList, ScanLine } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { ReleaseHost, ReleaseTrigger, type ListNote } from "@/components/warehouse/ReleaseHost";
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

const PAGE = 30;
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
      include: { sale: { select: { saleNo: true, customer: { select: { name: true, reseller: { select: { id: true } } } }, salesperson: { select: { name: true } } } }, items: { select: { id: true, productId: true, quantity: true, releasedQty: true, cancelledQty: true, product: { select: { name: true, sku: true, image: { select: { updatedAt: true } }, baseUnit: { select: { symbol: true } }, units: { select: { factor: true, unit: { select: { symbol: true } } } } } } } } },
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
      {notes.length === 0 && !q ? (
        <div className="card">
          <EmptyState icon={<ClipboardList size={22} />} title="Nothing here" description={filter.key === "open" ? "No sale is waiting to be collected." : "No notes match this filter."} />
        </div>
      ) : (
        <ReleaseHost>
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <p className="text-sm text-slate-600">
              <span className="font-semibold text-slate-900">{total}</span> {filter.key === "open" ? "waiting" : filter.label.toLowerCase()}
              {filter.key === "done" || filter.key === "cancelled" ? " · newest first" : " · waiting longest first"}
            </p>
            <form method="get" className="flex items-center gap-2">
              {filter.key !== "open" && <input type="hidden" name="f" value={filter.key} />}
              <input name="q" defaultValue={q} placeholder="Search note, customer or product" autoComplete="off" className="input h-9 w-full min-w-0 text-sm sm:w-72" aria-label="Search collections" />
              <button className="btn-secondary btn-sm h-9" type="submit">
                Search
              </button>
              {q && (
                <Link href={href({ q: undefined, page: undefined })} className="text-sm text-slate-500 hover:text-slate-800">
                  Clear
                </Link>
              )}
            </form>
          </div>

          {notes.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">Nothing matches &ldquo;{q}&rdquo;.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th className="hidden md:table-cell">Customer</th>
                    <th className="hidden md:table-cell">Goods</th>
                    <th className="hidden lg:table-cell">Payment</th>
                    <th className="hidden sm:table-cell">Status</th>
                    <th className="text-right">&nbsp;</th>
                  </tr>
                </thead>
                <tbody>
                  {notes.map((p) => {
                    const open = (OPEN_STATUSES as readonly PickupStatus[]).includes(p.status);
                    const lines = p.items
                      .map((i) => {
                        const pack = largestPack(i.product.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor })));
                        const qty = open ? Number(i.quantity.minus(i.releasedQty).minus(i.cancelledQty)) : Number(i.quantity);
                        return { name: i.product.name, qty, text: qtyText(qty, pack, i.product.baseUnit.symbol).main };
                      })
                      .filter((l) => !open || l.qty > 0);
                    const customer = p.sale.customer?.name;
                    const releaseNote: ListNote = {
                      id: p.id,
                      noteNo: p.noteNo,
                      customer: customer ?? "Walk-in customer",
                      winga: Boolean(p.sale.customer?.reseller),
                      saleNo: p.sale.saleNo,
                      paymentLabel: AUTH_LABEL[p.auth],
                      lines: p.items
                        .map((i) => {
                          const waiting = i.quantity.minus(i.releasedQty).minus(i.cancelledQty);
                          const pack = largestPack(i.product.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor })));
                          return { id: i.id, productId: i.productId, name: i.product.name, sku: i.product.sku, waiting: Number(waiting), waitingText: qtyText(Number(waiting), pack, i.product.baseUnit.symbol).main, symbol: i.product.baseUnit.symbol, imageV: i.product.image ? i.product.image.updatedAt.getTime() : null, pack };
                        })
                        .filter((l) => l.waiting > 0),
                    };
                    const hours = (Date.now() - p.createdAt.getTime()) / 3_600_000;
                    // the longer an order waits the louder its edge: yellow after 4 hours, red after a day
                    const edge = !open ? "border-l-transparent" : hours >= 24 ? "border-l-brand-red" : hours >= 4 ? "border-l-oil-400" : "border-l-transparent";
                    const winga = p.sale.customer?.reseller ? <span className="rounded-full bg-oil-400/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-800 dark:text-oil-400">Winga</span> : null;
                    const status = <span className={cn("inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold", STATUS_TEXT[p.status])}>{STATUS_LABEL[p.status]}</span>;
                    return (
                      <tr key={p.id}>
                        <td className={cn("border-l-[3px] max-sm:w-full max-sm:max-w-0", edge)}>
                          <Link href={`/warehouse/orders/${p.id}`} className="whitespace-nowrap font-mono text-[13px] font-semibold text-navy-700 hover:underline">
                            {p.noteNo}
                          </Link>
                          <span className="block text-xs text-slate-500">{ago(p.createdAt)}</span>
                          {/* a phone has one column for the order: who, what, and where it stands */}
                          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium text-slate-900 md:hidden">
                            {customer ?? <span className="font-normal text-slate-400">Walk-in customer</span>}
                            {winga}
                          </span>
                          <span className="block truncate text-xs text-slate-500 md:hidden">
                            {lines.length === 0 ? "Nothing left to hand over" : `${lines[0].name} · ${lines[0].text}${lines.length > 1 ? ` + ${lines.length - 1} more` : ""}`}
                          </span>
                          <span className="mt-1 block sm:hidden">{status}</span>
                        </td>
                        <td className="hidden md:table-cell">
                          <span className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                            {customer ?? <span className="font-normal text-slate-400">Walk-in customer</span>}
                            {winga}
                          </span>
                          <span className="block text-xs text-slate-500">Sold by {p.sale.salesperson.name}</span>
                        </td>
                        <td className="hidden md:table-cell">
                          {lines.length === 0 ? (
                            <span className="text-xs text-slate-500">Nothing left to hand over</span>
                          ) : (
                            <ul className="space-y-0.5 text-sm">
                              {lines.slice(0, 2).map((l) => (
                                <li key={l.name} className="flex items-baseline justify-between gap-4">
                                  <span className="max-w-[16rem] truncate text-slate-700">{l.name}</span>
                                  <span className="shrink-0 font-semibold tabular-nums text-slate-900">{l.text}</span>
                                </li>
                              ))}
                              {lines.length > 2 && <li className="text-xs text-slate-500">+ {lines.length - 2} more product{lines.length - 2 === 1 ? "" : "s"}</li>}
                            </ul>
                          )}
                        </td>
                        <td className="hidden lg:table-cell">
                          <span className={cn("text-xs font-medium", p.auth === "PAID" ? "text-emerald-600" : "text-amber-600")}>{AUTH_LABEL[p.auth].split(",")[0]}</span>
                        </td>
                        <td className="hidden sm:table-cell">{status}</td>
                        <td className="whitespace-nowrap text-right max-sm:pl-1 max-sm:pr-3">
                          <span className="inline-flex items-center gap-2">
                            {open && operate && releaseNote.lines.length > 0 && <ReleaseTrigger note={releaseNote} />}
                            <Link href={`/warehouse/orders/${p.id}`} className="btn-secondary btn-sm hidden sm:inline-flex" aria-label={`Open ${p.noteNo}`}>
                              Open
                            </Link>
                            <Link href={`/warehouse/orders/${p.id}`} className="btn-secondary btn-sm px-2 sm:hidden" aria-label={`Open ${p.noteNo}`}>
                              <ChevronRight size={16} />
                            </Link>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {total > PAGE && (
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-slate-600">
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
        </section>
        </ReleaseHost>
      )}
    </>
  );
}
