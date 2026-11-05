import { notFound, redirect } from "next/navigation";
import ReceiptActions from "@/components/sales/ReceiptActions";
import { Prisma } from "@/generated/prisma/client";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { owedOf } from "@/lib/sales/owed";
import { methodLabel } from "@/lib/sales/types";
import { getBusinessProfile, getCurrency } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Receipt" };

// The customer's receipt. 80 mm thermal layout by default (also A4 / PDF). The first print right after the sale is the
// original; opening it later is a reprint and is clearly marked COPY (and recorded).
export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ paper?: string; first?: string }> }) {
  const user = await requireUser();
  if (!canAny(user, ["sales.view_own", "sales.view_all"])) redirect("/forbidden");
  const { id } = await params;
  const sp = await searchParams;
  const paper: "80" | "a4" = sp.paper === "a4" ? "a4" : "80";
  const sale = await db.sale.findUnique({
    where: { id },
    include: {
      customer: { select: { name: true, phone: true } },
      salesperson: { select: { name: true } },
      items: { orderBy: { id: "asc" }, include: { product: { select: { name: true } }, enteredUnit: { select: { symbol: true, name: true } } } },
      allocations: { include: { payment: { select: { method: true, source: true, receivedAt: true } } }, orderBy: { id: "asc" } },
    },
  });
  if (!sale || (!can(user, "sales.view_all") && sale.salespersonId !== user.id)) notFound();
  const [profile, currency] = await Promise.all([getBusinessProfile(), getCurrency()]);
  const m = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, currency);
  const isCopy = !sp.first;
  const balance = sale.status === "CANCELLED" ? new Prisma.Decimal(0) : owedOf(sale);
  const paidAtSale = sale.allocations.filter((a) => a.payment.source === "AT_SALE");
  const thermal = paper === "80";
  const w = thermal ? "72mm" : "180mm";

  return (
    <>
      <style>{`
        @media print {
          @page { size: ${thermal ? "80mm auto" : "A4"}; margin: ${thermal ? "3mm" : "14mm"}; }
          html, body { background: #fff !important; }
          body * { visibility: hidden; }
          .receipt-root, .receipt-root * { visibility: visible; }
          .receipt-root { position: absolute; left: 0; top: 0; width: ${w}; margin: 0 !important; box-shadow: none !important; border: 0 !important; }
        }
      `}</style>
      <ReceiptActions saleId={sale.id} paper={paper} isCopy={isCopy} backHref={`/sales/${sale.id}`} />

      <article className={`receipt-root mx-auto bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,27,45,0.12)] ring-1 ring-line ${thermal ? "p-3 text-[12px] leading-snug" : "p-8 text-sm"}`} style={{ width: w, maxWidth: "100%" }}>
        <header className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-full.png" alt="" className={`mx-auto w-auto ${thermal ? "h-12" : "h-16"}`} />
          <p className={`mt-1 font-bold tracking-wide ${thermal ? "text-sm" : "text-lg"}`}>{profile.name.toUpperCase()}</p>
          {profile.address && <p className="text-slate-600">{profile.address}</p>}
          {profile.phone && <p className="text-slate-600">Tel: {profile.phone}</p>}
        </header>

        {isCopy && (
          <p className="my-2 border-y-2 border-dashed border-slate-800 py-1 text-center text-sm font-extrabold tracking-[0.2em]">COPY · REPRINT</p>
        )}

        <div className="my-2 border-t border-dashed border-slate-400 pt-2">
          <div className="flex justify-between font-semibold">
            <span>RECEIPT</span>
            <span>{sale.saleNo}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>{formatDateTime(sale.createdAt)}</span>
            <span>Cashier: {sale.salesperson.name}</span>
          </div>
          <p className="text-slate-600">Customer: {sale.customer?.name ?? "Walk-in customer"}</p>
        </div>

        <table className="my-2 w-full border-y border-dashed border-slate-400">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
              <th className="py-1 font-medium">Item</th>
              <th className="py-1 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((i) => (
              <tr key={i.id} className="align-top">
                <td className="py-1 pr-2">
                  <span className="font-medium">{i.product.name}</span>
                  <span className="block text-slate-600">
                    {i.enteredQty.toString()} {i.enteredUnit.symbol} × {m(i.unitPrice)}
                  </span>
                  {i.discount.gt(0) && <span className="block text-slate-600">Discount −{m(i.discount)}</span>}
                </td>
                <td className="py-1 text-right font-medium tabular-nums">{m(i.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="space-y-0.5 tabular-nums">
          {sale.discountTotal.gt(0) && (
            <div className="flex justify-between text-slate-600">
              <dt>Discount given</dt>
              <dd>−{m(sale.discountTotal)}</dd>
            </div>
          )}
          <div className={`flex justify-between font-bold ${thermal ? "text-sm" : "text-base"}`}>
            <dt>TOTAL</dt>
            <dd>{m(sale.total)}</dd>
          </div>
          {sale.returnedTotal.gt(0) && (
            <div className="flex justify-between text-slate-600">
              <dt>Returned goods</dt>
              <dd>−{m(sale.returnedTotal)}</dd>
            </div>
          )}
          {paidAtSale.map((a) => (
            <div key={a.id} className="flex justify-between">
              <dt>Paid · {methodLabel(a.payment.method)}</dt>
              <dd>{m(a.amount)}</dd>
            </div>
          ))}
          {balance.gt(0) && (
            <div className="flex justify-between font-bold">
              <dt>BALANCE DUE</dt>
              <dd>{m(balance)}</dd>
            </div>
          )}
          {balance.gt(0) && sale.dueDate && (
            <div className="flex justify-between text-slate-600">
              <dt>Please pay by</dt>
              <dd>{formatDate(sale.dueDate)}</dd>
            </div>
          )}
        </dl>
        {sale.status === "CANCELLED" && <p className="mt-2 text-center font-bold">CANCELLED</p>}

        <footer className="mt-3 border-t border-dashed border-slate-400 pt-2 text-center">
          <p className="font-semibold">Thank you for choosing {profile.name}!</p>
          <p className="text-slate-500">Please keep this receipt for returns.</p>
        </footer>
      </article>
    </>
  );
}
