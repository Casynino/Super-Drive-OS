import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { largestPack, qtyText } from "@/lib/qty";
import { ISSUE_TYPE_LABEL, loadIssueRecords } from "@/lib/shipments/issues";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Discrepancies" };

/** Goods that arrived missing, damaged or not as ordered, from the counts at receiving. The Director decides what to do with each one. */
export default async function DiscrepanciesPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const user = await requireUser();
  if (!canAny(user, ["warehouse.operate", "warehouse.view"])) redirect("/forbidden");
  const sp = await searchParams;
  const showAll = sp.all === "1";
  const records = await loadIssueRecords(db, {}); // quantities only: no costs for anyone here
  // goods customers brought back damaged: they came back, are not sellable and stay under investigation (quantities and reasons, no money)
  const damaged = await db.reversalItem.findMany({
    where: { condition: "DAMAGED", reversal: { status: "COMPLETED" } },
    orderBy: { reversal: { decidedAt: "desc" } },
    take: 30,
    select: {
      id: true,
      enteredQty: true,
      product: { select: { name: true, sku: true } },
      saleItem: { select: { enteredUnit: { select: { symbol: true } } } },
      reversal: { select: { reversalNo: true, reason: true, decidedAt: true, requestedBy: { select: { name: true } }, sale: { select: { saleNo: true } } } },
    },
  });
  const rows = records.filter((r) => showAll || r.open > 0).sort((a, b) => (b.reportedAt?.getTime() ?? 0) - (a.reportedAt?.getTime() ?? 0));
  const openCount = records.filter((r) => r.open > 0).length;
  const pill = (on: boolean) => cn("rounded-full border px-3 py-1.5 text-sm font-medium transition", on ? "border-navy-600 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900");
  const qty = (r: (typeof rows)[number], n: number) => qtyText(n, r.pack ? largestPack([{ symbol: r.pack.symbol, factor: { toString: () => String(r.pack!.factor) } as never }]) : null, r.unit).main;

  return (
    <>
      <PageHeader title="Discrepancies" description="Goods that arrived missing, damaged or different from the order, and damaged goods customers returned." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/warehouse/discrepancies" className={pill(!showAll)}>
          Still open <span className="text-xs opacity-80">{openCount}</span>
        </Link>
        <Link href="/warehouse/discrepancies?all=1" className={pill(showAll)}>
          All <span className="text-xs opacity-80">{records.length}</span>
        </Link>
      </div>
      {damaged.length > 0 && (
        <section className="card mb-5 overflow-hidden" aria-label="Damaged goods returned">
          <div className="border-b border-line px-4 py-3 sm:px-5">
            <h2 className="text-base font-semibold text-slate-900">Damaged goods returned by customers</h2>
            <p className="text-xs text-slate-500">They came back, are not for sale, and are under investigation.</p>
          </div>
          <ul className="divide-y divide-line text-sm">
            {damaged.map((d) => (
              <li key={d.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">
                    {d.enteredQty.toString()} {d.saleItem.enteredUnit.symbol} · {d.product.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {d.reversal.sale.saleNo} · {d.reversal.reversalNo} · “{d.reversal.reason}”
                  </p>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <span className="badge-yellow">Under investigation</span>
                  <span className="mt-1 block">
                    {d.reversal.requestedBy.name}
                    {d.reversal.decidedAt ? ` · ${formatDateTime(d.reversal.decidedAt)}` : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">{showAll ? "No discrepancy has been recorded." : "Nothing is open. Every delivery matched, or the Director has decided on the differences."}</p>
        ) : (
          <div className="table-wrap">
            <table className="table w-full md:table-fixed">
              <colgroup>
                <col className="md:w-[30%]" />
                <col className="md:w-[20%]" />
                <col className="md:w-[16%]" />
                <col className="md:w-[12%]" />
                <col className="md:w-[12%]" />
                <col className="md:w-[10%]" />
              </colgroup>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>What is wrong</th>
                  <th className="hidden md:table-cell">Order</th>
                  <th className="text-right">Ordered</th>
                  <th className="text-right">Arrived</th>
                  <th className="text-right">Still open</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="relative align-top">
                    <td>
                      <Link href={`/shipments/${r.shipmentId}`} className="font-medium text-slate-900 after:absolute after:inset-0 after:content-[''] hover:text-navy-700">
                        {r.productName}
                      </Link>
                      <span className="block font-mono text-[11px] text-slate-500">{r.sku}</span>
                    </td>
                    <td>
                      <span className="text-slate-800">{ISSUE_TYPE_LABEL[r.type]}</span>
                      <span className="block text-xs text-slate-500">{r.reportedAt ? `${formatDateTime(r.reportedAt)}${r.reportedBy ? ` · ${r.reportedBy}` : ""}` : ""}</span>
                    </td>
                    <td className="hidden font-mono text-[13px] text-slate-600 md:table-cell">{r.shipmentNo}</td>
                    <td className="text-right tabular-nums text-slate-600">{qty(r, r.expected)}</td>
                    <td className="text-right tabular-nums text-slate-600">{qty(r, r.arrived)}</td>
                    <td className={cn("text-right font-semibold tabular-nums", r.open > 0 ? "text-amber-600" : "text-slate-400")}>{r.open > 0 ? qty(r, r.open) : "Decided"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
