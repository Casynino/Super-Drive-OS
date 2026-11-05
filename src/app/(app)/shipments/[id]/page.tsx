import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, ImageOff } from "lucide-react";
import { Alert, DetailGrid, PageHeader } from "@/components/ui";
import { CancelShipmentForm, ResolveIssueForm } from "@/components/shipments/IssueForms";
import { Prisma } from "@/generated/prisma/client";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/utils";
import { cancelShipmentAction, resolveIssueAction } from "../actions";
import { IssueBadge, ShipmentStatusBadge } from "../badges";

export const metadata = { title: "Shipment" };
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
      resolvedBy: { select: { name: true } },
      items: {
        orderBy: [{ unexpected: "asc" }, { id: "asc" }],
        select: {
          id: true, productId: true, expectedQty: true, enteredQty: true, factor: true, unexpected: true, missingQty: true,
          enteredUnit: { select: { symbol: true } },
          product: { select: { name: true, sku: true, baseUnit: { select: { symbol: true } }, image: { select: { updatedAt: true } } } },
          // costs are only read for the owner; they are never sent to the shop
          ...(manage ? { lineCost: true, unitCost: true } : {}),
        },
      },
      receivings: { orderBy: { sessionNo: "asc" }, include: { startedBy: { select: { name: true } }, confirmedBy: { select: { name: true } }, stockReceipt: { select: { id: true, receiptNo: true } }, items: { select: { goodQty: true, damagedQty: true } } } },
    },
  });
  if (!shipment) notFound();

  const sums = await db.shipmentReceivingItem.groupBy({ by: ["productId"], where: { receiving: { shipmentId: id, status: "CONFIRMED" } }, _sum: { goodQty: true, damagedQty: true } });
  const counted = new Map(sums.map((s) => [s.productId, { good: s._sum.goodQty ?? new D(0), damaged: s._sum.damagedQty ?? new D(0) }]));

  const rows = shipment.items.map((i) => {
    const c = counted.get(i.productId) ?? { good: new D(0), damaged: new D(0) };
    const accounted = c.good.plus(c.damaged);
    const missing = shipment.status === "RECEIVED" || shipment.status === "CANCELLED" ? i.missingQty : D.max(i.expectedQty.minus(accounted), 0);
    const extra = D.max(accounted.minus(i.expectedQty), 0);
    return { i, c, missing, extra };
  });
  const totalDamaged = rows.reduce((s, r) => s.plus(r.c.damaged), new D(0));
  const totalMissing = shipment.status === "RECEIVED" ? rows.reduce((s, r) => s.plus(r.missing), new D(0)) : new D(0);
  const extras = rows.filter((r) => r.extra.gt(0));
  const draft = shipment.receivings.find((r) => r.status === "DRAFT");
  const open = shipment.status === "EXPECTED" || shipment.status === "PARTIAL";
  const totalCost = manage ? shipment.items.reduce((s, i) => s.plus((i as { lineCost?: Prisma.Decimal | null }).lineCost ?? 0), new D(0)) : null;

  return (
    <>
      <PageHeader
        title={shipment.shipmentNo}
        description={shipment.supplier?.name ?? "No supplier"}
        back={{ href: "/shipments", label: "Incoming stock" }}
        actions={
          <>
            <ShipmentStatusBadge status={shipment.status} />
            <IssueBadge issue={shipment.issue} />
            {receive && open && (
              <Link href={`/shipments/${id}/receive`} className="btn-primary">
                {draft ? "Continue counting" : shipment.status === "PARTIAL" ? "Count the next delivery" : "Count this shipment"}
              </Link>
            )}
          </>
        }
      />
      {sp.created && <div className="mb-4"><Alert kind="success">Shipment announced. The shop has been told it is on its way. Stock only goes up when they count and confirm it.</Alert></div>}
      {sp.counted && <div className="mb-4"><Alert kind="success">Receipt confirmed. The good items are now in stock{shipment.issue === "OPEN" ? ", and the owner has been told about the problem" : ""}.</Alert></div>}

      {shipment.issue === "OPEN" && (
        <div className="card card-pad mb-5 border-brand-red/40 bg-brand-red-soft/40">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-red-soft text-brand-red-dark">
              <AlertTriangle size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-slate-900">Needs investigation</h2>
              <ul className="mt-1.5 space-y-0.5 text-sm text-slate-700">
                {totalDamaged.gt(0) && <li>{q(totalDamaged)} item(s) arrived damaged and were written off.</li>}
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

      <div className="card card-pad mb-5">
        <DetailGrid
          items={[
            { label: "Deliver to", value: shipment.location.name },
            { label: "Expected", value: shipment.expectedDate ? formatDate(shipment.expectedDate) : null },
            { label: "Reference", value: shipment.reference },
            { label: "Announced by", value: `${shipment.createdBy.name} · ${formatDate(shipment.createdAt)}` },
            ...(totalCost ? [{ label: "Total cost", value: <span className="font-semibold">{formatMoney(totalCost, currency)}</span> }] : []),
            { label: "Notes", value: shipment.notes },
          ]}
        />
      </div>

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
                {manage && <th className="hidden text-right md:table-cell">Cost</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ i, c, missing }) => (
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
                  {manage && <td className="hidden text-right md:table-cell">{(i as { lineCost?: Prisma.Decimal | null }).lineCost ? formatMoney((i as { lineCost: Prisma.Decimal }).lineCost, currency) : "—"}</td>}
                </tr>
              ))}
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

      {manage && shipment.status === "EXPECTED" && shipment.receivings.length === 0 && (
        <section className="card card-pad">
          <h2 className="mb-2 text-base font-semibold text-slate-900">Cancel this shipment</h2>
          <p className="mb-3 text-sm text-slate-500">Only possible before the shop starts counting. The shop is told.</p>
          <CancelShipmentForm shipmentId={id} action={cancelShipmentAction} />
        </section>
      )}
    </>
  );
}
