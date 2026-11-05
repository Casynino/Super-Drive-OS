import Link from "next/link";
import { AlertTriangle, ArrowRight, Banknote, Boxes, CalendarCheck, Handshake, HandCoins, Landmark, Package, ReceiptText, Scale, Smartphone, TrendingUp, Truck, Undo2, Users, Wallet, Receipt, Inbox, ChartColumn } from "lucide-react";
import StatTile from "@/components/dashboard/StatTile";
import { ColumnsChart, DonutChart, MoneyBarsChart, SalesTrendChart, TopProductsChart } from "@/components/dashboard/Charts";
import { SaleStatusBadge } from "../sales/StatusBadge";
import { can } from "@/lib/auth/can";
import type { SessionUser } from "@/lib/auth/session";
import { businessDay, dayToDate, defaultLocationId, getBalances } from "@/lib/cash/ledger";
import { db } from "@/lib/db";
import { getOwnerDashboard, getOwnerExtras } from "@/lib/dashboard/owner";
import { RANGES, resolveRange } from "@/lib/dashboard/range";
import { getStockAlerts } from "@/lib/inventory/alerts";
import { formatMoney } from "@/lib/money";
import { owedOf } from "@/lib/sales/owed";
import { getBusinessProfile, getCurrency } from "@/lib/settings";
import { cn, formatDateTime } from "@/lib/utils";

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Dar_es_Salaam" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};
const PALETTE = ["#0e3d6e", "#ed1c24", "#fdc400", "#4f85b9", "#16a34a", "#8b5cf6", "#94a3b8"];

