import Link from "next/link";
import { Inbox } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import DecisionForm from "@/components/sales/DecisionForm";
import { redirect } from "next/navigation";
import { ExpenseDecisionForm } from "@/components/cash/ExpenseForms";
import { ClosingStatusBadge, Difference } from "@/components/cash/Display";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { decideExpenseAction } from "../expenses/actions";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { methodLabel } from "@/lib/sales/types";
import { getCurrency } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/utils";
import { decideReversal } from "../sales/reversal-actions";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const user = await requireUser();
  if (!canAny(user, ["returns.approve", "expenses.approve", "closing.approve"])) redirect("/forbidden");
  const showReturns = can(user, "returns.approve");
  const showExpenses = can(user, "expenses.approve");
  const showClosings = can(user, "closing.approve");
  const currency = await getCurrency();
  const include = {
    sale: { select: { id: true, saleNo: true, total: true, customer: { select: { name: true } } } },
    requestedBy: { select: { name: true } },
    decidedBy: { select: { name: true } },
    items: { include: { product: { select: { name: true } } } },
  } as const;
  const [pending, recent, expenses, closings] = await Promise.all([
    showReturns ? db.saleReversal.findMany({ where: { status: "PENDING" }, orderBy: { requestedAt: "asc" }, include }) : Promise.resolve([]),
    showReturns ? db.saleReversal.findMany({ where: { status: { not: "PENDING" } }, orderBy: { decidedAt: "desc" }, take: 10, include }) : Promise.resolve([]),
    showExpenses ? db.expense.findMany({ where: { status: "PENDING" }, orderBy: { requestedAt: "asc" }, include: { category: { select: { name: true } }, requestedBy: { select: { name: true } } } }) : Promise.resolve([]),
    showClosings ? db.dailyClosing.findMany({ where: { status: "NEEDS_REVIEW" }, orderBy: { businessDate: "asc" }, include: { submittedBy: { select: { name: true } } } }) : Promise.resolve([]),
  ]);
  const waiting = pending.length + expenses.length + closings.length;

  return (
    <>
      <PageHeader title="Approvals" description="Things that need a manager or the owner before stock and money change: returns, expenses above the limit, and cash counts that did not match." />

      {showClosings && closings.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-base font-semibold text-slate-900">Cash counts that did not match ({closings.length})</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {closings.map((c) => (
              <div key={c.id} className="card card-pad">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Closing ·{" "}
                      <Link href={`/closing/${c.id}`} className="text-navy-700 hover:underline">
                        {formatDate(c.businessDate)}
                      </Link>
                    </p>
                    <p className="text-xs text-slate-500">
                      {c.closingNo} · {c.submittedBy.name}
                    </p>
                  </div>
                  <ClosingStatusBadge status={c.status} />
                </div>
                <p className="mt-3 text-sm text-slate-700">
                  Expected {formatMoney(c.expectedCash, currency)}, counted {formatMoney(c.countedCash, currency)} · <Difference value={c.difference.toString()} currency={currency} />
                </p>
                {c.notes && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">“{c.notes}”</p>}
                <Link href={`/closing/${c.id}`} className="btn-primary mt-3">
                  Look into it
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {showExpenses && expenses.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-3 text-base font-semibold text-slate-900">Expenses waiting for approval ({expenses.length})</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {expenses.map((e) => (
              <div key={e.id} className="card card-pad">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      <Link href={`/expenses/${e.id}`} className="text-navy-700 hover:underline">
                        {e.expenseNo}
                      </Link>{" "}
                      · {e.category.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {e.requestedBy.name} · {formatDateTime(e.requestedAt)} · from {methodLabel(e.method).toLowerCase()}
                    </p>
                  </div>
                  <span className="text-lg font-semibold tabular-nums">{formatMoney(e.amount, currency)}</span>
                </div>
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">“{e.description}”</p>
                <div className="mt-3 border-t border-line pt-3">
                  <ExpenseDecisionForm expenseId={e.id} action={decideExpenseAction} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {showReturns && (
      <section className="mb-6">
        <h2 className="mb-3 text-base font-semibold text-slate-900">Returns and cancellations ({pending.length})</h2>
        {pending.length === 0 ? (
          <div className="card">
            <EmptyState icon={<Inbox size={22} />} title={waiting === 0 ? "Nothing is waiting" : "No returns waiting"} description="New requests also appear in your notifications." />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {pending.map((r) => (
              <div key={r.id} className="card card-pad">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {r.kind === "CANCEL" ? "Cancel sale" : "Return"} ·{" "}
                      <Link href={`/sales/${r.sale.id}`} className="text-navy-700 hover:underline">
                        {r.sale.saleNo}
                      </Link>
                    </p>
                    <p className="text-xs text-slate-500">
                      {r.sale.customer?.name ?? "Walk-in customer"} · sale total {formatMoney(r.sale.total, currency)}
                    </p>
                  </div>
                  <span className="badge-yellow">Waiting</span>
                </div>
                <ul className="mt-3 space-y-1 text-sm text-slate-700">
                  {r.items.map((i) => (
                    <li key={i.id}>
                      {i.enteredQty.toString()} × {i.product.name} {i.condition === "DAMAGED" && <span className="badge-red ml-1">Damaged</span>}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">“{r.reason}”</p>
                <p className="mt-2 text-xs text-slate-500">
                  Asked by {r.requestedBy.name} · {formatDateTime(r.requestedAt)}
                  {r.refundMethod && ` · refund by ${methodLabel(r.refundMethod)} if money is due`}
                </p>
                <div className="mt-3 border-t border-line pt-3">
                  <DecisionForm reversalId={r.id} action={decideReversal} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {showReturns && recent.length > 0 && (
        <section className="card overflow-hidden">
          <h2 className="border-b border-line px-5 py-3 text-base font-semibold text-slate-900">Recently decided</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <span>
                  <Link href={`/sales/${r.sale.id}`} className="font-medium text-navy-700 hover:underline">
                    {r.reversalNo}
                  </Link>{" "}
                  <span className="text-slate-500">
                    · {r.sale.saleNo} · {r.status === "COMPLETED" ? `approved by ${r.decidedBy?.name}` : `rejected by ${r.decidedBy?.name}`}
                  </span>
                </span>
                <span className={r.status === "COMPLETED" ? "badge-green" : "badge-red"}>{r.status === "COMPLETED" ? formatMoney(r.returnValue, currency) : "Rejected"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
