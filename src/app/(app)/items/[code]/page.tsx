import { redirect } from "next/navigation";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ImageOff, Printer } from "lucide-react";
import { PageHeader } from "@/components/ui";
import ItemStatusBadge from "@/components/products/ItemStatusBadge";
import QrImage from "@/components/products/QrImage";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { findItemByCode } from "@/lib/inventory/items";
import { LABELS_ENABLED, PIECE_LIST_ENABLED } from "@/lib/features";
import { ITEM_EVENT_LABEL } from "@/lib/inventory/item-labels";
import { itemQrText } from "@/lib/qr";
import { getCurrency } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Item" };

export default async function ItemPage({ params }: { params: Promise<{ code: string }> }) {
  if (!PIECE_LIST_ENABLED) redirect("/products");
  const user = await requirePagePermission("inventory.view");
  const { code } = await params;
  const found = await findItemByCode(db, decodeURIComponent(code));
  if (!found) notFound();

  const [item, history, currency] = await Promise.all([
    db.inventoryItem.findUniqueOrThrow({
      where: { id: found.id },
      include: {
        product: { select: { id: true, name: true, sku: true, size: true, sellingPrice: true, brand: { select: { name: true } }, category: { select: { name: true } }, image: { select: { updatedAt: true } } } },
        location: { select: { name: true } },
        shipment: { select: { id: true, shipmentNo: true, reference: true, cargoName: true } },
        receipt: { select: { id: true, receiptNo: true } },
      },
    }),
    can(user, "inventory.movements") ? db.itemMovement.findMany({ where: { itemId: found.id }, orderBy: { createdAt: "asc" }, include: { user: { select: { name: true } } } }) : Promise.resolve(null),
    getCurrency(),
  ]);
  const [sale, locs] = await Promise.all([
    item.saleId ? db.sale.findUnique({ where: { id: item.saleId }, select: { id: true, saleNo: true } }) : null,
    history ? db.location.findMany({ where: { id: { in: [...new Set(history.flatMap((m) => [m.fromLocationId, m.toLocationId].filter((x): x is string => Boolean(x))))] } }, select: { id: true, name: true } }) : [],
  ]);
  const locName = new Map(locs.map((l) => [l.id, l.name]));
  const canSeeSale = can(user, "sales.view_all") || can(user, "sales.view_own");

  return (
    <>
      <PageHeader
        title={item.itemNo}
        description={item.product.name}
        back={{ href: "/items", label: "Items" }}
        actions={
          <>
            <ItemStatusBadge status={item.status} />
            {LABELS_ENABLED && (
              <Link href={`/items/labels?ids=${item.id}`} className="btn-secondary btn-sm">
                <Printer size={14} /> Reprint label
              </Link>
            )}
          </>
        }
      />

      <div className={`mb-5 grid gap-5 ${LABELS_ENABLED ? "lg:grid-cols-[1fr_220px]" : ""}`}>
        <section className="card card-pad">
          <div className="flex items-start gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-white">
              {item.product.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/product-image/${item.product.id}?size=thumb&v=${item.product.image.updatedAt.getTime()}`} alt="" className="h-full w-full object-contain" />
              ) : (
                <ImageOff size={22} className="text-slate-300" />
              )}
            </div>
            <div className="min-w-0">
              <Link href={`/products/${item.product.id}`} className="text-lg font-semibold text-slate-900 hover:underline">
                {item.product.name}
              </Link>
              <p className="text-sm text-slate-500">{[item.product.brand?.name, item.product.size, item.product.category.name].filter(Boolean).join(" · ")}</p>
              <p className="mt-1 font-mono text-xs text-slate-400">{item.product.sku}</p>
            </div>
          </div>
          <dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { label: "Status", value: <ItemStatusBadge status={item.status} /> },
              { label: "Location", value: item.location.name },
              { label: "Selling price", value: formatMoney(item.product.sellingPrice, currency) },
              { label: "Received", value: formatDate(item.receivedAt) },
              { label: "Shipment", value: item.shipment ? <Link href={`/shipments/${item.shipment.id}`} className="text-navy-700 hover:underline">{item.shipment.shipmentNo}{item.shipment.reference ? ` · ${item.shipment.reference}` : ""}</Link> : null },
              { label: "Receipt", value: item.receipt ? (can(user, "inventory.movements") ? <Link href={`/inventory/receiving/${item.receipt.id}`} className="text-navy-700 hover:underline">{item.receipt.receiptNo}</Link> : item.receipt.receiptNo) : null },
              { label: item.status === "SOLD" ? "Sold on" : "Last sale", value: sale ? (canSeeSale ? <Link href={`/sales/${sale.id}`} className="text-navy-700 hover:underline">{sale.saleNo}</Link> : sale.saleNo) : null },
              { label: "Last movement", value: formatDateTime(item.updatedAt) },
            ].map((f) => (
              <div key={f.label}>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{f.label}</dt>
                <dd className="mt-1 text-sm text-slate-900">{f.value || "—"}</dd>
              </div>
            ))}
          </dl>
        </section>
        {LABELS_ENABLED && (
          <section className="card card-pad text-center">
            <div className="mx-auto w-40 overflow-hidden rounded-lg border border-line bg-white p-1">
              <QrImage text={itemQrText(item.token)} label={`QR code for ${item.itemNo}`} />
            </div>
            <p className="mt-2 font-mono text-sm font-semibold text-slate-900">{item.itemNo}</p>
            <p className="text-xs text-slate-500">This piece's own code. It never changes.</p>
          </section>
        )}
      </div>

      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-5 py-3 text-base font-semibold text-slate-900">Movement history</h2>
        {history === null ? (
          <p className="px-5 py-6 text-sm text-slate-500">You can see where this item is now. The full history is for people who can view stock movements.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Activity</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th className="hidden md:table-cell">Reference</th>
                  <th className="hidden md:table-cell">By</th>
                </tr>
              </thead>
              <tbody>
                {history.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap">{formatDateTime(m.createdAt)}</td>
                    <td>
                      <span className="font-medium">{ITEM_EVENT_LABEL[m.kind]}</span>
                      {m.auto && <span className="block text-xs text-slate-500">Taken by quantity, not picked by its number</span>}
                      {m.note && <span className="block text-xs text-slate-500">{m.note}</span>}
                    </td>
                    <td>
                      {m.fromLocationId && m.fromLocationId !== m.toLocationId ? `${locName.get(m.fromLocationId) ?? "—"} → ` : ""}
                      {locName.get(m.toLocationId) ?? "—"}
                    </td>
                    <td>
                      <ItemStatusBadge status={m.toStatus} />
                    </td>
                    <td className="hidden text-slate-600 md:table-cell">{m.referenceNo ?? "—"}</td>
                    <td className="hidden text-slate-600 md:table-cell">{m.user?.name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
