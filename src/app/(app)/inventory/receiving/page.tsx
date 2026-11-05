import Link from "next/link";
import { PackageCheck, Plus } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Stock receiving" };

export default async function ReceivingPage() {
  const user = await requireUser();
  if (!canAny(user, ["inventory.receive", "inventory.movements", "purchasing.view"])) redirect("/forbidden");
  const showCost = can(user, "inventory.valuation") || can(user, "products.cost");
  const currency = await getCurrency();

  const receipts = await db.stockReceipt.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { supplier: { select: { name: true } }, location: { select: { name: true } }, receivedBy: { select: { name: true } }, _count: { select: { items: true } } },
  });

  return (
    <>
      <PageHeader
        title="Stock receiving"
        description="Every delivery that adds stock. Stock only increases here, once the goods are physically received."
        actions={
          can(user, "inventory.receive") && (
            <Link href="/inventory/receiving/new" className="btn-primary">
              <Plus size={16} /> Receive stock
            </Link>
          )
        }
      />
      <div className="card overflow-hidden">
        {receipts.length === 0 ? (
          <EmptyState icon={<PackageCheck size={22} />} title="No stock received yet" description="Record your first delivery, or enter the stock you already have as opening stock." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Date</th>
                  <th className="hidden sm:table-cell">From</th>
                  <th className="hidden md:table-cell">Into</th>
                  <th className="text-right">Items</th>
                  {showCost && <th className="text-right">Total cost</th>}
                  <th className="hidden lg:table-cell">Received by</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/inventory/receiving/${r.id}`} className="font-medium text-navy-700 hover:underline">
                        {r.receiptNo}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">{formatDate(r.receivedDate)}</td>
                    <td className="hidden sm:table-cell">{r.type === "OPENING_STOCK" ? <span className="badge-yellow">Opening stock</span> : (r.supplier?.name ?? "—")}</td>
                    <td className="hidden md:table-cell">{r.location.name}</td>
                    <td className="text-right">{r._count.items}</td>
                    {showCost && <td className="text-right font-medium">{formatMoney(r.totalCost, currency)}</td>}
                    <td className="hidden text-slate-600 lg:table-cell">{r.receivedBy.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
