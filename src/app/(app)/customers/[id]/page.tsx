import Link from "next/link";
import BackLink from "@/components/BackLink";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Calendar, FileText, HandCoins, MapPin, MessageCircle, Pencil, Phone, ShoppingBag, Wallet } from "lucide-react";
import { Alert } from "@/components/ui";
import EntityForm from "@/components/EntityForm";
import RemindButton from "@/components/credit/RemindButton";
import { SalesTrendChart } from "@/components/dashboard/Charts";
import KpiCard from "@/components/dashboard/KpiCard";
import KpiStrip from "@/components/dashboard/KpiStrip";
import { CUSTOMER_BADGE, pctTone } from "@/components/customers/CustomerCard";
import { Meter, PerfTile } from "@/components/customers/Bits";
import { Prisma } from "@/generated/prisma/client";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { buildReminder, loadLastReminders, loadLateInvoices, remindedText, reminderLink, waNumber } from "@/lib/credit/reminders";
import { PERIODS, customerStatus, getCustomerDaily, getCustomerPeriodStats, getCustomerStandings, periodRange, type PeriodKey } from "@/lib/customers/performance";
import { emptyStanding } from "@/lib/resellers/performance";
import { customerCredit } from "@/lib/sales/collections";
import { owedOf } from "@/lib/sales/owed";
import { customerOutstanding } from "@/lib/sales/outstanding";
import { PaymentStatusBadge } from "../../sales/StatusBadge";
import { getBusinessProfile, getCurrency } from "@/lib/settings";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { saveCustomer } from "../actions";
import { CUSTOMER_TYPES } from "../types";

