import Link from "next/link";
import BackLink from "@/components/BackLink";
import { notFound, redirect } from "next/navigation";
import { Alert } from "@/components/ui";
import PrintButton from "@/components/PrintButton";
import { canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { owedOf } from "@/lib/sales/owed";
import { methodLabel } from "@/lib/sales/types";
import { getBusinessProfile, getCurrency } from "@/lib/settings";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Payment receipt" };

export default async function PaymentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const user = await requireUser();
  if (!canAny(user, ["payments.view", "payments.record"])) redirect("/forbidden");
  const { id } = await params;
  const sp = await searchParams;

  const p = await db.payment.findUnique({
    where: { id },
    include: {
      customer: true,
      receivedBy: { select: { name: true } },
      allocations: { include: { sale: { select: { id: true, saleNo: true, total: true, amountPaid: true, returnedTotal: true, refundedTotal: true } } }, orderBy: { id: "asc" } },
    },
  });
  if (!p) notFound();
  const [profile, currency] = await Promise.all([getBusinessProfile(), getCurrency()]);
  const money = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, currency);

  const allocated = p.allocations.reduce((s, a) => s.plus(a.amount), p.amount.minus(p.amount));
  const credit = p.amount.minus(allocated);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <BackLink href={p.customerId ? `/customers/${p.customerId}` : "/payments"} className="py-1 text-sm text-slate-500 hover:text-navy-700">
          ← {p.customer ? p.customer.name : "Payments"}
        </BackLink>
        <PrintButton label="Print receipt" />
      </div>
      {sp.created && (
        <div className="mb-4 print:hidden">
          <Alert kind="success">Payment recorded.{credit.gt(0) ? " The extra amount is held as customer credit." : ""}</Alert>
        </div>
      )}

      <article className="card mx-auto max-w-2xl p-5 sm:p-8 print:max-w-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">{profile.name}</h1>
            {profile.address && <p className="text-sm text-slate-600">{profile.address}</p>}
            {profile.phone && <p className="text-sm text-slate-600">Tel: {profile.phone}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Payment receipt</p>
            <p className="text-lg font-semibold text-navy-800">{p.paymentNo}</p>
            <p className="text-sm text-slate-600">{formatDateTime(p.receivedAt)}</p>
          </div>
        </header>

        <dl className="grid gap-4 border-b border-line py-5 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Received from</dt>
            <dd className="mt-1 font-medium text-slate-900">{p.customer?.name ?? "Walk-in customer"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Paid by</dt>
            <dd className="mt-1 text-slate-900">{methodLabel(p.method)}</dd>
            {p.reference && <dd className="text-slate-600">Ref: {p.reference}</dd>}
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Received by</dt>
            <dd className="mt-1 text-slate-900">{p.receivedBy.name}</dd>
          </div>
        </dl>

        <div className="py-5">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Applied to</p>
          {p.allocations.length === 0 ? (
            <p className="text-sm text-slate-600">No invoice. The full amount is held as customer credit.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th className="text-right">Paid now</th>
                  <th className="text-right">Still owed on invoice</th>
                </tr>
              </thead>
              <tbody>
                {p.allocations.map((a) => (
                  <tr key={a.id}>
                    <td className="font-medium">{a.sale.saleNo}</td>
                    <td className="text-right">{money(a.amount)}</td>
                    <td className="text-right text-slate-600">{money(owedOf(a.sale))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <dl className="ml-auto max-w-xs space-y-1.5 border-t border-line pt-4 text-sm">
          {credit.gt(0) && (
            <div className="flex justify-between text-slate-600">
              <dt>Held as customer credit</dt>
              <dd>{money(credit)}</dd>
            </div>
          )}
          <div className="flex justify-between text-base font-semibold text-slate-900">
            <dt>Amount received</dt>
            <dd>{money(p.amount)}</dd>
          </div>
        </dl>
        {p.notes && <p className="mt-5 text-sm text-slate-600">Note: {p.notes}</p>}
        <p className="mt-8 text-center text-xs text-slate-500">Thank you for your payment.</p>
      </article>
    </>
  );
}
