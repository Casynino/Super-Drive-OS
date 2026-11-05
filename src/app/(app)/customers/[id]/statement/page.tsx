import Link from "next/link";
import { notFound } from "next/navigation";
import PrintButton from "@/components/PrintButton";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { customerOutstanding } from "@/lib/sales/outstanding";
import { customerCredit } from "@/lib/sales/collections";
import { getStatement } from "@/lib/sales/statement";
import { getBusinessProfile, getCurrency } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Customer statement" };

const isDate = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));

export default async function StatementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  await requirePagePermission("credit.view");
  const { id } = await params;
  const sp = await searchParams;
  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) notFound();

  const from = isDate(sp.from) ? new Date(`${sp.from}T00:00:00+03:00`) : undefined;
  const to = isDate(sp.to) ? new Date(`${sp.to}T23:59:59.999+03:00`) : undefined;
  const [statement, profile, currency, owed, credit] = await Promise.all([getStatement(db, id, from, to), getBusinessProfile(), getCurrency(), customerOutstanding(db, id), customerCredit(db, id)]);
  const money = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, currency);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <Link href={`/customers/${id}`} className="text-sm text-slate-500 hover:text-navy-700">
            ← {customer.name}
          </Link>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Customer statement</h1>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <form method="get" className="flex flex-wrap items-end gap-2">
            <div>
              <label className="label" htmlFor="from">
                From
              </label>
              <input id="from" type="date" name="from" defaultValue={sp.from ?? ""} className="input" />
            </div>
            <div>
              <label className="label" htmlFor="to">
                To
              </label>
              <input id="to" type="date" name="to" defaultValue={sp.to ?? ""} className="input" />
            </div>
            <button className="btn-primary" type="submit">
              Show
            </button>
          </form>
          <PrintButton label="Print statement" />
        </div>
      </div>

      <article className="card mx-auto max-w-4xl p-5 sm:p-8 print:max-w-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">{profile.name}</h2>
            {profile.address && <p className="text-sm text-slate-600">{profile.address}</p>}
            {profile.phone && <p className="text-sm text-slate-600">Tel: {profile.phone}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Account statement</p>
            <p className="text-lg font-semibold text-slate-900">{customer.name}</p>
            {customer.phone && <p className="text-sm text-slate-600">{customer.phone}</p>}
            <p className="text-sm text-slate-600">
              {from ? formatDate(from) : "Start"} – {to ? formatDate(to) : "today"}
            </p>
            <p className="text-xs text-slate-500">Printed {formatDateTime(new Date())}</p>
          </div>
        </header>

        <div className="table-wrap py-3">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Transaction</th>
                <th className="text-right">Charged</th>
                <th className="text-right">Paid</th>
                <th className="text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-slate-50/70">
                <td colSpan={4} className="font-medium text-slate-700">
                  Previous balance
                </td>
                <td className="text-right font-medium">{money(statement.opening)}</td>
              </tr>
              {statement.lines.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-500">
                    No transactions in this period.
                  </td>
                </tr>
              )}
              {statement.lines.map((l) => (
                <tr key={`${l.kind}-${l.refId}`}>
                  <td className="whitespace-nowrap text-slate-600">{formatDateTime(l.at)}</td>
                  <td>
                    <span className="font-medium text-slate-900">{l.ref}</span>
                    <span className="block text-xs text-slate-500">{l.description}</span>
                  </td>
                  <td className="text-right">{l.debit.gt(0) ? money(l.debit) : ""}</td>
                  <td className="text-right text-emerald-700">{l.credit.gt(0) ? money(l.credit) : ""}</td>
                  <td className="whitespace-nowrap text-right font-medium">{money(l.balance)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 bg-slate-50">
                <td colSpan={4} className="font-semibold text-slate-900">
                  Balance at end of period
                </td>
                <td className="text-right text-base font-semibold text-slate-900">{money(statement.closing)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <dl className="ml-auto mt-3 max-w-xs space-y-1.5 border-t border-line pt-4 text-sm">
          <div className="flex justify-between text-slate-600">
            <dt>Unpaid invoices today</dt>
            <dd className={owed.gt(0) ? "font-semibold text-brand-red-dark" : ""}>{money(owed)}</dd>
          </div>
          {credit.gt(0) && (
            <div className="flex justify-between text-slate-600">
              <dt>Customer credit held</dt>
              <dd>{money(credit)}</dd>
            </div>
          )}
        </dl>
        <p className="mt-6 text-center text-xs text-slate-500">A negative balance means the customer has paid in advance.</p>
      </article>
    </>
  );
}
