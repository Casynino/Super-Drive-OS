import { qtyText } from "@/lib/qty";
import { getUnitMode } from "@/lib/unit-mode";
import Link from "next/link";
import { getTillToday } from "@/lib/cash/summary";
import { Boxes, HandCoins, Package, Receipt, ReceiptText, Undo2, Wallet } from "lucide-react";
import KpiCard from "@/components/dashboard/KpiCard";
import { ColumnsChart, DonutChart, TopProductsChart } from "@/components/dashboard/Charts";
import { SaleStatusBadge } from "../sales/StatusBadge";
import { Prisma } from "@/generated/prisma/client";
import { can } from "@/lib/auth/can";
import type { SessionUser } from "@/lib/auth/session";
import { unclosedDays } from "@/lib/cash/closing";
import { businessDay, dayToDate, defaultLocationId } from "@/lib/cash/ledger";
import { db } from "@/lib/db";
import { getStockAlerts } from "@/lib/inventory/alerts";
import { formatMoney } from "@/lib/money";
import { owedOf } from "@/lib/sales/owed";
import { getCurrency } from "@/lib/settings";
import { formatDate } from "@/lib/utils";

const TZ = "Africa/Dar_es_Salaam";
const timeOf = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(d);
const hourOf = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: TZ }).format(d)) % 24;
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`;

// The shop attendant's overview of the day (opened from the menu; the attendant's home is the POS).
// Only his own sales and today's figures, and the stock (quantities only: no costs, no balances of the bank accounts).
export default async function ShopOverview({ user }: { user: SessionUser }) {
  const unitMode = await getUnitMode();
  const currency = await getCurrency();
  const m = (v: number | Prisma.Decimal) => formatMoney(v, currency);
  const chart = { symbol: currency.symbol, decimals: currency.decimals };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  const from = new Date(`${today}T00:00:00+03:00`);
  const to = new Date(`${today}T23:59:59.999+03:00`);
  const sells = can(user, "sales.pos") || can(user, "sales.view_own") || can(user, "sales.view_all");

  const closedToday = can(user, "closing.submit") ? await db.dailyClosing.findFirst({ where: { businessDate: dayToDate(businessDay()) }, select: { id: true } }) : null;
  const hourNow = hourOf(new Date());
  const [shelf, spentToday, recentReceipts, recentIssues, recentPays, recentSpend, olderOpen] = await Promise.all([
    can(user, "inventory.view") ? db.stockBalance.aggregate({ where: { location: { type: { not: "RESELLER" } } }, _sum: { quantity: true } }) : null,
    can(user, "expenses.create") ? db.expense.aggregate({ where: { requestedById: user.id, status: "APPROVED", expenseDate: dayToDate(today) }, _sum: { amount: true } }) : null,
    can(user, "inventory.view") ? db.stockReceipt.findMany({ where: { createdAt: { gte: from, lte: to } }, orderBy: { createdAt: "desc" }, take: 4, select: { id: true, receiptNo: true, createdAt: true, items: { select: { product: { select: { name: true } } }, take: 2 } } }) : [],
    can(user, "resellers.view") ? db.resellerIssue.findMany({ where: { createdAt: { gte: from, lte: to } }, orderBy: { createdAt: "desc" }, take: 4, select: { id: true, issueNo: true, createdAt: true, reseller: { select: { name: true } } } }) : [],
    can(user, "payments.record") ? db.payment.findMany({ where: { source: "DEBT_COLLECTION", receivedById: user.id, receivedAt: { gte: from, lte: to } }, orderBy: { receivedAt: "desc" }, take: 4, select: { id: true, paymentNo: true, amount: true, receivedAt: true, customer: { select: { name: true } } } }) : [],
    can(user, "expenses.create") ? db.expense.findMany({ where: { requestedById: user.id, requestedAt: { gte: from, lte: to } }, orderBy: { requestedAt: "desc" }, take: 4, select: { id: true, expenseNo: true, amount: true, requestedAt: true, status: true, category: { select: { name: true } } } }) : [],
    can(user, "closing.submit") ? unclosedDays(db, await defaultLocationId(db), today) : [],
  ]);
  const tillLocation = can(user, "closing.submit") || can(user, "deposits.record") ? await defaultLocationId(db) : null;
  const till = tillLocation ? await getTillToday(db, tillLocation, today) : null;
  const [mySales, myPayments, pendingMine, alerts] = await Promise.all([
    sells ? db.sale.findMany({ where: { salespersonId: user.id, createdAt: { gte: from, lte: to } }, orderBy: { createdAt: "desc" }, include: { customer: { select: { name: true } }, items: { select: { lineTotal: true, product: { select: { name: true } } } } } }) : [],
    can(user, "payments.record") || sells ? db.payment.groupBy({ by: ["method"], where: { receivedById: user.id, receivedAt: { gte: from, lte: to } }, _sum: { amount: true } }) : [],
    can(user, "returns.create") ? db.saleReversal.count({ where: { requestedById: user.id, status: "PENDING" } }) : 0,
    can(user, "inventory.view") ? getStockAlerts(db) : null,
  ]);

  const zero = new Prisma.Decimal(0);
  const active = mySales.filter((s) => s.status === "COMPLETED");
  const soldToday = active.reduce((s, x) => s.plus(x.total.minus(x.returnedTotal)), zero);
  const stillOwed = active.reduce((s, x) => s.plus(owedOf(x)), zero);
  const received = (method: string) => myPayments.find((p) => p.method === method)?._sum.amount ?? zero;
  const collected = myPayments.reduce((s, p) => s.plus(p._sum.amount ?? 0), zero);
  const onCredit = active.filter((x) => owedOf(x).gt(0));

  // sales by the hour, best sellers and money by method: all from his own sales today
  const byHour = new Map<number, { total: Prisma.Decimal; n: number }>();
  for (const s of active) {
    const h = hourOf(s.createdAt);
    const cur = byHour.get(h) ?? { total: zero, n: 0 };
    byHour.set(h, { total: cur.total.plus(s.total.minus(s.returnedTotal)), n: cur.n + 1 });
  }
  const hours = [...byHour.keys()];
  const firstHour = Math.min(7, ...hours);
  const lastHour = Math.max(18, ...hours);
  const hourBars = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => ({ name: hourLabel(firstHour + i), value: Number(byHour.get(firstHour + i)?.total ?? 0) }));
  const busiest = [...byHour.entries()].reduce<[number, { total: Prisma.Decimal; n: number }] | null>((b, e) => (b === null || e[1].total.gt(b[1].total) ? e : b), null);
  const soldBy = new Map<string, Prisma.Decimal>();
  for (const s of active) for (const it of s.items) soldBy.set(it.product.name, (soldBy.get(it.product.name) ?? zero).plus(it.lineTotal));
  const topSold = [...soldBy.entries()].sort((a, b) => b[1].comparedTo(a[1])).slice(0, 6).map(([name, v]) => ({ name, value: Number(v) }));
  const methods = [
    { name: "Cash", value: Number(received("CASH")) },
    { name: "Mobile money", value: Number(received("MOBILE_MONEY")) },
    { name: "Bank", value: Number(received("BANK")) },
  ];

  const canClose = can(user, "closing.submit");
  const closingNote = !canClose ? null : closedToday ? { text: "Closing done today", link: false } : olderOpen.length > 0 ? { text: `Waiting to be closed · includes cash from ${formatDate(`${olderOpen[0]}T00:00:00Z`)}`, link: true } : hourNow >= 18 ? { text: "Count the cash and close when you finish", link: true } : null;
  const feed = [
    ...recentReceipts.map((r) => ({ at: r.createdAt, text: `Stock received: ${r.items.map((i) => i.product.name).join(", ")}`, ref: r.receiptNo, href: `/inventory/receiving/${r.id}` })),
    ...recentIssues.map((i) => ({ at: i.createdAt, text: `Stock issued to ${i.reseller.name}`, ref: i.issueNo, href: `/resellers/issues/${i.id}` })),
    ...recentPays.map((p) => ({ at: p.receivedAt, text: `Payment from ${p.customer?.name ?? "a customer"}: ${m(p.amount)}`, ref: p.paymentNo, href: `/payments/${p.id}` })),
    ...recentSpend.map((e) => ({ at: e.requestedAt, text: `Expense (${e.category.name}): ${m(e.amount)}${e.status === "PENDING" ? " · waiting for the owner" : ""}`, ref: e.expenseNo, href: `/expenses/${e.id}` })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 8);

  // stock: healthy / running low / out, and the products that need attention first
  const outN = alerts?.out.length ?? 0;
  const lowN = alerts?.low.length ?? 0;
  const totalN = Math.max(alerts?.active ?? 0, 1);
  const okN = Math.max((alerts?.active ?? 0) - outN - lowN, 0);
  const attention = alerts ? [...alerts.out.map((a) => ({ ...a, out: true })), ...alerts.low.map((a) => ({ ...a, out: false }))].slice(0, 6) : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Hello {user.name.split(" ")[0]}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Overview</h1>
          <p className="mt-1 text-sm text-slate-500">{new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ }).format(new Date())}</p>
        </div>
        {closingNote &&
          (closingNote.link ? (
            <Link href="/closing" className="text-sm font-medium text-slate-700 hover:text-navy-700 hover:underline">
              {closingNote.text} · Close &amp; deposit →
            </Link>
          ) : (
            <p className="text-sm font-medium text-slate-700">{closingNote.text}</p>
          ))}
      </div>

      {sells && (
        <div className="grid gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fit,minmax(11.5rem,1fr))]">
          <KpiCard icon={Receipt} tone="navy" label="Sales today" value={m(soldToday)} hint={`${active.length} sale${active.length === 1 ? "" : "s"}${active.length > 0 ? ` · average ${m(soldToday.div(active.length).toDecimalPlaces(0))}` : ""}`} href="/sales" />
          <KpiCard icon={Wallet} tone="green" label="Money received" value={m(collected)} hint={`Cash ${m(received("CASH"))} · Mobile ${m(received("MOBILE_MONEY"))} · Bank ${m(received("BANK"))}`} />
          <KpiCard icon={HandCoins} tone="red" label="On credit today" value={m(stillOwed)} hint={`${onCredit.length} sale${onCredit.length === 1 ? "" : "s"} not paid yet`} />
          {spentToday ? <KpiCard icon={ReceiptText} tone="yellow" label="Expenses today" value={m(spentToday._sum.amount ?? 0)} hint="Paid out of the shop" href="/expenses" /> : <KpiCard icon={Undo2} tone="yellow" label="Requests waiting" value={String(pendingMine)} hint="Returns waiting for the manager" />}
          {shelf ? <KpiCard icon={Boxes} tone="slate" label="Stock on the shelf" value={`${Number(shelf._sum.quantity ?? 0).toFixed(0)} items`} hint={alerts ? `${alerts.inStock} of ${alerts.active} products in stock` : undefined} href="/inventory" /> : <KpiCard icon={Undo2} tone="slate" label="Requests waiting" value={String(pendingMine)} />}
        </div>
      )}

      {sells && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="card flex flex-col px-4 py-4 sm:px-5" aria-label="Sales today by the hour">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">My sales today, hour by hour</h2>
              <span className="text-xs text-slate-500">{active.length} sale{active.length === 1 ? "" : "s"} so far</span>
            </div>
            <div className="mt-3 h-52">
              <ColumnsChart data={hourBars} money={chart} label="Sold" empty="No sales yet today" />
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-line pt-3 text-sm">
              <Fact label="Sales today" value={String(active.length)} />
              <Fact label="Average sale" value={active.length > 0 ? m(soldToday.div(active.length).toDecimalPlaces(0)) : "—"} />
              <Fact label="Busiest hour" value={busiest ? hourLabel(busiest[0]) : "—"} note={busiest ? m(busiest[1].total) : undefined} />
            </dl>
          </section>

          <section className="card flex flex-col px-4 py-4 sm:px-5" aria-label="Money received today">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Money received today</h2>
              <span className="text-sm font-bold tabular-nums text-slate-900">{m(collected)}</span>
            </div>
            <div className="mt-2 h-44">
              <DonutChart data={methods.filter((x) => x.value > 0)} money={chart} centre={m(collected)} centreLabel="Received" empty="Nothing received yet today" />
            </div>
            <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-sm">
              {methods.map((x) => (
                <Row key={x.name} label={x.name} value={m(x.value)} />
              ))}
            </dl>
          </section>
        </div>
      )}

      {alerts && (
        <section className="card overflow-hidden" aria-label="Stock right now">
          <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
            <h2 className="text-sm font-semibold text-slate-900">Stock right now</h2>
            <Link href="/inventory" className="text-sm font-medium text-navy-700 hover:underline">
              See all stock
            </Link>
          </div>
          <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] md:divide-x md:divide-line">
            <div className="px-4 py-5 sm:px-5">
              <p className="text-3xl font-bold tabular-nums text-slate-900">
                {alerts.inStock}
                <span className="ml-2 text-base font-medium text-slate-500">of {alerts.active} products in stock</span>
              </p>
              <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${okN} healthy, ${lowN} running low, ${outN} out of stock`}>
                <div className="bg-emerald-500" style={{ width: `${(okN / totalN) * 100}%` }} />
                <div className="bg-oil-400" style={{ width: `${(lowN / totalN) * 100}%` }} />
                <div className="bg-rose-500" style={{ width: `${(outN / totalN) * 100}%` }} />
              </div>
              <ul className="mt-4 space-y-2 text-sm">
                <Legend dot="bg-emerald-500" label="Healthy" n={okN} />
                <Legend dot="bg-oil-400" label="Running low" n={lowN} />
                <Legend dot="bg-rose-500" label="Out of stock" n={outN} />
              </ul>
              <p className="mt-4 text-xs text-slate-500">Running low means at or below the minimum the owner set.</p>
            </div>
            <div>
              {attention.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-slate-500">{alerts.active === 0 ? "No products have been added yet." : "Everything is in stock."}</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {attention.map((a) => {
                    const pct = a.out ? 0 : Math.min(100, Math.max(4, (Number(a.qty) / Math.max(Number(a.min), 1)) * 100));
                    return (
                      <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-gradient-to-b from-white to-slate-100">
                          {a.imageV ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={`/api/product-image/${a.id}?size=thumb&v=${a.imageV}`} alt="" loading="lazy" className="h-full w-full object-contain" />
                          ) : (
                            <Package size={18} className="text-slate-300" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-900">{a.name}</span>
                          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <span className={`block h-full rounded-full ${a.out ? "bg-rose-500" : "bg-oil-400"}`} style={{ width: `${pct}%` }} />
                          </span>
                        </span>
                        <span className={a.out ? "badge-red" : "badge-yellow"}>{a.out ? "Out of stock" : `${qtyText(Number(a.qty), a.pack, a.symbol, unitMode).main} left`}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      {sells && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <section className="card flex flex-col px-4 py-4 sm:px-5" aria-label="Best sellers today">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">My best sellers today</h2>
              <span className="text-xs text-slate-500">by amount sold</span>
            </div>
            <div className="mt-3 h-64">
              <TopProductsChart data={topSold} money={chart} empty="No sales yet today" />
            </div>
          </section>

          <section className="card overflow-hidden" aria-label="My latest sales">
            <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
              <h2 className="text-sm font-semibold text-slate-900">My latest sales</h2>
              <Link href="/sales" className="text-sm font-medium text-navy-700 hover:underline">
                History
              </Link>
            </div>
            {mySales.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-slate-500">No sales yet today.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {mySales.slice(0, 7).map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                    <span className="min-w-0">
                      <Link href={`/sales/${s.id}`} className="font-medium text-navy-700 hover:underline">
                        {s.saleNo}
                      </Link>
                      <span className="block truncate text-xs text-slate-500">
                        {timeOf(s.createdAt)} · {s.customer?.name ?? "Walk-in"}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <SaleStatusBadge status={s.status} paymentStatus={s.paymentStatus} />
                      <span className="font-semibold text-slate-900">{m(s.total.minus(s.returnedTotal))}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {till && (
        <section className="card overflow-hidden" aria-label="Cash at the shop">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
            <h2 className="text-sm font-semibold text-slate-900">Cash at the shop</h2>
            {canClose && (
              <Link href="/closing" className="btn-secondary btn-sm">
                Close &amp; deposit
              </Link>
            )}
          </div>
          <dl className="grid grid-cols-2 divide-line md:grid-cols-4 md:divide-x">
            <div className="px-4 py-4 sm:px-5">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cash received today</dt>
              <dd className="mt-1 text-xl font-bold tabular-nums text-emerald-700">+ {m(till.received)}</dd>
            </div>
            <div className="px-4 py-4 sm:px-5">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Used for expenses</dt>
              <dd className="mt-1 text-xl font-bold tabular-nums text-slate-900">− {m(till.expenses)}</dd>
              {till.otherOut.gt(0) && <p className="text-[11px] text-slate-500">and {m(till.otherOut)} for refunds, suppliers or the owner</p>}
            </div>
            <div className="px-4 py-4 sm:px-5">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Deposited today</dt>
              <dd className="mt-1 text-xl font-bold tabular-nums text-slate-900">− {m(till.deposited)}</dd>
            </div>
            <div className="bg-sky-500/[0.07] px-4 py-4 sm:px-5">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Still at the shop</dt>
              <dd className="mt-1 text-xl font-bold tabular-nums text-slate-900 lg:text-2xl">{m(till.balance)}</dd>
            </div>
          </dl>
        </section>
      )}

      {feed.length > 0 && (
        <section className="card overflow-hidden" aria-label="What happened today">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold text-slate-900 sm:px-5">What happened today</h2>
          <ul className="divide-y divide-slate-100">
            {feed.map((f) => (
              <li key={f.ref} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm sm:px-5">
                <Link href={f.href} className="min-w-0 truncate text-slate-800 hover:text-navy-700">
                  {f.text}
                  <span className="ml-2 text-xs text-slate-400">{f.ref}</span>
                </Link>
                <span className="shrink-0 text-xs text-slate-500">{timeOf(f.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 truncate text-base font-bold tabular-nums text-slate-900" title={value}>
        {value}
      </dd>
      {note && <p className="text-[11px] text-slate-500">{note}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-600">{label}</dt>
      <dd className="tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}

function Legend({ dot, label, n }: { dot: string; label: string; n: number }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-slate-600">
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden />
        {label}
      </span>
      <span className="font-semibold tabular-nums text-slate-900">{n}</span>
    </li>
  );
}
