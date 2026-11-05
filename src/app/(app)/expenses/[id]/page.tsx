import { notFound, redirect } from "next/navigation";
import { ExpenseStatusBadge } from "@/components/cash/Display";
import { ExpenseDecisionForm, ReverseExpenseForm } from "@/components/cash/ExpenseForms";
import { DetailGrid, PageHeader } from "@/components/ui";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { methodLabel } from "@/lib/sales/types";
import { getCurrency } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/utils";
import { decideExpenseAction, reverseExpenseAction } from "../actions";

export const metadata = { title: "Expense" };

export default async function ExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!canAny(user, ["expenses.view", "expenses.create"])) redirect("/forbidden");
  const { id } = await params;
  const e = await db.expense.findUnique({
    where: { id },
    include: { category: { select: { name: true } }, requestedBy: { select: { name: true } }, decidedBy: { select: { name: true } }, reversedBy: { select: { name: true } } },
  });
  // People who cannot see everyone's expenses only see their own (others return "not found")
  if (!e || (!can(user, "expenses.view") && e.requestedById !== user.id)) notFound();
  const currency = await getCurrency();
  const approver = can(user, "expenses.approve");

  return (
    <>
      <PageHeader title={e.expenseNo} back={{ href: "/expenses", label: "Expenses" }} description={e.description} actions={<ExpenseStatusBadge status={e.status} />} />

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <section className="card card-pad">
            <p className="text-sm text-slate-500">Amount</p>
            <p className="mt-0.5 text-3xl font-semibold tracking-tight text-slate-900">{formatMoney(e.amount, currency)}</p>
            <div className="mt-5">
              <DetailGrid
                items={[
                  { label: "Category", value: e.category.name },
                  { label: "Paid from", value: methodLabel(e.method) },
                  { label: "Date", value: formatDate(e.expenseDate) },
                  { label: "Recorded by", value: `${e.requestedBy.name} · ${formatDateTime(e.requestedAt)}` },
                  { label: "Notes", value: e.notes },
                ]}
              />
            </div>
          </section>

          {(e.decidedAt || e.reversedAt) && (
            <section className="card card-pad">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">History</h2>
              <ol className="space-y-3 text-sm">
                <li>
                  <span className="font-medium text-slate-900">Recorded</span> by {e.requestedBy.name} · {formatDateTime(e.requestedAt)}
                </li>
                {e.decidedAt && (
                  <li>
                    <span className="font-medium text-slate-900">{e.status === "REJECTED" ? "Rejected" : e.decidedById ? "Approved" : "Paid within the approval limit"}</span>
                    {e.decidedBy && ` by ${e.decidedBy.name}`} · {formatDateTime(e.decidedAt)}
                    {e.decisionNote && e.decidedById && <p className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-slate-700">“{e.decisionNote}”</p>}
                  </li>
                )}
                {e.reversedAt && (
                  <li>
                    <span className="font-medium text-slate-900">Reversed</span> by {e.reversedBy?.name} · {formatDateTime(e.reversedAt)}
                    <p className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-slate-700">“{e.reversalReason}”</p>
                  </li>
                )}
              </ol>
            </section>
          )}
        </div>

        <div className="space-y-5">
          {e.receiptId && (
            <section className="card overflow-hidden">
              <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-slate-900">Receipt</h2>
              <a href={`/api/attachment/${e.receiptId}`} target="_blank" rel="noreferrer" className="block bg-slate-50 p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/attachment/${e.receiptId}`} alt={`Receipt for ${e.expenseNo}`} className="mx-auto max-h-96 w-auto rounded-md border border-line bg-white" />
              </a>
            </section>
          )}
          {approver && e.status === "PENDING" && (
            <section className="card card-pad">
              <h2 className="mb-1 text-base font-semibold text-slate-900">Your decision</h2>
              <p className="mb-3 text-sm text-slate-500">Approving lets the shop pay it. The money leaves {methodLabel(e.method).toLowerCase()} at that moment.</p>
              <ExpenseDecisionForm expenseId={e.id} action={decideExpenseAction} />
            </section>
          )}
          {approver && e.status === "APPROVED" && (
            <section className="card card-pad">
              <h2 className="mb-1 text-base font-semibold text-slate-900">Reverse this expense</h2>
              <p className="mb-3 text-sm text-slate-500">Use this if it was entered by mistake. The money is put back and the record stays, marked reversed.</p>
              <ReverseExpenseForm expenseId={e.id} action={reverseExpenseAction} />
            </section>
          )}
        </div>
      </div>
    </>
  );
}
