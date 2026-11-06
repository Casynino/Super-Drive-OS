import Link from "next/link";
import BackLink from "@/components/BackLink";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Calendar, HandCoins, MapPin, MessageCircle, Pencil, Phone, Undo2 } from "lucide-react";
import { Alert } from "@/components/ui";
import StatTile from "@/components/dashboard/StatTile";
import { SalesTrendChart } from "@/components/dashboard/Charts";
import RemindButton from "@/components/credit/RemindButton";
import { BADGE, pctTone, wingaStatus } from "@/components/resellers/WingaCard";
import { buildReminder, loadLastReminders, loadLateInvoices, remindedText, reminderLink, waNumber } from "@/lib/credit/reminders";
import { PERIODS, emptyStanding, getDailySold, getPeriodStats, getStandings, periodRange, type PeriodKey } from "@/lib/resellers/performance";
import { SaleStatusBadge } from "../../sales/StatusBadge";
import { can } from "@/lib/auth/can";
import { qtyText } from "@/lib/qty";
import { getUnitMode } from "@/lib/unit-mode";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getResellerAccount, getResellerProducts } from "@/lib/resellers/engine";
import { owedOf } from "@/lib/sales/owed";
import { getBusinessProfile, getCurrency } from "@/lib/settings";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { setResellerStatusAction } from "../actions";

export const metadata = { title: "Winga" };

