import { qtyText } from "@/lib/qty";
import { getUnitMode } from "@/lib/unit-mode";
import Link from "next/link";
import { ArrowRight, Banknote, Boxes, CalendarCheck, ChartColumn, Handshake, HandCoins, Inbox, Landmark, Package, PiggyBank, Receipt, ReceiptText, ScrollText, ShoppingBag, Smartphone, TrendingUp, Truck, Wallet } from "lucide-react";
import AttentionPanel, { type AttentionItem } from "@/components/dashboard/AttentionPanel";
import { CHART_COLORS, ColumnsChart, DonutChart, InOutChart, MoneyBarsChart, YearChart } from "@/components/dashboard/Charts";
import { SaleStatusBadge } from "../sales/StatusBadge";
import { can } from "@/lib/auth/can";
import type { SessionUser } from "@/lib/auth/session";
import { businessDay, defaultLocationId, getBalances } from "@/lib/cash/ledger";
import { db } from "@/lib/db";
import { getOwnerDashboard, getOwnerExtras, getOwnerOverview } from "@/lib/dashboard/owner";
import { resolveRange } from "@/lib/dashboard/range";
import { getStockAlerts } from "@/lib/inventory/alerts";
import { formatMoney } from "@/lib/money";
import { getBusinessProfile, getCurrency } from "@/lib/settings";
import { cn, formatDateTime } from "@/lib/utils";

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Dar_es_Salaam" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

