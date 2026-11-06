import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, ClipboardCheck, ImageOff, Printer } from "lucide-react";
import { Alert, PageHeader } from "@/components/ui";
import { CancelShipmentForm, ResolveIssueForm } from "@/components/shipments/IssueForms";
import MarkArrivedButton from "@/components/shipments/MarkArrivedButton";
import ShipmentSteps from "@/components/shipments/ShipmentSteps";
import KpiCard from "@/components/dashboard/KpiCard";
import { Prisma } from "@/generated/prisma/client";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { canCount, canMarkArrived, shipmentPhase } from "@/lib/shipments/phase";
import { getCurrency } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/utils";
import { Banknote, Coins, TrendingUp, Truck } from "lucide-react";
import { cancelShipmentAction, markArrivedAction, resolveIssueAction } from "../actions";
import { PhaseBadge } from "../badges";

export const metadata = { title: "Purchase order" };
const D = Prisma.Decimal;
const q = (n: Prisma.Decimal) => Number(n.toFixed(3)).toString();

export default async function ShipmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; counted?: string }> }) {
  const user = await requireUser();
  if (!canAny(user, ["shipments.manage", "shipments.receive"])) redirect("/forbidden");
  const { id } = await params;
  const sp = await searchParams;
  const manage = can(user, "shipments.manage");
  const receive = can(user, "shipments.receive");
  const currency = await getCurrency();

  const shipment = await db.shipment.findUnique({
    where: { id },
    include: {
      supplier: { select: { name: true } },
      location: { select: { name: true } },
      createdBy: { select: { name: true } },
      arrivedBy: { select: { name: true } },
      resolvedBy: { select: { name: true } },
      items: {
        orderBy: [{ unexpected: "asc" }, { id: "asc" }],
        select: {
          id: true, productId: true, expectedQty: true, enteredQty: true, factor: true, unexpected: true, missingQty: true,
          enteredUnit: { select: { symbol: true } },
          product: { select: { name: true, sku: true, baseUnit: { select: { symbol: true } }, image: { select: { updatedAt: true } }, ...(manage ? { sellingPrice: true } : {}) } },
          // costs and prices are only read for the owner; they are never sent to the shop
          ...(manage ? { lineCost: true, unitCost: true, sellingPrice: true, wholesalePrice: true, priceAppliedAt: true } : {}),
        },
      },
      receivings: { orderBy: { sessionNo: "asc" }, include: { startedBy: { select: { name: true } }, confirmedBy: { select: { name: true } }, stockReceipt: { select: { id: true, receiptNo: true } }, items: { select: { goodQty: true, damagedQty: true } } } },
    },
  });
  if (!shipment) notFound();

  const itemCount = await db.inventoryItem.count({ where: { shipmentId: id } }); // pieces that already have their own number and QR
  const sums = await db.shipmentReceivingItem.groupBy({ by: ["productId"], where: { receiving: { shipmentId: id, status: "CONFIRMED" } }, _sum: { goodQty: true, damagedQty: true } });
  const counted = new Map(sums.map((s) => [s.productId, { good: s._sum.goodQty ?? new D(0), damaged: s._sum.damagedQty ?? new D(0) }]));

  type MoneyItem = { lineCost?: Prisma.Decimal | null; unitCost?: Prisma.Decimal | null; sellingPrice?: Prisma.Decimal | null; wholesalePrice?: Prisma.Decimal | null; priceAppliedAt?: Date | null };
  const rows = shipment.items.map((i) => {
    const c = counted.get(i.productId) ?? { good: new D(0), damaged: new D(0) };
    const accounted = c.good.plus(c.damaged);
    const missing = shipment.status === "RECEIVED" || shipment.status === "CANCELLED" ? i.missingQty : D.max(i.expectedQty.minus(accounted), 0);
    const extra = D.max(accounted.minus(i.expectedQty), 0);
    const m = i as unknown as MoneyItem;
    const productPrice = (i.product as { sellingPrice?: Prisma.Decimal }).sellingPrice;
    const sell = m.sellingPrice ?? productPrice ?? null; // the new price entered with the shipment, else today's price
    return { i, c, missing, extra, m, sell };
  });
  const totalDamaged = rows.reduce((s, r) => s.plus(r.c.damaged), new D(0));
  const totalMissing = shipment.status === "RECEIVED" ? rows.reduce((s, r) => s.plus(r.missing), new D(0)) : new D(0);
  const extras = rows.filter((r) => r.extra.gt(0));
  const draft = shipment.receivings.find((r) => r.status === "DRAFT");
  const phase = shipmentPhase(shipment);

  // Owner only: what it costs, what it should sell for, and the profit (lines without a buying or selling price are left out of the profit)
  const money = manage
    ? rows.reduce(
        (a, r) => {
          const cost = r.m.lineCost ?? new D(0);
          a.cost = a.cost.plus(cost);
          if (r.sell && r.sell.gt(0) && !r.i.unexpected) {
            a.sales = a.sales.plus(r.sell.mul(r.i.expectedQty));
            a.pricedCost = a.pricedCost.plus(cost);
          } else if (!r.i.unexpected) a.unpriced++;
          return a;
        },
        { cost: new D(0), sales: new D(0), pricedCost: new D(0), unpriced: 0 },
      )
    : null;
  const profit = money ? money.sales.minus(money.pricedCost) : null;
  const margin = money && profit && money.sales.gt(0) ? Number(profit.div(money.sales).mul(100).toFixed(0)) : null;

  const confirmedCounts = shipment.receivings.filter((r) => r.status === "CONFIRMED").length;
  const steps = [
    { title: "On the way", detail: `${shipment.createdBy.name} · ${formatDate(shipment.createdAt)}` },
    { title: "Arrived", detail: shipment.arrivedAt ? `${shipment.arrivedBy?.name ?? "The shop"} · ${formatDateTime(shipment.arrivedAt)}` : shipment.expectedDate ? `Expected ${formatDate(shipment.expectedDate)}` : "Waiting for the shop" },
    { title: "Checked", detail: confirmedCounts ? `${confirmedCounts} count${confirmedCounts === 1 ? "" : "s"} confirmed` : "Not counted yet" },
    { title: "In stock", detail: shipment.status === "RECEIVED" ? formatDate(shipment.closedAt ?? shipment.createdAt) : "Goods go on the shelf" },
  ];
  const stepsDone = shipment.status === "RECEIVED" ? 4 : shipment.arrivedAt ? 2 : 1;

  return (
    <>
      <PageHeader
        title={shipment.shipmentNo}
        description={[shipment.supplier?.name, shipment.cargoName ?? shipment.reference].filter(Boolean).join(" · ") || "No supplier"}
        back={{ href: "/shipments", label: "Purchase orders" }}
        actions={
          <>
            <PhaseBadge phase={phase} />
            {itemCount > 0 && can(user, "inventory.view") && (
              <Link href={`/items/labels?shipment=${id}`} className="btn-secondary">
                <Printer size={16} /> Print item labels ({itemCount})
              </Link>
            )}
            {receive && canMarkArrived(shipment) &&<MarkArrivedButton shipmentId={id} action={markArrivedAction} />}
            {receive && canCount(shipment) && (
              <Link href={`/shipments/${id}/receive`} className="btn-primary">
                <ClipboardCheck size={16} /> {draft ? "Continue checking" : shipment.status === "PARTIAL" ? "Check the next delivery" : "Check this shipment"}
              </Link>
            )}
          </>
        }
      />
      {sp.created && <div className="mb-4"><Alert kind="success">Sent. The shop has been told it is on its way. They will mark it arrived and check it; stock only goes up when they confirm the count.</Alert></div>}
      {sp.counted && <div className="mb-4"><Alert kind="success">Check confirmed. The good items are now in stock{shipment.issue === "OPEN" ? ", and the owner has been told about the problem" : ""}. Every piece got its own QR code: press <strong>Print item labels</strong> to stick them on.</Alert></div>}

      {shipment.status !== "CANCELLED" && (
        <div className="card card-pad mb-5">
          <ShipmentSteps steps={steps} done={stepsDone} />
          {receive && canMarkArrived(shipment) && <p className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">When the delivery is at the shop, press <strong>Mark as arrived</strong>. Then you can count it.</p>}
          {receive && shipment.arrivedAt && canCount(shipment) && !draft && confirmedCounts === 0 && <p className="mt-4 rounded-lg bg-oil-soft px-3 py-2 text-sm text-yellow-800">It has arrived. Press <strong>Check this shipment</strong> and count what is really there.</p>}
        </div>
      )}

      {shipment.issue === "OPEN" && (
        <div className="card card-pad mb-5 border-brand-red/40 bg-brand-red-soft/40">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-red-soft text-brand-red-dark">
              <AlertTriangle size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-slate-900">Needs investigation</h2>
              <ul className="mt-1.5 space-y-0.5 text-sm text-slate-700">
                {totalDamaged.gt(0) && <li>{q(totalDamaged)} item(s) arrived damaged and were written off from stock.</li>}
                {totalMissing.gt(0) && <li>{q(totalMissing)} item(s) never arrived.</li>}
                {extras.map((r) => (
                  <li key={r.i.id}>
                    {r.i.unexpected ? "Not announced" : "More than announced"}: {q(r.extra)} × {r.i.product.name}
                  </li>
                ))}
              </ul>
              {manage && (
                <div className="mt-4 border-t border-brand-red/20 pt-4">
                  <ResolveIssueForm shipmentId={id} action={resolveIssueAction} />
                </div>
              )}
              {!manage && <p className="mt-2 text-sm text-slate-600">The owner has been told and will look into it.</p>}
            </div>
          </div>
        </div>
      )}
      {shipment.issue === "RESOLVED" && (
        <div className="mb-5"><Alert kind="info">Investigated by {shipment.resolvedBy?.name}{shipment.resolvedAt ? ` on ${formatDate(shipment.resolvedAt)}` : ""}: {shipment.resolutionNote}</Alert></div>
      )}
      {shipment.status === "CANCELLED" && <div className="mb-5"><Alert kind="info">Cancelled: {shipment.resolutionNote}</Alert></div>}

      {money && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <KpiCard icon={Banknote} tone="navy" label="You pay" value={formatMoney(money.cost, currency)} hint={`${shipment.items.filter((i) => !i.unexpected).length} products`} />
          <KpiCard icon={Coins} tone="blue" label="Sells for" value={money.sales.gt(0) ? formatMoney(money.sales, currency) : "—"} hint={money.unpriced ? `${money.unpriced} product${money.unpriced > 1 ? "s" : ""} with no selling price` : "At the selling prices"} />
          <KpiCard icon={TrendingUp} tone={profit && profit.lt(0) ? "red" : "green"} label="Expected profit" value={profit && money.sales.gt(0) ? formatMoney(profit, currency) : "—"} badge={margin !== null ? `${margin}% margin` : undefined} hint="If everything sells" />
          <KpiCard icon={Truck} tone="slate" label="Deliver to" value={shipment.location.name} hint={shipment.expectedDate ? `Expected ${formatDate(shipment.expectedDate)}` : "No date given"} />
        </div>
      )}

      {shipment.notes && <div className="mb-5"><Alert kind="info">Note: {shipment.notes}</Alert></div>}

      <section className="card mb-5 overflow-hidden">
        <h2 className="border-b border-line px-5 py-3 text-base font-semibold text-slate-900">Products</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="text-right">Announced</th>
                <th className="text-right">Good</th>
                <th className="text-right">Damaged</th>
                <th className="text-right">{shipment.status === "RECEIVED" ? "Missing" : "Still to come"}</th>
                {manage && <th className="hidden text-right md:table-cell">Buy / piece</th>}
                {manage && <th className="hidden text-right md:table-cell">Sell / piece</th>}
                {manage && <th className="hidden text-right lg:table-cell">Margin</th>}
                {manage && <th className="hidden text-right lg:table-cell">Line cost</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ i, c, missing, m, sell }) => {
                const buy = m.unitCost ?? null;
                const mg = buy && sell && sell.gt(0) ? Number(sell.minus(buy).div(sell).mul(100).toFixed(0)) : null;
                return (
                  <tr key={i.id}>
                    <td>
                      <span className="flex items-center gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-gradient-to-b from-white to-slate-100">
                          {i.product.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={`/api/product-image/${i.productId}?size=thumb&v=${i.product.image.updatedAt.getTime()}`} alt="" loading="lazy" className="h-full w-full object-contain" />
                          ) : (
                            <ImageOff size={16} className="text-slate-300" />
                          )}
                        </span>
                        <span>
                          <span className="block font-medium text-slate-900">{i.product.name}</span>
                          <span className="block text-xs text-slate-500">{i.unexpected ? "Not announced" : i.product.sku}</span>
                        </span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-right">
                      {i.unexpected ? "—" : `${q(i.enteredQty)} ${i.enteredUnit.symbol}`}
                      {!i.unexpected && i.factor.gt(1) && <span className="block text-xs text-slate-500">{q(i.expectedQty)} {i.product.baseUnit.symbol}</span>}
                    </td>
                    <td className="text-right font-medium text-emerald-700">{c.good.gt(0) ? `${q(c.good)} ${i.product.baseUnit.symbol}` : "—"}</td>
                    <td className={`text-right font-medium ${c.damaged.gt(0) ? "text-brand-red-dark" : "text-slate-400"}`}>{c.damaged.gt(0) ? q(c.damaged) : "—"}</td>
                    <td className={`text-right font-medium ${missing.gt(0) && shipment.status === "RECEIVED" ? "text-brand-red-dark" : "text-slate-400"}`}>{missing.gt(0) ? q(missing) : "—"}</td>
                    {manage && <td className="hidden text-right md:table-cell">{buy ? formatMoney(buy, currency) : "—"}</td>}
                    {manage && (
                      <td className="hidden text-right md:table-cell">
                        {sell && sell.gt(0) ? formatMoney(sell, currency) : "—"}
                        {m.sellingPrice && !m.priceAppliedAt && shipment.status !== "CANCELLED" && <span className="block text-[11px] text-slate-500">new price starts on arrival</span>}
                      </td>
                    )}
                    {manage && <td className={`hidden text-right font-medium lg:table-cell ${mg === null ? "text-slate-400" : mg < 0 ? "text-brand-red-dark" : mg < 15 ? "text-yellow-700" : "text-emerald-700"}`}>{mg === null ? "—" : `${mg}%`}</td>}
                    {manage && <td className="hidden text-right lg:table-cell">{m.lineCost ? formatMoney(m.lineCost, currency) : "—"}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card mb-5 overflow-hidden">
        <h2 className="border-b border-line px-5 py-3 text-base font-semibold text-slate-900">Counts</h2>
        {shipment.receivings.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">Nobody has counted this shipment yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {shipment.receivings.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <span>
                  <span className="font-medium text-slate-900">Count {r.sessionNo}</span>
                  <span className="ml-2 text-slate-500">
                    {r.status === "CONFIRMED" ? `confirmed by ${r.confirmedBy?.name} · ${formatDateTime(r.confirmedAt)}` : `draft by ${r.startedBy.name} (not confirmed, no stock added)`}
                  </span>
                  {r.notes && <span className="block text-xs text-slate-500">“{r.notes}”</span>}
                </span>
                <span className="flex items-center gap-3">
                  {r.stockReceipt && can(user, "inventory.movements") && (
                    <Link href={`/inventory/receiving/${r.stockReceipt.id}`} className="text-navy-700 hover:underline">
                      {r.stockReceipt.receiptNo}
                    </Link>
                  )}
                  <span className={r.status === "CONFIRMED" ? "badge-green" : "badge-yellow"}>{r.status === "CONFIRMED" ? "Confirmed" : "Draft"}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {manage && shipment.status === "EXPECTED" && !shipment.arrivedAt && shipment.receivings.length === 0 && (
        <section className="card card-pad">
          <h2 className="mb-2 text-base font-semibold text-slate-900">Cancel this shipment</h2>
          <p className="mb-3 text-sm text-slate-500">Only possible while it is still on the way. Once the shop marks it arrived it cannot be cancelled. The shop is told.</p>
          <CancelShipmentForm shipmentId={id} action={cancelShipmentAction} />
        </section>
      )}
    </>
  );
}
