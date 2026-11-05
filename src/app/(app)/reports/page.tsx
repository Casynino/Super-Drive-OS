import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Download, Info, TrendingUp } from "lucide-react";
import StatTile from "@/components/dashboard/StatTile";
import { DonutChart, SalesTrendChart, TopProductsChart } from "@/components/dashboard/Charts";
import { EmptyState, PageHeader } from "@/components/ui";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { PRESETS, financeAnalytics, insights, inventoryAnalytics, reportRange, salesAnalytics, type Grain } from "@/lib/reports/analytics";
import { getSupplierBalances } from "@/lib/cash/supplier";
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

  return (
    <>
      <PageHeader title="Reports" description={`How the business is doing · ${r.label} (${formatDate(`${r.fromYmd}T00:00:00Z`)} to ${formatDate(`${r.toYmd}T00:00:00Z`)}). Every figure comes from recorded transactions.`} />

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
              <div className="h-52">
                <DonutChart data={sales.byCategory} money={money} centre={m(t.sales)} />
              </div>
            </section>
          </div>
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
              <div className="h-72">
                <TopProductsChart data={sales.byProduct.slice(0, 8).map((p) => ({ name: p.name, value: p.revenue }))} money={money} />
              </div>
            </section>
            <section className="card card-pad">
              <h2 className="mb-3 text-base font-semibold text-slate-900">Sales by day of the week</h2>
              <div className="h-72">
                <TopProductsChart data={sales.weekday} money={money} empty="No sales in this period yet" />
              </div>
            </section>
            <section className="card card-pad">
              <h2 className="mb-3 text-base font-semibold text-slate-900">Sales by employee</h2>
              <div className="h-56">
                <TopProductsChart data={sales.byEmployee.map((e) => ({ name: e.name, value: e.sales }))} money={money} empty="No sales in this period yet" />
              </div>
            </section>
            <section className="card card-pad">
              <h2 className="mb-3 text-base font-semibold text-slate-900">Sales by category</h2>
              <div className="h-56">
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
            <StatTile icon={Users} tone="yellow" label="Held by resellers" value={`${inv.resellerItems.toFixed(0)} items`} hint="Still ours, off the shelf" href="/resellers" />
            {inv.totalValue !== null ? <StatTile icon={Wallet} tone="green" label="Stock value" value={m(inv.totalValue)} hint="Shelf and resellers, at average cost" /> : <StatTile icon={Wallet} tone="slate" label="Products" value={inv.list.length} />}
            <StatTile icon={AlertTriangle} tone={inv.dead.length ? "red" : "slate"} label="Dead stock" value={inv.dead.length} hint="No sale in 60 days" />
          </div>

          <div className="mb-5 grid gap-4 lg:grid-cols-2">
            <ListCard title="Selling fastest (last 30 days)" rows={inv.fast.map((p) => [p.name, `${p.sold30.toFixed(0)} sold`, p.cover !== null ? `~${Math.max(1, Math.round(p.cover))} days of stock` : ""])} empty="No sales in the last 30 days." note="Days of stock is an estimate from the last 30 days." />
            <ListCard title="Selling slowest (stock on the shelf)" rows={inv.slow.map((p) => [p.name, `${p.sold30.toFixed(0)} sold`, `${p.shelf.toFixed(0)} ${p.symbol} on shelf`])} empty="Nothing on the shelf." />
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
                    <th className="hidden text-right sm:table-cell">With resellers</th>
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

          <div className="mb-5 grid gap-4 lg:grid-cols-2">
            <section className="card card-pad">
              <h2 className="mb-3 text-base font-semibold text-slate-900">Who owes us</h2>
              <dl className="space-y-3 text-sm">
                <div className="flex items-center justify-between"><dt className="text-slate-600">Customers</dt><dd className="font-semibold tabular-nums">{m(fin.customerOwed)} {fin.customerOverdue > 0 && <span className="badge-red ml-2">{m(fin.customerOverdue)} overdue</span>}</dd></div>
                <div className="flex items-center justify-between"><dt className="text-slate-600">Resellers</dt><dd className="font-semibold tabular-nums">{m(fin.resellerOwed)} {fin.resellerOverdue > 0 && <span className="badge-red ml-2">{m(fin.resellerOverdue)} overdue</span>}</dd></div>
                <div className="flex items-center justify-between border-t border-line pt-3"><dt className="text-slate-600">Supplier obligations</dt><dd className="font-semibold tabular-nums">{m(supplierOwed)}</dd></div>
              </dl>
            </section>
            <section className="card card-pad">
              <h2 className="mb-3 text-base font-semibold text-slate-900">Expenses by category</h2>
              <div className="h-52">
                <TopProductsChart data={fin.expenses} money={money} empty="No approved expenses in this period" label="Spent" />
              </div>
            </section>
          </div>

          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Cash flow</h2>
                <p className="text-xs text-slate-500">Money in {m(fin.flowIn)} · money out {m(fin.flowOut)}. Moves between your own accounts (bank deposits, closing differences) are included.</p>
              </div>
              <Link href={exportHref("expenses")} className="btn-secondary btn-sm">
                <Download size={14} /> Expenses CSV
              </Link>
            </div>
            {fin.flow.length === 0 ? (
              <EmptyState icon={<Banknote size={22} />} title="No money moved in this period" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>What</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fin.flow.sort((a, b) => a.method.localeCompare(b.method) || b.value - a.value).map((f) => (
                      <tr key={`${f.method}-${f.type}`}>
                        <td>{ACCOUNT_NAME[f.method as PaymentMethod]}</td>
                        <td>{TX_LABEL[f.type as CashTxType]}</td>
                        <td className={cn("text-right tabular-nums", f.value >= 0 ? "text-emerald-700" : "text-brand-red-dark")}>{f.value >= 0 ? "+" : "−"} {m(Math.abs(f.value))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
