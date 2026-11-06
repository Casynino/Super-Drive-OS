import Link from "next/link";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import KpiCard from "@/components/dashboard/KpiCard";
import BarList from "@/components/reports/BarList";
import { PageHeader } from "@/components/ui";
import { Boxes, Lock, PackageCheck, PackageOpen, TriangleAlert } from "lucide-react";
import { can } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { businessDay } from "@/lib/cash/ledger";
import { getWarehouseSnapshot } from "@/lib/warehouse/dashboard";
import { EVENT_LABEL } from "@/lib/warehouse/labels";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Warehouse overview" };

const nf = (v: number) => new Intl.NumberFormat("en-US").format(Math.round(v));

/** The Director's view of the Store Warehouse: stock, receiving, sales and collections, and what each attendant has done. */
export default async function WarehouseOverviewPage() {
  const user = await requireUser();
  if (!can(user, "warehouse.view")) redirect(can(user, "warehouse.operate") ? "/warehouse" : "/forbidden");
  const todayStart = new Date(`${businessDay()}T00:00:00+03:00`);
  const since30 = new Date(Date.now() - 30 * 86_400_000);

  const [s, staff, events, sold] = await Promise.all([
    getWarehouseSnapshot(db),
    db.user.findMany({ where: { OR: [{ role: { permissions: { some: { permission: { key: "warehouse.operate" } } } } }, { warehouseEvents: { some: {} } }, { pickupReleases: { some: {} } }] }, select: { id: true, name: true, status: true, role: { select: { name: true } } }, orderBy: { name: "asc" } }),
    db.warehouseEvent.findMany({ orderBy: { createdAt: "desc" }, take: 14, include: { user: { select: { name: true } }, pickupNote: { select: { id: true, noteNo: true } }, product: { select: { name: true } } } }),
    db.$queryRaw<{ q: Prisma.Decimal | null }[]>`SELECT SUM(i."quantity") AS q FROM "PickupReleaseItem" i JOIN "PickupRelease" r ON r."id" = i."releaseId" WHERE r."createdAt" >= ${since30}`,
  ]);

  // what each attendant did: goods counted in, goods handed over, refused scans, and when he was last active
  const people = await Promise.all(
    staff.map(async (u) => {
      const [received, receivedQty, releases, releasedQty, refused, last, todayCount] = await Promise.all([
        db.shipmentReceiving.count({ where: { confirmedById: u.id, status: "CONFIRMED", confirmedAt: { gte: since30 } } }),
        db.$queryRaw<{ g: Prisma.Decimal | null; d: Prisma.Decimal | null }[]>`SELECT SUM(i."goodQty") AS g, SUM(i."damagedQty") AS d FROM "ShipmentReceivingItem" i JOIN "ShipmentReceiving" r ON r."id" = i."receivingId" WHERE r."confirmedById" = ${u.id} AND r."status" = 'CONFIRMED' AND r."confirmedAt" >= ${since30}`,
        db.pickupRelease.count({ where: { releasedById: u.id, createdAt: { gte: since30 } } }),
        db.$queryRaw<{ q: Prisma.Decimal | null }[]>`SELECT SUM(i."quantity") AS q FROM "PickupReleaseItem" i JOIN "PickupRelease" r ON r."id" = i."releaseId" WHERE r."releasedById" = ${u.id} AND r."createdAt" >= ${since30}`,
        db.warehouseEvent.count({ where: { userId: u.id, type: "SCAN_REJECTED", createdAt: { gte: since30 } } }),
        db.warehouseEvent.findFirst({ where: { userId: u.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
        db.pickupRelease.count({ where: { releasedById: u.id, createdAt: { gte: todayStart } } }),
      ]);
      return { u, received, good: Number(receivedQty[0]?.g ?? 0), damaged: Number(receivedQty[0]?.d ?? 0), releases, released: Number(releasedQty[0]?.q ?? 0), refused, last: last?.createdAt ?? null, todayCount };
    }),
  );

  return (
    <>
      <PageHeader title="Warehouse overview" description="Stock, receiving, sales and collections at the Store Warehouse, and who did what." actions={<Link href="/warehouse/stock" className="btn-secondary">Warehouse stock</Link>} />

      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Stock</h2>
      <section className="mb-6 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(13.5rem,1fr))]">
        <KpiCard icon={Boxes} tone="navy" label="Products in the warehouse" value={nf(s.products)} hint="with stock on the shelf" href="/warehouse/stock" />
        <KpiCard icon={PackageCheck} tone="slate" label="In the warehouse" value={nf(s.physical)} hint="pieces, physically here" />
        <KpiCard icon={PackageOpen} tone="green" label="Available" value={nf(s.available)} hint="can still be sold" />
        <KpiCard icon={Lock} tone="yellow" label="Reserved" value={nf(s.reserved)} hint="sold, waiting to be collected" href="/warehouse/stock?s=reserved" />
        <KpiCard icon={TriangleAlert} tone={s.out + s.low > 0 ? "red" : "slate"} label="Low or out of stock" value={nf(s.out + s.low)} hint={`${s.out} out · ${s.low} low`} href="/warehouse/stock?s=low" />
      </section>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <section className="card card-pad">
          <h2 className="text-base font-semibold text-slate-900">Receiving</h2>
          <p className="mb-4 text-xs text-slate-500">Deliveries from China</p>
          <BarList
            highlightFirst={false}
            rows={[
              { label: "On the way", value: s.inbound.filter((i) => !i.arrivedAt).length, text: String(s.inbound.filter((i) => !i.arrivedAt).length) },
              { label: "Arrived, waiting to be counted", value: s.inbound.filter((i) => i.arrivedAt).length, text: String(s.inbound.filter((i) => i.arrivedAt).length) },
              { label: "With a discrepancy to decide", value: s.issuesOpen, text: String(s.issuesOpen), note: s.issuesOpen > 0 ? "Missing, damaged or different from the order" : undefined, warn: true },
            ]}
          />
          <p className="mt-4 text-sm">
            <Link href="/shipments" className="font-medium text-navy-700 hover:underline">
              All deliveries
            </Link>
            <span className="mx-2 text-slate-300">·</span>
            <Link href="/warehouse/discrepancies" className="font-medium text-navy-700 hover:underline">
              Discrepancies
            </Link>
          </p>
        </section>
        <section className="card card-pad">
          <h2 className="text-base font-semibold text-slate-900">Sales and collections</h2>
          <p className="mb-4 text-xs text-slate-500">{nf(Number(sold[0]?.q ?? 0))} pieces handed over in the last 30 days</p>
          <BarList
            highlightFirst={false}
            rows={[
              { label: "New, not started", value: s.isNew, text: String(s.isNew) },
              { label: "Being prepared", value: s.preparing, text: String(s.preparing) },
              { label: "Ready for collection", value: s.ready, text: String(s.ready) },
              { label: "Partly collected", value: s.partial, text: String(s.partial) },
              { label: "Collected", value: s.completed, text: String(s.completed) },
              { label: "Cancelled", value: s.cancelled, text: String(s.cancelled) },
            ]}
          />
          <p className="mt-4 text-sm">
            <Link href="/warehouse/orders" className="font-medium text-navy-700 hover:underline">
              All pickup notes
            </Link>
            <span className="mx-2 text-slate-300">·</span>
            <Link href="/warehouse/history" className="font-medium text-navy-700 hover:underline">
              Collected goods
            </Link>
          </p>
        </section>
      </div>

      <section className="card mb-6 overflow-hidden" aria-label="Who did what">
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <h2 className="text-base font-semibold text-slate-900">Who did what</h2>
          <p className="text-xs text-slate-500">Last 30 days</p>
        </div>
        {people.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">No one works in the warehouse yet. Add a member with the Warehouse / Store role.</p>
        ) : (
          <div className="table-wrap">
            <table className="table w-full md:table-fixed">
              <colgroup>
                <col className="md:w-[20%]" />
                <col className="md:w-[19%]" />
                <col className="md:w-[19%]" />
                <col className="md:w-[14%]" />
                <col className="md:w-[14%]" />
                <col className="md:w-[14%]" />
              </colgroup>
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="text-right">Goods received</th>
                  <th className="text-right">Goods released</th>
                  <th className="hidden text-right md:table-cell">Today</th>
                  <th className="hidden text-right md:table-cell">Refused scans</th>
                  <th className="text-right">Last active</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.u.id} className="relative">
                    <td className="font-medium">
                      <Link href={`/employees/${p.u.id}`} className="after:absolute after:inset-0 after:content-[''] hover:text-navy-700">
                        {p.u.name}
                      </Link>
                      <span className="block text-xs font-normal text-slate-500">{p.u.role.name}</span>
                    </td>
                    <td className="text-right tabular-nums">
                      {nf(p.good)} pieces
                      <span className="block text-xs text-slate-500">
                        {p.received} count{p.received === 1 ? "" : "s"}
                        {p.damaged > 0 ? ` · ${nf(p.damaged)} damaged` : ""}
                      </span>
                    </td>
                    <td className="text-right tabular-nums">
                      {nf(p.released)} pieces
                      <span className="block text-xs text-slate-500">
                        {p.releases} handover{p.releases === 1 ? "" : "s"}
                      </span>
                    </td>
                    <td className="hidden text-right tabular-nums md:table-cell">{p.todayCount}</td>
                    <td className={cn("hidden text-right tabular-nums md:table-cell", p.refused > 0 && "font-semibold text-amber-600")}>{p.refused}</td>
                    <td className="whitespace-nowrap text-right text-xs text-slate-500">{p.last ? formatDateTime(p.last) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card overflow-hidden" aria-label="Latest activity">
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <h2 className="text-base font-semibold text-slate-900">Latest activity</h2>
        </div>
        {events.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 text-sm sm:px-5">
                <span className="min-w-0">
                  <span className="font-medium text-slate-900">{EVENT_LABEL[e.type]}</span>
                  {e.pickupNote ? (
                    <Link href={`/warehouse/orders/${e.pickupNote.id}`} className="ml-2 font-mono text-[13px] text-navy-700 hover:underline">
                      {e.pickupNote.noteNo}
                    </Link>
                  ) : null}
                  <span className="ml-2 text-slate-500">
                    {e.user.name}
                    {e.product ? ` · ${e.product.name}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-slate-500">{formatDateTime(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