export const metadata = { title: "Customer" };

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; creditApplied?: string; period?: string }> }) {
  const user = await requirePagePermission("customers.view");
  const { id } = await params;
  const sp = await searchParams;
  const c = await db.customer.findUnique({ where: { id } });
  if (!c) notFound();
  const currency = await getCurrency();
  const canEdit = can(user, "customers.edit");
  const canLimit = can(user, "credit.set_limit");
  const showCredit = can(user, "credit.view");
  const seeSales = can(user, "sales.view_all");
  const canCollect = can(user, "payments.record");
  const owes = showCredit ? await customerOutstanding(db, c.id) : null;
  const advance = showCredit ? await customerCredit(db, c.id) : null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date());
  const [openInvoices, recentPayments] = showCredit
    ? await Promise.all([
        db.sale.findMany({ where: { customerId: c.id, status: "COMPLETED", paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
        db.payment.findMany({ where: { customerId: c.id, source: "DEBT_COLLECTION" }, orderBy: { receivedAt: "desc" }, take: 8 }),
      ])
    : [[], []];
  const m = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, currency);

  // performance: how they pay, what they bought and paid in the chosen period, the last 30 days, and the WhatsApp reminder for late invoices
  const period: PeriodKey = PERIODS.some((p) => p.key === sp.period) ? (sp.period as PeriodKey) : "all";
  const [standings, all, stats, daily, span, lateMap, lastMap, profile] = await Promise.all([
    showCredit ? getCustomerStandings(db) : Promise.resolve(new Map()),
    getCustomerPeriodStats(db, c.id, periodRange("all")),
    seeSales ? getCustomerPeriodStats(db, c.id, periodRange(period)) : Promise.resolve(null),
    seeSales ? getCustomerDaily(db, c.id) : Promise.resolve([]),
    db.sale.aggregate({ where: { customerId: c.id, status: "COMPLETED" }, _max: { createdAt: true } }),
    showCredit ? loadLateInvoices(db, [c.id], today) : Promise.resolve(new Map()),
    showCredit ? loadLastReminders(db, [c.id]) : Promise.resolve(new Map()),
    getBusinessProfile(),
  ]);
  const st = standings.get(c.id) ?? emptyStanding;
  const status = showCredit || seeSales ? customerStatus({ inactive: c.status === "INACTIVE", lateInvoices: st.lateInvoices, openInvoices: st.openInvoices, orders: all.orders }) : { label: c.status === "ACTIVE" ? "Active" : "Inactive", tone: "slate" as const };
  const late = lateMap.get(c.id) ?? [];
  const reminderText = late.length ? buildReminder({ businessName: profile.name, businessPhone: profile.phone, paymentAccounts: profile.paymentAccounts, customerName: c.name, invoices: late, currency }) : null;
  const remindHref = reminderText ? reminderLink(c.phone ?? "", reminderText) : null;
  const chatNumber = waNumber(c.phone ?? "");
  const limitUsedPct = owes && c.creditLimit.gt(0) ? Math.min(100, Math.round(owes.div(c.creditLimit).mul(100).toNumber())) : null;
  const paidPct = all.bought.gt(0) ? Math.min(100, Math.round(all.paid.div(all.bought).mul(100).toNumber())) : null;
  const periodLabel = PERIODS.find((p) => p.key === period)!.label.toLowerCase();
  const lastBought = span._max.createdAt;
  const isOverdue = (due: Date | null) => Boolean(due && due.toISOString().slice(0, 10) < today);
  const overdueAmount = openInvoices.filter((i) => isOverdue(i.dueDate)).reduce((s, i) => s.plus(owedOf(i)), new Prisma.Decimal(0));

  return (
    <>
      <BackLink href="/customers" className="mb-3 inline-flex items-center gap-1.5 py-1 text-sm font-medium text-slate-500 hover:text-slate-900">
        <ArrowLeft size={15} /> Back
      </BackLink>
      <section className="card mb-5 p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-navy-700 text-2xl font-bold text-white" aria-hidden>
            {c.name.trim().charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{c.name}</h1>
              <span className={CUSTOMER_BADGE[status.tone]}>{status.label}</span>
            </div>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
              <span className="font-medium text-slate-700">{CUSTOMER_TYPES.find((t) => t.value === c.type)?.label ?? c.type}</span>
              {c.contactPerson && <span>{c.contactPerson}</span>}
              {c.phone && (
                <span className="inline-flex items-center gap-1.5">
                  <Phone size={14} /> {c.phone}
                </span>
              )}
              {c.businessLocation && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={14} /> {c.businessLocation}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Calendar size={14} /> Customer since {formatDate(c.createdAt)}
              </span>
              {seeSales && <span>{lastBought ? `Last bought ${formatDate(lastBought)}` : "Has not bought yet"}</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            {canCollect && (
              <Link href={`/customers/${c.id}/pay`} className="btn-primary">
                <HandCoins size={16} /> {owes?.gt(0) ? "Collect payment" : "Top up"}
              </Link>
            )}
            {showCredit && (
              <Link href={`/customers/${c.id}/statement`} className="btn-secondary">
                <FileText size={16} /> Statement
              </Link>
            )}
            {late.length > 0 && remindHref && <RemindButton href={remindHref} customerId={c.id} saleIds={late.map((i: { id: string }) => i.id)} lastText={remindedText(lastMap.get(c.id))} label="Remind to pay" />}
            {chatNumber && (
              <a href={`https://wa.me/${chatNumber}`} target="_blank" rel="noopener noreferrer" className="btn-secondary" title="Open a WhatsApp chat">
                <MessageCircle size={16} /> WhatsApp
              </a>
            )}
            {canEdit && (
              <a href="#details" className="btn-secondary">
                <Pencil size={16} /> Edit
              </a>
            )}
          </div>
        </div>
      </section>

      {sp.created && (
        <div className="mb-4">
          <Alert kind="success">Customer created.</Alert>
        </div>
      )}
      {sp.creditApplied && (
        <div className="mb-4">
          <Alert kind="success">The customer’s credit was applied to the selected invoices.</Alert>
        </div>
      )}
      {overdueAmount.gt(0) && (
        <div className="mb-4">
          <Alert>
            <span className="flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                <strong>{m(overdueAmount)}</strong> is past its due date.
              </span>
            </span>
          </Alert>
        </div>
      )}

      {(seeSales || showCredit) && (
        <KpiStrip className="mb-5">
          {seeSales && <KpiCard icon={ShoppingBag} tone="navy" label="Bought so far" value={m(all.bought)} hint={`${all.orders} order${all.orders === 1 ? "" : "s"} · average ${m(all.average)}`} />}
          {showCredit && <KpiCard icon={Wallet} tone="green" label="Money paid in" value={m(all.paid)} hint="At the sale and on debts" />}
          {showCredit && <KpiCard icon={HandCoins} tone={owes?.gt(0) ? "red" : "slate"} label="They owe us" value={m(owes ?? 0)} hint={c.creditLimit.gt(0) ? `Credit limit ${m(c.creditLimit)}` : "No credit allowed"} />}
          {showCredit && <KpiCard icon={Wallet} tone={advance?.gt(0) ? "green" : "slate"} label={advance?.gt(0) ? "Paid in advance" : "Credit left"} value={advance?.gt(0) ? m(advance) : c.creditLimit.gt(0) ? m(Prisma.Decimal.max(c.creditLimit.minus(owes ?? 0), 0)) : "—"} hint={advance?.gt(0) ? "Can be used on the next invoices" : c.creditLimit.gt(0) ? "Still available to buy on credit" : "Pays at the sale"} />}
        </KpiStrip>
      )}

      {(seeSales || showCredit) && (
        <div className={cn("mb-5 grid gap-5", seeSales && showCredit && "xl:grid-cols-[1fr_340px]")}>
          {seeSales && stats && (
            <section className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
                <h2 className="text-base font-semibold text-slate-900">Performance</h2>
                <nav className="inline-flex rounded-xl border border-line bg-white p-0.5 text-sm font-medium" aria-label="Period">
                  {PERIODS.map((p) => (
                    <Link key={p.key} href={`/customers/${c.id}?period=${p.key}`} aria-current={period === p.key ? "page" : undefined} className={cn("rounded-[10px] px-3 py-1.5 transition", period === p.key ? "bg-navy-700 text-white" : "text-slate-600 hover:bg-slate-100")}>
                      {p.label}
                    </Link>
                  ))}
                </nav>
              </div>
              <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 2xl:grid-cols-4">
                <PerfTile label="Bought" value={m(stats.bought)} sub={`${stats.orders} order${stats.orders === 1 ? "" : "s"} ${periodLabel}`} tone="navy" />
                <PerfTile label="Orders" value={String(stats.orders)} sub={period === "all" ? "All time" : periodLabel} />
                <PerfTile label="Average order" value={m(stats.average)} sub="After returns" />
                <PerfTile label="Money paid in" value={m(stats.paid)} sub={period === "all" ? "All payments" : `Paid ${periodLabel}`} tone="green" />
              </div>
              <div className="border-t border-line px-4 pb-4 pt-3 sm:px-5">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Bought, last 30 days</p>
                <div className="h-52">
                  <SalesTrendChart data={daily} money={currency} />
                </div>
              </div>
            </section>
          )}

          {showCredit && (
            <aside className="card card-pad">
              <h2 className="mb-4 text-base font-semibold text-slate-900">How they are doing</h2>
              <div className="space-y-5">
                <Meter label="Pays on time" pct={st.onTimePct} hint={st.onTimePct === null ? "No invoice has come due yet" : `${st.onTimeOf} invoice${st.onTimeOf === 1 ? "" : "s"} paid or late so far`} color={st.onTimePct === null ? "bg-slate-300" : st.onTimePct >= 80 ? "bg-emerald-500" : st.onTimePct >= 50 ? "bg-oil-400" : "bg-brand-red"} pctClass={st.onTimePct === null ? "text-slate-400" : pctTone(st.onTimePct)} />
                <Meter label="Credit limit used" pct={limitUsedPct} hint={c.creditLimit.gt(0) ? `${m(owes ?? 0)} of ${m(c.creditLimit)}` : "No credit allowed"} color={limitUsedPct !== null && limitUsedPct >= 90 ? "bg-brand-red" : "bg-navy-600"} />
                <Meter label="Paid of what they bought" pct={paidPct} hint={all.bought.gt(0) ? `${m(all.paid)} of ${m(all.bought)}` : "Nothing bought yet"} color="bg-emerald-500" />
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
          )}
        </div>
      )}

      {showCredit && (
        <>
          <section className="card mb-5 overflow-hidden">
            <h2 className="border-b border-line px-5 py-3 text-base font-semibold text-slate-900">Unpaid invoices</h2>
            {openInvoices.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">Nothing owed. All invoices are paid.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th className="hidden sm:table-cell">Date</th>
                      <th>Due</th>
                      <th className="hidden text-right md:table-cell">Total</th>
                      <th className="text-right">Owed</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openInvoices.map((i) => (
                      <tr key={i.id}>
                        <td>
                          <Link href={`/sales/${i.id}`} className="font-medium text-navy-700 hover:underline">
                            {i.saleNo}
                          </Link>
                        </td>
                        <td className="hidden text-slate-600 sm:table-cell">{formatDate(i.createdAt)}</td>
                        <td className={isOverdue(i.dueDate) ? "font-medium text-brand-red-dark" : "text-slate-600"}>
                          {i.dueDate ? formatDate(i.dueDate) : "—"}
                          {isOverdue(i.dueDate) && <span className="badge-red ml-2">Overdue</span>}
                        </td>
                        <td className="hidden text-right md:table-cell">{formatMoney(i.total, currency)}</td>
                        <td className="text-right font-semibold">{formatMoney(owedOf(i), currency)}</td>
                        <td>
                          <PaymentStatusBadge status={i.paymentStatus} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {recentPayments.length > 0 && (
            <section className="card mb-5 overflow-hidden">
              <h2 className="border-b border-line px-5 py-3 text-base font-semibold text-slate-900">Recent payments received</h2>
              <ul className="divide-y divide-slate-100 text-sm">
                {recentPayments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <span>
                      <Link href={`/payments/${p.id}`} className="font-medium text-navy-700 hover:underline">
                        {p.paymentNo}
                      </Link>
                      <span className="ml-2 text-xs text-slate-500">{formatDateTime(p.receivedAt)}</span>
                    </span>
                    <span className="font-semibold text-emerald-700">{formatMoney(p.amount, currency)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <section id="details" className="card card-pad max-w-2xl scroll-mt-20">
        <h2 className="mb-4 text-base font-semibold text-slate-900">Details and credit limit</h2>
        <EntityForm
          action={saveCustomer}
          submitLabel="Save changes"
          hidden={{ id: c.id }}
          disabled={!canEdit}
          fields={[
            { name: "name", label: "Customer / business name", value: c.name, required: true, span: 2 },
            { name: "contactPerson", label: "Contact person", value: c.contactPerson ?? "" },
            { name: "phone", label: "Phone number", value: c.phone ?? "" },
            { name: "type", label: "Customer type", type: "select", value: c.type, options: CUSTOMER_TYPES.map((t) => ({ value: t.value, label: t.label })) },
            { name: "businessLocation", label: "Place (where they live or work)", value: c.businessLocation ?? "" },
            { name: "idNumber", label: "ID number", value: c.idNumber ?? "", hint: "Needed before they can take goods on credit." },
            ...(canLimit ? [{ name: "creditLimit", label: "Credit limit", value: c.creditLimit.toString(), hint: "0 means no credit." }] : []),
            ...(can(user, "customers.deactivate")
              ? [{ name: "status", label: "Status", type: "select" as const, value: c.status, options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive (cannot buy)" }] }]
              : []),
            { name: "notes", label: "Notes", type: "textarea" as const, value: c.notes ?? "", span: 2 },
          ]}
        />
      </section>
    </>
  );
}
