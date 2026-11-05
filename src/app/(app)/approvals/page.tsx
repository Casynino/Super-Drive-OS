import Link from "next/link";
import { Inbox } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import DecisionForm from "@/components/sales/DecisionForm";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { methodLabel } from "@/lib/sales/types";
import { getCurrency } from "@/lib/settings";
import { formatDateTime } from "@/lib/utils";
import { decideReversal } from "../sales/reversal-actions";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  await requirePagePermission("returns.approve");
  const currency = await getCurrency();
  const include = {
    sale: { select: { id: true, saleNo: true, total: true, customer: { select: { name: true } } } },
    requestedBy: { select: { name: true } },
    decidedBy: { select: { name: true } },
    items: { include: { product: { select: { name: true } } } },
  } as const;
  const [pending, recent] = await Promise.all([
    db.saleReversal.findMany({ where: { status: "PENDING" }, orderBy: { requestedAt: "asc" }, include }),
    db.saleReversal.findMany({ where: { status: { not: "PENDING" } }, orderBy: { decidedAt: "desc" }, take: 10, include }),
  ]);

  return (
    <>
      <PageHeader title="Approvals" description="Returns and cancellations that need a manager or the owner before stock and money change." />

      <section className="mb-6">
        <h2 className="mb-3 text-base font-semibold text-slate-900">Waiting for you ({pending.length})</h2>
        {pending.length === 0 ? (
          <div className="card">
            <EmptyState icon={<Inbox size={22} />} title="Nothing is waiting" description="New requests also appear in your notifications." />
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

      {recent.length > 0 && (
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
