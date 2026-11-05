import { formatMoney, type CurrencyConfig } from "@/lib/money";
import { db } from "@/lib/db";
import { MOVEMENT_LABELS } from "@/lib/inventory/labels";

/** The ledger rows a document produced: the proof that stock really moved. */
export default async function DocumentMovements({
  referenceType,
  referenceId,
  showCost,
  currency,
}: {
  referenceType: string;
  referenceId: string;
  showCost: boolean;
  currency: CurrencyConfig;
}) {
  const moves = await db.stockMovement.findMany({
    where: { referenceType, referenceId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { product: { select: { name: true, baseUnit: { select: { symbol: true } } } }, location: { select: { name: true } } },
  });
  if (moves.length === 0) return <p className="px-5 py-6 text-sm text-slate-500">No stock was changed by this document.</p>;

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Location</th>
            <th>Type</th>
            <th className="text-right">Change</th>
            <th className="text-right">Stock before → after</th>
            {showCost && <th className="hidden text-right md:table-cell">Unit cost</th>}
          </tr>
        </thead>
        <tbody>
          {moves.map((m) => {
            const t = MOVEMENT_LABELS[m.type]!;
            const neg = m.quantity.isNegative();
            return (
              <tr key={m.id}>
                <td className="font-medium">{m.product.name}</td>
                <td>{m.location.name}</td>
                <td>
                  <span className={t.badge}>{t.label}</span>
                </td>
                <td className={`text-right font-semibold ${neg ? "text-brand-red-dark" : "text-emerald-700"}`}>
                  {neg ? "" : "+"}
                  {m.quantity.toString()} {m.product.baseUnit.symbol}
                </td>
                <td className="whitespace-nowrap text-right text-slate-600">
                  {m.previousQty.toString()} → {m.newQty.toString()}
                </td>
                {showCost && <td className="hidden text-right md:table-cell">{m.unitCost ? formatMoney(m.unitCost, { ...currency, decimals: Math.max(currency.decimals, 2) }) : "—"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
