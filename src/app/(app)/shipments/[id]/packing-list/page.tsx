import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import PrintButton from "@/components/PrintButton";
import { PageHeader } from "@/components/ui";
import PackingListSheet, { type SheetRow } from "@/components/shipments/PackingListSheet";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { getBusinessProfile, getCurrency } from "@/lib/settings";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Packing list" };

/**
 * The packing list of one purchase order as a paper document: see it nicely arranged, print it, or save it as PDF from the print window.
 * Prices are only ever read for the owner and only when asked for (?prices=1); the shop's copy never carries them.
 */
export default async function PackingListPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ prices?: string }> }) {
  const user = await requireUser();
  if (!canAny(user, ["shipments.manage", "shipments.receive"])) redirect("/forbidden");
  const { id } = await params;
  const sp = await searchParams;
  const manage = can(user, "shipments.manage");
  const showPrices = manage && sp.prices === "1";

  const shipment = await db.shipment.findUnique({
    where: { id },
    include: {
      supplier: { select: { name: true } },
      location: { select: { name: true } },
      createdBy: { select: { name: true } },
      items: {
        where: { unexpected: false },
        orderBy: { id: "asc" },
        select: {
          productId: true,
          expectedQty: true,
          enteredQty: true,
          factor: true,
          enteredUnit: { select: { symbol: true } },
          product: { select: { name: true, sku: true, barcode: true, baseUnit: { select: { symbol: true } }, image: { select: { updatedAt: true } } } },
          ...(showPrices ? { unitCost: true, lineCost: true } : {}),
        },
      },
    },
  });
  if (!shipment) notFound();
  const [biz, currency] = await Promise.all([getBusinessProfile(), getCurrency()]);

  const rows: SheetRow[] = shipment.items.map((i) => {
    const m = i as unknown as { unitCost?: { toString(): string } | null; lineCost?: { toString(): string } | null };
    return {
      name: i.product.name,
      code: i.product.sku,
      barcode: i.product.barcode,
      imageUrl: i.product.image ? `/api/product-image/${i.productId}?size=thumb&v=${i.product.image.updatedAt.getTime()}` : null,
      packed: `${Number(i.enteredQty.toFixed(3))} ${i.enteredUnit.symbol}`,
      pieces: Number(i.expectedQty),
      unitPrice: m.unitCost != null ? Number(m.unitCost.toString()) : null,
      lineTotal: m.lineCost != null ? Number(m.lineCost.toString()) : null,
    };
  });

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={`Packing list · ${shipment.shipmentNo}`}
          description="Look it over, then press Print. In the print window choose “Save as PDF” to download it."
          back={{ href: `/shipments/${id}`, label: shipment.shipmentNo }}
          actions={
            <>
              {manage && (
                <Link href={showPrices ? `/shipments/${id}/packing-list` : `/shipments/${id}/packing-list?prices=1`} className="btn-secondary">
                  {showPrices ? <EyeOff size={16} /> : <Eye size={16} />} {showPrices ? "Hide buying prices" : "Show buying prices"}
                </Link>
              )}
              <PrintButton label="Print / Save as PDF" />
            </>
          }
        />
      </div>
      <div className="bg-slate-100 p-3 sm:p-6 print:bg-transparent print:p-0">
        <PackingListSheet
          data={{
            number: shipment.shipmentNo,
            dateText: formatDate(shipment.createdAt),
            business: { name: biz.name, address: biz.address, phone: biz.phone },
            supplier: shipment.supplier?.name ?? null,
            cargo: shipment.cargoName ?? shipment.reference ?? null,
            expected: shipment.expectedDate ? formatDate(shipment.expectedDate) : null,
            deliverTo: shipment.location.name,
            notes: shipment.notes,
            preparedBy: shipment.createdBy.name,
            currencySymbol: currency.symbol,
            showPrices,
            rows,
          }}
        />
      </div>
    </>
  );
}