function Section({ title, hint, action, children, className }: { title: string; hint?: string; action?: { href: string; label: string }; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("card card-pad", className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
        </div>
        {action && (
          <Link href={action.href} className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-navy-700 hover:underline">
            {action.label} <ArrowRight size={13} />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

const Heading = ({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) => (
  <div className="mb-3 mt-8 flex items-center justify-between gap-3 first:mt-0">
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{children}</h2>
    {right}
  </div>
);

const TONES = {
  blue: { box: "border-sky-500/25 from-sky-500/[0.08]", icon: "bg-sky-500/15 text-sky-600 dark:text-sky-300", value: "text-sky-700 dark:text-sky-200" },
  green: { box: "border-emerald-500/25 from-emerald-500/[0.08]", icon: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300", value: "text-emerald-700 dark:text-emerald-300" },
  red: { box: "border-rose-500/25 from-rose-500/[0.08]", icon: "bg-rose-500/15 text-rose-600 dark:text-rose-300", value: "text-rose-700 dark:text-rose-300" },
  amber: { box: "border-amber-500/30 from-amber-500/[0.09]", icon: "bg-amber-500/15 text-amber-600 dark:text-amber-300", value: "text-amber-700 dark:text-amber-300" },
  violet: { box: "border-violet-500/25 from-violet-500/[0.08]", icon: "bg-violet-500/15 text-violet-600 dark:text-violet-300", value: "text-violet-700 dark:text-violet-200" },
  slate: { box: "border-line from-slate-500/[0.06]", icon: "bg-slate-500/15 text-slate-600", value: "text-slate-900" },
} as const;

function Metric({ icon: Icon, label, value, hint, change, upIsGood = true, tone, href }: { icon: typeof Package; label: string; value: React.ReactNode; hint?: React.ReactNode; change?: number | null; upIsGood?: boolean; tone: keyof typeof TONES; href?: string }) {
  const t = TONES[tone];
  const good = change === null || change === undefined ? null : upIsGood ? change >= 0 : change <= 0;
  const body = (
    <div className={cn("@container h-full rounded-xl border bg-gradient-to-br to-transparent p-4 transition", t.box, href && "hover:-translate-y-0.5 hover:shadow-lg")}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[13px] font-medium text-slate-600">
          <span className={cn("grid h-8 w-8 place-items-center rounded-lg", t.icon)}>
            <Icon size={16} />
          </span>
          {label}
        </span>
        {change !== null && change !== undefined && (
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", good ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/15 text-rose-700 dark:text-rose-300")}>
            {change >= 0 ? "+" : "−"}
            {Math.abs(change).toFixed(Math.abs(change) >= 100 ? 0 : 1)}%
          </span>
        )}
      </div>
      <p className={cn("mt-3 whitespace-nowrap text-[clamp(1.2rem,9cqw,1.75rem)] font-bold leading-none tracking-tight", t.value)}>{value}</p>
      {hint && <p className="mt-2 text-xs text-slate-500">{hint}</p>}
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

// One calm style for every shortcut (Nino: too many colours); only the Approvals count is red
const PILL_BASE = "border-line bg-white text-slate-800 hover:border-sky-400/60 hover:bg-slate-50";
const PILL = { sky: PILL_BASE, emerald: PILL_BASE, rose: PILL_BASE, amber: PILL_BASE, violet: PILL_BASE, navy: PILL_BASE } as const;

export default async function OwnerHome({ user }: { user: SessionUser }) {
  const unitMode = await getUnitMode();
  const range = resolveRange("month");
  const financials = can(user, "dashboard.financials");
  const locationId = await defaultLocationId(db);
  const [currency, profile, data, extras, overview, alerts, shipmentIssues, shipmentsOnTheWay, balances, pendingExpenses, resellerOverdue, shelf, away, closedToday] = await Promise.all([
    getCurrency(),
    getBusinessProfile(),
    getOwnerDashboard(db, range, { financials, valuation: can(user, "inventory.valuation") }),
    getOwnerExtras(db, range, { resellers: can(user, "resellers.view"), expenses: can(user, "expenses.view") }),
    getOwnerOverview(db, { financials }),
    getStockAlerts(db),
    can(user, "shipments.manage") ? db.shipment.count({ where: { issue: "OPEN" } }) : 0,
    can(user, "shipments.manage") ? db.shipment.count({ where: { status: "EXPECTED", arrivedAt: null } }) : 0,
    can(user, "cash.view") ? getBalances(db, locationId) : Promise.resolve([]),
    can(user, "expenses.approve") ? db.expense.aggregate({ where: { status: "PENDING" }, _count: true, _sum: { amount: true } }) : null,
    can(user, "resellers.view") ? db.$queryRaw<{ v: number | null }[]>`SELECT SUM("total" - "returnedTotal" - "amountPaid" + "refundedTotal")::float AS v FROM "Sale" WHERE "channel" = 'RESELLER' AND "status" = 'COMPLETED' AND "dueDate" < ${businessDay()}::date AND ("total" - "returnedTotal" - "amountPaid" + "refundedTotal") > 0`.then((r) => Number(r[0]?.v ?? 0)) : 0,
    can(user, "inventory.view") ? db.stockBalance.aggregate({ where: { location: { type: { not: "RESELLER" } } }, _sum: { quantity: true } }) : null,
    can(user, "inventory.view") ? db.stockBalance.aggregate({ where: { location: { type: "RESELLER" } }, _sum: { quantity: true } }) : null,
    db.dailyClosing.findFirst({ where: { locationId, businessDate: new Date(`${businessDay()}T00:00:00.000Z`) }, select: { id: true } }),
  ]);
  const pendingReturn = data.pendingApprovals > 0 && can(user, "returns.approve") ? await db.saleReversal.findFirst({ where: { status: "PENDING" }, select: { saleId: true }, orderBy: { id: "asc" } }) : null;
  const money = { symbol: currency.symbol, decimals: currency.decimals };
  const m = (v: number) => formatMoney(v, currency);
  const compact = (v: number) => `${currency.symbol} ${Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(v >= 100_000_000 ? 0 : 1)}M` : Math.abs(v) >= 10_000 ? `${Math.round(v / 1000)}k` : new Intl.NumberFormat("en-US").format(Math.round(v))}`;
  const k = data.kpi;
  const o = overview;
  const usable = balances.reduce((s, b) => s + b.balance.toNumber(), 0);
  const hourNow = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Dar_es_Salaam" }).format(new Date()));
  const firstName = user.name.split(" ")[0]!;
  const todayLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Dar_es_Salaam" }).format(new Date());
  const names = (rows: { name: string }[]) => rows.slice(0, 3).map((r) => r.name).join(", ") + (rows.length > 3 ? ` and ${rows.length - 3} more` : "");

  // ── What needs the owner, most urgent first ──
  const items: AttentionItem[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (data.pendingApprovals > 0 && can(user, "returns.approve")) items.push({ id: "returns", group: "decisions", tone: "amber", icon: "returns", title: `${plural(data.pendingApprovals, "return or cancellation", "returns and cancellations")} waiting`, detail: "Stock and money wait for your yes.", href: pendingReturn ? `/sales/${pendingReturn.saleId}` : "/sales" });
  if (pendingExpenses && pendingExpenses._count > 0) items.push({ id: "expenses", group: "decisions", tone: "amber", icon: "expense", title: `${plural(pendingExpenses._count, "expense", "expenses")} waiting for approval`, detail: "Nothing is paid out until you approve.", main: m(Number(pendingExpenses._sum.amount ?? 0)), href: "/expenses?status=PENDING" });
  if (shipmentIssues > 0) items.push({ id: "ship-issues", group: "decisions", tone: "amber", icon: "shipment", title: `${plural(shipmentIssues, "shipment", "shipments")} with damaged or missing goods`, detail: "Find out what went wrong and close the investigation.", href: "/shipments" });
  if (k.debt.overdue > 0) items.push({ id: "overdue", group: "money", tone: "red", icon: "debt", title: "Customers owe money past the due date", detail: o.oldestOwed > 0 ? `The oldest unpaid bill is ${o.oldestOwed} days old.` : "Follow these up before they get older.", main: m(k.debt.overdue), sub: `of ${m(k.debt.value)} owed in all`, href: "/credit" });
  if (resellerOverdue > 0) items.push({ id: "reseller-overdue", group: "money", tone: "red", icon: "reseller", title: "Winga have not paid on time", detail: "Money is past the settlement date.", main: m(resellerOverdue), href: "/resellers" });
  if (!closedToday && hourNow >= 19 && can(user, "closing.approve")) items.push({ id: "not-closed", group: "money", tone: "amber", icon: "clock", title: "The shop has not closed today yet", detail: "The WhatsApp report goes out once the day is closed.", href: "/closing" });
  if (alerts.out.length > 0) items.push({ id: "out", group: "stock", tone: "red", icon: "stock", title: `${plural(alerts.out.length, "product", "products")} out of stock`, detail: names(alerts.out), href: "/inventory?status=out" });
  if (alerts.low.length > 0) items.push({ id: "low", group: "stock", tone: "amber", icon: "stock", title: `${plural(alerts.low.length, "product", "products")} running low`, detail: names(alerts.low), href: "/inventory?status=low" });
  if (shipmentsOnTheWay > 0) items.push({ id: "ship-way", group: "stock", tone: "blue", icon: "shipment", title: `${plural(shipmentsOnTheWay, "shipment", "shipments")} on the way`, detail: "The shop marks them arrived and checks them.", href: "/shipments" });

  const pills = [
    can(user, "cash.view") && { href: "/cash", label: "Accounts", icon: Landmark, tone: "sky" as const },
    can(user, "reports.view") && { href: "/reports", label: "Reports", icon: ChartColumn, tone: "emerald" as const },
    can(user, "shipments.manage") && { href: "/shipments", label: "Purchase orders", icon: Truck, tone: "amber" as const },
    can(user, "resellers.view") && { href: "/resellers", label: "Winga", icon: Handshake, tone: "violet" as const },
    can(user, "sales.view_all") && { href: "/sales", label: "Sales history", icon: Receipt, tone: "rose" as const },
    can(user, "audit.view") && { href: "/audit", label: "Audit log", icon: ScrollText, tone: "navy" as const },
  ].filter(Boolean) as { href: string; label: string; icon: typeof Package; tone: keyof typeof PILL; badge?: number }[];

  const stockRing = [
    { name: "In stock", value: Math.max(0, alerts.inStock - alerts.low.length) },
    { name: "Running low", value: alerts.low.length },
    { name: "Out of stock", value: alerts.out.length },
  ].filter((x) => x.value > 0);
  const tone = (v: number | null, good: number, ok: number, lowerIsBetter = false) => (v === null ? "text-slate-400" : (lowerIsBetter ? v <= good : v >= good) ? "text-emerald-600 dark:text-emerald-300" : (lowerIsBetter ? v <= ok : v >= ok) ? "text-amber-600 dark:text-amber-300" : "text-rose-600 dark:text-rose-300");
  const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
  const health: { label: string; value: string; cls: string; note: string }[] = [
    { label: "Money collected from sales", value: pct(o.month.collectionRate), cls: tone(o.month.collectionRate, 80, 50), note: "received ÷ sold this month" },
    ...(o.month.margin !== null ? [{ label: "Profit margin", value: pct(o.month.margin), cls: tone(o.month.margin, 25, 10), note: "profit ÷ sales" }] : []),
    { label: "Spent on expenses", value: pct(o.month.expenseRatio), cls: tone(o.month.expenseRatio, 10, 20, true), note: "expenses ÷ sales" },
    { label: "Still owed to us", value: pct(o.outstandingRatio), cls: tone(o.outstandingRatio, 10, 25, true), note: "owed ÷ twelve months of sales" },
    { label: "Sales growth", value: o.month.sales.change === null ? "—" : `${o.month.sales.change >= 0 ? "+" : "−"}${Math.abs(o.month.sales.change).toFixed(1)}%`, cls: tone(o.month.sales.change, 0, -10), note: `against ${o.prevMonthLabel}` },
    ...(o.month.profit ? [{ label: "Profit growth", value: o.month.profit.change === null ? "—" : `${o.month.profit.change >= 0 ? "+" : "−"}${Math.abs(o.month.profit.change).toFixed(1)}%`, cls: tone(o.month.profit.change, 0, -10), note: `against ${o.prevMonthLabel}` }] : []),
  ];
  const agingMax = Math.max(1, ...o.aging.map((a) => a.value));
  const agingColors = ["var(--c5)", "var(--c4)", "var(--c3)", "var(--c2)"];
  const moneyIn = extras.moneyTrend.reduce((s, d) => s + d.cash + d.mobile + d.bank, 0);

  return (
    <>
      {/* ── Banner: the greeting, the three numbers that matter, and the shop's real products ── */}
      <section className="relative mb-4 overflow-hidden rounded-2xl bg-[#0a1a33] text-white shadow-[0_10px_30px_-14px_rgba(5,22,39,0.7)] ring-1 ring-white/10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_380px_at_78%_25%,rgba(47,111,208,0.42),transparent_62%)]" aria-hidden />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/banner-products.webp" alt="" aria-hidden className="pointer-events-none absolute bottom-0 right-0 hidden h-full w-auto max-w-[56%] select-none object-contain object-right-bottom xl:block" />

        <div className="relative px-5 pb-6 pt-6 sm:px-8 sm:pb-8 sm:pt-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-oil-400">Management · Owner</p>
          <h1 className="mt-2 text-[1.7rem] font-bold leading-tight tracking-tight sm:text-4xl">
            {greeting()}, {firstName}
          </h1>
          <p className="mt-1 text-sm text-white/60">
            {todayLabel} · {profile.name}
          </p>
          <dl className="mt-5 flex flex-wrap gap-x-9 gap-y-4">
            {balances.length > 0 && (
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">You can use now</dt>
                <dd className="mt-0.5 text-xl font-bold tabular-nums">{m(usable)}</dd>
              </div>
            )}
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">Collected today</dt>
              <dd className="mt-0.5 text-xl font-bold tabular-nums text-emerald-300">{m(o.today.collected)}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">Owed by customers</dt>
              <dd className="mt-0.5 text-xl font-bold tabular-nums text-oil-400">{m(k.debt.value)}</dd>
            </div>
          </dl>
        </div>
      </section>

      <nav className="-mx-1 mb-6 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" aria-label="Shortcuts">
        {pills.map((l) => (
          <Link key={l.href} href={l.href} className={cn("inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold transition", PILL[l.tone])}>
            <l.icon size={15} className="text-sky-500" /> {l.label}
            {l.badge ? <span className="rounded-full bg-brand-red px-1.5 text-[11px] font-bold leading-[18px] text-white">{l.badge}</span> : null}
          </Link>
        ))}
      </nav>

      {alerts.active === 0 && (
        <div className="card card-pad mb-6 border-oil-400/50 bg-oil-soft/60">
          <p className="text-sm font-semibold text-slate-900">Your catalogue is empty</p>
          <p className="mt-0.5 text-sm text-slate-600">
            Add your products, set their selling prices, then announce your first shipment so the shop can receive it.{" "}
            <Link href="/products/new" className="font-medium text-navy-700 hover:underline">
              Add a product
            </Link>
          </p>
        </div>
      )}

      {/* ── Needs you ── */}
      <Heading
      >
        Needs your attention <span className="ml-1.5 rounded-full bg-oil-400 px-2 py-0.5 text-[11px] font-bold tracking-normal text-[#0a1424]">{items.length}</span>
      </Heading>
      <AttentionPanel items={items} />

      {/* ── The money ── */}
      <Heading>The money</Heading>
      <section className="card overflow-hidden">
        <div className="grid xl:grid-cols-[1.25fr_1fr]">
          {balances.length > 0 ? (
            <div className="grid items-center gap-5 p-4 sm:grid-cols-[170px_1fr] sm:p-5">
              <div className="mx-auto h-40 w-40 sm:h-44 sm:w-44">
                <DonutChart data={balances.map((b) => ({ name: b.name, value: Math.max(0, b.balance.toNumber()) })).filter((x) => x.value > 0)} money={money} centre={compact(usable)} centreLabel="in the accounts" empty="No money recorded yet" />
              </div>
              <ul className="space-y-3">
                {balances.map((b, i) => {
                  const Icon = b.method === "CASH" ? Banknote : b.method === "BANK" ? Landmark : Smartphone;
                  return (
                    <li key={b.method} className="flex items-center gap-3">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CHART_COLORS[i] }} />
                      <Icon size={16} className="shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] text-slate-500">{b.name}</span>
                        <span className={cn("block text-base font-bold tabular-nums", b.balance.lt(0) ? "text-brand-red-dark" : "text-slate-900")}>{m(b.balance.toNumber())}</span>
                      </span>
                      <span className="hidden text-right text-[11px] text-slate-500 sm:block">
                        +{m(b.inToday.toNumber())}
                        <br />−{m(b.outToday.toNumber())} today
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div className="p-5 text-sm text-slate-500">Account balances are shown to people who may see cash and accounts.</div>
          )}
          <div className="border-t border-line p-4 sm:p-5 xl:border-l xl:border-t-0">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Today</p>
              {balances.length > 0 && (
                <Link href="/cash" className="text-[13px] font-medium text-navy-700 hover:underline">
                  Open accounts
                </Link>
              )}
            </div>
            <dl className="divide-y divide-slate-100 text-sm">
              <div className="flex items-center justify-between py-2.5"><dt className="text-slate-600">Sold today</dt><dd className="font-bold tabular-nums text-slate-900">{m(extras.today.sales)}</dd></div>
              <div className="flex items-center justify-between py-2.5"><dt className="text-slate-600">Collected today</dt><dd className="font-bold tabular-nums text-emerald-600 dark:text-emerald-300">{m(o.today.collected)}</dd></div>
              <div className="flex items-center justify-between py-2.5"><dt className="text-slate-600">Spent today</dt><dd className="font-bold tabular-nums text-slate-900">{m(o.today.spent)}</dd></div>
              <div className="flex items-center justify-between py-2.5"><dt className="text-slate-600">Net cash today</dt><dd className={cn("font-bold tabular-nums", o.today.net < 0 ? "text-rose-600 dark:text-rose-300" : "text-emerald-600 dark:text-emerald-300")}>{o.today.net < 0 ? "−" : ""}{m(Math.abs(o.today.net))}</dd></div>
            </dl>
          </div>
        </div>
      </section>

      {/* ── This month against last month ── */}
      <Heading
        right={
          <Link href="/reports" className="inline-flex items-center gap-1 text-[13px] font-medium text-navy-700 hover:underline">
            Reports <ArrowRight size={13} />
          </Link>
        }
      >
        {o.monthLabel} · against {o.prevMonthLabel}
      </Heading>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Metric icon={Receipt} tone="blue" label="Sales" value={m(o.month.sales.value)} change={o.month.sales.change} hint={`${o.month.sales.count} sale${o.month.sales.count === 1 ? "" : "s"} so far`} href={`/sales?from=${range.fromYmd}&to=${range.toYmd}`} />
        <Metric icon={Wallet} tone="green" label="Money received" value={m(o.month.money.value)} change={o.month.money.change} hint="Cash, mobile money and bank" href="/payments" />
        <Metric icon={ReceiptText} tone="red" label="Expenses" value={m(o.month.spent.value)} change={o.month.spent.change} upIsGood={false} hint="Approved expenses" href="/expenses" />
        {o.month.profit ? <Metric icon={TrendingUp} tone="amber" label="Gross profit" value={m(o.month.profit.value)} change={o.month.profit.change} hint={o.month.margin !== null ? `${o.month.margin.toFixed(1)}% of sales` : undefined} /> : <Metric icon={ShoppingBag} tone="amber" label="Items sold" value={Math.round(o.month.units.value).toLocaleString("en-US")} change={o.month.units.change} />}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Metric icon={HandCoins} tone="amber" label="Owed to us" value={m(o.owedTotal)} hint="On every unpaid bill, not just this month" href="/credit" />
        <Metric icon={PiggyBank} tone="violet" label="Collected of what was sold" value={o.month.collectionRate === null ? "—" : `${Math.round(o.month.collectionRate)}%`} hint={`${m(o.month.money.value)} of ${m(o.month.sales.value)}`} />
        <Metric icon={ShoppingBag} tone="blue" label="Items sold" value={Math.round(o.month.units.value).toLocaleString("en-US")} change={o.month.units.change} hint="Bottles and tins this month" />
        <Metric icon={Boxes} tone="slate" label={k.stockValue !== null ? "Stock value" : "On the shelf"} value={k.stockValue !== null ? m(k.stockValue) : `${Math.round(Number(shelf?._sum.quantity ?? 0)).toLocaleString("en-US")} items`} hint={`${alerts.low.length + alerts.out.length} product${alerts.low.length + alerts.out.length === 1 ? "" : "s"} need restocking`} href="/inventory" />
      </div>
      <p className="mt-2 text-xs text-slate-500">Compared with the same days of {o.prevMonthLabel}. Sales are what was invoiced; money received is what actually came in.</p>

      {/* ── The year and the health ── */}
      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Section title={o.month.profit ? "Sales, costs and what was left" : "Sales and expenses"} hint="The last twelve months" className="xl:col-span-2">
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            {[["Sales", "var(--c1)"], ...(financials ? [["Costs", "var(--c2)"], ["What was left", "var(--c5)"]] : [["Expenses", "var(--c2)"]])].map(([l, c]) => (
              <span key={l} className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: c }} />
                {l}
              </span>
            ))}
          </div>
          <div className="h-60 sm:h-72">
            <YearChart data={o.year} money={money} showCosts />
          </div>
        </Section>
        <Section title="How the business is doing" hint="Simple rules of thumb: green is healthy">
          <ul className="divide-y divide-slate-100">
            {health.map((h) => (
              <li key={h.label} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-sm text-slate-800">{h.label}</span>
                  <span className="block text-[11px] text-slate-500">{h.note}</span>
                </span>
                <span className={cn("shrink-0 text-lg font-bold tabular-nums", h.cls)}>{h.value}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      {/* ── Products ── */}
      <section className="card mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900">What each product is making</h2>
            <p className="text-xs text-slate-500">{o.monthLabel} so far. {financials ? "Cost is what the stock cost us." : ""}</p>
          </div>
          <Link href="/reports?tab=sales" className="inline-flex items-center gap-1 text-[13px] font-medium text-navy-700 hover:underline">
            All products <ArrowRight size={13} />
          </Link>
        </div>
        {o.products.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">Nothing sold this month yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="hidden text-right sm:table-cell">Sold</th>
                  <th className="text-right">Sales</th>
                  {financials && <th className="hidden text-right sm:table-cell">Cost</th>}
                  {financials && <th className="text-right">Profit</th>}
                  {financials && <th className="hidden text-right md:table-cell">Margin</th>}
                </tr>
              </thead>
              <tbody>
                {o.products.map((p) => {
                  const margin = p.sales > 0 && p.profit !== null ? (p.profit / p.sales) * 100 : null;
                  return (
                    <tr key={p.id}>
                      <td className="font-medium text-slate-900">{p.name}</td>
                      <td className="hidden text-right tabular-nums sm:table-cell">{Math.round(p.units)}</td>
                      <td className="text-right tabular-nums">{m(p.sales)}</td>
                      {financials && <td className="hidden text-right tabular-nums text-rose-600 dark:text-rose-300 sm:table-cell">{m(p.cost ?? 0)}</td>}
                      {financials && <td className="text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-300">{m(p.profit ?? 0)}</td>}
                      {financials && <td className="hidden text-right tabular-nums text-slate-600 md:table-cell">{margin === null ? "—" : `${margin.toFixed(0)}%`}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Where it comes from and goes ── */}
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Section title="By category" hint={`${o.monthLabel} so far`} action={{ href: "/reports?tab=sales", label: "Details" }}>
          <div className="h-44">
            <DonutChart data={data.byCategory} money={money} centre={compact(o.month.sales.value)} />
          </div>
          <ul className="mt-3 space-y-1.5 text-sm">
            {data.byCategory.slice(0, 4).map((c, i) => (
              <li key={c.name} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-slate-700">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                  <span className="truncate">{c.name}</span>
                </span>
                <span className="shrink-0 font-medium text-slate-900">{m(c.value)}</span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Top customers" hint="Billed this month, and what they still owe">
          {o.customers.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">Nothing billed to a named customer this month yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {o.customers.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                  <Link href={`/customers/${c.id}`} className="min-w-0 truncate text-sm font-medium text-slate-800 hover:text-navy-700">
                    {c.name}
                  </Link>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-semibold tabular-nums text-slate-900">{m(c.billed)}</span>
                    <span className={cn("block text-[11px] tabular-nums", c.owed > 0 ? "text-amber-600 dark:text-amber-300" : "text-slate-400")}>{c.owed > 0 ? `owes ${m(c.owed)}` : "paid up"}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Where money is spent" hint={`${o.monthLabel} so far`} action={{ href: "/expenses", label: "Expenses" }}>
          {extras.expenses.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No expenses recorded this month.</p>
          ) : (
            <>
              <div className="h-44">
                <DonutChart data={extras.expenses} money={money} centre={compact(o.month.spent.value)} centreLabel="spent" />
              </div>
              <ul className="mt-3 space-y-1.5 text-sm">
                {extras.expenses.slice(0, 4).map((e, i) => (
                  <li key={e.name} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-slate-700">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span className="truncate">{e.name}</span>
                    </span>
                    <span className="shrink-0 font-medium text-slate-900">{m(e.value)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Section title="Money in and out" hint="Every month, this year" action={{ href: "/cash", label: "Accounts" }}>
          <div className="h-52">
            <InOutChart data={o.year.map((y) => ({ label: y.label, in: y.in, out: y.out }))} money={money} />
          </div>
          <p className="mt-2 flex gap-4 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "var(--c5)" }} />Money in</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: "var(--c2)" }} />Money out</span>
          </p>
        </Section>
        <Section title="Who owes us, by age" hint="From the day the sale was made" action={{ href: "/credit", label: "Credit" }}>
          <ul className="space-y-3.5">
            {o.aging.map((a, i) => (
              <li key={a.label}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-slate-700">{a.label}</span>
                  <span className="text-xs text-slate-500">
                    {a.count} bill{a.count === 1 ? "" : "s"} · <strong className="text-sm tabular-nums text-slate-900">{m(a.value)}</strong>
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full" style={{ width: `${(a.value / agingMax) * 100}%`, background: agingColors[i] }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-line pt-3 text-xs text-slate-500">
            Owed in all <strong className="tabular-nums text-slate-800">{m(o.owedTotal)}</strong>
            {o.oldestOwed > 0 && <> · oldest {o.oldestOwed} days</>}
          </p>
        </Section>
        <Section title="Where the stock is" action={{ href: "/inventory", label: "Stock" }}>
          <div className="h-40">
            <DonutChart data={stockRing} money={money} centre={String(alerts.active)} centreLabel="products" colors={["var(--c5)", "var(--c3)", "var(--c2)"]} empty="No products yet" />
          </div>
          <ul className="mt-3 space-y-1.5 text-sm">
            {stockRing.map((r) => (
              <li key={r.name} className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-slate-700">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: ["var(--c5)", "var(--c3)", "var(--c2)"][["In stock", "Running low", "Out of stock"].indexOf(r.name)] }} />
                  {r.name}
                </span>
                <strong className="text-slate-900">{r.value}</strong>
              </li>
            ))}
          </ul>
          {shelf && away && (
            <p className="mt-3 flex justify-between border-t border-line pt-3 text-xs text-slate-500">
              <span>On the shelf <strong className="text-slate-800">{Math.round(Number(shelf._sum.quantity ?? 0)).toLocaleString("en-US")}</strong></span>
              <span>With winga <strong className="text-slate-800">{Math.round(Number(away._sum.quantity ?? 0)).toLocaleString("en-US")}</strong></span>
            </p>
          )}
        </Section>
      </div>

      {/* ── Daily rhythm, people, resellers ── */}
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Section title="Money received each day" hint={`${o.monthLabel} so far, by how it was paid`} className="xl:col-span-2">
          <div className="h-52 sm:h-60">
            <MoneyBarsChart data={extras.moneyTrend} money={money} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-slate-600">
            {[
              ["Cash", "var(--c1)", k.cash.byMethod.CASH ?? 0],
              ["Mobile money", "var(--c3)", k.cash.byMethod.MOBILE_MONEY ?? 0],
              ["Bank", "var(--c4)", k.cash.byMethod.BANK ?? 0],
            ].map(([label, colour, v]) => (
              <span key={label as string} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: colour as string }} />
                {label as string}
                <strong className="text-slate-900">{m(v as number)}</strong>
                {moneyIn > 0 && <span className="text-slate-400">{Math.round(((v as number) / moneyIn) * 100)}%</span>}
              </span>
            ))}
          </div>
        </Section>
        <Section title="Busiest days" hint="Sales by day of the week">
          <div className="h-52 sm:h-60">
            <ColumnsChart data={extras.weekday} money={money} />
          </div>
        </Section>
      </div>

      <div className="mt-4 grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
        <section className="card overflow-hidden xl:col-span-2">
          <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
            <h2 className="text-base font-semibold text-slate-900">Latest sales</h2>
            <Link href="/sales" className="inline-flex items-center gap-1 text-[13px] font-medium text-navy-700 hover:underline">
              View all <ArrowRight size={13} />
            </Link>
          </div>
          {data.recent.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">No sales yet. They appear here as soon as the shop makes one.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.recent.map((s) => (
                <li key={s.id}>
                  <Link href={`/sales/${s.id}`} className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-slate-50 sm:px-5">
                    <span className="min-w-0">
                      <span className="block font-medium text-navy-700">{s.saleNo}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {s.customer?.name ?? "Walk-in"} · by {s.salesperson.name} · {formatDateTime(s.createdAt)}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
                      <span className="font-semibold text-slate-900">{m(Number(s.total.minus(s.returnedTotal)))}</span>
                      <SaleStatusBadge status={s.status} paymentStatus={s.paymentStatus} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-4">
          <Section title="Staff performance" hint={`${o.monthLabel} so far`}>
            {data.staff.length === 0 ? (
              <p className="text-sm text-slate-500">No sales this month yet.</p>
            ) : (
              <ul className="space-y-3.5">
                {data.staff.map((s, i) => {
                  const w = data.staff[0]!.sales > 0 ? (s.sales / data.staff[0]!.sales) * 100 : 0;
                  return (
                    <li key={s.id}>
                      <Link href={`/sales?seller=${s.id}&from=${range.fromYmd}&to=${range.toYmd}`} className="flex items-center gap-3">
                        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold", i === 0 ? "bg-oil-400 text-navy-900" : "bg-navy-50 text-navy-700")}>
                          {s.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between text-sm">
                            <span className="truncate font-medium text-slate-800">{s.name}</span>
                            <span className="font-semibold tabular-nums text-slate-900">{m(s.sales)}</span>
                          </span>
                          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <span className="block h-full rounded-full" style={{ width: `${w}%`, background: "var(--c1)" }} />
                          </span>
                          <span className="mt-0.5 block text-xs text-slate-500">{s.count} sale{s.count === 1 ? "" : "s"}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
          {extras.resellers && (
            <Section title="Winga" action={{ href: "/resellers", label: "Open" }}>
              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between"><dt className="text-slate-600">Active winga</dt><dd className="font-semibold">{extras.resellers.count}</dd></div>
                <div className="flex items-center justify-between"><dt className="text-slate-600">Stock they hold</dt><dd className="font-semibold tabular-nums">{m(extras.resellers.held)}</dd></div>
                <div className="flex items-center justify-between"><dt className="text-slate-600">They owe us</dt><dd className="font-semibold tabular-nums">{m(extras.resellers.owed)}</dd></div>
                {extras.resellers.overdue > 0 && (
                  <div className="flex items-center justify-between rounded-lg bg-brand-red-soft px-3 py-2 text-brand-red-dark"><dt>Overdue</dt><dd className="font-bold tabular-nums">{m(extras.resellers.overdue)}</dd></div>
                )}
              </dl>
            </Section>
          )}
        </div>
      </div>

      {alerts.out.length + alerts.low.length > 0 && (
        <Section title="Restock soon" action={{ href: "/inventory?status=low", label: "See all" }} className="mt-4">
          <ul className="grid gap-x-8 gap-y-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3">
            {[...alerts.out.map((a) => ({ ...a, out: true })), ...alerts.low.map((a) => ({ ...a, out: false }))].slice(0, 9).map((a) => (
              <li key={a.id} className="flex items-center gap-3 border-b border-slate-100 py-2">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-gradient-to-b from-white to-slate-100">
                  {a.imageV ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/product-image/${a.id}?size=thumb&v=${a.imageV}`} alt="" loading="lazy" className="h-full w-full object-contain" />
                  ) : (
                    <Package size={18} className="text-slate-300" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{a.name}</span>
                <span className={a.out ? "badge-red" : "badge-yellow"}>{a.out ? "Out" : `${qtyText(Number(a.qty), a.pack, a.symbol, unitMode).main} left`}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
