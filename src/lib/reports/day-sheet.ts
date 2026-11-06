// Builds the end-of-day report document from the records: the day's own sales, money, expenses and stock, and the locked
// closing (cash count, bank deposit, corrections). Used by the report page and by the print page, so both show the same thing.
import { Prisma } from "@/generated/prisma/client";
import type { ClosingSummary } from "@/lib/cash/closing";
import type { Db } from "@/lib/db";
import { getStockAlerts } from "@/lib/inventory/alerts";
import { formatMoney } from "@/lib/money";
import { largestPack, qtyText } from "@/lib/qty";
import { getBusinessProfile, getCurrency } from "@/lib/settings";
import type { DaySheetData, Tile } from "@/components/reports/EndOfDaySheet";
import { getPeriodStats, getProductsSold, getSalesPerDay, shiftDay } from "./period";

const D = Prisma.Decimal;

const dateText = (day: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
const stamp = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }).format(d);
const share = (v: Prisma.Decimal, total: Prisma.Decimal) => (total.gt(0) ? `${v.div(total).mul(100).toFixed(0)}%` : "—");
const pct = (now: Prisma.Decimal, before: Prisma.Decimal) => (before.gt(0) ? Math.round(now.minus(before).div(before).mul(100).toNumber()) : null);

export async function loadDaySheet(db: Db, closingId: string, o: { seeProfit: boolean; onlyBy?: string; logoSrc: string; slipOrigin?: string }) {
  const c = await db.dailyClosing.findUnique({ where: { id: closingId }, include: { submittedBy: { select: { name: true, role: { select: { name: true } } } }, location: { select: { name: true } } } });
  if (!c || (o.onlyBy && c.submittedById !== o.onlyBy)) return null;
  const day = c.businessDate.toISOString().slice(0, 10);
  const summary = c.summary as unknown as ClosingSummary;
  const [currency, profile] = await Promise.all([getCurrency(), getBusinessProfile()]);
  const money = (v: Prisma.Decimal | string | number) => formatMoney(v, currency);

  const [today, products, perDay, alerts, deposits, corrections, owner] = await Promise.all([
    getPeriodStats(db, c.locationId, day, day),
    getProductsSold(db, c.locationId, day, day),
    getSalesPerDay(db, c.locationId, shiftDay(day, -62), day),
    getStockAlerts(db),
    db.bankDeposit.findMany({ where: { closingId: c.id }, include: { createdBy: { select: { name: true } } } }),
    db.cashTransaction.findMany({ where: { type: "ADJUSTMENT", referenceType: "Manual", referenceNo: c.closingNo, account: { locationId: c.locationId, method: "CASH" } }, orderBy: { createdAt: "asc" }, include: { user: { select: { name: true } } } }),
    db.user.findFirst({ where: { status: "ACTIVE", role: { isSuperAdmin: true } }, orderBy: { createdAt: "asc" }, select: { name: true } }),
  ]);
  const into = deposits.length ? await db.cashTransaction.findMany({ where: { type: "DEPOSIT_IN", referenceType: "BankDeposit", referenceId: { in: deposits.map((d) => d.id) } }, select: { referenceId: true, account: { select: { name: true, accountNumber: true } } } }) : [];
  const packs = products.length ? await db.product.findMany({ where: { id: { in: products.map((p) => p.id) } }, select: { id: true, baseUnit: { select: { symbol: true } }, units: { select: { factor: true, unit: { select: { symbol: true } } } } } }) : [];

  // the day against the days around it
  const bySales = new Map(perDay.map((d) => [d.day, d.total]));
  const at = (d: string) => bySales.get(d) ?? new D(0);
  const sumRange = (from: string, to: string) => {
    let t = new D(0);
    for (let d = from; d <= to; d = shiftDay(d, 1)) t = t.plus(at(d));
    return t;
  };
  const that = at(day);
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  const weekStart = shiftDay(day, -((dow + 6) % 7));
  const monthStart = `${day.slice(0, 8)}01`;
  const prevMonthEnd = shiftDay(monthStart, -1);
  const prevMonthStart = `${prevMonthEnd.slice(0, 8)}01`;
  const sameDayLastMonth = shiftDay(prevMonthStart, Number(day.slice(8)) - 1);
  const avg7 = sumRange(shiftDay(day, -7), shiftDay(day, -1)).div(7);
  const avg30 = sumRange(shiftDay(day, -30), shiftDay(day, -1)).div(30);
  const weekSoFar = sumRange(weekStart, day);
  const monthSoFar = sumRange(monthStart, day);
  const barVals = Array.from({ length: 14 }, (_, i) => ({ day: shiftDay(day, i - 13), total: at(shiftDay(day, i - 13)) }));
  const peak = barVals.reduce((m, b) => (b.total.gt(m) ? b.total : m), new D(0));

  const banked = deposits.reduce((t, d) => t.plus(d.amount), new D(0));
  const correctedBy = corrections.reduce((t, x) => t.plus(x.amount), new D(0));
  const tillLeft = c.cashCarried.plus(correctedBy);
  const dec = (v: string | undefined) => new D(v ?? 0);
  const balance = (m: "MOBILE_MONEY" | "BANK") => dec(summary.accounts.find((a) => a.method === m)?.balance);
  const mobile = balance("MOBILE_MONEY");
  const bank = balance("BANK").plus(banked);
  // what was spent that day (by the expense's own date): one figure for the strip, the table and the profit
  const spent = today.expensesByCategory.reduce((t, e) => t.plus(e.value), new D(0));
  const profit = o.seeProfit ? { gross: today.profit.gross, net: today.profit.gross.minus(spent), marginPct: today.profit.sales.gt(0) ? today.profit.gross.minus(spent).div(today.profit.sales).mul(100).toNumber() : 0 } : null;
  const diff = c.difference;
  const net = diff.plus(correctedBy);

  const strip: Tile[] = [
    { label: "Sold", value: money(today.sales.total), note: `${today.sales.count} sale${today.sales.count === 1 ? "" : "s"}${today.sales.creditGiven.gt(0) ? ` · ${money(today.sales.creditGiven)} on credit` : ""}`, change: pct(that, avg7) },
    { label: "Money received", value: money(today.money.income), note: `${today.money.payments} payment${today.money.payments === 1 ? "" : "s"}` },
    { label: "Expenses", value: money(spent), note: `${today.expensesByCategory.length} categor${today.expensesByCategory.length === 1 ? "y" : "ies"}` },
    profit
      ? { label: profit.net.lt(0) ? "Loss" : "Profit", value: money(profit.net.abs()), note: `${profit.marginPct.toFixed(1)}% of sales`, tone: profit.net.lt(0) ? "red" : "green" }
      : { label: "On credit", value: money(today.sales.creditGiven), note: "not paid yet" },
    { label: "Cash count", value: net.isZero() ? "OK" : `${net.lt(0) ? "−" : "+"} ${money(net.abs())}`, note: correctedBy.isZero() ? `Counted ${money(c.countedCash)}` : `Corrected: was ${diff.lt(0) ? "−" : "+"} ${money(diff.abs())}`, tone: net.isZero() ? "green" : net.lt(0) ? "red" : "plain" },
    { label: "Banked", value: money(banked), note: `${money(tillLeft)} stays in the till` },
  ];

  const totalRev = products.reduce((t, p) => t.plus(p.revenue), new D(0));
  const totalProfit = products.reduce((t, p) => t.plus(p.revenue.minus(p.cost)), new D(0));
  const productsTable = {
    columns: [{ label: "Product" }, { label: "Sold", right: true }, { label: "Revenue", right: true }, { label: "Share", right: true }, ...(profit ? [{ label: "Profit", right: true }] : [])],
    rows: products.map((p) => {
      const meta = packs.find((x) => x.id === p.id);
      const sold = meta ? qtyText(Number(p.qty), largestPack(meta.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor }))), meta.baseUnit.symbol).main : p.qty.toString();
      return [p.name, sold, money(p.revenue), share(p.revenue, totalRev), ...(profit ? [money(p.revenue.minus(p.cost))] : [])];
    }),
    total: products.length ? ["Total", "", money(totalRev), "100%", ...(profit ? [money(totalProfit)] : [])] : undefined,
  };

  const inAccounts = today.money.byAccount.filter((a) => a.income.gt(0));
  const inTotal = inAccounts.reduce((t, a) => t.plus(a.income), new D(0));
  const sc = summary.cash;
  const n = (v: string | undefined) => new D(v ?? 0);
  const cashRows: DaySheetData["cash"] = [
    { label: "Cash at the start (yesterday's closing balance)", value: money(sc.opening) },
    { sign: "+", label: "Cash sales", value: money(sc.salesIn) },
    { sign: "+", label: "Debts collected in cash", value: money(sc.collectionsIn) },
    ...(n(sc.refundsOut).isZero() ? [] : [{ sign: "−" as const, label: "Refunds paid", value: money(sc.refundsOut) }]),
    { sign: "−", label: "Cash expenses", value: money(sc.expensesOut) },
    ...(n(sc.withdrawals).isZero() ? [] : [{ sign: "−" as const, label: "Taken out by the owner", value: money(sc.withdrawals) }]),
    ...(n(sc.transfers).isZero() ? [] : [{ sign: (n(sc.transfers).lt(0) ? "−" : "+") as "+" | "−", label: "Moved to or from other accounts", value: money(n(sc.transfers).abs()) }]),
    ...(n(sc.supplierPayments).isZero() ? [] : [{ sign: "−" as const, label: "Paid to suppliers", value: money(sc.supplierPayments ?? "0") }]),
    ...(n(sc.depositsOut).isZero() ? [] : [{ sign: "−" as const, label: "Banked earlier", value: money(sc.depositsOut) }]),
    ...(n(sc.corrections).isZero() ? [] : [{ sign: (n(sc.corrections).lt(0) ? "−" : "+") as "+" | "−", label: "Corrections by the owner", value: money(n(sc.corrections).abs()) }]),
    { sign: "=", label: "Should be in the till", value: money(c.expectedCash), strong: true },
    { label: "Counted", value: money(c.countedCash), strong: true },
    { label: "Difference", value: diff.isZero() ? "OK" : `${diff.lt(0) ? "−" : "+"} ${money(diff.abs())}`, strong: true, tone: diff.isZero() ? "green" : diff.lt(0) ? "red" : undefined },
    { label: "Taken to the bank", value: money(banked) },
    { label: "Left in the till (closing balance)", value: money(c.cashCarried), strong: true },
  ];

  const compareTiles: Tile[] = [
    { label: "Day vs last 7 days", value: money(that), change: pct(that, avg7), note: `Usual day: ${money(avg7)}` },
    { label: "Day vs last 30 days", value: money(that), change: pct(that, avg30), note: `Usual day: ${money(avg30)}` },
    { label: "Week so far", value: money(weekSoFar), change: pct(weekSoFar, sumRange(shiftDay(weekStart, -7), shiftDay(day, -7))), note: "vs the same days last week" },
    { label: "Month so far", value: money(monthSoFar), change: pct(monthSoFar, sumRange(prevMonthStart, sameDayLastMonth > prevMonthEnd ? prevMonthEnd : sameDayLastMonth)), note: "vs the same days last month" },
  ];

  const stockRows = [
    ...alerts.out.map((a) => [a.name, "0", "Out of stock"]),
    ...alerts.low.map((a) => [a.name, qtyText(Number(a.qty), a.pack, a.symbol).main, "Low"]),
  ].slice(0, 14);

  const origin = o.slipOrigin ?? "";
  const data: DaySheetData = {
    number: `RPT-${day.replaceAll("-", "")}-EOD`,
    preparedAt: stamp(new Date()),
    dateText: dateText(day),
    business: { name: profile.name, address: profile.address, phone: profile.phone },
    logoSrc: o.logoSrc,
    shop: c.location.name,
    closingNo: c.closingNo,
    currencyCode: currency.code,
    strip,
    products: productsTable,
    accounts: { columns: [{ label: "Account" }, { label: "Amount", right: true }, { label: "Share", right: true }], rows: inAccounts.map((a) => [a.name, money(a.income), share(a.income, inTotal)]), total: inAccounts.length ? ["Total", money(inTotal), "100%"] : undefined },
    expenses: { columns: [{ label: "Category" }, { label: "Amount", right: true }, { label: "Share", right: true }], rows: today.expensesByCategory.map((e) => [e.name, money(e.value), share(e.value, spent)]), total: today.expensesByCategory.length ? ["Total", money(spent), "100%"] : undefined },
    cash: cashRows,
    money: [
      { label: "In the till (cash)", value: money(tillLeft), note: banked.gt(0) ? `after ${money(banked)} went to the bank` : "nothing was banked" },
      { label: "Mobile money", value: money(mobile), note: "in the mobile money accounts" },
      { label: "In the bank", value: money(bank), note: banked.gt(0) ? `includes ${money(banked)} banked today` : "in the bank accounts" },
      { label: "All together", value: money(tillLeft.plus(mobile).plus(bank)), tone: "green" },
    ],
    deposit: deposits.length
      ? {
          empty: null,
          slipSrc: deposits[0]?.slipId ? `${origin}/api/attachment/${deposits[0].slipId}` : null,
          lines: deposits.flatMap((d) => {
            const acc = into.find((r) => r.referenceId === d.id)?.account;
            return [
              { label: "Amount", value: money(d.amount) },
              { label: "Into", value: `${acc?.name ?? "the bank"}${acc?.accountNumber ? ` · ${acc.accountNumber}` : ""}` },
              { label: "Reference", value: `${d.bankReference} · ${d.depositNo}` },
              { label: "By", value: d.createdBy.name },
            ];
          }),
        }
      : { lines: [], slipSrc: null, empty: `Nothing was banked. ${money(c.cashCarried)} stays in the till.` },
    compare: { bars: barVals.map((b) => ({ label: b.day.slice(8), pct: peak.gt(0) ? Math.max(b.total.div(peak).mul(100).toNumber(), b.total.gt(0) ? 3 : 0) : 0, highlight: b.day === day })), tiles: compareTiles },
    stock: { columns: [{ label: "Product" }, { label: "In stock", right: true }, { label: "Status" }], rows: stockRows },
    corrections: corrections.length
      ? { columns: [{ label: "Reason" }, { label: "By" }, { label: "Amount", right: true }], rows: corrections.map((x) => [(x.description ?? "").replace(/^Correction \((added|removed)\): /, ""), `${x.user.name} · ${stamp(x.createdAt)}`, `${x.amount.gt(0) ? "+ " : "− "}${money(x.amount.abs())}`]) }
      : null,
    note: c.notes,
    signatures: { preparedBy: c.submittedBy.name, preparedRole: c.submittedBy.role.name, approvedBy: owner?.name ?? "Owner" },
  };
  return { closing: c, data, corrections, countedNow: c.countedCash.plus(correctedBy), currencySymbol: currency.symbol, money };
}
