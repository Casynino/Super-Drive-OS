import { notFound, redirect } from "next/navigation";
import { Alert, DetailGrid, PageHeader } from "@/components/ui";
import DocumentMovements from "@/components/inventory/DocumentMovements";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Stock receipt" };

export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const user = await requireUser();
  if (!canAny(user, ["inventory.receive", "inventory.movements", "purchasing.view"])) redirect("/forbidden");
  const { id } = await params;
  const sp = await searchParams;
  const showCost = can(user, "inventory.valuation") || can(user, "products.cost");
  const currency = await getCurrency();

  const r = await db.stockReceipt.findUnique({
    where: { id },
    include: {
      supplier: { select: { name: true } },
      location: { select: { name: true } },
      receivedBy: { select: { name: true } },
      items: { include: { product: { select: { name: true, sku: true, baseUnit: { select: { symbol: true } } } }, enteredUnit: { select: { symbol: true } } }, orderBy: { id: "asc" } },
    },
  });
  if (!r) notFound();

  return (
    <>
      <PageHeader title={r.receiptNo} description={r.type === "OPENING_STOCK" ? "Opening stock" : "Delivery from supplier"} back={{ href: "/inventory/receiving", label: "Deliveries" }} />
      {sp.created && (
        <div className="mb-4">
          <Alert kind="success">Stock received. Quantities are now in the stock ledger.</Alert>
        </div>
      )}

      <div className="card card-pad mb-5">
        <DetailGrid
          items={[
            { label: "Date received", value: formatDate(r.receivedDate) },
            { label: "Into location", value: r.location.name },
            { label: "Supplier", value: r.type === "OPENING_STOCK" ? "—" : r.supplier?.name },
            { label: "Supplier invoice", value: r.supplierInvoice },
            { label: "Received by", value: r.receivedBy.name },
            { label: "Recorded", value: formatDateTime(r.createdAt) },
            ...(showCost ? [{ label: "Total cost", value: <span className="font-semibold">{formatMoney(r.totalCost, currency)}</span> }] : []),
            { label: "Notes", value: r.notes },
          ]}
        />
      </div>

      <section className="card mb-5 overflow-hidden">
        <h2 className="border-b border-line px-5 py-3 text-base font-semibold text-slate-900">Items received</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="text-right">Received</th>
                <th className="text-right">In stock units</th>
                {showCost && <th className="hidden text-right sm:table-cell">Unit cost</th>}
                {showCost && <th className="text-right">Line total</th>}
              </tr>
            </thead>
            <tbody>
              {r.items.map((i) => (
                <tr key={i.id}>
                  <td>
                    <span className="font-medium">{i.product.name}</span>
                    <span className="block text-xs text-slate-500">{i.product.sku}</span>
                  </td>
                  <td className="text-right">
                    {i.enteredQty.toString()} {i.enteredUnit.symbol}
                  </td>
                  <td className="text-right">
                    {i.quantity.toString()} {i.product.baseUnit.symbol}
                  </td>
                  {showCost && <td className="hidden text-right sm:table-cell">{formatMoney(i.unitCost, { ...currency, decimals: Math.max(currency.decimals, 2) })}</td>}
                  {showCost && <td className="text-right font-medium">{formatMoney(i.lineTotal, currency)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-5 py-3 text-base font-semibold text-slate-900">Stock ledger entries</h2>
        <DocumentMovements referenceType="StockReceipt" referenceId={r.id} showCost={showCost} currency={currency} />
      </section>
    </>
  );
}
