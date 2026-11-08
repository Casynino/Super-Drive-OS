import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/ui";
import ProblemReports from "@/components/shipments/ProblemReports";
import { canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { getCurrency } from "@/lib/settings";
import { loadProblems } from "@/lib/shipments/problems";
import { decideProblemAction, reportProblemAction } from "../../shipments/actions";

export const metadata = { title: "Issues" };

/**
 * Damaged goods customers brought back (Nino 2026-11-08: "the cartons with a problem need an action; the list of delivery problems is the same as Investigation, drop it").
 * The pieces are already off the shelf; here the warehouse (or the Director) decides: not damaged after all (back on the shelf), write off, or sell cheaper.
 * Problems with deliveries and things found by hand live in Receiving → Investigation, so nothing is listed twice.
 */
export default async function IssuesPage() {
  const user = await requireUser();
  if (!canAny(user, ["warehouse.operate", "warehouse.view"])) redirect("/forbidden");
  const currency = await getCurrency();
  const [problems, openOrders, openByHand] = await Promise.all([loadProblems(db, { source: "return", decidedLimit: 30 }), db.shipment.count({ where: { issue: "OPEN" } }), db.stockProblem.count({ where: { action: null, adjustmentId: { not: null } } })]);
  const deliveryOpen = openOrders + openByHand;
  const asRow = (v: (typeof problems.open)[number]) => ({ ...v, baseSymbol: v.unit, reportedAt: v.reportedAt.toISOString(), decidedAt: v.decidedAt ? v.decidedAt.toISOString() : null });

  return (
    <>
      <PageHeader title="Issues" description="Damaged goods customers brought back. Decide what happens to each one." />
      <ProblemReports
        open={problems.open.map(asRow)}
        decided={problems.decided.map(asRow)}
        products={[]}
        canReport={false}
        reportAction={reportProblemAction}
        decideAction={decideProblemAction}
        currencySymbol={currency.symbol}
        title="Damaged goods returned by customers"
        intro="Nothing waits for a decision. Goods customers bring back damaged show up here."
        emptyText="No customer has brought damaged goods back yet."
      />
      {deliveryOpen > 0 && (
        <Link href="/shipments?tab=investigation" className="card flex items-center justify-between gap-3 px-4 py-3 text-sm transition hover:border-navy-200 sm:px-5">
          <span className="text-slate-700">
            <span className="font-semibold text-slate-900">{deliveryOpen}</span> problem{deliveryOpen === 1 ? "" : "s"} with deliveries or found on the shelf wait in <span className="font-medium">Receiving, Investigation</span>.
          </span>
          <ChevronRight size={16} className="shrink-0 text-slate-400" />
        </Link>
      )}
    </>
  );
}
