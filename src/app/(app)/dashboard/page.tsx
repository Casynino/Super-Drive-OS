import Link from "next/link";
import { AlertTriangle, Banknote, Boxes, HandCoins, Package, PackageCheck, Receipt, Scale, ShoppingCart, TrendingUp, Undo2, Users, Wallet } from "lucide-react";
import StatTile from "@/components/dashboard/StatTile";
import { DonutChart, SalesTrendChart, TopProductsChart } from "@/components/dashboard/Charts";
import { SaleStatusBadge } from "../sales/StatusBadge";
import { Prisma } from "@/generated/prisma/client";
import { can } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getOwnerDashboard } from "@/lib/dashboard/owner";
import { RANGES, resolveRange } from "@/lib/dashboard/range";
import { getStockAlerts } from "@/lib/inventory/alerts";
import { formatMoney } from "@/lib/money";
import { owedOf } from "@/lib/sales/owed";
import { methodLabel } from "@/lib/sales/types";
import { getCurrency } from "@/lib/settings";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Dar_es_Salaam" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  // The people who run the business see the management dashboard; shop staff get the shop dashboard.
  return can(user, "dashboard.view") ? <OwnerDashboard user={user} range={sp.range} /> : <ShopDashboard user={user} />;
}

// ───────────────────────── Owner / manager ─────────────────────────

