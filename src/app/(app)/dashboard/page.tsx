import { qtyText } from "@/lib/qty";
import { getUnitMode } from "@/lib/unit-mode";
import Link from "next/link";
import { CalendarCheck, Handshake, Banknote, Boxes, HandCoins, Package, PackageCheck, Receipt, ReceiptText, ShoppingCart, Undo2, Users, Wallet } from "lucide-react";
import StatTile from "@/components/dashboard/StatTile";
import { SaleStatusBadge } from "../sales/StatusBadge";
import OwnerHome from "./OwnerHome";
import { Prisma } from "@/generated/prisma/client";
import { can } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import type { SessionUser } from "@/lib/auth/session";
import { unclosedDays } from "@/lib/cash/closing";
import { businessDay, dayToDate, defaultLocationId } from "@/lib/cash/ledger";
import { db } from "@/lib/db";
import { getStockAlerts } from "@/lib/inventory/alerts";
import { formatMoney } from "@/lib/money";
import { owedOf } from "@/lib/sales/owed";
import { getCurrency } from "@/lib/settings";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

const greeting = () => {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Dar_es_Salaam" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  // The people who run the business see the management dashboard; shop staff get the shop dashboard.
  return can(user, "dashboard.view") ? <OwnerHome user={user} /> : <ShopDashboard user={user} />;
}

// ───────────────────────── Shop attendant ─────────────────────────

