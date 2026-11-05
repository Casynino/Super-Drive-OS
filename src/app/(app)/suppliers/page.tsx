import Link from "next/link";
import { Plus, Truck } from "lucide-react";
import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSupplierBalances } from "@/lib/cash/supplier";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const user = await requireUser();
  if (!canAny(user, ["suppliers.view", "suppliers.manage"])) redirect("/forbidden");
  const canManage = can(user, "suppliers.manage");
  const [suppliers, balances, currency] = await Promise.all([
    db.supplier.findMany({ orderBy: [{ status: "asc" }, { name: "asc" }], include: { _count: { select: { receipts: true } } } }),
    can(user, "suppliers.pay") ? getSupplierBalances(db) : Promise.resolve([]),
    getCurrency(),
  ]);
  const owed = new Map(balances.map((b) => [b.id, b]));
  const showOwed = can(user, "suppliers.pay");

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Who you buy from, and what you owe them. Pay a supplier from their page."
        actions={
          canManage && (
            <Link href="/suppliers/new" className="btn-primary">
              <Plus size={16} /> Add supplier
            </Link>
          )
        }
      />
      <div className="card overflow-hidden">
        {suppliers.length === 0 ? (
          <EmptyState icon={<Truck size={22} />} title="No suppliers yet" description="Add the businesses you buy oil from so deliveries can be linked to them." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th className="hidden sm:table-cell">Contact</th>
                  <th className="hidden md:table-cell">Phone</th>
                  <th className="text-right">Deliveries</th>
                  {showOwed && <th className="text-right">We owe</th>}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {canManage ? (
                        <Link href={`/suppliers/${s.id}`} className="font-medium text-slate-900 hover:text-navy-700 hover:underline">
                          {s.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{s.name}</span>
                      )}
                    </td>
                    <td className="hidden text-slate-600 sm:table-cell">{s.contactPerson ?? "—"}</td>
                    <td className="hidden text-slate-600 md:table-cell">{s.phone ?? "—"}</td>
                    <td className="text-right">{s._count.receipts}</td>
                    {showOwed && <td className={`text-right tabular-nums ${(owed.get(s.id)?.owed ?? 0) > 0 ? "font-semibold text-slate-900" : "text-slate-400"}`}>{formatMoney(owed.get(s.id)?.owed ?? 0, currency)}</td>}
                    <td>
                      <StatusBadge status={s.status} />
                    </td>
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
