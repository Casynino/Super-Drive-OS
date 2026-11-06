import Link from "next/link";
import { PackageCheck } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/utils";

export type ReceiptRow = {
  id: string;
  receiptNo: string;
  date: Date;
  openingStock: boolean;
  supplier: string | null;
  location: string;
  lines: number;
  /** already formatted; null when the person may not see costs */
  cost: string | null;
  receivedBy: string;
};

/** The delivery receipts (GRN): goods that arrived, were counted and went into stock. Shared by Orders → Deliveries and the old Deliveries page. */
export default function ReceiptsTable({ rows, showCost }: { rows: ReceiptRow[]; showCost: boolean }) {
  if (rows.length === 0) return <EmptyState icon={<PackageCheck size={22} />} title="No stock received yet" description="When the shop checks an order, the goods that arrived fine show up here and go into stock." />;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Receipt</th>
            <th>Date</th>
            <th className="hidden sm:table-cell">From</th>
            <th className="hidden md:table-cell">Into</th>
            <th className="text-right">Products</th>
            {showCost && <th className="text-right">Total cost</th>}
            <th className="hidden lg:table-cell">Received by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={`/inventory/receiving/${r.id}`} className="font-medium text-navy-700 hover:underline">
                  {r.receiptNo}
                </Link>
              </td>
              <td className="whitespace-nowrap">{formatDate(r.date)}</td>
              <td className="hidden sm:table-cell">{r.openingStock ? <span className="badge-yellow">Opening stock</span> : (r.supplier ?? "—")}</td>
              <td className="hidden md:table-cell">{r.location}</td>
              <td className="text-right">{r.lines}</td>
              {showCost && <td className="text-right font-medium">{r.cost ?? "—"}</td>}
              <td className="hidden text-slate-600 lg:table-cell">{r.receivedBy}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