async function ShopDashboard({ user }: { user: SessionUser }) {
  const unitMode = await getUnitMode();
  const currency = await getCurrency();
  const m = (v: number | Prisma.Decimal) => formatMoney(v, currency);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date());
  const from = new Date(`${today}T00:00:00+03:00`);
  const to = new Date(`${today}T23:59:59.999+03:00`);
  const sells = can(user, "sales.pos") || can(user, "sales.view_own") || can(user, "sales.view_all");

  const incoming = can(user, "shipments.receive") ? await db.shipment.count({ where: { status: { in: ["EXPECTED", "PARTIAL"] }, arrivedAt: { not: null } } }) : 0;
  const closedToday = can(user, "closing.submit") ? await db.dailyClosing.findFirst({ where: { businessDate: dayToDate(businessDay()) }, select: { id: true } }) : null;
  const pendingExpensesMine = can(user, "expenses.create") ? await db.expense.count({ where: { requestedById: user.id, status: "PENDING" } }) : 0;
  const hourNow = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Dar_es_Salaam" }).format(new Date()));
  const [shelf, spentToday, recentReceipts, recentIssues, recentPays, recentSpend, olderOpen] = await Promise.all([
    can(user, "inventory.view") ? db.stockBalance.aggregate({ where: { location: { type: { not: "RESELLER" } } }, _sum: { quantity: true } }) : null,
    can(user, "expenses.create") ? db.expense.aggregate({ where: { requestedById: user.id, status: "APPROVED", expenseDate: dayToDate(today) }, _sum: { amount: true } }) : null,
    can(user, "inventory.view") ? db.stockReceipt.findMany({ where: { createdAt: { gte: from, lte: to } }, orderBy: { createdAt: "desc" }, take: 4, select: { id: true, receiptNo: true, createdAt: true, items: { select: { product: { select: { name: true } } }, take: 2 } } }) : [],
    can(user, "resellers.view") ? db.resellerIssue.findMany({ where: { createdAt: { gte: from, lte: to } }, orderBy: { createdAt: "desc" }, take: 4, select: { id: true, issueNo: true, createdAt: true, reseller: { select: { name: true } } } }) : [],
    can(user, "payments.record") ? db.payment.findMany({ where: { source: "DEBT_COLLECTION", receivedById: user.id, receivedAt: { gte: from, lte: to } }, orderBy: { receivedAt: "desc" }, take: 4, select: { id: true, paymentNo: true, amount: true, receivedAt: true, customer: { select: { name: true } } } }) : [],
    can(user, "expenses.create") ? db.expense.findMany({ where: { requestedById: user.id, requestedAt: { gte: from, lte: to } }, orderBy: { requestedAt: "desc" }, take: 4, select: { id: true, expenseNo: true, amount: true, requestedAt: true, status: true, category: { select: { name: true } } } }) : [],
    can(user, "closing.submit") ? unclosedDays(db, await defaultLocationId(db), today) : [],
  ]);
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

  const onCredit = active.filter((x) => owedOf(x).gt(0));
  const canClose = can(user, "closing.submit");
  const shopStatus = !canClose ? null : closedToday ? ({ label: "CLOSED", text: "Today is closed. Anything new goes into tomorrow's closing.", tone: "closed" } as const) : olderOpen.length > 0 || hourNow >= 18 ? ({ label: "AWAITING DAILY CLOSING", text: olderOpen.length > 0 ? "An earlier day was never closed. Close the day when you are ready." : "Count the cash and close the day when you finish.", tone: "awaiting" } as const) : ({ label: "OPEN", text: "The shop is open. Close the day when you finish.", tone: "open" } as const);
  const feed = [
    ...recentReceipts.map((r) => ({ at: r.createdAt, text: `Stock received: ${r.items.map((i) => i.product.name).join(", ")}`, ref: r.receiptNo, href: `/inventory/receiving/${r.id}` })),
    ...recentIssues.map((i) => ({ at: i.createdAt, text: `Stock issued to ${i.reseller.name}`, ref: i.issueNo, href: `/resellers/issues/${i.id}` })),
    ...recentPays.map((p) => ({ at: p.receivedAt, text: `Payment from ${p.customer?.name ?? "a customer"}: ${m(p.amount)}`, ref: p.paymentNo, href: `/payments/${p.id}` })),
    ...recentSpend.map((e) => ({ at: e.requestedAt, text: `Expense (${e.category.name}): ${m(e.amount)}${e.status === "PENDING" ? " · waiting for the owner" : ""}`, ref: e.expenseNo, href: `/expenses/${e.id}` })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 8);

  const actions = [
    can(user, "sales.pos") && { href: "/pos", icon: ShoppingCart, title: "New sale", text: "Sell to a customer", primary: true },
    can(user, "payments.record") && { href: "/customers", icon: Banknote, title: "Take a payment", text: "A customer pays a debt" },
    can(user, "shipments.receive") && { href: "/shipments", icon: PackageCheck, title: "Purchase orders", text: incoming > 0 ? `${incoming} ${incoming === 1 ? "delivery" : "deliveries"} to check` : "See what is on the way" },
    can(user, "resellers.operate") && { href: "/resellers", icon: Handshake, title: "Winga", text: "Issue stock, record what they sold" },
    can(user, "returns.create") && { href: "/sales", icon: Undo2, title: "Return an item", text: "Open the sale first" },
    can(user, "expenses.create") && { href: "/expenses", icon: ReceiptText, title: "Record an expense", text: pendingExpensesMine > 0 ? `${pendingExpensesMine} waiting for the owner` : "Money spent for the shop" },
    can(user, "closing.submit") && { href: "/closing", icon: CalendarCheck, title: closedToday ? "Today is closed" : "Close the day", text: closedToday ? "See today's closing" : "Count the cash and finish" },
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

      {shopStatus && (
        <div className={cn("mb-5 flex items-center gap-3 rounded-2xl border px-4 py-3", shopStatus.tone === "open" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : shopStatus.tone === "awaiting" ? "border-amber-200 bg-oil-soft text-yellow-950" : "border-slate-200 bg-slate-100 text-slate-700")}>
          <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", shopStatus.tone === "open" ? "bg-emerald-500" : shopStatus.tone === "awaiting" ? "animate-pulse bg-amber-500" : "bg-slate-400")} aria-hidden />
          <span className="text-sm">
            <strong className="mr-2 tracking-wide">{shopStatus.label}</strong>
            {shopStatus.text}
          </span>
        </div>
      )}

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
        <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
          <StatTile icon={Receipt} tone="navy" label="Sales today" value={m(soldToday)} hint={`${active.length} sale${active.length === 1 ? "" : "s"}`} href="/sales" />
          <StatTile icon={Wallet} tone="green" label="Money received" value={m(collected)} hint={`Cash ${m(received("CASH"))} · Mobile ${m(received("MOBILE_MONEY"))} · Bank ${m(received("BANK"))}`} />
          <StatTile icon={HandCoins} tone="red" label="On credit today" value={String(onCredit.length)} hint={`${m(stillOwed)} not paid yet`} />
          {spentToday ? <StatTile icon={ReceiptText} tone="yellow" label="Expenses today" value={m(spentToday._sum.amount ?? 0)} href="/expenses" /> : <StatTile icon={Undo2} tone="yellow" label="Requests waiting" value={pendingMine} hint="Returns waiting for the manager" />}
          {shelf ? <StatTile icon={Boxes} tone="slate" label="Stock on the shelf" value={`${Number(shelf._sum.quantity ?? 0).toFixed(0)} items`} href="/inventory" /> : <StatTile icon={Undo2} tone="slate" label="Requests waiting" value={pendingMine} />}
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
                    <span className={a.out ? "badge-red" : "badge-yellow"}>{a.out ? "Out of stock" : `${qtyText(Number(a.qty), a.pack, a.symbol, unitMode).main} left`}</span>
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

        {feed.length > 0 && (
          <section className="card overflow-hidden lg:col-span-2">
            <h2 className="border-b border-line px-5 py-3 text-base font-semibold text-slate-900">What happened today</h2>
            <ul className="divide-y divide-slate-100">
              {feed.map((f) => (
                <li key={f.ref} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <Link href={f.href} className="min-w-0 truncate text-slate-800 hover:text-navy-700">
                    {f.text}
                    <span className="ml-2 text-xs text-slate-400">{f.ref}</span>
                  </Link>
                  <span className="shrink-0 text-xs text-slate-500">{new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }).format(f.at)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
