import { notFound, redirect } from "next/navigation";
import { Alert, DetailGrid, PageHeader } from "@/components/ui";
import DocumentMovements from "@/components/inventory/DocumentMovements";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { getCurrency } from "@/lib/settings";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Stock transfer" };

export default async function TransferPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const user = await requireUser();
  if (!canAny(user, ["inventory.transfer", "inventory.movements"])) redirect("/forbidden");
  const { id } = await params;
  const sp = await searchParams;
  const currency = await getCurrency();

  const t = await db.stockTransfer.findUnique({
    where: { id },
    include: {
      fromLocation: { select: { name: true } },
      toLocation: { select: { name: true } },
      createdBy: { select: { name: true } },
      items: { include: { product: { select: { name: true, sku: true, baseUnit: { select: { symbol: true } } } }, enteredUnit: { select: { symbol: true } } }, orderBy: { id: "asc" } },
    },
  });
  if (!t) notFound();

  return (
    <>
      <PageHeader title={t.transferNo} back={{ href: "/inventory/transfers", label: "Stock transfers" }} />
      {sp.created && (
        <div className="mb-4">
          <Alert kind="success">Transfer completed.</Alert>
        </div>
      )}
      <div className="card card-pad mb-5">
        <DetailGrid
          items={[
            { label: "From", value: t.fromLocation.name },
            { label: "To", value: t.toLocation.name },
            { label: "Recorded by", value: t.createdBy.name },
            { label: "When", value: formatDateTime(t.createdAt) },
            { label: "Notes", value: t.notes },
          ]}
        />
      </div>
      <section className="card mb-5 overflow-hidden">
        <h2 className="border-b border-line px-5 py-3 text-base font-semibold text-slate-900">Items moved</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="text-right">Entered</th>
                <th className="text-right">In stock units</th>
              </tr>
            </thead>
            <tbody>
              {t.items.map((i) => (
                <tr key={i.id}>
                  <td className="font-medium">{i.product.name}</td>
                  <td className="text-right">
                    {i.enteredQty.toString()} {i.enteredUnit.symbol}
                  </td>
                  <td className="text-right">
                    {i.quantity.toString()} {i.product.baseUnit.symbol}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-5 py-3 text-base font-semibold text-slate-900">Stock ledger entries</h2>
        <DocumentMovements referenceType="StockTransfer" referenceId={t.id} showCost={can(user, "inventory.valuation")} currency={currency} />
      </section>
    </>
  );
}
