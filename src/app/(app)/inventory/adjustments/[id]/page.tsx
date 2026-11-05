import { notFound, redirect } from "next/navigation";
import { Alert, DetailGrid, PageHeader } from "@/components/ui";
import DocumentMovements from "@/components/inventory/DocumentMovements";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { ADJUSTMENT_KIND_LABELS } from "@/lib/inventory/labels";
import { getCurrency } from "@/lib/settings";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Stock adjustment" };

export default async function AdjustmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const user = await requireUser();
  if (!canAny(user, ["inventory.adjust", "inventory.count", "inventory.report_damage", "inventory.movements"])) redirect("/forbidden");
  const { id } = await params;
  const sp = await searchParams;
  const currency = await getCurrency();

  const a = await db.stockAdjustment.findUnique({
    where: { id },
    include: {
      location: { select: { name: true } },
      createdBy: { select: { name: true } },
      items: { include: { product: { select: { name: true, sku: true, baseUnit: { select: { symbol: true } } } }, enteredUnit: { select: { symbol: true } } }, orderBy: { id: "asc" } },
    },
  });
  if (!a) notFound();

  return (
    <>
      <PageHeader title={a.adjustmentNo} description={ADJUSTMENT_KIND_LABELS[a.kind]} back={{ href: "/inventory/adjustments", label: "Stock adjustments" }} />
      {sp.created && (
        <div className="mb-4">
          <Alert kind="success">Recorded. Changed quantities are now in the stock ledger.</Alert>
        </div>
      )}
      <div className="card card-pad mb-5">
        <DetailGrid
          items={[
            { label: "Location", value: a.location.name },
            { label: "Recorded by", value: a.createdBy.name },
            { label: "When", value: formatDateTime(a.createdAt) },
            { label: "Reason", value: a.reason },
          ]}
        />
      </div>
      <section className="card mb-5 overflow-hidden">
        <h2 className="border-b border-line px-5 py-3 text-base font-semibold text-slate-900">{a.kind === "COUNT" ? "Counted" : "Products"}</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="text-right">{a.kind === "COUNT" ? "Counted" : "Entered"}</th>
                <th className="text-right">System before</th>
                <th className="text-right">Change</th>
              </tr>
            </thead>
            <tbody>
              {a.items.map((i) => (
                <tr key={i.id}>
                  <td className="font-medium">{i.product.name}</td>
                  <td className="text-right">
                    {i.enteredQty.toString()} {i.enteredUnit.symbol}
                  </td>
                  <td className="text-right">
                    {i.systemQty.toString()} {i.product.baseUnit.symbol}
                  </td>
                  <td className={`text-right font-semibold ${i.delta.isNegative() ? "text-brand-red-dark" : i.delta.isZero() ? "text-slate-500" : "text-emerald-700"}`}>
                    {i.delta.isZero() ? "No difference" : `${i.delta.isPositive() ? "+" : ""}${i.delta.toString()} ${i.product.baseUnit.symbol}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-5 py-3 text-base font-semibold text-slate-900">Stock ledger entries</h2>
        <DocumentMovements referenceType="StockAdjustment" referenceId={a.id} showCost={can(user, "inventory.valuation")} currency={currency} />
      </section>
    </>
  );
}