function Card({ title, hint, action, children, className, id }: { title: string; hint?: string; id?: string; action?: { href: string; label: string }; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={cn("card card-pad scroll-mt-20", className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
        </div>
        {action && (
          <Link href={action.href} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-navy-700 hover:underline">
            {action.label} <ArrowRight size={14} />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export default async function OwnerHome({ user, range: rangeKey }: { user: SessionUser; range?: string }) {
  const range = resolveRange(rangeKey);
  const locationId = await defaultLocationId(db);
  const [currency, profile, data, extras, alerts, shipmentIssues, shipmentsOnTheWay, balances, pendingExpenses, closingsToReview, lastClosing, resellerOverdue] = await Promise.all([
    getCurrency(),
    getBusinessProfile(),
    getOwnerDashboard(db, range, { financials: can(user, "dashboard.financials"), valuation: can(user, "inventory.valuation") }),
    getOwnerExtras(db, range, { resellers: can(user, "resellers.view"), expenses: can(user, "expenses.view") }),
    getStockAlerts(db),
    can(user, "shipments.manage") ? db.shipment.count({ where: { issue: "OPEN" } }) : 0,
    can(user, "shipments.manage") ? db.shipment.count({ where: { status: { in: ["EXPECTED", "PARTIAL"] } } }) : 0,
    can(user, "cash.view") ? getBalances(db, locationId) : Promise.resolve([]),
    can(user, "expenses.approve") ? db.expense.count({ where: { status: "PENDING" } }) : 0,
    can(user, "closing.approve") ? db.dailyClosing.count({ where: { status: "NEEDS_REVIEW" } }) : 0,
    can(user, "closing.approve") || can(user, "cash.view") ? db.dailyClosing.findFirst({ where: { locationId }, orderBy: { businessDate: "desc" }, select: { businessDate: true, difference: true } }) : null,
    can(user, "resellers.view")
      ? db.sale.findMany({ where: { channel: "RESELLER", status: "COMPLETED", dueDate: { lt: dayToDate(businessDay()) } }, select: { total: true, returnedTotal: true, amountPaid: true, refundedTotal: true } }).then((rows) => rows.reduce((s, x) => s + Math.max(0, owedOf(x).toNumber()), 0))
      : 0,
  ]);
  const money = { symbol: currency.symbol, decimals: currency.decimals };
  const m = (v: number) => formatMoney(v, currency);
  const compact = (v: number) => `${currency.symbol} ${Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : Math.abs(v) >= 10_000 ? `${Math.round(v / 1000)}k` : new Intl.NumberFormat("en-US").format(Math.round(v))}`;
  const q = `from=${range.fromYmd}&to=${range.toYmd}`;
  const k = data.kpi;
  const attention = data.pendingApprovals + pendingExpenses + closingsToReview + shipmentIssues + (resellerOverdue > 0 ? 1 : 0) + (k.debt.overdue > 0 ? 1 : 0) + alerts.out.length + alerts.low.length;
  const methodTotal = Object.values(k.cash.byMethod).reduce((s, v) => s + v, 0);
  const expenseTotal = extras.expenses.reduce((s, e) => s + e.value, 0);
  const stockRing = [
    { name: "In stock", value: Math.max(0, alerts.inStock - alerts.low.length) },
    { name: "Running low", value: alerts.low.length },
    { name: "Out of stock", value: alerts.out.length },
  ].filter((x) => x.value > 0);
  const firstName = user.name.split(" ")[0]!;
  const todayLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Dar_es_Salaam" }).format(new Date());
  const links = [
    can(user, "reports.view") && { href: "/reports", label: "Reports", icon: ChartColumn },
    (can(user, "returns.approve") || can(user, "expenses.approve") || can(user, "closing.approve")) && { href: "/approvals", label: "Approvals", icon: Inbox, badge: data.pendingApprovals + pendingExpenses + closingsToReview },
    can(user, "cash.view") && { href: "/cash", label: "Cash", icon: Banknote },
    can(user, "shipments.manage") && { href: "/shipments", label: "Incoming stock", icon: Truck },
    can(user, "resellers.view") && { href: "/resellers", label: "Resellers", icon: Handshake },
  ].filter(Boolean) as { href: string; label: string; icon: typeof Package; badge?: number }[];

  return (
    <>
      {/* ── Banner ── */}
      <section className="relative mb-5 overflow-hidden rounded-2xl bg-gradient-to-br from-navy-950 via-navy-800 to-navy-600 text-white shadow-[0_8px_28px_-12px_rgba(8,35,64,0.6)]">
        <svg aria-hidden viewBox="0 0 400 200" preserveAspectRatio="xMaxYMin slice" className="pointer-events-none absolute right-0 top-0 h-[30%] w-40 sm:h-[68%] sm:w-[30rem] sm:max-w-[70%]">
          <path d="M400 0 L400 200 L170 200 Q300 120 400 0 Z" fill="#ED1C24" opacity="0.95" />
          <path d="M400 70 L400 200 L260 200 Q350 150 400 70 Z" fill="#FDC400" />
        </svg>
        <div className="pointer-events-none absolute -left-16 -top-20 h-56 w-56 rounded-full bg-white/5" aria-hidden />
        <div className="pointer-events-none absolute left-1/3 top-1/2 h-40 w-40 rounded-full bg-white/[0.04]" aria-hidden />

        <div className="relative px-5 pb-5 pt-5 sm:px-8 sm:pb-7 sm:pt-7">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-navy-200">{todayLabel}</p>
          <h1 className="mt-1.5 text-[1.65rem] font-bold leading-tight tracking-tight sm:text-4xl">
            {greeting()}, {firstName}
          </h1>
          <p className="mt-1 max-w-md text-sm text-navy-100/90">Here is how {profile.name} is doing right now.</p>

          <div className="mt-5 grid max-w-2xl grid-cols-3 gap-2 sm:gap-3">
            <Link href="/sales" className="rounded-xl bg-white/10 px-3 py-2.5 ring-1 ring-white/15 transition hover:bg-white/15 sm:px-4 sm:py-3">
              <p className="text-[11px] font-medium text-navy-100 sm:text-xs">Sold today</p>
              <p className="mt-0.5 whitespace-nowrap text-[15px] font-bold tabular-nums sm:text-xl"><span className="sm:hidden">{compact(extras.today.sales)}</span><span className="hidden sm:inline">{m(extras.today.sales)}</span></p>
              <p className="text-[11px] text-navy-200">{extras.today.count} sale{extras.today.count === 1 ? "" : "s"}</p>
            </Link>
            <Link href="/payments" className="rounded-xl bg-white/10 px-3 py-2.5 ring-1 ring-white/15 transition hover:bg-white/15 sm:px-4 sm:py-3">
              <p className="text-[11px] font-medium text-navy-100 sm:text-xs">Money in</p>
              <p className="mt-0.5 whitespace-nowrap text-[15px] font-bold tabular-nums sm:text-xl"><span className="sm:hidden">{compact(extras.today.money)}</span><span className="hidden sm:inline">{m(extras.today.money)}</span></p>
              <p className="text-[11px] text-navy-200">received</p>
            </Link>
            <a href="#attention" className="rounded-xl bg-white/10 px-3 py-2.5 ring-1 ring-white/15 transition hover:bg-white/15 sm:px-4 sm:py-3">
              <p className="text-[11px] font-medium text-navy-100 sm:text-xs">Needs you</p>
              <p className="mt-0.5 whitespace-nowrap text-[15px] font-bold tabular-nums sm:text-xl">{attention}</p>
              <p className="text-[11px] text-navy-200">{attention === 0 ? "all clear" : "item" + (attention === 1 ? "" : "s")}</p>
            </a>
          </div>

          <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" aria-label="Shortcuts">
              {links.map((l) => (
                <Link key={l.href} href={l.href} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-sm font-semibold text-navy-800 shadow-sm transition hover:bg-oil-400">
                  <l.icon size={15} /> {l.label}
                  {l.badge ? <span className="ml-0.5 rounded-full bg-brand-red px-1.5 text-[11px] font-bold leading-5 text-white">{l.badge}</span> : null}
                </Link>
              ))}
            </nav>
            <nav className="grid w-full grid-cols-4 gap-0.5 rounded-xl bg-navy-950/70 p-1 ring-1 ring-white/10 sm:inline-grid sm:w-fit" aria-label="Period">
              {RANGES.map((r) => (
                <Link key={r.key} href={`/dashboard?range=${r.key}`} aria-current={range.key === r.key ? "true" : undefined} className={cn("whitespace-nowrap rounded-lg px-2.5 py-1.5 text-center text-[13px] font-medium transition sm:px-3.5 sm:text-sm", range.key === r.key ? "bg-white text-navy-800 shadow-sm" : "text-navy-100 hover:bg-white/10")}>
                  {r.key === "month" ? (
                    <>
                      <span className="sm:hidden">Month</span>
                      <span className="hidden sm:inline">This month</span>
                    </>
                  ) : (
                    r.label
                  )}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </section>

      {alerts.active === 0 && (
        <div className="card card-pad mb-5 border-oil-400/50 bg-oil-soft/60">
          <p className="text-sm font-semibold text-slate-900">Your catalogue is empty</p>
          <p className="mt-0.5 text-sm text-slate-600">
            Add your products, set their selling prices, then announce your first shipment so the shop can receive it.{" "}
            <Link href="/products/new" className="font-medium text-navy-700 hover:underline">
              Add a product
            </Link>
          </p>
        </div>
      )}

      {/* ── Key figures ── */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-6">
        <StatTile icon={Receipt} tone="navy" label={`Sales · ${range.label.toLowerCase()}`} value={m(k.sales.value)} change={k.sales.change} hint={`${k.sales.count} sale${k.sales.count === 1 ? "" : "s"} · avg ${m(k.avgSale)}`} href={`/sales?${q}`} spark={data.trend.map((t) => t.sales)} />
        <StatTile icon={Wallet} tone="green" label="Money received" value={m(k.cash.value)} change={k.cash.change} hint={`Cash ${m(k.cash.byMethod.CASH ?? 0)} · Mobile ${m(k.cash.byMethod.MOBILE_MONEY ?? 0)}`} href={`/payments?${q}`} spark={extras.moneyTrend.map((t) => t.cash + t.mobile + t.bank)} />
        {k.profit ? (
          <StatTile icon={TrendingUp} tone="yellow" label="Gross profit" value={m(k.profit.value)} change={k.profit.change} hint={`${k.profit.margin.toFixed(1)}% of sales`} />
        ) : (
          <StatTile icon={Users} tone="yellow" label="Staff selling" value={data.staff.length} hint="With sales in this period" />
        )}
        <StatTile icon={ReceiptText} tone="slate" label="Expenses" value={m(expenseTotal)} hint={extras.expenses[0] ? `Mostly ${extras.expenses[0].name.toLowerCase()}` : "Approved expenses"} href="/expenses" />
        <StatTile icon={HandCoins} tone="red" label="Owed by customers" value={m(k.debt.value)} hint={k.debt.overdue > 0 ? `${m(k.debt.overdue)} overdue` : `${k.debt.open} open invoice${k.debt.open === 1 ? "" : "s"}`} href="/credit" />
        {k.stockValue !== null ? (
          <StatTile icon={Boxes} tone="navy" label="Stock value" value={m(k.stockValue)} hint={`${alerts.low.length + alerts.out.length} need restocking`} href="/inventory" />
        ) : (
          <StatTile icon={Boxes} tone="navy" label="Need restocking" value={alerts.low.length + alerts.out.length} hint={`${alerts.out.length} out of stock`} href="/inventory?status=low" />
        )}
      </div>

      {/* ── Sales ── */}
      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <Card title="Sales trend" hint="Daily sales after returns" className="lg:col-span-2">
          <div className="h-56 sm:h-72">
            <SalesTrendChart data={data.trend} money={money} />
          </div>
        </Card>
        <Card title="Sales by category" action={{ href: "/reports?tab=sales", label: "Details" }}>
          <div className="h-48 sm:h-52">
            <DonutChart data={data.byCategory} money={money} centre={compact(k.sales.value)} />
          </div>
          <ul className="mt-3 space-y-1.5 text-sm">
            {data.byCategory.slice(0, 5).map((c, i) => (
              <li key={c.name} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-slate-700">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
                  <span className="truncate">{c.name}</span>
                </span>
                <span className="shrink-0 font-medium text-slate-900">{m(c.value)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <Card title="Money received" hint="Each day, by how it was paid" className="lg:col-span-2">
          <div className="h-52 sm:h-60">
            <MoneyBarsChart data={extras.moneyTrend} money={money} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-slate-600">
            {[
              ["Cash", "#0e3d6e", k.cash.byMethod.CASH ?? 0],
              ["Mobile money", "#fdc400", k.cash.byMethod.MOBILE_MONEY ?? 0],
              ["Bank", "#84add4", k.cash.byMethod.BANK ?? 0],
            ].map(([label, colour, v]) => (
              <span key={label as string} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: colour as string }} />
                {label as string}
                <strong className="text-slate-900">{m(v as number)}</strong>
                {methodTotal > 0 && <span className="text-slate-400">{Math.round(((v as number) / methodTotal) * 100)}%</span>}
              </span>
            ))}
          </div>
        </Card>
        <Card title="Busiest days" hint="Sales by day of the week">
          <div className="h-52 sm:h-60">
            <ColumnsChart data={extras.weekday} money={money} />
          </div>
        </Card>
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <Card title="Best-selling products" action={{ href: "/reports?tab=sales", label: "All" }} className="lg:col-span-2">
          <div className="h-60 sm:h-64">
            <TopProductsChart data={data.topProducts} money={money} />
          </div>
        </Card>
        <Card id="attention" title="Needs your attention" hint={attention === 0 ? undefined : `${attention} thing${attention === 1 ? "" : "s"} to look at`}>
          <ul className="space-y-2 text-sm">
            <Attention href="/shipments" show={can(user, "shipments.manage")} count={shipmentIssues} icon={AlertTriangle} text="shipments with damaged or missing goods" />
            <Attention href="/shipments" show={can(user, "shipments.manage")} count={shipmentsOnTheWay} icon={Truck} text="shipments on the way" calm />
            <Attention href="/approvals" show={can(user, "returns.approve")} count={data.pendingApprovals} icon={Undo2} text="return or cancel requests" />
            <Attention href="/approvals" show={can(user, "expenses.approve")} count={pendingExpenses} icon={ReceiptText} text="expenses waiting for approval" />
            <Attention href="/approvals" show={can(user, "closing.approve")} count={closingsToReview} icon={CalendarCheck} text="closings where the cash did not match" />
            <Attention href="/resellers" show={can(user, "resellers.view")} count={resellerOverdue > 0 ? 1 : 0} icon={Handshake} text={`${m(resellerOverdue)} overdue from resellers`} hideCount />
            <Attention href="/credit" show count={k.debt.overdue > 0 ? 1 : 0} icon={AlertTriangle} text={`${m(k.debt.overdue)} owed past the due date`} hideCount />
            <Attention href="/inventory?status=out" show count={alerts.out.length} icon={Package} text="products out of stock" />
            <Attention href="/inventory?status=low" show count={alerts.low.length} icon={Scale} text="products running low" />
            {attention === 0 && <li className="rounded-lg bg-emerald-50 px-3 py-3 text-emerald-800">Nothing needs your attention right now.</li>}
          </ul>
        </Card>
      </div>

      {/* ── Money and stock ── */}
      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        {balances.length > 0 && (
          <Card title="Where the money is" action={{ href: "/cash", label: "Cash & accounts" }} className="lg:col-span-2">
            <div className="grid gap-3 sm:grid-cols-3">
              {balances.map((b) => {
                const Icon = b.method === "CASH" ? Banknote : b.method === "BANK" ? Landmark : Smartphone;
                return (
                  <div key={b.method} className="rounded-xl border border-line p-3.5">
                    <span className={cn("grid h-9 w-9 place-items-center rounded-lg", b.method === "CASH" ? "bg-oil-soft text-yellow-800" : b.method === "BANK" ? "bg-navy-50 text-navy-700" : "bg-emerald-50 text-emerald-700")}>
                      <Icon size={18} />
                    </span>
                    <p className="mt-2.5 text-xs text-slate-500">{b.name}</p>
                    <p className={cn("text-lg font-bold tabular-nums", b.balance.lt(0) ? "text-brand-red-dark" : "text-slate-900")}>{m(b.balance.toNumber())}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      +{m(b.inToday.toNumber())} · −{m(b.outToday.toNumber())} today
                    </p>
                  </div>
                );
              })}
            </div>
            <Link href="/closing" className="mt-3 flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2.5 text-sm transition hover:bg-slate-100">
              <span className="flex items-center gap-2 text-slate-600">
                <CalendarCheck size={16} /> Last day closed
              </span>
              <span className="font-semibold text-slate-900">
                {lastClosing ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }).format(lastClosing.businessDate) : "Not yet"}
                {lastClosing && (
                  <span className={cn("ml-2 text-xs font-medium", lastClosing.difference.isZero() ? "text-emerald-700" : lastClosing.difference.lt(0) ? "text-brand-red-dark" : "text-yellow-800")}>
                    {lastClosing.difference.isZero() ? "matched" : `${lastClosing.difference.lt(0) ? "short" : "extra"} ${m(lastClosing.difference.abs().toNumber())}`}
                  </span>
                )}
              </span>
            </Link>
          </Card>
        )}
        <Card title="Stock health" action={{ href: "/inventory", label: "Stock" }} className={balances.length === 0 ? "lg:col-span-3" : undefined}>
          <div className="h-44">
            <DonutChart data={stockRing} money={money} centre={String(alerts.active)} centreLabel="Products" colors={["#16a34a", "#fdc400", "#ed1c24"]} empty="No products yet" />
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {stockRing.map((r, i) => (
              <li key={r.name} className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-slate-700">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: ["#16a34a", "#fdc400", "#ed1c24"][["In stock", "Running low", "Out of stock"].indexOf(r.name)] ?? PALETTE[i] }} />
                  {r.name}
                </span>
                <strong className="text-slate-900">{r.value}</strong>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {(alerts.out.length + alerts.low.length > 0 || extras.resellers) && (
        <div className="mb-5 grid gap-4 lg:grid-cols-3">
          {alerts.out.length + alerts.low.length > 0 && (
            <Card title="Restock soon" action={{ href: "/inventory?status=low", label: "See all" }} className="lg:col-span-2">
              <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                {[...alerts.out.map((a) => ({ ...a, out: true })), ...alerts.low.map((a) => ({ ...a, out: false }))].slice(0, 8).map((a) => (
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
                    <span className={a.out ? "badge-red" : "badge-yellow"}>{a.out ? "Out" : `${Number(a.qty)} left`}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {extras.resellers && (
            <Card title="Resellers" action={{ href: "/resellers", label: "Open" }} className={alerts.out.length + alerts.low.length === 0 ? "lg:col-span-3" : undefined}>
              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between"><dt className="text-slate-600">Active resellers</dt><dd className="font-semibold">{extras.resellers.count}</dd></div>
                <div className="flex items-center justify-between"><dt className="text-slate-600">Stock they hold</dt><dd className="font-semibold tabular-nums">{m(extras.resellers.held)}</dd></div>
                <div className="flex items-center justify-between"><dt className="text-slate-600">They owe us</dt><dd className="font-semibold tabular-nums">{m(extras.resellers.owed)}</dd></div>
                {extras.resellers.overdue > 0 && <div className="flex items-center justify-between rounded-lg bg-brand-red-soft px-3 py-2 text-brand-red-dark"><dt>Overdue</dt><dd className="font-bold tabular-nums">{m(extras.resellers.overdue)}</dd></div>}
              </dl>
            </Card>
          )}
        </div>
      )}

      {/* ── People and records ── */}
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <section className="card overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
            <h2 className="text-base font-semibold text-slate-900">Latest sales</h2>
            <Link href="/sales" className="inline-flex items-center gap-1 text-sm font-medium text-navy-700 hover:underline">
              View all <ArrowRight size={14} />
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
          <Card title="Staff performance">
            {data.staff.length === 0 ? (
              <p className="text-sm text-slate-500">No sales in this period.</p>
            ) : (
              <ul className="space-y-3.5">
                {data.staff.map((s, i) => {
                  const pct = data.staff[0]!.sales > 0 ? (s.sales / data.staff[0]!.sales) * 100 : 0;
                  return (
                    <li key={s.id}>
                      <Link href={`/sales?seller=${s.id}&${q}`} className="block">
                        <div className="flex items-center gap-3">
                          <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold", i === 0 ? "bg-oil-400 text-navy-900" : "bg-navy-50 text-navy-700")}>
                            {s.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between text-sm">
                              <span className="truncate font-medium text-slate-800">{s.name}</span>
                              <span className="font-semibold text-slate-900">{m(s.sales)}</span>
                            </span>
                            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-100">
                              <span className="block h-full rounded-full bg-navy-600" style={{ width: `${pct}%` }} />
                            </span>
                            <span className="mt-0.5 block text-xs text-slate-500">{s.count} sale{s.count === 1 ? "" : "s"}</span>
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          {data.debtors.length > 0 && (
            <Card title="Who owes the most" action={{ href: "/credit", label: "Credit" }}>
              <ul className="space-y-2.5 text-sm">
                {data.debtors.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2">
                    <Link href={`/customers/${d.id}`} className="truncate text-navy-700 hover:underline">
                      {d.name}
                    </Link>
                    <span className="shrink-0 font-semibold text-brand-red-dark">{m(d.owed)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {extras.expenses.length > 0 && (
            <Card title="Where the money went" hint="Approved expenses in this period" action={{ href: "/expenses", label: "Expenses" }}>
              <div className="h-40">
                <DonutChart data={extras.expenses} money={money} centre={compact(expenseTotal)} centreLabel="Spent" />
              </div>
              <ul className="mt-2 space-y-1.5 text-sm">
                {extras.expenses.slice(0, 4).map((e, i) => (
                  <li key={e.name} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-slate-700">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
                      <span className="truncate">{e.name}</span>
                    </span>
                    <span className="shrink-0 font-medium text-slate-900">{m(e.value)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Attention({ href, show, count, icon: Icon, text, hideCount, calm }: { href: string; show: boolean; count: number; icon: typeof Package; text: string; hideCount?: boolean; calm?: boolean }) {
  if (!show || count === 0) return null;
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 transition hover:border-navy-200 hover:bg-slate-50">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", calm ? "bg-navy-50 text-navy-700" : "bg-brand-red-soft text-brand-red-dark")}>
          <Icon size={18} />
        </span>
        <span className="text-slate-700">
          {!hideCount && <strong className="mr-1 text-slate-900">{count}</strong>}
          {text}
        </span>
      </Link>
    </li>
  );
}