type Search = { created?: string; saved?: string; reported?: string; returned?: string; period?: string };

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

  // performance: how they pay, what moved in the chosen period, the last 30 days, and the WhatsApp reminder for late invoices
  const period: PeriodKey = PERIODS.some((p) => p.key === sp.period) ? (sp.period as PeriodKey) : "all";
  const [standings, stats, daily, lateMap, lastMap, profile] = await Promise.all([
    getStandings(db),
    getPeriodStats(db, id, r.customerId, periodRange(period)),
    getDailySold(db, id),
    loadLateInvoices(db, [r.customerId], today),
    loadLastReminders(db, [r.customerId]),
    getBusinessProfile(),
  ]);
  const st = standings.get(id) ?? emptyStanding;
  const status = wingaStatus({ inactive: r.status === "INACTIVE", lateInvoices: st.lateInvoices, openInvoices: st.openInvoices, holdsStock: a.remainingQty.gt(0), reports: a.reports });
  const late = lateMap.get(r.customerId) ?? [];
  const reminderText = late.length ? buildReminder({ businessName: profile.name, businessPhone: profile.phone, paymentAccounts: profile.paymentAccounts, customerName: r.name, invoices: late, currency }) : null;
  const remindHref = reminderText ? reminderLink(r.phone, reminderText) : null;
  const chatNumber = waNumber(r.phone);
  const took = a.issuedQty.minus(a.returnedQty);
  const soldPct = took.gt(0) ? Math.min(100, Math.round(a.soldQty.div(took).mul(100).toNumber())) : null;
  const paidPct = a.soldValue.gt(0) ? Math.min(100, Math.round(a.collected.div(a.soldValue).mul(100).toNumber())) : null;
  const periodLabel = PERIODS.find((p) => p.key === period)!.label.toLowerCase();

  return (
    <>
      <BackLink href="/resellers" className="mb-3 inline-flex items-center gap-1.5 py-1 text-sm font-medium text-slate-500 hover:text-slate-900">
        <ArrowLeft size={15} /> Back
      </BackLink>
      <section className="card mb-5 p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-navy-700 text-2xl font-bold text-white" aria-hidden>
            {r.name.trim().charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{r.name}</h1>
              <span className={BADGE[status.tone]}>{status.label}</span>
            </div>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
              {r.businessName && <span className="font-medium text-slate-700">{r.businessName}</span>}
              <span className="inline-flex items-center gap-1.5">
                <Phone size={14} /> {r.phone}
              </span>
              {r.salesLocation && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={14} /> {r.salesLocation}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Calendar size={14} /> Joined {formatDate(r.registeredAt)}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
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
            {late.length > 0 && <RemindButton href={remindHref} customerId={r.customerId} saleIds={late.map((i) => i.id)} lastText={remindedText(lastMap.get(r.customerId))} label="Remind to pay" />}
            {chatNumber && (
              <a href={`https://wa.me/${chatNumber}`} target="_blank" rel="noopener noreferrer" className="btn-secondary" title="Open a WhatsApp chat">
                <MessageCircle size={16} /> WhatsApp
              </a>
            )}
          </div>
        </div>
      </section>

      {sp.created && <div className="mb-4"><Alert kind="success">Winga registered. You can now issue stock to them.</Alert></div>}
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

      <div className="mb-5 grid gap-5 xl:grid-cols-[1fr_340px]">
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
            <h2 className="text-base font-semibold text-slate-900">Performance</h2>
            <nav className="inline-flex rounded-xl border border-line bg-white p-0.5 text-sm font-medium" aria-label="Period">
              {PERIODS.map((p) => (
                <Link key={p.key} href={`/resellers/${id}${p.key === "all" ? "" : `?period=${p.key}`}`} aria-current={period === p.key ? "page" : undefined} className={cn("rounded-[10px] px-3 py-1.5 transition", period === p.key ? "bg-navy-700 text-white" : "text-slate-600 hover:text-slate-900")}>
                  {p.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 2xl:grid-cols-4">
            <PerfTile label="Received" value={`${stats.receivedQty.toString()} items`} sub={m(stats.receivedValue)} />
            <PerfTile label="Sold" value={`${stats.soldQty.toString()} items`} sub={`${stats.reports} report${stats.reports === 1 ? "" : "s"} · ${m(stats.soldValue)}`} tone="green" />
            <PerfTile label="Returned" value={`${stats.returnedQty.toString()} items`} sub={`${stats.returns} return${stats.returns === 1 ? "" : "s"}`} />
            <PerfTile label="Money paid in" value={m(stats.collected)} sub={period === "all" ? "All payments" : `Paid ${periodLabel}`} tone="navy" />
          </div>
          <div className="border-t border-line px-4 pb-4 pt-3 sm:px-5">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Reported sold, last 30 days</p>
            <div className="h-52">
              <SalesTrendChart data={daily} money={currency} />
            </div>
          </div>
        </section>

        <aside className="card card-pad">
          <h2 className="mb-4 text-base font-semibold text-slate-900">How they are doing</h2>
          <div className="space-y-5">
            <Meter label="Pays on time" pct={st.onTimePct} hint={st.onTimePct === null ? "No invoice has come due yet" : `${st.onTimeOf} invoice${st.onTimeOf === 1 ? "" : "s"} paid or late so far`} color={st.onTimePct === null ? "bg-slate-300" : st.onTimePct >= 80 ? "bg-emerald-500" : st.onTimePct >= 50 ? "bg-oil-400" : "bg-brand-red"} pctClass={st.onTimePct === null ? "text-slate-400" : pctTone(st.onTimePct)} />
            <Meter label="Sold of what they took" pct={soldPct} hint={took.gt(0) ? `${a.soldQty.toString()} of ${took.toString()} items sold (returns taken off)` : "Nothing issued yet"} color="bg-navy-600" />
            <Meter label="Paid of what they sold" pct={paidPct} hint={a.soldValue.gt(0) ? `${m(a.collected)} of ${m(a.soldValue)}` : "Nothing reported sold yet"} color="bg-emerald-500" />
          </div>
          <dl className="mt-5 grid gap-3 border-t border-line pt-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">Late invoices</dt>
              <dd className={cn("font-semibold", st.lateInvoices > 0 ? "text-brand-red-dark" : "text-slate-900")}>{st.lateInvoices > 0 ? `${st.lateInvoices} · oldest ${st.oldestLateDays ?? 0} day${st.oldestLateDays === 1 ? "" : "s"}` : "None"}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-slate-500">Next payment due</dt>
              <dd className="font-semibold text-slate-900">{st.nextDueDays === null ? "—" : st.nextDueDays === 0 ? "Today" : `In ${st.nextDueDays} day${st.nextDueDays === 1 ? "" : "s"}`}</dd>
            </div>
          </dl>
        </aside>
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

const TILE_TONE = { navy: "text-navy-700", green: "text-emerald-700", plain: "text-slate-900" } as const;

function PerfTile({ label, value, sub, tone = "plain" }: { label: string; value: string; sub: string; tone?: keyof typeof TILE_TONE }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-slate-50/60 px-3.5 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={cn("mt-1 text-xl font-bold tabular-nums", TILE_TONE[tone])}>{value}</p>
      <p className="mt-0.5 text-xs text-slate-500">{sub}</p>
    </div>
  );
}

function Meter({ label, pct, hint, color, pctClass }: { label: string; pct: number | null; hint: string; color: string; pctClass?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-slate-800">{label}</span>
        <span className={cn("text-lg font-bold tabular-nums", pctClass ?? (pct === null ? "text-slate-400" : "text-slate-900"))}>{pct === null ? "—" : `${pct}%`}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct ?? 0}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}
