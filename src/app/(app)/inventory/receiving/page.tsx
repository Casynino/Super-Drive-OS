import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/ui";
import ReceiptsTable from "@/components/inventory/ReceiptsTable";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";

export const metadata = { title: "Deliveries" };

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
        title="Deliveries"
        description="Every delivery that came into stock. Stock only goes up once the goods are physically received."
        actions={
          can(user, "inventory.receive") && (
            <Link href="/inventory/receiving/new" className="btn-primary">
              <Plus size={16} /> Receive stock
            </Link>
          )
        }
      />
      <div className="card overflow-hidden">
        <ReceiptsTable
          rows={receipts.map((r) => ({ id: r.id, receiptNo: r.receiptNo, date: r.receivedDate, openingStock: r.type === "OPENING_STOCK", supplier: r.supplier?.name ?? null, location: r.location.name, lines: r._count.items, cost: showCost ? formatMoney(r.totalCost, currency) : null, receivedBy: r.receivedBy.name }))}
          showCost={showCost}
        />
      </div>
    </>
  );
}