async function OwnerDashboard({ user, range: rangeKey }: { user: SessionUser; range?: string }) {
  const range = resolveRange(rangeKey);
  const [currency, data, alerts] = await Promise.all([
    getCurrency(),
    getOwnerDashboard(db, range, { financials: can(user, "dashboard.financials"), valuation: can(user, "inventory.valuation") }),
    getStockAlerts(db),
  ]);
  const money = { symbol: currency.symbol, decimals: currency.decimals };
  const m = (v: number) => formatMoney(v, currency);
  const q = `from=${range.fromYmd}&to=${range.toYmd}`;
  const k = data.kpi;
  const empty = alerts.active === 0;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {greeting()}, {user.name.split(" ")[0]}
          </h1>
          <p className="mt-1 text-sm text-slate-500">Here is how the business is doing. Click any figure to see the records behind it.</p>
        </div>
        <nav className="flex gap-1 rounded-xl bg-white p-1 shadow-[0_1px_2px_rgba(15,27,45,0.06)] ring-1 ring-line" aria-label="Period">
          {RANGES.map((r) => (
            <Link key={r.key} href={`/dashboard?range=${r.key}`} aria-current={range.key === r.key ? "true" : undefined} className={cn("rounded-lg px-3.5 py-1.5 text-sm font-medium transition", range.key === r.key ? "bg-navy-700 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100")}>
              {r.label}
            </Link>
          ))}
        </nav>
      </div>

      {empty && (
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

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
        <StatTile icon={Receipt} tone="navy" label={`Sales · ${range.label.toLowerCase()}`} value={m(k.sales.value)} change={k.sales.change} hint={`${k.sales.count} sale${k.sales.count === 1 ? "" : "s"} · avg ${m(k.avgSale)}`} href={`/sales?${q}`} />
        <StatTile icon={Wallet} tone="green" label="Money received" value={m(k.cash.value)} change={k.cash.change} hint={`Cash ${m(k.cash.byMethod.CASH ?? 0)} · Mobile ${m(k.cash.byMethod.MOBILE_MONEY ?? 0)}`} href={`/payments?${q}`} />
        {k.profit ? (
          <StatTile icon={TrendingUp} tone="yellow" label="Gross profit" value={m(k.profit.value)} change={k.profit.change} hint={`${k.profit.margin.toFixed(1)}% of sales`} />
        ) : (
          <StatTile icon={Users} tone="yellow" label="Staff selling" value={data.staff.length} hint="With sales in this period" />
        )}
        <StatTile icon={HandCoins} tone="red" label="Owed by customers" value={m(k.debt.value)} hint={k.debt.overdue > 0 ? `${m(k.debt.overdue)} overdue` : `${k.debt.open} open invoice${k.debt.open === 1 ? "" : "s"}`} href="/credit" />
        {k.stockValue !== null ? (
          <StatTile icon={Boxes} tone="slate" label="Stock value" value={m(k.stockValue)} hint={`${alerts.low.length + alerts.out.length} need restocking`} href="/inventory" />
        ) : (
          <StatTile icon={Boxes} tone="slate" label="Need restocking" value={alerts.low.length + alerts.out.length} hint={`${alerts.out.length} out of stock`} href="/inventory?status=low" />
        )}
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <section className="card card-pad lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Sales trend</h2>
            <span className="text-xs text-slate-500">Daily sales after returns</span>
          </div>
          <div className="h-72">
            <SalesTrendChart data={data.trend} money={money} />
          </div>
        </section>
        <section className="card card-pad">
          <h2 className="mb-3 text-base font-semibold text-slate-900">Sales by category</h2>
          <div className="h-52">
            <DonutChart data={data.byCategory} money={money} centre={m(k.sales.value)} />
          </div>
          <ul className="mt-3 space-y-1.5 text-sm">
            {data.byCategory.slice(0, 5).map((c, i) => (
              <li key={c.name} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-slate-700">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: ["#0e3d6e", "#ed1c24", "#fdc400", "#4f85b9", "#16a34a", "#8b5cf6"][i % 6] }} />
                  {c.name}
                </span>
                <span className="font-medium text-slate-900">{m(c.value)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <section className="card card-pad lg:col-span-2">
          <h2 className="mb-3 text-base font-semibold text-slate-900">Best-selling products</h2>
          <div className="h-64">
            <TopProductsChart data={data.topProducts} money={money} />
          </div>
        </section>
        <section className="card card-pad">
          <h2 className="mb-3 text-base font-semibold text-slate-900">Needs your attention</h2>
          <ul className="space-y-2.5 text-sm">
            <Attention href="/approvals" show={can(user, "returns.approve")} count={data.pendingApprovals} icon={Undo2} text="return / cancel requests to approve" />
            <Attention href="/credit" show count={k.debt.overdue > 0 ? 1 : 0} icon={AlertTriangle} text={`${m(k.debt.overdue)} owed past the due date`} hideCount />
            <Attention href="/inventory?status=out" show count={alerts.out.length} icon={Package} text="products out of stock" />
            <Attention href="/inventory?status=low" show count={alerts.low.length} icon={Scale} text="products running low" />
            {data.pendingApprovals + alerts.out.length + alerts.low.length === 0 && k.debt.overdue === 0 && <li className="rounded-lg bg-emerald-50 px-3 py-2.5 text-emerald-800">Nothing needs attention right now.</li>}
          </ul>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-base font-semibold text-slate-900">Latest sales</h2>
            <Link href="/sales" className="text-sm font-medium text-navy-700 hover:underline">
              View all
            </Link>
          </div>
          {data.recent.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">No sales yet. They appear here as soon as the shop makes one.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {data.recent.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Link href={`/sales/${s.id}`} className="font-medium text-navy-700 hover:underline">
                          {s.saleNo}
                        </Link>
                        <span className="block text-xs text-slate-500">{formatDateTime(s.createdAt)}</span>
                      </td>
                      <td className="hidden sm:table-cell">
                        {s.customer?.name ?? <span className="text-slate-400">Walk-in</span>}
                        <span className="block text-xs text-slate-500">by {s.salesperson.name}</span>
                      </td>
                      <td className="text-right font-semibold">{m(Number(s.total.minus(s.returnedTotal)))}</td>
                      <td className="text-right">
                        <SaleStatusBadge status={s.status} paymentStatus={s.paymentStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="space-y-4">
          <section className="card card-pad">
            <h2 className="mb-3 text-base font-semibold text-slate-900">Staff performance</h2>
            {data.staff.length === 0 ? (
              <p className="text-sm text-slate-500">No sales in this period.</p>
            ) : (
              <ul className="space-y-3">
                {data.staff.map((s) => {
                  const pct = data.staff[0]!.sales > 0 ? (s.sales / data.staff[0]!.sales) * 100 : 0;
                  return (
                    <li key={s.id}>
                      <Link href={`/sales?seller=${s.id}&${q}`} className="block">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-slate-800">{s.name}</span>
                          <span className="font-semibold text-slate-900">{m(s.sales)}</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-navy-600" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">{s.count} sale{s.count === 1 ? "" : "s"}</p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          {data.debtors.length > 0 && (
            <section className="card card-pad">
              <h2 className="mb-3 text-base font-semibold text-slate-900">Who owes the most</h2>
              <ul className="space-y-2 text-sm">
                {data.debtors.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2">
                    <Link href={`/customers/${d.id}`} className="truncate text-navy-700 hover:underline">
                      {d.name}
                    </Link>
                    <span className="shrink-0 font-semibold text-brand-red-dark">{m(d.owed)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function Attention({ href, show, count, icon: Icon, text, hideCount }: { href: string; show: boolean; count: number; icon: typeof Package; text: string; hideCount?: boolean }) {
  if (!show || count === 0) return null;
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 transition hover:border-navy-200 hover:bg-slate-50">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-red-soft text-brand-red-dark">
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

// ───────────────────────── Shop attendant ─────────────────────────

async function ShopDashboard({ user }: { user: SessionUser }) {
  const currency = await getCurrency();
  const m = (v: number | Prisma.Decimal) => formatMoney(v, currency);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date());
  const from = new Date(`${today}T00:00:00+03:00`);
  const to = new Date(`${today}T23:59:59.999+03:00`);
  const sells = can(user, "sales.pos") || can(user, "sales.view_own") || can(user, "sales.view_all");

  const [mySales, myPayments, pendingMine, alerts] = await Promise.all([
    sells ? db.sale.findMany({ where: { salespersonId: user.id, createdAt: { gte: from, lte: to } }, orderBy: { createdAt: "desc" }, include: { customer: { select: { name: true } } } }) : [],
    can(user, "payments.record") || sells ? db.payment.groupBy({ by: ["method"], where: { receivedById: user.id, receivedAt: { gte: from, lte: to } }, _sum: { amount: true } }) : [],
    can(user, "returns.create") ? db.saleReversal.count({ where: { requestedById: user.id, status: "PENDING" } }) : 0,
    can(user, "inventory.view") ? getStockAlerts(db) : null,
  ]);

  const active = mySales.filter((s) => s.status === "COMPLETED");
  const soldToday = active.reduce((s, x) => s.plus(x.total.minus(x.returnedTotal)), new Prisma.Decimal(0));
  const stillOwed = active.reduce((s, x) => s.plus(owedOf(x)), new Prisma.Decimal(0));
  const received = (method: string) => myPayments.find((p) => p.method === method)?._sum.amount ?? new Prisma.Decimal(0);
  const collected = myPayments.reduce((s, p) => s.plus(p._sum.amount ?? 0), new Prisma.Decimal(0));

  const actions = [
    can(user, "sales.pos") && { href: "/pos", icon: ShoppingCart, title: "New sale", text: "Sell to a customer", primary: true },
    can(user, "payments.record") && { href: "/customers", icon: Banknote, title: "Take a payment", text: "A customer pays a debt" },
    can(user, "inventory.receive") && { href: "/inventory/receiving", icon: PackageCheck, title: "Receive stock", text: "Check in a delivery" },
    can(user, "returns.create") && { href: "/sales", icon: Undo2, title: "Return an item", text: "Open the sale first" },
    can(user, "inventory.view") && { href: "/inventory", icon: Boxes, title: "View stock", text: "What is on the shelf" },
    can(user, "customers.view") && { href: "/customers", icon: Users, title: "Customers", text: "Find or add a customer" },
  ].filter(Boolean) as { href: string; icon: typeof Package; title: string; text: string; primary?: boolean }[];

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {greeting()}, {user.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Dar_es_Salaam" }).format(new Date())}</p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {actions.map((a) => (
          <Link key={a.title} href={a.href} className={cn("group flex items-center gap-4 rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-md sm:p-5", a.primary ? "col-span-2 border-navy-700 bg-navy-700 text-white lg:col-span-1" : "border-line bg-white")}>
            <span className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl", a.primary ? "bg-white/15 text-oil-400" : "bg-navy-50 text-navy-700")}>
              <a.icon size={28} />
            </span>
            <span className="min-w-0">
              <span className={cn("block text-lg font-bold leading-tight", a.primary ? "text-white" : "text-slate-900")}>{a.title}</span>
              <span className={cn("block text-sm", a.primary ? "text-navy-100" : "text-slate-500")}>{a.text}</span>
            </span>
          </Link>
        ))}
      </div>

      {sells && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatTile icon={Receipt} tone="navy" label="My sales today" value={m(soldToday)} hint={`${active.length} sale${active.length === 1 ? "" : "s"}`} href="/sales" />
          <StatTile icon={Wallet} tone="green" label="Money I received today" value={m(collected)} hint={`Cash ${m(received("CASH"))} · Mobile ${m(received("MOBILE_MONEY"))} · Bank ${m(received("BANK"))}`} />
          <StatTile icon={HandCoins} tone="red" label="Still unpaid on today's sales" value={m(stillOwed)} hint="Customers who took goods on credit" />
          <StatTile icon={Undo2} tone="yellow" label="My requests waiting" value={pendingMine} hint="Returns waiting for the manager" />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {alerts && (
          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="text-base font-semibold text-slate-900">Stock to watch</h2>
              <Link href="/inventory" className="text-sm font-medium text-navy-700 hover:underline">
                See all stock
              </Link>
            </div>
            {alerts.out.length + alerts.low.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">{alerts.active === 0 ? "No products have been added yet." : "Everything is in stock."}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {[...alerts.out.map((a) => ({ ...a, out: true })), ...alerts.low.map((a) => ({ ...a, out: false }))].slice(0, 7).map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-5 py-2.5">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-gradient-to-b from-white to-slate-100">
                      {a.imageV ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/product-image/${a.id}?size=thumb&v=${a.imageV}`} alt="" loading="lazy" className="h-full w-full object-contain" />
                      ) : (
                        <Package size={18} className="text-slate-300" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{a.name}</span>
                    <span className={a.out ? "badge-red" : "badge-yellow"}>{a.out ? "Out of stock" : `${Number(a.qty)} left`}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {sells && (
          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="text-base font-semibold text-slate-900">My latest sales</h2>
              <Link href="/sales" className="text-sm font-medium text-navy-700 hover:underline">
                History
              </Link>
            </div>
            {mySales.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">No sales yet today.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {mySales.slice(0, 7).map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <span className="min-w-0">
                      <Link href={`/sales/${s.id}`} className="font-medium text-navy-700 hover:underline">
                        {s.saleNo}
                      </Link>
                      <span className="block truncate text-xs text-slate-500">
                        {new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }).format(s.createdAt)} · {s.customer?.name ?? "Walk-in"}
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
        )}
      </div>
    </>
  );
}
