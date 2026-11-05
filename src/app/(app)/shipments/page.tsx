import Link from "next/link";
import { ArrowRight, PackageOpen, Plus, Truck } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";
import { formatDate } from "@/lib/utils";
import { IssueBadge, ShipmentStatusBadge } from "./badges";

export const metadata = { title: "Incoming stock" };

export default async function ShipmentsPage() {
  const user = await requireUser();
  if (!canAny(user, ["shipments.manage", "shipments.receive"])) redirect("/forbidden");
  const manage = can(user, "shipments.manage");
  const currency = await getCurrency();

  const shipments = await db.shipment.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: 100,
    include: {
      supplier: { select: { name: true } },
      location: { select: { name: true } },
      // costs are only read for the owner; the shop never receives them
      items: { select: { expectedQty: true, unexpected: true, ...(manage ? { lineCost: true } : {}) } },
    },
  });
  const waiting = shipments.filter((s) => s.status === "EXPECTED" || s.status === "PARTIAL");
  const done = shipments.filter((s) => s.status === "RECEIVED" || s.status === "CANCELLED");
  const cost = (s: (typeof shipments)[number]) => s.items.reduce((sum, i) => sum + Number((i as { lineCost?: { toString(): string } | null }).lineCost ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Incoming stock"
        description={manage ? "Announce stock you have bought. The shop counts it when it arrives, and anything wrong comes back to you." : "Stock that is on its way to the shop. Open it when it arrives and count what you receive."}
        actions={
          manage && (
            <Link href="/shipments/new" className="btn-primary">
              <Plus size={16} /> New shipment
            </Link>
          )
        }
      />

      <section className="mb-6">
        <h2 className="mb-3 text-base font-semibold text-slate-900">{manage ? "On the way" : "Waiting for you to count"} ({waiting.length})</h2>
        {waiting.length === 0 ? (
          <div className="card">
            <EmptyState icon={<Truck size={22} />} title="Nothing is on the way" description={manage ? "Announce a shipment so the shop knows what to expect." : "When the owner announces new stock it appears here."} />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {waiting.map((s) => (
              <Link key={s.id} href={`/shipments/${s.id}`} className="card card-pad group block transition hover:-translate-y-0.5 hover:border-navy-300 hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-base font-semibold text-slate-900">{s.shipmentNo}</p>
                    <p className="text-sm text-slate-500">{s.supplier?.name ?? "No supplier"}</p>
                  </div>
                  <ShipmentStatusBadge status={s.status} />
                </div>
                <p className="mt-3 text-sm text-slate-600">
                  {s.items.filter((i) => !i.unexpected).length} product{s.items.filter((i) => !i.unexpected).length === 1 ? "" : "s"}
                  {s.expectedDate && <> · expected {formatDate(s.expectedDate)}</>}
                </p>
                {s.reference && <p className="text-xs text-slate-500">Ref: {s.reference}</p>}
                <div className="mt-3 flex items-center justify-between">
                  {manage ? <span className="text-sm font-semibold text-slate-900">{formatMoney(cost(s), currency)}</span> : <span />}
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-navy-700">
                    {manage ? "Open" : s.status === "PARTIAL" ? "Continue counting" : "Count it"} <ArrowRight size={15} className="transition group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="card overflow-hidden">
        <h2 className="border-b border-line px-5 py-3 text-base font-semibold text-slate-900">Earlier shipments</h2>
        {done.length === 0 ? (
          <EmptyState icon={<PackageOpen size={22} />} title="No finished shipments yet" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Shipment</th>
                  <th className="hidden sm:table-cell">Supplier</th>
                  <th className="hidden md:table-cell">Products</th>
                  {manage && <th className="text-right">Cost</th>}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {done.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/shipments/${s.id}`} className="font-medium text-navy-700 hover:underline">
                        {s.shipmentNo}
                      </Link>
                      <span className="block text-xs text-slate-500">{formatDate(s.createdAt)}</span>
                    </td>
                    <td className="hidden sm:table-cell">{s.supplier?.name ?? "—"}</td>
                    <td className="hidden md:table-cell">{s.items.length}</td>
                    {manage && <td className="text-right font-medium">{formatMoney(cost(s), currency)}</td>}
                    <td className="space-x-1.5">
                      <ShipmentStatusBadge status={s.status} />
                      <IssueBadge issue={s.issue} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
