import Link from "next/link";
import BackLink from "@/components/BackLink";
import { notFound, redirect } from "next/navigation";
import { Alert } from "@/components/ui";
import { Prisma } from "@/generated/prisma/client";
import PrintButton from "@/components/PrintButton";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { methodLabel } from "@/lib/sales/types";
import { getBusinessProfile, getCurrency } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/utils";
import DecisionForm from "@/components/sales/DecisionForm";
import { owedOf } from "@/lib/sales/owed";
import { SaleStatusBadge } from "../StatusBadge";
import { decideReversal } from "../reversal-actions";

export const metadata = { title: "Sale" };

export default async function SalePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; reversal?: string }> }) {
  const user = await requireUser();
  if (!canAny(user, ["sales.view_own", "sales.view_all"])) redirect("/forbidden");
  const { id } = await params;
  const sp = await searchParams;

  const sale = await db.sale.findUnique({
    where: { id },
    include: {
      customer: true,
      location: { select: { name: true } },
      salesperson: { select: { name: true } },
      creditApprovedBy: { select: { name: true } },
      pickupNote: { select: { id: true, noteNo: true, status: true } },
      items: { orderBy: { id: "asc" }, include: { product: { select: { name: true, sku: true } }, enteredUnit: { select: { symbol: true } } } },
      allocations: { include: { payment: true }, orderBy: { id: "asc" } },
      reversals: { orderBy: { requestedAt: "desc" }, include: { requestedBy: { select: { name: true } }, decidedBy: { select: { name: true } }, items: { include: { product: { select: { name: true } } } } } },
    },
  });
  // Someone who may only see their own sales gets "not found" for anyone else's.
  if (!sale || (!can(user, "sales.view_all") && sale.salespersonId !== user.id)) notFound();

  const [profile, currency] = await Promise.all([getBusinessProfile(), getCurrency()]);
  const money = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, currency);
  const cancelled = sale.status === "CANCELLED";
  const balance = cancelled ? new Prisma.Decimal(0) : owedOf(sale);
  const canApprove = can(user, "returns.approve");
  const showProfit = can(user, "dashboard.financials");
  const isCredit = sale.paymentStatus !== "PAID";

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <BackLink href="/sales" className="py-1 text-sm text-slate-500 hover:text-navy-700">
          ← Sales history
        </BackLink>
        <div className="flex gap-2">
          {can(user, "sales.pos") && (
            <Link href="/pos" className="btn-primary">
              New sale
            </Link>
          )}
          {can(user, "returns.create") && !cancelled && (
            <Link href={`/sales/${sale.id}/return`} className="btn-secondary">
              Return / cancel
            </Link>
          )}
          <Link href={`/sales/${sale.id}/receipt${sp.created ? "?first=1" : ""}`} className="btn-secondary">
            Thermal receipt
          </Link>
          <PrintButton label="Print invoice" />
        </div>
      </div>
      {sp.reversal && (
        <div className="mb-4 print:hidden">
          <Alert kind="success">{sp.reversal === "done" ? "Done. Stock and the customer's account have been updated." : "Request sent. A manager or the owner has been notified and must approve it before anything changes."}</Alert>
        </div>
      )}
      {sp.created && (
        <div className="mb-4 print:hidden">
          <Alert kind="success">
            {sale.pickupNote ? `Sale completed${sale.amountPaid.gt(0) ? " and the payment recorded" : ""}. The goods are reserved at the warehouse: the pickup note is how they are collected.` : `Sale completed. Stock has been updated${sale.amountPaid.gt(0) ? " and the payment recorded" : ""}.`}
          </Alert>
        </div>
      )}
      {sale.pickupNote && (
        <section className="card mb-4 flex flex-wrap items-center justify-between gap-3 px-4 py-4 print:hidden sm:px-5" aria-label="Pickup note">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Pickup note</p>
            <p className="font-mono text-lg font-semibold text-slate-900">{sale.pickupNote.noteNo}</p>
            <p className="text-sm text-slate-600">
              {sale.pickupNote.status === "COMPLETED" ? "Collected" : sale.pickupNote.status === "CANCELLED" ? "Cancelled" : sale.pickupNote.status === "PARTIAL" ? "Partly collected" : sale.pickupNote.status === "READY" ? "Ready for collection" : "Waiting at the warehouse"}
              . Take it to the Store Warehouse to collect the goods.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/print/pickup/${sale.pickupNote.id}`} target="_blank" className="btn-primary">
              Open the note
            </Link>
            <Link href={`/print/pickup/${sale.pickupNote.id}?print=1&save=1`} target="_blank" className="btn-secondary">
              Download PDF
            </Link>
            <Link href={`/print/pickup/${sale.pickupNote.id}?print=1`} target="_blank" className="btn-secondary">
              Print
            </Link>
          </div>
        </section>
      )}

      <article className="card mx-auto max-w-3xl p-5 sm:p-8 print:max-w-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">{profile.name}</h1>
            {profile.address && <p className="text-sm text-slate-600">{profile.address}</p>}
            {profile.phone && <p className="text-sm text-slate-600">Tel: {profile.phone}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{isCredit ? "Invoice" : "Sales receipt"}</p>
            <p className="text-lg font-semibold text-navy-800">{sale.saleNo}</p>
            <p className="text-sm text-slate-600">{formatDateTime(sale.createdAt)}</p>
            <div className="mt-1 print:hidden">
              <SaleStatusBadge status={sale.status} paymentStatus={sale.paymentStatus} />
            </div>
          </div>
        </header>

        <dl className="grid gap-4 border-b border-line py-5 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Customer</dt>
            <dd className="mt-1 font-medium text-slate-900">{sale.customer?.name ?? "Walk-in customer"}</dd>
            {sale.customer?.phone && <dd className="text-slate-600">{sale.customer.phone}</dd>}
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Served by</dt>
            <dd className="mt-1 text-slate-900">{sale.salesperson.name}</dd>
            <dd className="text-slate-600">{sale.location.name}</dd>
          </div>
          {sale.dueDate && balance.gt(0) && (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Payment due</dt>
              <dd className="mt-1 font-medium text-slate-900">{formatDate(sale.dueDate)}</dd>
            </div>
          )}
        </dl>

        <div className="table-wrap py-2">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Price</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {sale.items.map((i) => (
                <tr key={i.id}>
                  <td>
                    <span className="font-medium text-slate-900">{i.product.name}</span>
                    {i.discount.gt(0) && <span className="block text-xs text-emerald-700">Discount {money(i.discount)}</span>}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {i.enteredQty.toString()} {i.enteredUnit.symbol}
                  </td>
                  <td className="whitespace-nowrap text-right">{money(i.unitPrice)}</td>
                  <td className="whitespace-nowrap text-right font-medium">{money(i.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="ml-auto mt-3 max-w-xs space-y-1.5 border-t border-line pt-4 text-sm">
          <div className="flex justify-between text-slate-600">
            <dt>Subtotal</dt>
            <dd>{money(sale.subtotal)}</dd>
          </div>
          {sale.discountTotal.gt(0) && (
            <div className="flex justify-between text-emerald-700">
              <dt>Discount</dt>
              <dd>−{money(sale.discountTotal)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-line pt-2 text-base font-semibold text-slate-900">
            <dt>Total</dt>
            <dd>{money(sale.total)}</dd>
          </div>
          {sale.allocations.map((a) => (
            <div key={a.id} className="flex justify-between text-slate-600">
              <dt>
                Paid · {methodLabel(a.payment.method)}
                {a.payment.reference ? ` (${a.payment.reference})` : ""}
              </dt>
              <dd>{money(a.amount)}</dd>
            </div>
          ))}
          {sale.returnedTotal.gt(0) && (
            <div className="flex justify-between text-slate-600">
              <dt>Goods returned</dt>
              <dd>−{money(sale.returnedTotal)}</dd>
            </div>
          )}
          {sale.refundedTotal.gt(0) && (
            <div className="flex justify-between text-slate-600">
              <dt>Refunded to customer</dt>
              <dd>{money(sale.refundedTotal)}</dd>
            </div>
          )}
          <div className={`flex justify-between text-base font-semibold ${balance.gt(0) ? "text-brand-red-dark" : "text-emerald-700"}`}>
            <dt>Balance due</dt>
            <dd>{money(balance)}</dd>
          </div>
        </dl>

        {sale.notes && <p className="mt-5 text-sm text-slate-600">Note: {sale.notes}</p>}
        <p className="mt-8 text-center text-xs text-slate-500">Thank you for choosing {profile.name}.</p>
      </article>

      {(sale.creditApprovedBy || showProfit || sale.discountReason) && (
        <section className="card card-pad mx-auto mt-5 max-w-3xl text-sm print:hidden">
          <h2 className="mb-2 text-base font-semibold text-slate-900">Internal details</h2>
          {sale.creditApprovedBy && (
            <p className="text-slate-700">
              Credit limit exception approved by <span className="font-medium">{sale.creditApprovedBy.name}</span>: {sale.creditExceptionReason}
            </p>
          )}
          {sale.discountReason && (
            <p className="text-slate-700">
              Discount of <span className="font-medium">{money(sale.discountTotal)}</span> given: {sale.discountReason}
            </p>
          )}
          {showProfit && (
            <p className="mt-1 text-slate-700">
              Cost of goods {money(sale.cogsTotal)} · Gross profit <span className="font-medium">{money(sale.total.minus(sale.cogsTotal))}</span>
            </p>
          )}
        </section>
      )}

      {sale.reversals.length > 0 && (
        <section className="card mx-auto mt-5 max-w-3xl overflow-hidden print:hidden">
          <h2 className="border-b border-line px-5 py-3 text-base font-semibold text-slate-900">Returns and cancellations</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {sale.reversals.map((r) => (
              <li key={r.id} className="space-y-1.5 px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">
                    {r.reversalNo} · {r.kind === "CANCEL" ? "Cancellation" : "Return"}
                  </span>
                  <span className={r.status === "COMPLETED" ? "badge-green" : r.status === "REJECTED" ? "badge-red" : "badge-yellow"}>{r.status === "COMPLETED" ? "Done" : r.status === "REJECTED" ? "Rejected" : "Waiting for approval"}</span>
                </div>
                <p className="text-slate-600">
                  {r.items.map((i) => `${i.enteredQty.toString()} × ${i.product.name}${i.condition === "DAMAGED" ? " (damaged)" : ""}`).join(", ")}
                </p>
                <p className="text-xs text-slate-500">
                  Asked by {r.requestedBy.name} on {formatDateTime(r.requestedAt)}: “{r.reason}”
                  {r.decidedBy && ` · ${r.status === "REJECTED" ? "Rejected" : "Approved"} by ${r.decidedBy.name}${r.decisionNote ? `: “${r.decisionNote}”` : ""}`}
                </p>
                {r.status === "COMPLETED" && (
                  <p className="text-xs font-medium text-slate-700">
                    Goods returned {money(r.returnValue)}
                    {r.refundAmount.gt(0) && ` · refunded ${money(r.refundAmount)}${r.refundMethod ? ` by ${methodLabel(r.refundMethod)}` : ""}`}
                  </p>
                )}
                {r.status === "PENDING" && canApprove && (
                  <div className="pt-2">
                    <DecisionForm reversalId={r.id} action={decideReversal} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
