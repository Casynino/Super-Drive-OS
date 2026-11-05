// The owner's daily WhatsApp report, built only from recorded transactions (nothing is estimated or filled in).
// A SUMMARY (short) and a DETAIL report (split into numbered parts) are produced once the day has been closed.
// If the shop has not closed, only an exception notice is produced and it says so plainly.
import { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { getStockAlerts } from "@/lib/inventory/alerts";
import { getResellerAccount } from "@/lib/resellers/engine";
import { owedSql } from "@/lib/sales/owed";
import { getBusinessProfile, getCurrency } from "@/lib/settings";
import type { ClosingSummary } from "@/lib/cash/closing";
import { dayToDate } from "@/lib/cash/ledger";
import { longDate, splitIntoParts } from "./format";

const D = Prisma.Decimal;
const num = (v: unknown) => Number(v ?? 0);
const TZ = "Africa/Dar_es_Salaam";

const fmt = (v: number, code: string) => `${code} ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(v))}`;
const hhmm = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(d);

export type DailyReport =
  | { closed: true; summary: string; detail: string[]; closingNo: string }
  | { closed: false; exception: string };

export async function buildDailyReport(db: Db, locationId: string, day: string): Promise<DailyReport> {
  const [currency, biz] = await Promise.all([getCurrency(), getBusinessProfile()]);
  const code = currency.code;
  const m = (v: number) => fmt(v, code);
  const from = new Date(`${day}T00:00:00+03:00`);
  const to = new Date(`${day}T23:59:59.999+03:00`);
  const name = biz.name.toUpperCase();

  const closing = await db.dailyClosing.findUnique({ where: { locationId_businessDate: { locationId, businessDate: dayToDate(day) } }, include: { submittedBy: { select: { name: true } } } });

  if (!closing) {
    const [sales, count] = await Promise.all([
      db.sale.aggregate({ where: { status: "COMPLETED", createdAt: { gte: from, lte: to } }, _sum: { total: true }, _count: true }),
      db.cashTransaction.count({ where: { account: { locationId }, closingId: null } }),
    ]);
    return {
      closed: false,
      exception: [
        name,
        "DAILY CLOSING PENDING",
        `Date: ${longDate(day)}`,
        "",
        "The shop has NOT submitted the daily closing for this day, so no final report can be sent.",
        `Recorded so far (not final): ${sales._count} sale${sales._count === 1 ? "" : "s"}, ${m(num(sales._sum.total))}; ${count} cash entr${count === 1 ? "y" : "ies"} not yet closed.`,
        "",
        `${biz.name.toUpperCase()} MANAGEMENT SYSTEM`,
      ].join("\n"),
    };
  }
  const s = closing.summary as unknown as ClosingSummary;

  const [sales, collections, expenses, deposits, alerts, movements, approvals, resellers, units, owed] = await Promise.all([
    db.sale.findMany({
      where: { createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: "asc" },
      include: {
        customer: { select: { name: true } },
        salesperson: { select: { name: true } },
        items: { include: { product: { select: { name: true } } }, orderBy: { id: "asc" } },
        allocations: { include: { payment: { select: { method: true, source: true } } } },
      },
    }),
    db.payment.findMany({ where: { source: "DEBT_COLLECTION", receivedAt: { gte: from, lte: to } }, orderBy: { receivedAt: "asc" }, include: { customer: { select: { name: true, reseller: { select: { id: true } } } } } }),
    db.expense.findMany({ where: { status: "APPROVED", expenseDate: dayToDate(day) }, orderBy: { requestedAt: "asc" }, include: { category: { select: { name: true } }, requestedBy: { select: { name: true } } } }),
    db.bankDeposit.findMany({ where: { businessDate: dayToDate(day) }, orderBy: { createdAt: "asc" } }),
    getStockAlerts(db),
    db.stockMovement.groupBy({ by: ["type"], where: { createdAt: { gte: from, lte: to } }, _count: true, _sum: { quantity: true } }),
    Promise.all([db.saleReversal.count({ where: { status: "PENDING" } }), db.expense.count({ where: { status: "PENDING" } }), db.dailyClosing.count({ where: { status: "NEEDS_REVIEW" } })]),
    db.reseller.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } }),
    db.$queryRaw<{ q: Prisma.Decimal | null }[]>`
      SELECT SUM(si."quantity" - COALESCE(x.q, 0)) AS q FROM "SaleItem" si JOIN "Sale" s ON s."id" = si."saleId"
        LEFT JOIN (SELECT ri."saleItemId", SUM(ri."quantity") AS q FROM "ReversalItem" ri JOIN "SaleReversal" rv ON rv."id" = ri."reversalId" WHERE rv."status" = 'COMPLETED' GROUP BY 1) x ON x."saleItemId" = si."id"
       WHERE s."status" = 'COMPLETED' AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}`,
    db.$queryRaw<{ channel: string; owed: Prisma.Decimal | null; overdue: Prisma.Decimal | null }[]>`
      SELECT "channel"::text AS channel, SUM(${owedSql()}) AS owed, SUM(CASE WHEN "dueDate" < ${day}::date THEN ${owedSql()} ELSE 0 END) AS overdue
        FROM "Sale" WHERE "status" = 'COMPLETED' AND ${owedSql()} > 0 GROUP BY 1`,
  ]);
  const accounts = await Promise.all(resellers.map((r) => getResellerAccount(db, r.id)));
  const resellerOwed = num(owed.find((o) => o.channel === "RESELLER")?.owed);
  const resellerOverdue = num(owed.find((o) => o.channel === "RESELLER")?.overdue);

  const live = sales.filter((x) => x.status === "COMPLETED");
  const net = (x: (typeof sales)[number]) => num(x.total) - num(x.returnedTotal);
  const totalSales = live.reduce((t, x) => t + net(x), 0);
  // the sales block is worked out from the day's records (the closing only fixes the cash count at the time it was submitted)
  const paidBy = { CASH: 0, MOBILE_MONEY: 0, BANK: 0 };
  let creditGiven = 0;
  for (const x of live) {
    let paid = 0;
    for (const a of x.allocations) if (a.payment.source === "AT_SALE") {
      paidBy[a.payment.method] += num(a.amount);
      paid += num(a.amount);
    }
    creditGiven += Math.max(0, num(x.total) - paid);
  }
  const customerColl = collections.filter((c) => !c.customer?.reseller).reduce((t, c) => t + num(c.amount), 0);
  const resellerColl = collections.filter((c) => c.customer?.reseller).reduce((t, c) => t + num(c.amount), 0);
  const spent = expenses.reduce((t, e) => t + num(e.amount), 0);
  const diff = num(closing.difference);
  const status = closing.status === "NEEDS_REVIEW" ? "COMPLETED - CASH DIFFERENCE, NEEDS OWNER REVIEW" : closing.status === "REVIEWED" ? "COMPLETED AND REVIEWED" : "COMPLETED";

  const summary = [
    name,
    "DAILY BUSINESS SUMMARY",
    `Date: ${longDate(day)}`,
    "",
    "SALES",
    `Total Sales: ${m(totalSales)} (${live.length} sale${live.length === 1 ? "" : "s"})`,
    `Cash Sales: ${m(paidBy.CASH)}`,
    `Mobile Money Sales: ${m(paidBy.MOBILE_MONEY)}`,
    `Bank Sales: ${m(paidBy.BANK)}`,
    `Credit Sales: ${m(creditGiven)}`,
    "",
    "COLLECTIONS",
    `Customer Collections: ${m(customerColl)}`,
    `Reseller Collections: ${m(resellerColl)}`,
    "",
    "EXPENSES",
    `Total Expenses: ${m(spent)}`,
    "",
    "CASH MANAGEMENT",
    `Expected Cash: ${m(num(closing.expectedCash))}`,
    `Actual Cash: ${m(num(closing.countedCash))}`,
    `Difference: ${diff === 0 ? "none" : `${diff < 0 ? "SHORT " : "EXTRA "}${m(Math.abs(diff))}`}`,
    `Bank Deposited: ${m(num(closing.depositedNow))}`,
    `Cash Remaining: ${m(num(closing.cashCarried))}`,
    "",
    "INVENTORY",
    `Products Sold: ${num(units[0]?.q).toFixed(0)} units`,
    `Low Stock Products: ${alerts.low.length}`,
    `Out of Stock Products: ${alerts.out.length}`,
    "",
    "RESELLERS",
    `Active Resellers: ${resellers.length}`,
    `Outstanding Settlements: ${m(resellerOwed)}${resellerOverdue > 0 ? ` (overdue ${m(resellerOverdue)})` : ""}`,
    "",
    "DAILY CLOSING",
    `Status: ${status}`,
    `Recorded By: ${closing.submittedBy.name}`,
    "",
    `${name} MANAGEMENT SYSTEM`,
  ].join("\n");

  // ── Detail ──
  const L: string[] = [];
  const section = (title: string) => L.push("", `== ${title} ==`);
  section("SALES");
  if (sales.length === 0) L.push("No sales.");
  sales.forEach((x, i) => {
    const paid = new Map<string, number>();
    for (const a of x.allocations) if (a.payment.source === "AT_SALE") paid.set(a.payment.method, (paid.get(a.payment.method) ?? 0) + num(a.amount));
    const pay = [...paid].map(([k, v]) => `${k === "CASH" ? "Cash" : k === "MOBILE_MONEY" ? "Mobile" : "Bank"} ${m(v)}`).join(" + ");
    const credit = num(x.total) - [...paid.values()].reduce((t, v) => t + v, 0);
    L.push(`${i + 1}. ${x.saleNo} ${hhmm(x.createdAt)} · ${x.customer?.name ?? "Walk-in"}${x.channel === "RESELLER" ? " (reseller report)" : ""} · ${x.salesperson.name}${x.status === "CANCELLED" ? " · CANCELLED" : ""}`);
    for (const it of x.items) L.push(`   ${it.enteredQty.toString()} x ${it.product.name} @ ${m(num(it.unitPrice))}${num(it.discount) > 0 ? ` (discount ${m(num(it.discount))})` : ""}`);
    L.push(`   Total ${m(num(x.total))}${num(x.returnedTotal) > 0 ? ` (returned ${m(num(x.returnedTotal))})` : ""} · ${pay || "no payment"}${credit > 0.5 ? ` · on credit ${m(credit)}` : ""}${x.discountReason ? ` · discount reason: ${x.discountReason}` : ""}`);
  });
  section("CUSTOMER COLLECTIONS");
  const cc = collections.filter((c) => !c.customer?.reseller);
  if (cc.length === 0) L.push("None.");
  cc.forEach((c) => L.push(`${c.paymentNo} ${hhmm(c.receivedAt)} · ${c.customer?.name ?? "—"} · ${c.method} ${m(num(c.amount))}`));
  section("RESELLER COLLECTIONS");
  const rc = collections.filter((c) => c.customer?.reseller);
  if (rc.length === 0) L.push("None.");
  rc.forEach((c) => L.push(`${c.paymentNo} ${hhmm(c.receivedAt)} · ${c.customer?.name ?? "—"} · ${c.method} ${m(num(c.amount))}`));

  const issues = await db.resellerIssue.findMany({ where: { createdAt: { gte: from, lte: to } }, orderBy: { createdAt: "asc" }, include: { reseller: { select: { name: true } }, items: { include: { product: { select: { name: true } } } } } });
  section("RESELLER STOCK ISSUED");
  if (issues.length === 0) L.push("None.");
  issues.forEach((i) => L.push(`${i.issueNo} · ${i.reseller.name} · ${m(num(i.expectedValue))}`, ...i.items.map((it) => `   ${it.enteredQty.toString()} x ${it.product.name}`)));
  section("RESELLER STOCK REMAINING");
  const holding = accounts.filter((a) => a.remainingQty.gt(0) || a.outstanding.gt(0));
  if (holding.length === 0) L.push("None.");
  holding.forEach((a) => L.push(`${a.reseller.name}: holds ${a.remainingQty.toString()} items (${m(a.remainingValue.toNumber())}), owes ${m(a.outstanding.toNumber())}${a.overdue.gt(0) ? `, overdue ${m(a.overdue.toNumber())}` : ""}`));

  section("EXPENSES");
  if (expenses.length === 0) L.push("None.");
  expenses.forEach((e) => L.push(`${e.expenseNo} · ${e.category.name} · ${e.description} · ${m(num(e.amount))} · ${e.requestedBy.name}`));
  section("BANK DEPOSITS");
  if (deposits.length === 0) L.push("None.");
  deposits.forEach((d) => L.push(`${d.depositNo} · ref ${d.bankReference} · ${m(num(d.amount))}`));

  section("CASH RECONCILIATION");
  L.push(`Cash at the start: ${m(num(s.cash.opening))}`, `+ Cash from sales: ${m(num(s.cash.salesIn))}`, `+ Debts collected in cash: ${m(num(s.cash.collectionsIn))}`);
  if (num(s.cash.refundsOut)) L.push(`- Refunds: ${m(num(s.cash.refundsOut))}`);
  L.push(`- Cash expenses: ${m(num(s.cash.expensesOut))}`);
  if (num(s.cash.withdrawals)) L.push(`- Owner withdrawals: ${m(num(s.cash.withdrawals))}`);
  if (num(s.cash.depositsOut)) L.push(`- Deposited earlier: ${m(num(s.cash.depositsOut))}`);
  if (num(s.cash.corrections)) L.push(`Corrections: ${m(num(s.cash.corrections))}`);
  L.push(`= Should be in the till: ${m(num(closing.expectedCash))}`, `Counted: ${m(num(closing.countedCash))}`, `Difference: ${diff === 0 ? "none" : `${diff < 0 ? "short" : "extra"} ${m(Math.abs(diff))}`}`);
  if (closing.notes) L.push(`Attendant's note: ${closing.notes}`);

  section("LOW STOCK");
  if (alerts.low.length === 0) L.push("None.");
  alerts.low.forEach((a) => L.push(`${a.name}: ${a.qty} ${a.symbol} left (minimum ${a.min})`));
  section("OUT OF STOCK");
  if (alerts.out.length === 0) L.push("None.");
  alerts.out.forEach((a) => L.push(a.name));

  section("INVENTORY MOVEMENTS TODAY");
  if (movements.length === 0) L.push("None.");
  movements.forEach((mv) => L.push(`${mv.type.replace(/_/g, " ").toLowerCase()}: ${mv._count} movement${mv._count === 1 ? "" : "s"}, net ${num(mv._sum.quantity).toFixed(0)} units`));

  section("PENDING APPROVALS");
  L.push(`Returns/cancellations: ${approvals[0]}`, `Expenses: ${approvals[1]}`, `Closings needing review: ${approvals[2]}`);
  section("DAILY CLOSING");
  L.push(`${closing.closingNo} · closed by ${closing.submittedBy.name} at ${hhmm(closing.submittedAt)} · ${status}`);

  return { closed: true, summary, detail: splitIntoParts(L, `${name}\nDAILY DETAILED REPORT\nDate: ${longDate(day)}`), closingNo: closing.closingNo };
}

void D;
