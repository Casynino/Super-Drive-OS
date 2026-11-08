import Link from "next/link";
import { InOutChart } from "@/components/dashboard/Charts";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { qtyText, type Pack } from "@/lib/qty";
import { getCurrency } from "@/lib/settings";

const num = (d: { toString(): string } | null | undefined) => Number(d?.toString() ?? 0);

/**
 * How a product is doing (Nino 2026-11-08: "see the performance of the product, inside, nice and more"): what sold in the last 7 and 30 days, how long the stock
 * lasts at that pace, the totals since the start (received, sold, returned, damaged), a 30-day chart of received against sold, what the stock is worth (only with
 * `inventory.valuation`). The movements themselves are NOT listed here (a busy product would make this page grow with every sale): they are paged on the stock page,
 * which the link points to. Everything is read from the stock ledger, nothing is stored. Used on the product page and the stock page.
 */
export default async function ProductPerformance({ productId, pack, baseSymbol, showValue, moreHref }: { productId: string; pack: Pack | null; baseSymbol: string; /** may see what the stock is worth (inventory.valuation) */ showValue: boolean; /** the stock page, where every movement is listed (paged) */ moreHref?: string }) {
  const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const since7 = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const currency = showValue ? await getCurrency() : null;
  const [byType, sold30, sold7, perDay, worth, balances] = await Promise.all([
    db.stockMovement.groupBy({ by: ["type"], where: { productId }, _sum: { quantity: true }, _max: { createdAt: true } }),
    db.stockMovement.aggregate({ where: { productId, type: "SOLD", createdAt: { gte: since30 } }, _sum: { quantity: true } }),
    db.stockMovement.aggregate({ where: { productId, type: "SOLD", createdAt: { gte: since7 } }, _sum: { quantity: true } }),
    db.$queryRaw<{ day: string; rec: string; sold: string }[]>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
             COALESCE(SUM(CASE WHEN "type" = 'RECEIVED' THEN "quantity" ELSE 0 END), 0)::text AS rec,
             COALESCE(SUM(CASE WHEN "type" = 'SOLD' THEN -"quantity" ELSE 0 END), 0)::text AS sold
        FROM "StockMovement" WHERE "productId" = ${productId} AND "createdAt" >= ${since30} GROUP BY 1 ORDER BY 1`,
    showValue ? db.product.findUnique({ where: { id: productId }, select: { avgCost: true, sellingPrice: true } }) : Promise.resolve(null),
    db.stockBalance.findMany({ where: { productId, location: { type: { not: "RESELLER" } } }, select: { quantity: true, reserved: true } }),
  ]);

  const say = (n: number) => qtyText(n, pack, baseSymbol).main;
  const qty = balances.reduce((t, b) => t + num(b.quantity), 0);
  const reserved = balances.reduce((t, b) => t + num(b.reserved), 0);
  const available = Math.max(qty - reserved, 0);
  const sum = (t: string) => num(byType.find((r) => r.type === t)?._sum.quantity);
  const soldLast30 = -num(sold30._sum.quantity);
  const soldLast7 = -num(sold7._sum.quantity);
  const perWeek = (soldLast30 / 30) * 7;
  const daysLeft = soldLast30 > 0 ? Math.floor(available / (soldLast30 / 30)) : null;
  const factor = pack?.factor ?? 1;
  const days: { label: string; in: number; out: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3600 * 1000);
    const row = perDay.find((r) => r.day === d.toISOString().slice(0, 10));
    days.push({ label: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }), in: Number((Number(row?.rec ?? 0) / factor).toFixed(1)), out: Number((Number(row?.sold ?? 0) / factor).toFixed(1)) });
  }
  const lastOf = (t: string) => byType.find((r) => r.type === t)?._max.createdAt ?? null;
  const day = (d: Date | null) => (d ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "never");
  const tile = (label: string, value: string, hint?: string) => (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 truncate text-lg font-bold leading-tight tracking-tight text-slate-900">{value}</p>
      {hint && <p className="truncate text-xs text-slate-500">{hint}</p>}
    </div>
  );

  return (
    <section className="card mb-4 overflow-hidden" aria-label="Performance and totals">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
        <h2 className="text-base font-semibold text-slate-900">Performance and totals</h2>
        {moreHref && (
          <Link href={moreHref} className="text-sm font-medium text-navy-700 hover:underline">
            Stock page and every movement
          </Link>
        )}
      </div>
      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)]">
        <dl className="grid grid-cols-2 content-start gap-x-5 gap-y-3.5">
          {tile("Sold, 7 days", say(soldLast7), "last week")}
          {tile("Sold, 30 days", say(soldLast30), `${say(Math.round(perWeek))} a week`)}
          {tile("Lasts about", daysLeft === null ? "No sales" : daysLeft > 365 ? "A year +" : `${daysLeft} days`, daysLeft === null ? "in the last 30 days" : "at this pace")}
          {tile("Last sold", day(lastOf("SOLD")), `last received ${day(lastOf("RECEIVED"))}`)}
          {tile("Received so far", say(sum("RECEIVED")), "deliveries and counts")}
          {tile("Sold so far", say(-sum("SOLD")), "all time")}
          {tile("Returned", say(sum("CUSTOMER_RETURN")), "by customers")}
          {tile("Damaged or lost", say(-sum("DAMAGED")), "taken off the shelf")}
          {worth && currency && tile("Worth at cost", formatMoney(num(worth.avgCost) * qty, currency), "what is on the shelf")}
          {worth && currency && tile("Worth when sold", formatMoney(num(worth.sellingPrice) * qty, currency), "at the selling price")}
        </dl>
        <div className="min-w-0">
          <p className="mb-1 text-xs text-slate-500">The last 30 days, in {pack ? pack.symbol : baseSymbol}: received and sold</p>
          <div className="h-48">
            <InOutChart data={days} money={{ symbol: "", decimals: pack ? 1 : 0 } as never} inLabel="Received" outLabel="Sold" empty="Nothing was received or sold in 30 days" />
          </div>
        </div>
      </div>

    </section>
  );
}
