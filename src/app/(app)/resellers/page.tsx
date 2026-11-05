import Link from "next/link";
import { Handshake, Plus } from "lucide-react";
import { EmptyState, PageHeader, Stat } from "@/components/ui";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getResellerAccount } from "@/lib/resellers/engine";
import { getCurrency } from "@/lib/settings";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Resellers" };

export default async function ResellersPage() {
  const user = await requirePagePermission("resellers.view");
  const currency = await getCurrency();
  const resellers = await db.reseller.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }] });
  const accounts = await Promise.all(resellers.map((r) => getResellerAccount(db, r.id)));
  const sum = (f: (a: (typeof accounts)[number]) => number) => accounts.reduce((s, a) => s + f(a), 0);
  const canManage = can(user, "resellers.manage");

  return (
    <>
      <PageHeader
        title="Resellers"
        description="People who take stock to sell elsewhere. Stock they hold is still ours: it is off the shop shelf but counted under their name until it is sold or returned."
        actions={
          canManage && (
            <Link href="/resellers/new" className="btn-primary">
              <Plus size={16} /> Register reseller
            </Link>
          )
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label="Resellers" value={resellers.filter((r) => r.status === "ACTIVE").length} hint={`${resellers.length} registered`} />
        <Stat label="Stock with resellers" value={formatMoney(sum((a) => a.remainingValue.toNumber()), currency)} hint="At the agreed prices" />
        <Stat label="Owed by resellers" value={formatMoney(sum((a) => a.outstanding.toNumber()), currency)} hint="For what they reported sold" />
        <Stat label="Overdue" value={formatMoney(sum((a) => a.overdue.toNumber()), currency)} hint={sum((a) => a.overdue.toNumber()) > 0 ? "Past the settlement date" : "Nothing overdue"} />
      </div>

      <div className="card overflow-hidden">
        {resellers.length === 0 ? (
          <EmptyState
            icon={<Handshake size={22} />}
            title="No resellers yet"
            description="Register a reseller, then issue stock to them. Everything they take, sell and pay is tracked here."
            action={
              canManage ? (
                <Link href="/resellers/new" className="btn-primary">
                  Register reseller
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Reseller</th>
                  <th className="text-right">Stock they hold</th>
                  <th className="hidden text-right md:table-cell">Reported sold</th>
                  <th className="hidden text-right lg:table-cell">Paid</th>
                  <th className="text-right">Owes</th>
                  <th className="hidden sm:table-cell">Last payment</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.reseller.id}>
                    <td>
                      <Link href={`/resellers/${a.reseller.id}`} className="font-medium text-navy-700 hover:underline">
                        {a.reseller.name}
                      </Link>
                      {a.reseller.status === "INACTIVE" && <span className="badge-gray ml-2">Inactive</span>}
                      <span className="block text-xs text-slate-500">{[a.reseller.businessName, a.reseller.phone].filter(Boolean).join(" · ")}</span>
                    </td>
                    <td className="text-right tabular-nums">
                      {formatMoney(a.remainingValue, currency)}
                      <span className="block text-xs text-slate-500">{a.remainingQty.toString()} items</span>
                    </td>
                    <td className="hidden text-right tabular-nums md:table-cell">{formatMoney(a.soldValue, currency)}</td>
                    <td className="hidden text-right tabular-nums lg:table-cell">{formatMoney(a.collected, currency)}</td>
                    <td className="text-right tabular-nums">
                      <span className={a.outstanding.gt(0) ? "font-semibold text-slate-900" : "text-slate-400"}>{formatMoney(a.outstanding, currency)}</span>
                      {a.overdue.gt(0) && <span className="badge-red ml-2">Overdue</span>}
                    </td>
                    <td className="hidden whitespace-nowrap text-slate-600 sm:table-cell">{a.lastPaymentAt ? formatDate(a.lastPaymentAt) : "—"}</td>
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
