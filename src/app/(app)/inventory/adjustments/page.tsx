import Link from "next/link";
import { ClipboardCheck, Plus } from "lucide-react";
import StockTabs from "@/components/inventory/StockTabs";
import { EmptyState, PageHeader } from "@/components/ui";
import { canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ADJUSTMENT_KIND_LABELS } from "@/lib/inventory/labels";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Stock adjustments" };

const ANY_ADJUST = ["inventory.adjust", "inventory.count", "inventory.report_damage"] as const;

export default async function AdjustmentsPage() {
  const user = await requireUser();
  if (!canAny(user, [...ANY_ADJUST, "inventory.movements"])) redirect("/forbidden");

  const rows = await db.stockAdjustment.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { location: { select: { name: true } }, createdBy: { select: { name: true } }, _count: { select: { items: true } } },
  });

  return (
    <>
      <PageHeader
        title="Stock adjustments"
        description="Damaged or missing stock, manual corrections and physical stock counts. Each one needs a reason and is kept permanently."
        actions={
          canAny(user, ANY_ADJUST) && (
            <Link href="/inventory/adjustments/new" className="btn-primary">
              <Plus size={16} /> New adjustment
            </Link>
          )
        }
      />
      <StockTabs active="adjustments" user={user} />
      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState icon={<ClipboardCheck size={22} />} title="No adjustments yet" description="Damage reports, corrections and stock counts will be listed here." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Adjustment</th>
                  <th>When</th>
                  <th>Type</th>
                  <th className="hidden sm:table-cell">Location</th>
                  <th className="hidden md:table-cell">Reason</th>
                  <th className="hidden lg:table-cell">By</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/inventory/adjustments/${a.id}`} className="font-medium text-navy-700 hover:underline">
                        {a.adjustmentNo}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">{formatDateTime(a.createdAt)}</td>
                    <td>
                      <span className={a.kind === "DAMAGE" ? "badge-red" : "badge-yellow"}>{ADJUSTMENT_KIND_LABELS[a.kind]}</span>
                    </td>
                    <td className="hidden sm:table-cell">{a.location.name}</td>
                    <td className="hidden max-w-xs truncate text-slate-600 md:table-cell">{a.reason}</td>
                    <td className="hidden text-slate-600 lg:table-cell">{a.createdBy.name}</td>
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
