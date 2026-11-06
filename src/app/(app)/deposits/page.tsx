import Link from "next/link";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { Landmark } from "lucide-react";
import { DepositForm } from "@/components/cash/CashForms";
import { Alert, EmptyState, PageHeader, Stat } from "@/components/ui";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { defaultLocationId, getBalances, listAccounts } from "@/lib/cash/ledger";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/utils";
import { recordDepositAction } from "../closing/actions";

export const metadata = { title: "Bank Deposits" };

export default async function DepositsPage({ searchParams }: { searchParams: Promise<{ recorded?: string }> }) {
  const user = await requireUser();
  if (!canAny(user, ["deposits.record", "cash.view"])) redirect("/forbidden");
  const canRecord = can(user, "deposits.record");
  const seeAll = can(user, "cash.view");
  const sp = await searchParams;
  const currency = await getCurrency();
  const locationId = await defaultLocationId(db);
  const [rows, balances, total] = await Promise.all([
    db.bankDeposit.findMany({ where: seeAll ? {} : { createdById: user.id }, orderBy: { createdAt: "desc" }, take: 50, include: { createdBy: { select: { name: true } } } }),
    getBalances(db, locationId),
    db.bankDeposit.aggregate({ where: seeAll ? {} : { createdById: user.id }, _sum: { amount: true } }),
  ]);
  const cash = balances.find((b) => b.method === "CASH")!;
  const bank = balances.find((b) => b.method === "BANK")!;

  return (
    <>
      <PageHeader title="Bank Deposits" description="Taking cash from the till to the bank. It is a transfer between your own accounts - not income and not an expense. You can deposit part of the cash; the rest stays in the till." />

      {sp.recorded && (
        <div className="mb-4">
          <Alert kind="success">
            Deposit <strong>{sp.recorded}</strong> is recorded. Cash on hand went down and the bank balance went up by the same amount.
          </Alert>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <Stat label="Cash on hand" value={formatMoney(cash.balance, currency)} />
        {seeAll && <Stat label="Bank balance" value={formatMoney(bank.balance, currency)} />}
        <Stat label={seeAll ? "Total deposited" : "Deposited by you"} value={formatMoney(total._sum.amount ?? 0, currency)} />
      </div>

      {canRecord && (
        <section className="card mb-5">
          <div className="border-b border-line px-4 py-3.5 sm:px-5">
            <h2 className="text-base font-semibold text-slate-900">Record a deposit</h2>
          </div>
          <div className="px-4 py-4 sm:px-5">
            <DepositForm key={sp.recorded ?? "new"} action={recordDepositAction} submissionKey={randomUUID()} cashBalance={formatMoney(cash.balance, currency)} bankAccounts={(await listAccounts(db, locationId)).filter((a) => a.method === "BANK")} />
          </div>
        </section>
      )}

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={<Landmark size={22} />} title="No deposits yet" description="Deposits appear here once cash is taken to the bank." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Deposit</th>
                  <th>Day</th>
                  <th>Bank reference</th>
                  <th className="hidden md:table-cell">By</th>
                  <th className="text-right">Amount</th>
                  <th className="hidden sm:table-cell">Slip</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td className="font-medium">
                      {d.depositNo}
                      {d.closingId && (
                        <Link href={`/closing/${d.closingId}`} className="ml-2 text-xs font-normal text-navy-700 hover:underline">
                          with closing
                        </Link>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-slate-600">{formatDate(d.businessDate)}</td>
                    <td>{d.bankReference}</td>
                    <td className="hidden md:table-cell">
                      {d.createdBy.name}
                      <span className="block text-xs text-slate-400">{formatDateTime(d.createdAt)}</span>
                    </td>
                    <td className="text-right font-medium tabular-nums">{formatMoney(d.amount, currency)}</td>
                    <td className="hidden sm:table-cell">
                      {d.slipId ? (
                        <a href={`/api/attachment/${d.slipId}`} target="_blank" rel="noreferrer" className="text-navy-700 hover:underline">
                          View photo
                        </a>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
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
