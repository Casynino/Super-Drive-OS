import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { Alert, EmptyState, PageHeader } from "@/components/ui";
import ReturnAllButton from "@/components/pos/ReturnAllButton";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { owedOf } from "@/lib/sales/owed";
import { returnedBySaleItem } from "@/lib/sales/reversals";
import { getCurrency } from "@/lib/settings";
import { formatDate } from "@/lib/utils";
import { returnWingaGoods } from "../../../sales/reversal-actions";

export const metadata = { title: "Return goods" };

/** A Winga comes back with goods he did not sell: every unpaid invoice with goods still out, one button each. */
export default async function WingaReturnPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  await requirePagePermission("returns.create");
  const { id } = await params;
  const sp = await searchParams;
  const customer = await db.customer.findUnique({ where: { id }, include: { reseller: { select: { id: true } } } });
  if (!customer) notFound();
  if (!customer.reseller) redirect(`/customers/${id}`); // ordinary customers return goods from the invoice page

  const [currency, sales] = await Promise.all([
    getCurrency(),
    db.sale.findMany({
      where: { customerId: id, status: "COMPLETED", paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] } },
      orderBy: [{ createdAt: "desc" }],
      include: { items: { orderBy: { id: "asc" }, select: { id: true, enteredQty: true, product: { select: { name: true } }, enteredUnit: { select: { symbol: true } } } } },
    }),
  ]);
  const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: currency.decimals });
  const cards = [] as { id: string; saleNo: string; date: string; owed: number; lines: { name: string; qty: string }[]; partlyPaid: boolean }[];
  for (const s of sales) {
    const done = await returnedBySaleItem(db, s.id, true);
    const lines = s.items.map((it) => ({ name: it.product.name, left: it.enteredQty.minus(done.qty.get(it.id) ?? 0), sym: it.enteredUnit.symbol })).filter((l) => l.left.gt(0));
    if (lines.length === 0) continue;
    cards.push({ id: s.id, saleNo: s.saleNo, date: formatDate(s.createdAt), owed: Number(owedOf(s)), lines: lines.map((l) => ({ name: l.name, qty: `${l.left.toString()} ${l.sym}` })), partlyPaid: s.paymentStatus === "PARTIALLY_PAID" });
  }
  const owedTotal = sales.reduce((t, s) => t + Number(owedOf(s)), 0);

  return (
    <>
      <PageHeader title="Return goods" description={`${customer.name}${customer.phone ? ` · ${customer.phone}` : ""}`} back={{ href: "/pos", label: "Home" }} />
      {sp.done && (
        <div className="mb-4">
          <Alert kind="success">The goods of {sp.done} are back in the store and the invoice is reduced.</Alert>
        </div>
      )}
      <div className="card card-pad mb-5">
        <p className="text-[13px] font-medium text-slate-500">Currently owes</p>
        <p className="mt-1 text-2xl font-semibold text-brand-red-dark">
          {currency.symbol}&nbsp;{nf.format(owedTotal)}
        </p>
      </div>
      {cards.length === 0 ? (
        <div className="card">
          <EmptyState title="No goods to take back" description="This Winga has no unpaid invoice with goods still out." />
        </div>
      ) : (
        <ul className="space-y-3">
          {cards.map((c) => (
            <li key={c.id} className="card card-pad">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold text-slate-900">{c.saleNo}</p>
                  <p className="text-xs text-slate-500">
                    {c.date} · owed {currency.symbol} {nf.format(c.owed)}
                  </p>
                  <ul className="mt-2 space-y-0.5 text-sm text-slate-700">
                    {c.lines.map((l, i) => (
                      <li key={i}>
                        <span className="font-medium">{l.qty}</span> · {l.name}
                      </li>
                    ))}
                  </ul>
                  {c.partlyPaid && <p className="mt-2 text-xs text-amber-700">Part of this invoice was paid, so it cannot be returned here. Use Return / cancel on the invoice.</p>}
                </div>
                {!c.partlyPaid && <ReturnAllButton action={returnWingaGoods} saleId={c.id} customerId={id} submissionKey={randomUUID()} />}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-slate-500">The goods go back to the store and the invoice is reduced by their value. No money moves.</p>
    </>
  );
}
