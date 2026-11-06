import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardCheck, PackageCheck, PackageOpen, Plus, Search as SearchIcon, ShieldAlert, Truck } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import KpiCard from "@/components/dashboard/KpiCard";
import ReceiptsTable from "@/components/inventory/ReceiptsTable";
import MarkArrivedButton from "@/components/shipments/MarkArrivedButton";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { todayYmd } from "@/lib/dashboard/range";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { canCount, canMarkArrived, shipmentPhase, type ShipmentPhase } from "@/lib/shipments/phase";
import { getCurrency } from "@/lib/settings";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { markArrivedAction } from "./actions";
import { PhaseBadge } from "./badges";

export const metadata = { title: "Purchase orders" };

type PhaseTab = "way" | "check" | "investigation" | "history";
type Tab = PhaseTab | "deliveries";
const TAB_PHASES: Record<PhaseTab, ShipmentPhase[]> = {
  way: ["ON_THE_WAY"],
  check: ["ARRIVED", "CHECKING"],
  investigation: ["INVESTIGATION"],
  history: ["DONE", "CANCELLED"],
};

export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  if (!canAny(user, ["shipments.manage", "shipments.receive"])) redirect("/forbidden");
  const sp = await searchParams;
  const manage = can(user, "shipments.manage");
  const receive = can(user, "shipments.receive");
  const currency = await getCurrency();
  // The goods that were counted into stock (delivery receipts) live here too, for people who may see them
  const deliveriesAllowed = canAny(user, ["inventory.receive", "inventory.movements", "purchasing.view"]);
  const showCost = can(user, "inventory.valuation") || can(user, "products.cost");
  const wantDeliveries = deliveriesAllowed && sp.tab === "deliveries";
  const [receiptCount, receipts] = deliveriesAllowed
    ? await Promise.all([
        db.stockReceipt.count(),
        wantDeliveries
          ? db.stockReceipt.findMany({
              orderBy: { createdAt: "desc" },
              take: 100,
              include: { supplier: { select: { name: true } }, location: { select: { name: true } }, receivedBy: { select: { name: true } }, _count: { select: { items: true } } },
            })
          : Promise.resolve([]),
      ])
    : [0, []];

  const shipments = await db.shipment.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: 200,
    include: {
      supplier: { select: { name: true } },
      arrivedBy: { select: { name: true } },
      // costs are only read for the owner; the shop never receives them
      items: { select: { expectedQty: true, unexpected: true, ...(manage ? { lineCost: true } : {}) } },
    },
  });
  const rows = shipments.map((s) => ({ s, phase: shipmentPhase(s) }));
  const inTab = (t: PhaseTab) => rows.filter((r) => TAB_PHASES[t].includes(r.phase));
  const counts: Record<PhaseTab, number> = { way: inTab("way").length, check: inTab("check").length, investigation: inTab("investigation").length, history: inTab("history").length };

  const fallback: PhaseTab = manage && counts.investigation > 0 ? "investigation" : receive && counts.check > 0 ? "check" : counts.way > 0 ? "way" : counts.check > 0 ? "check" : counts.investigation > 0 ? "investigation" : "history";
  const tab: Tab = wantDeliveries ? "deliveries" : sp.tab && sp.tab in TAB_PHASES ? (sp.tab as PhaseTab) : fallback;
  const list = tab === "deliveries" ? [] : inTab(tab);

  const units = (s: (typeof shipments)[number]) => s.items.filter((i) => !i.unexpected).reduce((sum, i) => sum + Number(i.expectedQty), 0);
  const productCount = (s: (typeof shipments)[number]) => s.items.filter((i) => !i.unexpected).length;
  const cost = (s: (typeof shipments)[number]) => s.items.reduce((sum, i) => sum + Number((i as { lineCost?: { toString(): string } | null }).lineCost ?? 0), 0);
  const today = todayYmd();
  const isLate = (s: (typeof shipments)[number]) => Boolean(s.expectedDate && s.expectedDate.toISOString().slice(0, 10) < today);

  const wayRows = inTab("way");
  const wayUnits = wayRows.reduce((sum, r) => sum + units(r.s), 0);
  const wayCost = wayRows.reduce((sum, r) => sum + cost(r.s), 0);
  const nextDue = wayRows.map((r) => r.s.expectedDate).filter((d): d is Date => Boolean(d)).sort((a, b) => a.getTime() - b.getTime())[0];
  const since = Date.now() - 30 * 24 * 3600 * 1000;
  const doneRecently = rows.filter((r) => r.phase === "DONE" && (r.s.closedAt?.getTime() ?? 0) >= since).length;

  const tabs: { key: Tab; label: string }[] = [
    { key: "way", label: "On the way" },
    { key: "check", label: "To check" },
    { key: "investigation", label: "Investigation" },
    { key: "history", label: "History" },
    ...(deliveriesAllowed ? [{ key: "deliveries" as const, label: "Deliveries" }] : []),
  ];
  const countOf = (k: Tab) => (k === "deliveries" ? receiptCount : counts[k]);
  const empty: Record<PhaseTab, { title: string; text: string }> = {
    way: { title: "Nothing is on the way", text: manage ? "Make a purchase order and it shows up here." : "When the owner sends a purchase order it shows up here." },
    check: { title: "Nothing to check", text: "When a delivery is marked as arrived it waits here to be counted." },
    investigation: { title: "No problems", text: "Damaged, missing or extra goods are listed here until they are investigated." },
    history: { title: "No finished orders yet", text: "Orders that are fully in stock appear here." },
  };

  const action = (r: (typeof rows)[number]) => {
    const s = r.s;
    if (receive && canMarkArrived(s)) return <MarkArrivedButton shipmentId={s.id} action={markArrivedAction} small />;
    if (receive && canCount(s))
      return (
        <Link href={`/shipments/${s.id}/receive`} className="btn-primary btn-sm">
          <ClipboardCheck size={14} /> {r.phase === "CHECKING" || r.phase === "INVESTIGATION" ? "Keep checking" : "Check it"}
        </Link>
      );
    if (manage && r.phase === "INVESTIGATION")
      return (
        <Link href={`/shipments/${s.id}`} className="btn-primary btn-sm">
          <ShieldAlert size={14} /> Investigate
        </Link>
      );
    return (
      <Link href={`/shipments/${s.id}`} className="btn-secondary btn-sm">
        Open
      </Link>
    );
  };

  return (
    <>
      <PageHeader
        title="Purchase orders"
        description={manage ? "Write down what you order. It goes on the way, the shop marks it arrived and checks it, and anything wrong comes back to you." : "Orders on their way to the shop. Mark one arrived, then check what you receive."}
        actions={
          manage && (
            <Link href="/shipments/new" className="btn-primary">
              <Plus size={16} /> New purchase order
            </Link>
          )
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard
          icon={Truck}
          tone="blue"
          label="On the way"
          value={counts.way}
          hint={counts.way ? [`${Math.round(wayUnits)} items`, nextDue ? `next ${formatDate(nextDue)}` : null, manage && wayCost > 0 ? formatMoney(wayCost, currency) : null].filter(Boolean).join(" · ") : "Nothing coming"}
          href="/shipments?tab=way"
          active={tab === "way"}
        />
        <KpiCard icon={PackageCheck} tone="yellow" label="To check" value={counts.check} hint={counts.check ? "Arrived, waiting to be counted" : "All counted"} href="/shipments?tab=check" active={tab === "check"} />
        <KpiCard icon={ShieldAlert} tone={counts.investigation ? "red" : "slate"} label="Investigation" value={counts.investigation} hint={counts.investigation ? "Damaged, missing or extra goods" : "No problems"} href="/shipments?tab=investigation" active={tab === "investigation"} />
        <KpiCard icon={PackageOpen} tone="green" label="In stock" value={doneRecently} hint="Fully received, last 30 days" href={deliveriesAllowed ? "/shipments?tab=deliveries" : "/shipments?tab=history"} active={tab === "deliveries" || (!deliveriesAllowed && tab === "history")} />
      </div>

      <nav className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Order stages">
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <Link
              key={t.key}
              href={`/shipments?tab=${t.key}`}
              aria-current={active ? "page" : undefined}
              className={cn("inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition", active ? "border-navy-700 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900")}
            >
              {t.label}
              <span className={cn("rounded-full px-1.5 text-xs font-semibold", active ? "bg-white/20 text-white" : t.key === "investigation" && counts.investigation > 0 ? "bg-brand-red text-white" : "bg-slate-100 text-slate-600")}>{countOf(t.key)}</span>
            </Link>
          );
        })}
      </nav>

      {tab === "deliveries" ? (
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <p className="text-sm text-slate-600">Goods that arrived, were checked by the shop and are now in stock. Damaged pieces are written off and missing ones never show here.</p>
            {can(user, "inventory.receive") && (
              <Link href="/inventory/receiving/new" className="btn-secondary btn-sm">
                <Plus size={14} /> Receive stock
              </Link>
            )}
          </div>
          <ReceiptsTable
            rows={receipts.map((r) => ({ id: r.id, receiptNo: r.receiptNo, date: r.receivedDate, openingStock: r.type === "OPENING_STOCK", supplier: r.supplier?.name ?? null, location: r.location.name, lines: r._count.items, cost: showCost ? formatMoney(r.totalCost, currency) : null, receivedBy: r.receivedBy.name }))}
            showCost={showCost}
          />
        </section>
      ) : (
      <section className="card overflow-hidden">
        {list.length === 0 ? (
          <EmptyState
            icon={tab === "way" ? <Truck size={22} /> : tab === "check" ? <ClipboardCheck size={22} /> : tab === "investigation" ? <SearchIcon size={22} /> : <PackageOpen size={22} />}
            title={empty[tab].title}
            description={empty[tab].text}
            action={
              tab === "way" && manage ? (
                <Link href="/shipments/new" className="btn-primary">
                  <Plus size={16} /> New purchase order
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th className="hidden md:table-cell">Items</th>
                  <th className="hidden sm:table-cell">{tab === "way" ? "Expected" : "Arrived"}</th>
                  <th>Status</th>
                  {manage && <th className="hidden text-right lg:table-cell">Cost</th>}
                  <th className="text-right">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const s = r.s;
                  return (
                    <tr key={s.id}>
                      <td>
                        <Link href={`/shipments/${s.id}`} className="font-semibold text-navy-700 hover:underline">
                          {s.shipmentNo}
                        </Link>
                        <span className="block text-xs text-slate-500">{[s.supplier?.name, s.cargoName ?? s.reference].filter(Boolean).join(" · ") || `Announced ${formatDate(s.createdAt)}`}</span>
                      </td>
                      <td className="hidden md:table-cell">
                        {productCount(s)} product{productCount(s) === 1 ? "" : "s"}
                        <span className="block text-xs text-slate-500">{Math.round(units(s))} items</span>
                      </td>
                      <td className="hidden sm:table-cell">
                        {r.phase === "ON_THE_WAY" ? (
                          <>
                            {s.expectedDate ? formatDate(s.expectedDate) : <span className="text-slate-400">No date</span>}
                            {isLate(s) && <span className="badge-red ml-2">Late</span>}
                          </>
                        ) : r.phase === "CANCELLED" ? (
                          <span className="text-slate-400">Cancelled</span>
                        ) : s.arrivedAt ? (
                          <>
                            {formatDateTime(s.arrivedAt)}
                            {s.arrivedBy && <span className="block text-xs text-slate-500">by {s.arrivedBy.name}</span>}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <PhaseBadge phase={r.phase} />
                      </td>
                      {manage && <td className="hidden text-right font-medium lg:table-cell">{formatMoney(cost(s), currency)}</td>}
                      <td className="text-right">{action(r)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}
    </>
  );
}
