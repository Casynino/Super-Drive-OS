import { can, canAny } from "@/lib/auth/can";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { inventoryAnalytics, reportRange, salesAnalytics } from "@/lib/reports/analytics";

// CSV downloads for the reports. Same permissions as the screen; profit and cost columns need reports.financial.
const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // a leading = + - @ would be run as a formula by a spreadsheet: neutralise it
  const safe = /^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const csv = (rows: unknown[][]) => rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!canAny(user, ["reports.view", "reports.financial"])) return new Response("Forbidden", { status: 403 });
  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const r = reportRange({ from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined });
  const financials = can(user, "reports.financial");
  let body = "";

  if (type === "products") {
    const s = await salesAnalytics(db, r, "day", financials);
    body = csv([["Product", "Units sold", "Sales", ...(financials ? ["Profit"] : [])], ...s.byProduct.map((p) => [p.name, p.qty, p.revenue, ...(financials ? [p.profit] : [])])]);
  } else if (type === "stock") {
    const i = await inventoryAnalytics(db, financials);
    body = csv([["Product", "SKU", "On the shelf", "With winga", "Sold in the last 30 days", "Last sale", ...(financials ? ["Value"] : [])], ...i.list.map((p) => [p.name, p.sku, p.shelf, p.withResellers, p.sold30, p.lastSale?.toISOString().slice(0, 10) ?? "never", ...(financials ? [p.value] : [])])]);
  } else if (type === "expenses") {
    if (!financials) return new Response("Forbidden", { status: 403 });
    const rows = await db.expense.findMany({
      where: { status: { in: ["APPROVED", "REVERSED"] }, expenseDate: { gte: new Date(`${r.fromYmd}T00:00:00Z`), lte: new Date(`${r.toYmd}T00:00:00Z`) } },
      orderBy: { expenseDate: "asc" },
      include: { category: { select: { name: true } }, requestedBy: { select: { name: true } } },
    });
    body = csv([["Expense", "Date", "Category", "Description", "Paid from", "Amount", "Status", "Recorded by"], ...rows.map((e) => [e.expenseNo, e.expenseDate.toISOString().slice(0, 10), e.category.name, e.description, e.method, e.amount.toString(), e.status, e.requestedBy.name])]);
  } else {
    return new Response("Unknown report", { status: 400 });
  }
  return new Response("﻿" + body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${type}-${r.fromYmd}-to-${r.toYmd}.csv"`, "Cache-Control": "private, no-store" } });
}
