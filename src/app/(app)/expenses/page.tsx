import Link from "next/link";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { CheckCircle2, Clock, ReceiptText } from "lucide-react";
import { Alert, EmptyState, PageHeader, Stat } from "@/components/ui";
import { ExpenseForm } from "@/components/cash/ExpenseForms";
import { ExpenseStatusBadge } from "@/components/cash/Display";
import { Prisma, type ExpenseStatus } from "@/generated/prisma/client";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { businessDay } from "@/lib/cash/ledger";
import { getCashSettings } from "@/lib/cash/settings";
import { defaultLocationId, listAccounts } from "@/lib/cash/ledger";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { methodLabel } from "@/lib/sales/types";
import { getCurrency } from "@/lib/settings";
import { formatDate } from "@/lib/utils";
import { recordExpenseAction } from "./actions";

export const metadata = { title: "Expenses" };

const STATUSES: ExpenseStatus[] = ["PENDING", "APPROVED", "REJECTED", "REVERSED"];
const PAGE_SIZE = 30;
type Search = { status?: string; from?: string; to?: string; page?: string; recorded?: string; state?: string };
const isDate = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (!canAny(user, ["expenses.view", "expenses.create"])) redirect("/forbidden");
  const seeAll = can(user, "expenses.view");
  const canRecord = can(user, "expenses.create");
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const today = businessDay();

  const [currency, settings, categories] = await Promise.all([
    getCurrency(),
    getCashSettings(db),
    canRecord ? db.expenseCategory.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);

  const expenseDate: Prisma.DateTimeFilter = {};
  if (isDate(sp.from)) expenseDate.gte = new Date(`${sp.from}T00:00:00Z`);
  if (isDate(sp.to)) expenseDate.lte = new Date(`${sp.to}T00:00:00Z`);
  const where: Prisma.ExpenseWhereInput = {
    ...(seeAll ? {} : { requestedById: user.id }),
    ...(STATUSES.includes(sp.status as ExpenseStatus) ? { status: sp.status as ExpenseStatus } : {}),
    ...(Object.keys(expenseDate).length ? { expenseDate } : {}),
  };
  const mine: Prisma.ExpenseWhereInput = seeAll ? {} : { requestedById: user.id };
  const monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);

  const [rows, total, paidToday, paidMonth, pending] = await Promise.all([
    db.expense.findMany({ where, orderBy: [{ requestedAt: "desc" }, { id: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { category: { select: { name: true } }, requestedBy: { select: { name: true } } } }),
    db.expense.count({ where }),
    db.expense.aggregate({ where: { ...mine, status: "APPROVED", expenseDate: new Date(`${today}T00:00:00Z`) }, _sum: { amount: true } }),
    db.expense.aggregate({ where: { ...mine, status: "APPROVED", expenseDate: { gte: monthStart } }, _sum: { amount: true } }),
    db.expense.count({ where: { ...mine, status: "PENDING" } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ status: sp.status, from: sp.from, to: sp.to })) if (v) q.set(k, v);
    if (p > 1) q.set("page", String(p));
    return `/expenses?${q.toString()}`;
  };
  const hasFilters = Boolean(sp.status || sp.from || sp.to);
  const limitText = settings.expenseApprovalLimit.gt(0)
    ? `Up to ${formatMoney(settings.expenseApprovalLimit, currency)} is recorded straight away. Anything above needs the owner to approve it first.`
    : "Every expense needs the owner's approval before the money is paid out.";

  return (
    <>
      <PageHeader title="Expenses" description={seeAll ? "Everything the shop spent. Approved expenses leave the account they were paid from." : "Money you spent for the shop. Record it here so the owner can see it and the day's cash adds up."} />

      {sp.recorded && (
        <div className="mb-4">
          {sp.state === "pending" ? (
            <Alert kind="info">
              <strong>{sp.recorded}</strong> was sent to the owner for approval. Do not pay it out of the till until it is approved.
            </Alert>
          ) : (
            <Alert kind="success">
              <strong>{sp.recorded}</strong> is recorded and taken from the account you chose.
            </Alert>
          )}
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <Stat label="Spent today" value={formatMoney(paidToday._sum.amount ?? 0, currency)} />
        <Stat label="Spent this month" value={formatMoney(paidMonth._sum.amount ?? 0, currency)} />
        <Stat label="Waiting for approval" value={pending} hint={pending ? "No money moves until approved" : undefined} />
      </div>

      {canRecord && (
        <section className="card mb-5">
          <div className="border-b border-line px-4 py-3.5 sm:px-5">
            <h2 className="text-base font-semibold text-slate-900">Record an expense</h2>
          </div>
          <div className="px-4 py-4 sm:px-5">
            {categories.length === 0 ? (
              <Alert kind="info">The owner has not set up expense categories yet (Settings → Expenses).</Alert>
            ) : (
              <ExpenseForm key={sp.recorded ?? "new"} action={recordExpenseAction} accounts={await listAccounts(db, await defaultLocationId(db))} categories={categories} today={today} submissionKey={randomUUID()} limitText={limitText} />
            )}
          </div>
        </section>
      )}

      <form method="get" className="card card-pad mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto]">
        <select name="status" defaultValue={sp.status ?? ""} className="input" aria-label="Status">
          <option value="">All statuses</option>
          <option value="PENDING">Waiting for approval</option>
          <option value="APPROVED">Paid</option>
          <option value="REJECTED">Rejected</option>
          <option value="REVERSED">Reversed</option>
        </select>
        <input type="date" name="from" defaultValue={sp.from ?? ""} className="input" aria-label="From date" />
        <input type="date" name="to" defaultValue={sp.to ?? ""} className="input" aria-label="To date" />
        <div className="flex gap-2">
          <button className="btn-primary" type="submit">
            Filter
          </button>
          {hasFilters && (
            <Link href="/expenses" className="btn-secondary">
              Clear
            </Link>
          )}
        </div>
      </form>

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={<ReceiptText size={22} />} title={hasFilters ? "No expenses match your filters" : "No expenses yet"} description={hasFilters ? undefined : "Expenses appear here as soon as they are recorded."} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Expense</th>
                  <th>Date</th>
                  <th>Category</th>
                  <th className="hidden md:table-cell">Description</th>
                  {seeAll && <th className="hidden lg:table-cell">By</th>}
                  <th className="hidden sm:table-cell">Paid from</th>
                  <th className="text-right">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link href={`/expenses/${e.id}`} className="font-medium text-navy-700 hover:underline">
                        {e.expenseNo}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap text-slate-600">{formatDate(e.expenseDate)}</td>
                    <td>{e.category.name}</td>
                    <td className="hidden max-w-[260px] truncate md:table-cell">{e.description}</td>
                    {seeAll && <td className="hidden lg:table-cell">{e.requestedBy.name}</td>}
                    <td className="hidden sm:table-cell">{methodLabel(e.method)}</td>
                    <td className="text-right font-medium tabular-nums">{formatMoney(e.amount, currency)}</td>
                    <td>
                      <ExpenseStatusBadge status={e.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-slate-600">
            <span>
              Page {page} of {pages} · {total} expenses
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={href(page - 1)} className="btn-secondary btn-sm">
                  Previous
                </Link>
              )}
              {page < pages && (
                <Link href={href(page + 1)} className="btn-secondary btn-sm">
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
        <CheckCircle2 size={13} /> Approved expenses cannot be edited or deleted. They can only be reversed by the owner, with a reason.
        <Clock size={13} className="ml-2" /> Dates follow Tanzania time.
      </p>
    </>
  );
}
