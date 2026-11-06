import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, HandCoins, Pencil, Undo2 } from "lucide-react";
import { Alert, PageHeader } from "@/components/ui";
import StatTile from "@/components/dashboard/StatTile";
import { SaleStatusBadge } from "../../sales/StatusBadge";
import { can } from "@/lib/auth/can";
import { qtyText } from "@/lib/qty";
import { getUnitMode } from "@/lib/unit-mode";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getResellerAccount, getResellerProducts } from "@/lib/resellers/engine";
import { owedOf } from "@/lib/sales/owed";
import { getCurrency } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/utils";
import { setResellerStatusAction } from "../actions";

export const metadata = { title: "Reseller" };

type Search = { created?: string; saved?: string; reported?: string; returned?: string };

export default async function ResellerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const unitMode = await getUnitMode();
  const user = await requirePagePermission("resellers.view");
  const { id } = await params;
  const sp = await searchParams;
  if (!(await db.reseller.findUnique({ where: { id }, select: { id: true } }))) notFound();
  const currency = await getCurrency();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date());

  const [a, products, sales, issues, returns, payments] = await Promise.all([
    getResellerAccount(db, id),
    getResellerProducts(db, id),
    db.sale.findMany({ where: { resellerId: id }, orderBy: { createdAt: "desc" }, take: 20, include: { items: { select: { quantity: true } } } }),
    db.resellerIssue.findMany({ where: { resellerId: id }, orderBy: { createdAt: "desc" }, take: 20, include: { createdBy: { select: { name: true } }, _count: { select: { items: true } } } }),
    db.resellerReturn.findMany({ where: { resellerId: id }, orderBy: { createdAt: "desc" }, take: 20, include: { createdBy: { select: { name: true } }, items: { select: { condition: true, quantity: true } } } }),
    db.payment.findMany({ where: { customerId: (await db.reseller.findUniqueOrThrow({ where: { id }, select: { customerId: true } })).customerId }, orderBy: { receivedAt: "desc" }, take: 10 }),
  ]);
  const r = a.reseller;
  const canOperate = can(user, "resellers.operate");
  const canManage = can(user, "resellers.manage");
  const m = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, currency);
  const daysSince = (d: Date | null) => (d ? Math.floor((Date.now() - d.getTime()) / 86_400_000) : null);
  const quiet = daysSince(a.lastReportAt ?? a.lastIssueAt);

  return (
    <>
      <PageHeader
        title={r.name}
        back={{ href: "/resellers", label: "Resellers" }}
        description={[r.businessName, r.phone, r.salesLocation].filter(Boolean).join(" · ")}
        actions={
          <>
            {r.status === "INACTIVE" && <span className="badge-gray">Inactive</span>}
            {canOperate && r.status === "ACTIVE" && (
              <Link href={`/resellers/${id}/issue`} className="btn-primary">
                <ArrowUpFromLine size={16} /> Issue stock
              </Link>
            )}
            {canOperate && (
              <Link href={`/resellers/${id}/sold`} className="btn-secondary">
                Record sold
              </Link>
            )}
            {canOperate && (
              <Link href={`/resellers/${id}/return`} className="btn-secondary">
                <Undo2 size={16} /> Returns
              </Link>
            )}
            {can(user, "payments.record") && (
              <Link href={`/customers/${r.customerId}/pay`} className="btn-secondary">
                <HandCoins size={16} /> Receive money
              </Link>
            )}
          </>
        }
      />

      {sp.created && <div className="mb-4"><Alert kind="success">Reseller registered. You can now issue stock to them.</Alert></div>}
      {sp.saved && <div className="mb-4"><Alert kind="success">Saved.</Alert></div>}
      {sp.reported && <div className="mb-4"><Alert kind="success"><strong>{sp.reported}</strong> recorded. {r.name} now owes this amount; the goods were taken from their stock.</Alert></div>}
      {sp.returned && <div className="mb-4"><Alert kind="success"><strong>{sp.returned}</strong> recorded. The stock was moved out of {r.name}&apos;s account.</Alert></div>}
      {a.overdue.gt(0) && (
        <div className="mb-4">
          <Alert>
            <span className="flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span><strong>{m(a.overdue)}</strong> is past the settlement date ({r.settlementDays} days after each report).</span>
            </span>
          </Alert>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile icon={ArrowUpFromLine} tone="navy" label="Stock received" value={m(a.issuedValue)} hint={`${a.issuedQty.toString()} items at the agreed prices`} />
        <StatTile icon={ArrowDownToLine} tone="green" label="Reported sold" value={m(a.soldValue)} hint={`${a.soldQty.toString()} items · ${a.reports} report${a.reports === 1 ? "" : "s"}`} />
        <StatTile icon={Undo2} tone="yellow" label="Stock they still hold" value={m(a.remainingValue)} hint={`${a.remainingQty.toString()} items unsold · ${a.returnedQty.toString()} returned`} />
        <StatTile icon={HandCoins} tone={a.outstanding.gt(0) ? "red" : "slate"} label="They owe us" value={m(a.outstanding)} hint={`Paid so far ${m(a.collected)}`} />
      </div>

      <div className="mb-5 grid gap-5 xl:grid-cols-[1fr_320px]">
        <section className="card overflow-hidden">
          <h2 className="border-b border-line px-4 py-3 text-base font-semibold text-slate-900 sm:px-5">Stock account</h2>
          {products.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">No stock has been issued to {r.name} yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="text-right">Issued</th>
                    <th className="text-right">Sold</th>
                    <th className="hidden text-right sm:table-cell">Returned</th>
                    <th className="text-right">Holds now</th>
                    <th className="hidden text-right md:table-cell">Agreed price</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.productId}>
                      <td className="font-medium">{p.name}</td>
                      <td className="text-right tabular-nums">{qtyText(Number(p.issued), p.pack, p.symbol, unitMode).main}</td>
                      <td className="text-right tabular-nums">{qtyText(Number(p.sold), p.pack, p.symbol, unitMode).main}</td>
                      <td className="hidden text-right tabular-nums sm:table-cell">{qtyText(Number(p.returned), p.pack, p.symbol, unitMode).main}</td>
                      <td className="text-right font-semibold tabular-nums">{qtyText(Number(p.remaining), p.pack, p.symbol, unitMode).main}</td>
                      <td className="hidden text-right tabular-nums md:table-cell">{m(p.basePrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="card card-pad">
          <h2 className="mb-3 text-base font-semibold text-slate-900">Profile</h2>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-1">
            {[
              ["Registered", formatDate(r.registeredAt)],
              ["Pays within", `${r.settlementDays} days of a report`],
              ["Last payment", a.lastPaymentAt ? formatDate(a.lastPaymentAt) : "None yet"],
              ["Last stock issued", a.lastIssueAt ? `${formatDate(a.lastIssueAt)}${quiet !== null ? ` (${quiet} days ago)` : ""}` : "None yet"],
              ["Alt. phone", r.altPhone],
              ["Address", r.address],
              ["ID / licence", r.idInfo],
              ["Notes", r.notes],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
                <dd className="mt-0.5 text-slate-900">{value || "—"}</dd>
              </div>
            ))}
          </dl>
          {canManage && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
              <Link href={`/resellers/${id}/edit`} className="btn-secondary btn-sm">
                <Pencil size={14} /> Edit
              </Link>
              <form action={setResellerStatusAction}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="status" value={r.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"} />
                <button type="submit" className={r.status === "ACTIVE" ? "btn-danger btn-sm" : "btn-secondary btn-sm"}>
                  {r.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                </button>
              </form>
            </div>
          )}
        </aside>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card overflow-hidden">
          <h2 className="border-b border-line px-4 py-3 text-base font-semibold text-slate-900 sm:px-5">What they reported sold</h2>
          {sales.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-slate-500">Nothing reported yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {sales.map((s) => {
                const owed = owedOf(s);
                const overdue = s.status === "COMPLETED" && owed.gt(0) && s.dueDate && s.dueDate.toISOString().slice(0, 10) < today;
                return (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
                    <span>
                      <Link href={`/sales/${s.id}`} className="font-medium text-navy-700 hover:underline">
                        {s.saleNo}
                      </Link>
                      <span className="ml-2 text-slate-500">{formatDate(s.createdAt)}</span>
                      <span className="block text-xs text-slate-500">{m(s.total.minus(s.returnedTotal))}{s.dueDate && owed.gt(0) ? ` · due ${formatDate(s.dueDate)}` : ""}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {overdue && <span className="badge-red">Overdue</span>}
                      <SaleStatusBadge status={s.status} paymentStatus={s.paymentStatus} />
                      <span className="w-24 text-right font-semibold tabular-nums">{owed.gt(0) ? m(owed) : "Paid"}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="space-y-5">
          <section className="card overflow-hidden">
            <h2 className="border-b border-line px-4 py-3 text-base font-semibold text-slate-900 sm:px-5">Stock issued</h2>
            {issues.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-slate-500">Nothing issued yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {issues.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2 px-4 py-3 sm:px-5">
                    <span>
                      <Link href={`/resellers/issues/${i.id}`} className="font-medium text-navy-700 hover:underline">
                        {i.issueNo}
                      </Link>
                      <span className="ml-2 text-slate-500">{formatDateTime(i.createdAt)}</span>
                      <span className="block text-xs text-slate-500">{i._count.items} product{i._count.items === 1 ? "" : "s"} · {i.createdBy.name}</span>
                    </span>
                    <span className="font-semibold tabular-nums">{m(i.expectedValue)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card overflow-hidden">
            <h2 className="border-b border-line px-4 py-3 text-base font-semibold text-slate-900 sm:px-5">Money received and returns</h2>
            {payments.length + returns.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-slate-500">No payments or returns yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-3 sm:px-5">
                    <span>
                      <Link href={`/payments/${p.id}`} className="font-medium text-navy-700 hover:underline">{p.paymentNo}</Link>
                      <span className="ml-2 text-slate-500">{formatDateTime(p.receivedAt)}</span>
                    </span>
                    <span className="font-semibold tabular-nums text-emerald-700">+ {m(p.amount)}</span>
                  </li>
                ))}
                {returns.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2 px-4 py-3 sm:px-5">
                    <span>
                      <span className="font-medium text-slate-900">{x.returnNo}</span>
                      <span className="ml-2 text-slate-500">{formatDateTime(x.createdAt)}</span>
                    </span>
                    <span className="text-slate-600">
                      {x.items.reduce((s, i) => s + Number(i.quantity), 0)} items back{x.items.some((i) => i.condition === "DAMAGED") && " (some damaged)"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
