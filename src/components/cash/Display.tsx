import type { ClosingStatus, ExpenseStatus } from "@/generated/prisma/client";
import { formatMoney, type CurrencyConfig } from "@/lib/money";
import type { ClosingSummary } from "@/lib/cash/closing";
import { ACCOUNT_NAME } from "@/lib/cash/ledger";
import { cn } from "@/lib/utils";

export function ExpenseStatusBadge({ status }: { status: ExpenseStatus }) {
  const map = { PENDING: ["badge-yellow", "Waiting for approval"], APPROVED: ["badge-green", "Paid"], REJECTED: ["badge-red", "Rejected"], REVERSED: ["badge-gray", "Reversed"] } as const;
  const [cls, label] = map[status];
  return <span className={cls}>{label}</span>;
}

export function ClosingStatusBadge({ status, difference }: { status: ClosingStatus; difference?: string }) {
  if (status === "NEEDS_REVIEW") return <span className="badge-red">Needs review</span>;
  if (status === "REVIEWED") return <span className="badge-blue">Reviewed</span>;
  return <span className={difference && difference !== "0" ? "badge-yellow" : "badge-green"}>{difference && difference !== "0" ? "Within allowed" : "Matches"}</span>;
}

/** A signed difference in words and colour: shortage (red), surplus (amber), exact (green). */
export function Difference({ value, currency, className }: { value: string; currency: CurrencyConfig; className?: string }) {
  const n = Number(value);
  return (
    <span className={cn("font-semibold tabular-nums", n === 0 ? "text-emerald-700" : n < 0 ? "text-brand-red-dark" : "text-yellow-800", className)}>
      {n === 0 ? "No difference" : `${n < 0 ? "Short " : "Extra "}${formatMoney(Math.abs(n), currency)}`}
    </span>
  );
}

function Row({ label, value, sign, strong, muted }: { label: string; value: string; sign?: "+" | "-" | "="; strong?: boolean; muted?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-1.5 text-sm", strong && "border-t border-line pt-2.5 text-base font-semibold text-slate-900", muted && "text-slate-400")}>
      <span className={cn("text-slate-600", strong && "text-slate-900")}>
        {sign && <span className="mr-2 inline-block w-3 text-center font-semibold text-slate-400">{sign}</span>}
        {label}
      </span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Block({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="card card-pad">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

/** The whole day on one screen: sales, collections, expenses, and how the expected cash is worked out. */
export function ClosingSummaryView({ s, currency, showAccounts = true }: { s: ClosingSummary; currency: CurrencyConfig; showAccounts?: boolean }) {
  const m = (v: string) => formatMoney(v, currency);
  const nonZero = (v: string) => Number(v) !== 0;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Block title="Sales" right={<span className="text-xs text-slate-500">{s.sales.count} sale{s.sales.count === 1 ? "" : "s"}</span>}>
          <Row label="Total sold" value={m(s.sales.total)} strong />
          <Row label="Paid in cash" value={m(s.sales.paidByMethod.CASH)} />
          <Row label="Paid by mobile money" value={m(s.sales.paidByMethod.MOBILE_MONEY)} />
          <Row label="Paid into the bank" value={m(s.sales.paidByMethod.BANK)} />
          <Row label="Given on credit (not paid yet)" value={m(s.sales.creditGiven)} />
          {s.sales.returnsCount > 0 && <Row label={`Returned or cancelled (${s.sales.returnsCount})`} value={m(s.sales.returnsValue)} muted />}
        </Block>

        <div className="space-y-4">
          <Block title="Debts collected">
            <Row label="Total collected" value={m(s.collections.total)} strong />
            <Row label="In cash" value={m(s.collections.byMethod.CASH)} />
            <Row label="By mobile money" value={m(s.collections.byMethod.MOBILE_MONEY)} />
            <Row label="Into the bank" value={m(s.collections.byMethod.BANK)} />
          </Block>
          <Block title="Expenses">
            <Row label="Total spent" value={m(s.expenses.total)} strong />
            {s.expenses.byCategory.length === 0 ? <p className="py-1 text-sm text-slate-400">No expenses.</p> : s.expenses.byCategory.map((c) => <Row key={c.name} label={c.name} value={m(c.amount)} />)}
          </Block>
        </div>
      </div>

      <Block title="Cash in the till">
        <Row label="Cash at the start" value={m(s.cash.opening)} />
        <Row sign="+" label="Cash from sales" value={m(s.cash.salesIn)} />
        <Row sign="+" label="Cash from debts collected" value={m(s.cash.collectionsIn)} />
        {nonZero(s.cash.refundsOut) && <Row sign="-" label="Refunds paid to customers" value={m(s.cash.refundsOut)} />}
        <Row sign="-" label="Cash expenses" value={m(s.cash.expensesOut)} />
        {nonZero(s.cash.withdrawals) && <Row sign="-" label="Taken out by the owner" value={m(s.cash.withdrawals)} />}
        {nonZero(s.cash.supplierPayments ?? "0") && <Row sign="-" label="Paid to suppliers" value={m(s.cash.supplierPayments ?? "0")} />}
        {nonZero(s.cash.depositsOut) && <Row sign="-" label="Deposited to the bank earlier" value={m(s.cash.depositsOut)} />}
        {nonZero(s.cash.corrections) && <Row sign={Number(s.cash.corrections) < 0 ? "-" : "+"} label="Corrections by the owner" value={m(String(Math.abs(Number(s.cash.corrections))))} />}
        <Row sign="=" label="Cash that should be in the till" value={m(s.cash.expected)} strong />
      </Block>

      {showAccounts && (
        <Block title="Mobile money and bank (kept apart from cash)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-1.5 font-medium">Account</th>
                  <th className="py-1.5 text-right font-medium">Start</th>
                  <th className="py-1.5 text-right font-medium">In</th>
                  <th className="py-1.5 text-right font-medium">Out</th>
                  <th className="py-1.5 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {s.accounts.filter((a) => a.method !== "CASH").map((a) => (
                  <tr key={a.method}>
                    <td className="py-2 text-slate-700">{ACCOUNT_NAME[a.method]}</td>
                    <td className="py-2 text-right tabular-nums text-slate-500">{m(a.opening)}</td>
                    <td className="py-2 text-right tabular-nums">{m(a.in)}</td>
                    <td className="py-2 text-right tabular-nums">{m(a.out)}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{m(a.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Block>
      )}
    </div>
  );
}
