import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Download, ExternalLink, FileText, Info, Printer, TrendingUp } from "lucide-react";
import StatTile from "@/components/dashboard/StatTile";
import { DonutChart, SalesTrendChart, TopProductsChart } from "@/components/dashboard/Charts";
import { EmptyState, PageHeader } from "@/components/ui";
import HealthPanel from "@/components/reports/HealthPanel";
import BarList from "@/components/reports/BarList";
import { computeHealth, healthInputFrom } from "@/lib/reports/health";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { PRESETS, financeAnalytics, insights, inventoryAnalytics, reportRange, salesAnalytics, type Grain } from "@/lib/reports/analytics";
import { getSupplierBalances } from "@/lib/cash/supplier";
import { businessDay } from "@/lib/cash/ledger";
import { shiftDay } from "@/lib/reports/period";
import { getCurrency } from "@/lib/settings";
import { ACCOUNT_NAME, TX_LABEL } from "@/lib/cash/ledger";
import { cn, formatDate } from "@/lib/utils";
import type { PaymentMethod, CashTxType } from "@/generated/prisma/client";
import { Banknote, Boxes, ChartColumn, Receipt, Users, Wallet } from "lucide-react";

export const metadata = { title: "Reports" };

type Search = { tab?: string; range?: string; from?: string; to?: string; grain?: string };
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "sales", label: "Sales" },
  { key: "inventory", label: "Inventory" },
  { key: "finance", label: "Money" },
] as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (!canAny(user, ["reports.view", "reports.financial"])) redirect("/forbidden");
  const financials = can(user, "reports.financial");
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "overview";
  const grain: Grain = sp.grain === "week" || sp.grain === "month" ? sp.grain : "day";
  const r = reportRange(sp);
  const currency = await getCurrency();
  const money = { symbol: currency.symbol, decimals: currency.decimals };
  const m = (v: number) => formatMoney(v, currency);

  const [sales, inv, fin] = await Promise.all([salesAnalytics(db, r, grain, financials), inventoryAnalytics(db, financials), financeAnalytics(db, r)]);
  const notes = await insights(db, sales, inv, fin, r);
  const supplierOwed = (await getSupplierBalances(db)).reduce((t, x) => t + Math.max(0, x.owed), 0);
  const q = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | undefined> = { tab: sp.tab, range: sp.range, from: sp.from, to: sp.to, grain: sp.grain, ...extra };
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    return `/reports?${p.toString()}`;
  };
  const exportHref = (type: string) => `/reports/export?type=${type}&from=${r.fromYmd}&to=${r.toYmd}`;
  const change = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);
  const t = sales.totals;
  const net = financials && t.profit !== null ? t.profit - fin.expenseTotal : null;
  const health = computeHealth(healthInputFrom(sales, inv, fin), m);

  return (
    <>
      <PageHeader title="Reports" description={`How the business is doing · ${r.label}`} />

      {(() => {
        // reports as paper documents: open them, download them as PDF or print them
        const today = businessDay();
        const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
        const weekStart = shiftDay(today, -((dow + 6) % 7));
        const monthStart = `${today.slice(0, 8)}01`;
        const lastMonthEnd = shiftDay(monthStart, -1);
        const short = (ymd: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));
        const ready = [
          { label: `Selected: ${r.label}`, sub: "", from: r.fromYmd, to: r.toYmd },
          { label: "This week", sub: "", from: weekStart, to: today },
          { label: "Last week", sub: "", from: shiftDay(weekStart, -7), to: shiftDay(weekStart, -1) },
          { label: "This month", sub: "", from: monthStart, to: today },
          { label: "Last month", sub: "", from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd },
        ];
        const href = (from: string, to: string, extra = "") => `/print/report?from=${from}&to=${to}${extra}`;
        return (
          <section className="card mb-5 overflow-hidden" aria-label="Make a report">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <FileText size={17} /> Make a report
              </h2>
              <p className="text-xs text-slate-500">Business health, sales and growth, products, money, expenses, customers and cash, as a document</p>
            </div>
            <ul className="grid grid-cols-2 gap-px bg-line lg:grid-cols-5">
              {ready.map((x) => (
                <li key={x.label} className="bg-[var(--card)] px-4 py-4 first:col-span-2 sm:px-5 lg:first:col-span-1">
                  <p className="text-sm font-semibold text-slate-900">{x.label}</p>
                  <p className="text-xs text-slate-500">
                    {short(x.from)} – {short(x.to)}
                    {x.sub ? ` · ${x.sub}` : ""}
                  </p>
                  <div className="mt-3 inline-flex overflow-hidden rounded-lg border border-line bg-white text-xs font-medium text-slate-700">
                    <Link href={href(x.from, x.to)} target="_blank" className="inline-flex items-center gap-1.5 px-3 py-2 transition hover:bg-slate-50 sm:py-1.5">
                      <ExternalLink size={13} /> Open
                    </Link>
                    <Link href={href(x.from, x.to, "&print=1&save=1")} target="_blank" className="inline-flex items-center border-l border-line px-2.5 py-2 transition hover:bg-slate-50 sm:py-1.5" title="Download as PDF" aria-label={`Download ${x.label} as PDF`}>
                      <Download size={14} />
                    </Link>
                    <Link href={href(x.from, x.to, "&print=1")} target="_blank" className="inline-flex items-center border-l border-line px-2.5 py-2 transition hover:bg-slate-50 sm:py-1.5" title="Print" aria-label={`Print ${x.label}`}>
                      <Printer size={14} />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
            <form method="get" action="/print/report" target="_blank" className="flex flex-wrap items-end gap-3 border-t border-line bg-slate-50/60 px-4 py-3 sm:px-5">
              <span className="pb-2 text-sm font-medium text-slate-700 max-sm:w-full">Any dates</span>
              <label className="text-xs text-slate-500 max-sm:min-w-[8.5rem] max-sm:flex-1">
                From
                <input type="date" name="from" defaultValue={weekStart} max={today} className="input mt-1 block w-full" />
              </label>
              <label className="text-xs text-slate-500 max-sm:min-w-[8.5rem] max-sm:flex-1">
                To
                <input type="date" name="to" defaultValue={today} max={today} className="input mt-1 block w-full" />
              </label>
              <div className="inline-flex overflow-hidden rounded-lg border border-line bg-white text-xs font-medium text-slate-700">
                <button type="submit" className="inline-flex items-center gap-1.5 px-3 py-2 transition hover:bg-slate-50 sm:py-1.5">
                  <ExternalLink size={13} /> Open
                </button>
                <button type="submit" name="save" value="1" className="inline-flex items-center border-l border-line px-2.5 py-2 transition hover:bg-slate-50 sm:py-1.5" title="Download as PDF" aria-label="Download as PDF">
                  <Download size={14} />
                </button>
                <button type="submit" name="print" value="1" className="inline-flex items-center border-l border-line px-2.5 py-2 transition hover:bg-slate-50 sm:py-1.5" title="Print" aria-label="Print">
                  <Printer size={14} />
                </button>
              </div>
            </form>
          </section>
        );
      })()}

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1 rounded-xl bg-white p-1 shadow-[0_1px_2px_rgba(15,27,45,0.06)] ring-1 ring-line" aria-label="Report">
          {TABS.filter((x) => x.key !== "finance" || financials || can(user, "reports.view")).map((x) => (
            <Link key={x.key} href={q({ tab: x.key })} className={cn("rounded-lg px-3.5 py-1.5 text-sm font-medium transition", tab === x.key ? "bg-navy-700 text-white" : "text-slate-600 hover:bg-slate-100")}>
              {x.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <nav className="flex flex-wrap gap-1 text-sm" aria-label="Period">
            {PRESETS.map((p) => (
              <Link key={p.key} href={q({ range: p.key, from: "", to: "" })} className={cn("rounded-full px-3 py-1", !sp.from && (sp.range ?? "30d") === p.key ? "bg-navy-700 text-white" : "bg-white text-slate-600 ring-1 ring-line hover:bg-slate-50")}>
                {p.label}
              </Link>
            ))}
          </nav>
          <form method="get" className="flex items-center gap-1.5 text-sm">
            <input type="hidden" name="tab" value={tab} />
            <input type="date" name="from" defaultValue={sp.from ?? ""} className="input h-8 w-36 px-2 py-0 text-sm" aria-label="From date" />
            <span className="text-slate-400">–</span>
            <input type="date" name="to" defaultValue={sp.to ?? ""} className="input h-8 w-36 px-2 py-0 text-sm" aria-label="To date" />
            <button className="btn-secondary btn-sm" type="submit">
              Go
            </button>
          </form>
        </div>
      </div>

      {tab === "overview" && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatTile icon={Receipt} tone="navy" label="Sales" value={m(t.sales)} change={change(t.sales, t.prevSales)} hint={`${t.count} transactions · avg ${m(t.avg)}`} />
            {t.profit !== null ? <StatTile icon={TrendingUp} tone="green" label="Gross profit" value={m(t.profit)} hint={t.sales > 0 ? `${((t.profit / t.sales) * 100).toFixed(1)}% of sales` : undefined} /> : <StatTile icon={Users} tone="green" label="Credit given" value={m(t.creditGiven)} hint="Not paid at the time of sale" />}
            <StatTile icon={Wallet} tone="yellow" label="Expenses" value={m(fin.expenseTotal)} hint="Approved expenses" />
            <StatTile icon={Banknote} tone={net !== null && net < 0 ? "red" : "slate"} label={net !== null ? "After expenses" : "Cash in the period"} value={m(net !== null ? net : fin.flowIn)} hint={net !== null ? "Gross profit minus expenses" : `Out ${m(fin.flowOut)}`} />
          </div>

          <HealthPanel health={health} />

          <section className="card card-pad mb-5">
            <h2 className="mb-3 text-base font-semibold text-slate-900">What stands out</h2>
            <ul className="space-y-2.5 text-sm">
              {notes.map((n, i) => (
                <li key={i} className={cn("flex items-start gap-2.5 rounded-lg px-3 py-2.5", n.tone === "good" ? "bg-emerald-50 text-emerald-900" : n.tone === "warn" ? "bg-oil-soft text-yellow-950" : "bg-slate-50 text-slate-700")}>
                  {n.tone === "warn" ? <AlertTriangle size={16} className="mt-0.5 shrink-0" /> : n.tone === "good" ? <TrendingUp size={16} className="mt-0.5 shrink-0" /> : <Info size={16} className="mt-0.5 shrink-0" />}
                  <span>
                    {n.text}
                    {n.estimate && <span className="ml-2 rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-black/5">estimate</span>}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">Observations are calculated from your records. Items marked &ldquo;estimate&rdquo; are projections from recent sales, not facts.</p>
          </section>

          <div className="grid gap-4 lg:grid-cols-3">
            <section className="card card-pad lg:col-span-2">
              <h2 className="mb-3 text-base font-semibold text-slate-900">Sales over time</h2>
              <div className="h-64">
                <SalesTrendChart data={sales.series} money={money} />
              </div>
            </section>
            <section className="card card-pad">
              <h2 className="mb-3 text-base font-semibold text-slate-900">Sales by category</h2>
              <div className="h-80">
                <DonutChart data={sales.byCategory} money={money} centre={m(t.sales)} />
              </div>
            </section>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <section className="card card-pad">
              <h2 className="mb-3 text-base font-semibold text-slate-900">Best-selling products</h2>
              <BarList rows={sales.byProduct.slice(0, 6).map((p) => ({ label: p.name, value: p.revenue, text: m(p.revenue) }))} empty="No sales in this period yet" />
            </section>
            <section className="card card-pad">
              <h2 className="mb-3 text-base font-semibold text-slate-900">Busiest days of the week</h2>
              <BarList rows={[...sales.weekday].sort((a, b) => b.value - a.value).map((d) => ({ label: d.name, value: d.value, text: m(d.value) }))} empty="No sales in this period yet" />
            </section>
            <section className="card card-pad">
              <h2 className="mb-3 text-base font-semibold text-slate-900">Where the money went</h2>
              <div className="h-80">
                <DonutChart data={fin.expenses} money={money} centre={m(fin.expenseTotal)} />
              </div>
            </section>
          </div>

          <section className="card mt-4 overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
              <h2 className="text-base font-semibold text-slate-900">Products at a glance</h2>
              <Link href={q({ tab: "sales" })} className="text-sm font-medium text-navy-700 hover:underline">
                All products
              </Link>
            </div>
            {sales.byProduct.length === 0 ? (
              <EmptyState icon={<Receipt size={22} />} title="No sales in this period" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="text-right">Units</th>
                      <th className="text-right">Sales</th>
                      <th className="hidden text-right sm:table-cell">Share</th>
                      {financials && <th className="text-right">Profit</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sales.byProduct.slice(0, 8).map((p) => (
                      <tr key={p.id}>
                        <td className="font-medium">{p.name}</td>
                        <td className="text-right tabular-nums">{p.qty.toFixed(0)}</td>
                        <td className="text-right tabular-nums">{m(p.revenue)}</td>
                        <td className="hidden text-right tabular-nums text-slate-500 sm:table-cell">{t.sales > 0 ? `${((p.revenue / t.sales) * 100).toFixed(0)}%` : "—"}</td>
                        {financials && <td className="text-right tabular-nums">{m(p.profit ?? 0)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {tab === "sales" && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatTile icon={Receipt} tone="navy" label="Sales" value={m(t.sales)} change={change(t.sales, t.prevSales)} />
            <StatTile icon={ChartColumn} tone="green" label="Transactions" value={t.count} change={change(t.count, t.prevCount)} hint={`Average ${m(t.avg)}`} />
            <StatTile icon={Wallet} tone="yellow" label="Paid at the time of sale" value={m(Math.max(0, t.sales - t.creditGiven))} hint="Cash, mobile money, bank" />
            <StatTile icon={Users} tone="red" label="Given on credit" value={m(t.creditGiven)} hint={t.sales > 0 ? `${((t.creditGiven / t.sales) * 100).toFixed(0)}% of sales` : undefined} />
          </div>

          <section className="card card-pad mb-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">Sales by {grain}</h2>
              <div className="flex gap-1 text-sm">
                {(["day", "week", "month"] as const).map((g) => (
                  <Link key={g} href={q({ tab: "sales", grain: g })} className={cn("rounded-full px-3 py-1", grain === g ? "bg-navy-700 text-white" : "bg-white text-slate-600 ring-1 ring-line hover:bg-slate-50")}>
                    {g === "day" ? "Daily" : g === "week" ? "Weekly" : "Monthly"}
                  </Link>
                ))}
              </div>
            </div>
            <div className="h-64">
              <SalesTrendChart data={sales.series} money={money} />
            </div>
          </section>

          <div className="mb-5 grid gap-4 lg:grid-cols-2">
            <section className="card card-pad">
              <h2 className="mb-3 text-base font-semibold text-slate-900">Best-selling products</h2>
              <BarList rows={sales.byProduct.slice(0, 8).map((p) => ({ label: p.name, value: p.revenue, text: m(p.revenue), note: t.sales > 0 ? `${((p.revenue / t.sales) * 100).toFixed(0)}% of sales` : undefined }))} empty="No sales in this period yet" />
            </section>
            <section className="card card-pad">
              <h2 className="mb-3 text-base font-semibold text-slate-900">Sales by day of the week</h2>
              <BarList rows={[...sales.weekday].sort((a, b) => b.value - a.value).map((d) => ({ label: d.name, value: d.value, text: m(d.value) }))} empty="No sales in this period yet" />
            </section>
            <section className="card card-pad">
              <h2 className="mb-3 text-base font-semibold text-slate-900">Sales by employee</h2>
              <BarList rows={sales.byEmployee.map((e) => ({ label: e.name, value: e.sales, text: m(e.sales), note: `${e.count} sale${e.count === 1 ? "" : "s"}` }))} empty="No sales in this period yet" />
            </section>
            <section className="card card-pad">
              <h2 className="mb-3 text-base font-semibold text-slate-900">Sales by category</h2>
              <div className="h-80">
                <DonutChart data={sales.byCategory} money={money} centre={m(t.sales)} />
              </div>
            </section>
          </div>

          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
              <h2 className="text-base font-semibold text-slate-900">Products sold</h2>
              <Link href={exportHref("products")} className="btn-secondary btn-sm">
                <Download size={14} /> Download CSV
              </Link>
            </div>
            {sales.byProduct.length === 0 ? (
              <EmptyState icon={<Receipt size={22} />} title="No sales in this period" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="text-right">Units</th>
                      <th className="text-right">Sales</th>
                      {financials && <th className="text-right">Profit</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sales.byProduct.map((p) => (
                      <tr key={p.id}>
                        <td className="font-medium">{p.name}</td>
                        <td className="text-right tabular-nums">{p.qty.toFixed(0)}</td>
                        <td className="text-right tabular-nums">{m(p.revenue)}</td>
                        {financials && <td className="text-right tabular-nums">{m(p.profit ?? 0)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {tab === "inventory" && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatTile icon={Boxes} tone="navy" label="On the shelf" value={`${inv.shelfItems.toFixed(0)} items`} hint={`${inv.low.length} low · ${inv.out.length} out of stock`} />
            <StatTile icon={Users} tone="yellow" label="Held by winga" value={`${inv.resellerItems.toFixed(0)} items`} hint="Still ours, off the shelf" href="/resellers" />
            {inv.totalValue !== null ? <StatTile icon={Wallet} tone="green" label="Stock value" value={m(inv.totalValue)} hint="Shelf and winga, at average cost" /> : <StatTile icon={Wallet} tone="slate" label="Products" value={inv.list.length} />}
            <StatTile icon={AlertTriangle} tone={inv.dead.length ? "red" : "slate"} label="Dead stock" value={inv.dead.length} hint="No sale in 60 days" />
          </div>

          <div className="mb-5 grid gap-4 lg:grid-cols-3">
            <section className="card card-pad">
              <h2 className="mb-3 text-base font-semibold text-slate-900">Stock health</h2>
              <div className="h-80">
                <DonutChart
                  data={[
                    { name: "In stock", value: Math.max(inv.list.length - inv.low.length - inv.out.length, 0) },
                    { name: "Running low", value: inv.low.length },
                    { name: "Out of stock", value: inv.out.length },
                  ].filter((x) => x.value > 0)}
                  money={{ symbol: "", decimals: 0 }}
                  centre={`${inv.list.length} products`}
                />
              </div>
            </section>
            <section className="card card-pad">
              <h2 className="mb-0.5 text-base font-semibold text-slate-900">Selling fastest</h2>
              <p className="mb-3 text-xs text-slate-500">Units sold in the last 30 days</p>
              <BarList tone="green" rows={inv.fast.map((p) => ({ label: p.name, value: p.sold30, text: `${p.sold30.toFixed(0)} sold`, note: p.cover !== null ? `about ${Math.max(1, Math.round(p.cover))} days of stock left` : undefined, warn: p.cover !== null && p.cover <= 7 }))} empty="No sales in the last 30 days." />
            </section>
            <section className="card card-pad">
              <h2 className="mb-0.5 text-base font-semibold text-slate-900">Selling slowest</h2>
              <p className="mb-3 text-xs text-slate-500">Stock on the shelf that moves least</p>
              <BarList tone="red" highlightFirst={false} rows={inv.slow.map((p) => ({ label: p.name, value: p.shelf, text: `${p.shelf.toFixed(0)} ${p.symbol}`, note: `${p.sold30.toFixed(0)} sold in 30 days` }))} empty="Nothing on the shelf." />
            </section>
          </div>

          <div className="mb-5 grid gap-4 lg:grid-cols-2">
            <ListCard title="Dead stock" rows={inv.dead.map((p) => [p.name, p.lastSale ? `last sold ${inv.age(p.lastSale)} days ago` : "never sold", `${p.shelf.toFixed(0)} ${p.symbol}`])} empty="No dead stock." />
            <ListCard title="Often running out (last 90 days)" rows={inv.frequentlyOut.map((p) => [p.name, `${p.stockouts90} times`, ""])} empty="Nothing ran out repeatedly." />
          </div>

          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
              <h2 className="text-base font-semibold text-slate-900">Stock position</h2>
              <Link href={exportHref("stock")} className="btn-secondary btn-sm">
                <Download size={14} /> Download CSV
              </Link>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="text-right">On shelf</th>
                    <th className="hidden text-right sm:table-cell">With winga</th>
                    <th className="hidden text-right md:table-cell">Sold (30 days)</th>
                    <th className="hidden text-right md:table-cell">Last sale</th>
                    {inv.totalValue !== null && <th className="hidden text-right lg:table-cell">Value</th>}
                  </tr>
                </thead>
                <tbody>
                  {inv.list.map((p) => (
                    <tr key={p.id}>
                      <td className="font-medium">{p.name}</td>
                      <td className={cn("text-right tabular-nums", p.shelf <= 0 && "font-semibold text-brand-red-dark")}>{p.shelf.toFixed(0)} {p.symbol}</td>
                      <td className="hidden text-right tabular-nums sm:table-cell">{p.withResellers > 0 ? p.withResellers.toFixed(0) : "—"}</td>
                      <td className="hidden text-right tabular-nums md:table-cell">{p.sold30.toFixed(0)}</td>
                      <td className="hidden whitespace-nowrap text-right text-slate-600 md:table-cell">{p.lastSale ? formatDate(p.lastSale) : "never"}</td>
                      {inv.totalValue !== null && <td className="hidden text-right tabular-nums lg:table-cell">{m(p.value ?? 0)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {tab === "finance" && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatTile icon={Receipt} tone="navy" label="Revenue" value={m(t.sales)} hint="Sales after returns" />
            {financials && t.profit !== null ? <StatTile icon={TrendingUp} tone="green" label="Gross profit" value={m(t.profit)} hint={`Cost of goods sold ${m(t.cogs ?? 0)}`} /> : <StatTile icon={Users} tone="slate" label="Credit given" value={m(t.creditGiven)} />}
            <StatTile icon={Wallet} tone="yellow" label="Operating expenses" value={m(fin.expenseTotal)} />
            <StatTile icon={Banknote} tone={net !== null && net < 0 ? "red" : "green"} label="Net operating result" value={net !== null ? m(net) : "—"} hint={net === null ? "Needs permission to see profit" : "Profit minus expenses (before supplier costs not yet paid)"} />
          </div>

          <div className="mb-5 grid gap-4 lg:grid-cols-3">
            <section className="card card-pad">
              <h2 className="mb-0.5 text-base font-semibold text-slate-900">Who owes us</h2>
              <p className="mb-3 text-xs text-slate-500">And what we owe suppliers, today</p>
              <BarList
                highlightFirst={false}
                tone="navy"
                rows={[
                  { label: "Customers", value: fin.customerOwed, text: m(fin.customerOwed), note: fin.customerOverdue > 0 ? `${m(fin.customerOverdue)} past the due date` : undefined, warn: true },
                  { label: "Winga", value: fin.resellerOwed, text: m(fin.resellerOwed), note: fin.resellerOverdue > 0 ? `${m(fin.resellerOverdue)} past the settlement date` : undefined, warn: true },
                  { label: "Suppliers (we owe)", value: supplierOwed, text: m(supplierOwed) },
                ]}
              />
            </section>
            <section className="card card-pad">
              <h2 className="mb-0.5 text-base font-semibold text-slate-900">Expenses by category</h2>
              <p className="mb-3 text-xs text-slate-500">{m(fin.expenseTotal)} spent in this period</p>
              <BarList rows={fin.expenses.map((e) => ({ label: e.name, value: e.value, text: m(e.value), note: fin.expenseTotal > 0 ? `${((e.value / fin.expenseTotal) * 100).toFixed(0)}% of expenses` : undefined }))} empty="No approved expenses in this period" />
            </section>
            <section className="card card-pad">
              <h2 className="mb-0.5 text-base font-semibold text-slate-900">Where the money came in</h2>
              <p className="mb-3 text-xs text-slate-500">{m(fin.flowIn)} in, {m(fin.flowOut)} out</p>
              <div className="h-80">
                <DonutChart
                  data={(["CASH", "MOBILE_MONEY", "BANK"] as const).map((meth) => ({ name: ACCOUNT_NAME[meth], value: fin.flow.filter((f) => f.method === meth && f.value > 0).reduce((t, f) => t + f.value, 0) })).filter((x) => x.value > 0)}
                  money={money}
                  centre={m(fin.flowIn)}
                />
              </div>
            </section>
          </div>

          <section aria-label="Cash flow">
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Cash flow by account</h2>
                <p className="text-xs text-slate-500">Moves between your own accounts (bank deposits, closing differences) are included.</p>
              </div>
              <Link href={exportHref("expenses")} className="btn-secondary btn-sm">
                <Download size={14} /> Expenses CSV
              </Link>
            </div>
            {fin.flow.length === 0 ? (
              <div className="card">
                <EmptyState icon={<Banknote size={22} />} title="No money moved in this period" />
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-3">
                {(["CASH", "MOBILE_MONEY", "BANK"] as const).map((meth) => {
                  const lines = fin.flow.filter((f) => f.method === meth).sort((a, b) => b.value - a.value);
                  const inn = lines.filter((f) => f.value > 0).reduce((t, f) => t + f.value, 0);
                  const out = lines.filter((f) => f.value < 0).reduce((t, f) => t - f.value, 0);
                  return (
                    <div key={meth} className="card overflow-hidden">
                      <div className="border-b border-line px-4 py-3 sm:px-5">
                        <div className="flex items-baseline justify-between gap-3">
                          <h3 className="text-base font-semibold text-slate-900">{ACCOUNT_NAME[meth]}</h3>
                          <p className={cn("text-base font-bold tabular-nums", inn - out >= 0 ? "text-emerald-600" : "text-brand-red-dark")}>
                            {inn - out >= 0 ? "+" : "−"} {m(Math.abs(inn - out))}
                          </p>
                        </div>
                        <p className="text-xs text-slate-500">
                          {m(inn)} in · {m(out)} out
                        </p>
                      </div>
                      {lines.length === 0 ? (
                        <p className="px-5 py-6 text-center text-sm text-slate-500">Nothing moved.</p>
                      ) : (
                        <ul className="divide-y divide-line">
                          {lines.map((f) => (
                            <li key={f.type} className="flex items-center justify-between gap-3 px-4 py-2 text-sm sm:px-5">
                              <span className="text-slate-700">{TX_LABEL[f.type as CashTxType]}</span>
                              <span className={cn("shrink-0 font-medium tabular-nums", f.value >= 0 ? "text-emerald-600" : "text-brand-red-dark")}>
                                {f.value >= 0 ? "+" : "−"} {m(Math.abs(f.value))}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

function ListCard({ title, rows, empty, note }: { title: string; rows: string[][]; empty: string; note?: string }) {
  return (
    <section className="card card-pad">
      <h2 className="mb-3 text-base font-semibold text-slate-900">{title}</h2>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {rows.map(([name, a, b], i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate font-medium text-slate-900">{name}</span>
              <span className="shrink-0 text-right text-slate-600">
                {a}
                {b && <span className="ml-2 text-xs text-slate-400">{b}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="mt-2 text-xs text-slate-500">{note}</p>}
    </section>
  );
}
