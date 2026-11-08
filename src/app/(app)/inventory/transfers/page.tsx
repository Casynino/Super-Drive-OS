import Link from "next/link";
import { ArrowLeftRight, Plus } from "lucide-react";
import StockTabs from "@/components/inventory/StockTabs";
import { EmptyState, PageHeader } from "@/components/ui";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Stock transfers" };

export default async function TransfersPage() {
  const user = await requireUser();
  if (!canAny(user, ["inventory.transfer", "inventory.movements"])) redirect("/forbidden");

  const transfers = await db.stockTransfer.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { fromLocation: { select: { name: true } }, toLocation: { select: { name: true } }, createdBy: { select: { name: true } }, _count: { select: { items: true } } },
  });

  return (
    <>
      <PageHeader
        title="Stock transfers"
        description="Move stock between your locations. The total never changes, only where it is."
        actions={
          can(user, "inventory.transfer") && (
            <Link href="/inventory/transfers/new" className="btn-primary">
              <Plus size={16} /> New transfer
            </Link>
          )
        }
      />
      <StockTabs active="transfers" user={user} />
      <div className="card overflow-hidden">
        {transfers.length === 0 ? (
          <EmptyState icon={<ArrowLeftRight size={22} />} title="No transfers yet" description="Transfers appear here once you move stock from one location to another." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Transfer</th>
                  <th>When</th>
                  <th>From → To</th>
                  <th className="text-right">Items</th>
                  <th className="hidden md:table-cell">By</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link href={`/inventory/transfers/${t.id}`} className="font-medium text-navy-700 hover:underline">
                        {t.transferNo}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">{formatDateTime(t.createdAt)}</td>
                    <td>
                      {t.fromLocation.name} → {t.toLocation.name}
                    </td>
                    <td className="text-right">{t._count.items}</td>
                    <td className="hidden text-slate-600 md:table-cell">{t.createdBy.name}</td>
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
