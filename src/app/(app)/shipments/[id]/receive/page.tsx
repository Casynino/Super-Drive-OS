import { notFound, redirect } from "next/navigation";
import { Alert, PageHeader } from "@/components/ui";
import ReceivingForm, { type CountRow } from "@/components/shipments/ReceivingForm";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { canCount } from "@/lib/shipments/phase";
import { getPickerProducts } from "../../../inventory/data";
import { saveCount } from "../../actions";

export const metadata = { title: "Count shipment" };
const q = (n: { toString(): string }) => Number(Number(n.toString()).toFixed(3)).toString();

export default async function ReceivePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("shipments.receive");
  const { id } = await params;

  // No cost fields are selected anywhere on this page: the shop never sees what the owner paid.
  const shipment = await db.shipment.findUnique({
    where: { id },
    select: {
      id: true, shipmentNo: true, status: true, arrivedAt: true, reference: true, cargoName: true, notes: true, expectedDate: true,
      supplier: { select: { name: true } },
      items: {
        orderBy: [{ unexpected: "asc" }, { id: "asc" }],
        select: {
          id: true, productId: true, expectedQty: true, enteredQty: true, enteredUnitId: true, factor: true, unexpected: true,
          enteredUnit: { select: { symbol: true } },
          product: { select: { name: true, sku: true, baseUnitId: true, baseUnit: { select: { symbol: true } }, image: { select: { updatedAt: true } }, units: { select: { unitId: true, factor: true, unit: { select: { name: true, symbol: true } } } } } },
        },
      },
      receivings: { where: { status: "DRAFT" }, select: { notes: true, finishShipment: true, items: { select: { productId: true, shipmentItemId: true, enteredUnitId: true, enteredGood: true, enteredDamaged: true, note: true } } } },
    },
  });
  if (!shipment) notFound();
  // Not arrived yet (or already finished / cancelled): the shipment page explains what to do next
  if (!canCount(shipment)) redirect(`/shipments/${id}`);

  const confirmed = await db.shipmentReceivingItem.groupBy({ by: ["productId"], where: { receiving: { shipmentId: id, status: "CONFIRMED" } }, _sum: { goodQty: true, damagedQty: true } });
  const counted = new Map(confirmed.map((c) => [c.productId, Number(c._sum.goodQty ?? 0) + Number(c._sum.damagedQty ?? 0)]));
  const draft = shipment.receivings[0];
  const draftBy = new Map((draft?.items ?? []).map((d) => [d.productId, d]));
  const baseUnits = await db.unit.findMany({ select: { id: true, name: true, symbol: true } });
  const baseUnit = new Map(baseUnits.map((u) => [u.id, u]));

  const rows: CountRow[] = shipment.items.map((i) => {
    const d = draftBy.get(i.productId);
    const base = baseUnit.get(i.product.baseUnitId)!;
    const units = [{ id: base.id, factor: 1 }, ...i.product.units.map((u) => ({ id: u.unitId, factor: Number(u.factor) }))];
    const pack = i.product.units.map((u) => ({ id: u.unitId, symbol: u.unit.symbol, factor: Number(u.factor) })).filter((u) => u.factor > 1).sort((x, y) => y.factor - x.factor)[0];
    const entered = d ? (units.find((u) => u.id === d.enteredUnitId)?.factor ?? 1) : 1;
    return {
      key: i.id,
      shipmentItemId: i.id,
      productId: i.productId,
      name: i.product.name,
      sku: i.product.sku,
      imageV: i.product.image ? i.product.image.updatedAt.getTime() : null,
      baseUnitId: base.id,
      baseSymbol: base.symbol,
      packUnitId: pack?.id ?? null,
      packSymbol: pack?.symbol ?? null,
      packFactor: pack?.factor ?? 1,
      expected: Number(i.expectedQty),
      counted: counted.get(i.productId) ?? 0,
      announcedText: i.unexpected ? "Not announced" : `${q(i.enteredQty)} ${i.enteredUnit.symbol}${i.factor.gt(1) ? ` (${q(i.expectedQty)} ${base.symbol})` : ""}`,
      goodBase: d ? Number((Number(d.enteredGood) * entered).toFixed(3)) : 0,
      damagedBase: d ? Number((Number(d.enteredDamaged) * entered).toFixed(3)) : 0,
      note: d?.note ?? "",
    };
  });

  // Goods the shop added to the draft earlier that are not on the shipment yet
  const catalogue = await getPickerProducts();
  const meta = Object.fromEntries((await db.product.findMany({ where: { status: "ACTIVE" }, select: { id: true, baseUnit: { select: { symbol: true } }, image: { select: { updatedAt: true } } } })).map((p) => [p.id, { imageV: p.image ? p.image.updatedAt.getTime() : null, baseSymbol: p.baseUnit.symbol }]));
  for (const d of draft?.items ?? []) {
    if (rows.some((r) => r.productId === d.productId)) continue;
    const p = catalogue.find((c) => c.id === d.productId);
    if (!p) continue;
    const pack = [...p.units].filter((u) => Number(u.factor) > 1).sort((x, y) => Number(y.factor) - Number(x.factor))[0];
    const entered = Number(p.units.find((u) => u.id === d.enteredUnitId)?.factor ?? 1);
    rows.push({ key: `new-${p.id}`, shipmentItemId: null, productId: p.id, name: p.name, sku: p.sku, imageV: meta[p.id]?.imageV ?? null, baseUnitId: p.baseUnitId, baseSymbol: meta[p.id]?.baseSymbol ?? "", packUnitId: pack?.id ?? null, packSymbol: pack?.symbol ?? null, packFactor: pack ? Number(pack.factor) : 1, expected: 0, counted: 0, announcedText: "Not announced", goodBase: Number((Number(d.enteredGood) * entered).toFixed(3)), damagedBase: Number((Number(d.enteredDamaged) * entered).toFixed(3)), note: d.note ?? "" });
  }

  return (
    <>
      <PageHeader
        title={`Count ${shipment.shipmentNo}`}
        description={[shipment.supplier?.name, shipment.cargoName ?? shipment.reference].filter(Boolean).join(" · ") || "Check what really arrived"}
        back={{ href: `/shipments/${id}`, label: shipment.shipmentNo }}
      />
      <div className="mb-4 space-y-3">
        <Alert kind="info">Most deliveries are fine: press <strong>Everything arrived fine</strong>. If something is wrong, type what <strong>arrived</strong> and open <strong>Damaged</strong>. Nothing goes into stock until you press <strong>Confirm</strong>.</Alert>
        {shipment.notes && <Alert kind="info">Note from the owner: {shipment.notes}</Alert>}
      </div>
      <ReceivingForm action={saveCount} shipmentId={id} shipmentNo={shipment.shipmentNo} rows={rows} catalogue={catalogue} catalogueMeta={meta} draftNotes={draft?.notes ?? ""} draftFinish={draft?.finishShipment ?? false} cancelHref={`/shipments/${id}`} />
    </>
  );
}
