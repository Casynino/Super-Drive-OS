import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardCheck, PackageCheck, PackageOpen, Plus, Search as SearchIcon, ShieldAlert, Truck } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import KpiCard from "@/components/dashboard/KpiCard";
import KpiStrip from "@/components/dashboard/KpiStrip";
import ReceiptsTable from "@/components/inventory/ReceiptsTable";
import IssueRecords from "@/components/shipments/IssueRecords";
import ProblemReports from "@/components/shipments/ProblemReports";
import { loadProblems } from "@/lib/shipments/problems";
import { largestPack } from "@/lib/qty";
import { loadIssueRecords } from "@/lib/shipments/issues";
import { toIssueViews } from "@/lib/shipments/issue-view";
import { getUnitMode } from "@/lib/unit-mode";
import { fmtQty, inPacks } from "@/lib/qty";
import MarkArrivedButton from "@/components/shipments/MarkArrivedButton";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { todayYmd } from "@/lib/dashboard/range";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { canCount, canMarkArrived, shipmentPhase, type ShipmentPhase } from "@/lib/shipments/phase";
import { getCurrency } from "@/lib/settings";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { decideIssueAction, decideProblemAction, markArrivedAction, reportProblemAction } from "./actions";
import { PhaseBadge } from "./badges";

export async function generateMetadata() {
  const user = await requireUser();
  return { title: can(user, "shipments.manage") ? "Purchase orders" : "Receiving" };
}

type PhaseTab = "way" | "check" | "investigation" | "history";
type Tab = PhaseTab | "deliveries";
const TAB_PHASES: Record<PhaseTab, ShipmentPhase[]> = {
  way: ["ON_THE_WAY"],
  check: ["ARRIVED", "CHECKING"],
  investigation: ["INVESTIGATION"],
  history: ["DONE", "CANCELLED"],
};

export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; page?: string }> }) {
  const unitMode = await getUnitMode();
  const user = await requireUser();
  if (!canAny(user, ["shipments.manage", "shipments.receive"])) redirect("/forbidden");
  const sp = await searchParams;
  const manage = can(user, "shipments.manage");
  const receive = can(user, "shipments.receive");
  const staff = receive && !manage; // the warehouse person: for him this page is "Receiving" (deliveries to count), not purchase orders
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
  // Investigation shows the problem products themselves (not just the orders), each with its choices
  const issueViews = tab === "investigation" && list.length > 0 ? toIssueViews(await loadIssueRecords(db, { shipmentIds: list.map((r) => r.s.id), withCost: manage })) : [];
  // Problems reported by hand on products already in stock (the warehouse person AND the owner can report and decide them)
  const canReport = can(user, "inventory.report_damage") || manage;
  const canDecide = manage || receive;
  const openProblemCount = await db.stockProblem.count({ where: { action: null, adjustmentId: { not: null } } }); // goods a customer brought back damaged are decided on the warehouse Issues page
  const problems = tab === "investigation" ? await loadProblems(db, { source: "hand" }) : { open: [], decided: [] };
  const reportProducts =
    tab === "investigation" && canReport
      ? await (async () => {
          const wh = await db.location.findFirst({ where: { isDefault: true }, select: { id: true } });
          if (!wh) return [];
          const bal = await db.stockBalance.findMany({
            where: { locationId: wh.id, quantity: { gt: 0 }, product: { status: "ACTIVE" } },
            select: { quantity: true, reserved: true, product: { select: { id: true, name: true, sku: true, baseUnit: { select: { symbol: true } }, image: { select: { updatedAt: true } }, units: { select: { factor: true, unit: { select: { symbol: true } } } } } } },
          });
          return bal
            .map((b) => ({ id: b.product.id, name: b.product.name, sku: b.product.sku, imageV: b.product.image ? b.product.image.updatedAt.getTime() : null, available: Number(b.quantity.minus(b.reserved)), baseSymbol: b.product.baseUnit.symbol, pack: largestPack(b.product.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor }))) }))
            .filter((p) => p.available > 0)
            .sort((x, y) => x.name.localeCompare(y.name));
        })()
      : [];
  const asRow = (v: (typeof problems.open)[number]) => ({ ...v, baseSymbol: v.unit, reportedAt: v.reportedAt.toISOString(), decidedAt: v.decidedAt ? v.decidedAt.toISOString() : null });

  // The list scales: soonest / oldest first, search by number, cargo or supplier, 20 per page, and how much of each delivery is counted
  const q = (sp.q ?? "").trim();
  const ts = (d: Date | null | undefined) => d?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const ordered = [...list].sort((x, y) =>
    tab === "way" ? ts(x.s.expectedDate) - ts(y.s.expectedDate) : tab === "check" ? ts(x.s.arrivedAt) - ts(y.s.arrivedAt) : y.s.createdAt.getTime() - x.s.createdAt.getTime(),
  );
  const needle = q.toLowerCase();
  const shown = needle ? ordered.filter((r) => [r.s.shipmentNo, r.s.cargoName, r.s.reference, r.s.supplier?.name].some((v) => v?.toLowerCase().includes(needle))) : ordered;
  const PAGE = 20;
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const pageNo = Math.min(pages, Math.max(1, Math.floor(Number(sp.page)) || 1));
  const pageRows = shown.slice((pageNo - 1) * PAGE, pageNo * PAGE);
  const pageHref = (n: number) => `/shipments?tab=${tab}${q ? `&q=${encodeURIComponent(q)}` : ""}${n > 1 ? `&page=${n}` : ""}`;
  const countedIds = tab === "deliveries" || tab === "investigation" ? [] : pageRows.filter((r) => r.phase !== "ON_THE_WAY" && r.phase !== "CANCELLED").map((r) => r.s.id);
  const counted = new Map<string, number>();
  if (countedIds.length > 0) {
    const done = await db.shipmentReceivingItem.findMany({
      where: { receiving: { shipmentId: { in: countedIds }, status: "CONFIRMED" }, shipmentItemId: { not: null } },
      select: { goodQty: true, damagedQty: true, receiving: { select: { shipmentId: true } } },
    });
    for (const d of done) counted.set(d.receiving.shipmentId, (counted.get(d.receiving.shipmentId) ?? 0) + Number(d.goodQty) + Number(d.damagedQty));
  }

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
    { key: "check", label: staff ? "To count" : "To check" },
    { key: "investigation", label: "Investigation" },
    { key: "history", label: "History" },
    ...(deliveriesAllowed ? [{ key: "deliveries" as const, label: "Deliveries" }] : []),
  ];
  const countOf = (k: Tab) => (k === "deliveries" ? receiptCount : k === "investigation" ? counts.investigation + openProblemCount : counts[k]);
  const empty: Record<PhaseTab, { title: string; text: string }> = {
    way: { title: staff ? "No delivery is expected" : "Nothing is on the way", text: manage ? "Make a purchase order and it shows up here." : "When the Director announces a delivery it shows up here." },
    check: { title: staff ? "Nothing to count" : "Nothing to check", text: "When a delivery is marked as arrived it waits here to be counted." },
    investigation: { title: "No problems", text: "Damaged, missing or extra goods are listed here until they are investigated." },
    history: { title: staff ? "No finished deliveries yet" : "No finished orders yet", text: staff ? "Deliveries that are fully in stock appear here." : "Orders that are fully in stock appear here." },
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
        title={staff ? "Receiving" : "Purchase orders"}
        description={manage ? "Write down what you order. It goes on the way, the shop marks it arrived and checks it, and anything wrong comes back to you." : "Deliveries on their way to the warehouse. Mark one arrived, then count what you receive."}
        actions={
          manage && (
            <Link href="/shipments/new" className="btn-primary">
              <Plus size={16} /> New purchase order
            </Link>
          )
        }
      />

      {!staff && (
      <KpiStrip className="mb-5">
        <KpiCard
          icon={Truck}
          tone="blue"
          label="On the way"
          value={counts.way}
          hint={counts.way ? [`${Math.round(wayUnits)} items`, nextDue ? `next ${formatDate(nextDue)}` : null, manage && wayCost > 0 ? formatMoney(wayCost, currency) : null].filter(Boolean).join(" · ") : "Nothing coming"}
          href="/shipments?tab=way"
          active={tab === "way"}
        />
        <KpiCard icon={PackageCheck} tone="yellow" label={staff ? "To count" : "To check"} value={counts.check} hint={counts.check ? "Arrived, waiting to be counted" : "All counted"} href="/shipments?tab=check" active={tab === "check"} />
        <KpiCard icon={ShieldAlert} tone={counts.investigation ? "red" : "slate"} label="Investigation" value={counts.investigation} hint={counts.investigation ? "Damaged, missing or extra goods" : "No problems"} href="/shipments?tab=investigation" active={tab === "investigation"} />
        <KpiCard icon={PackageOpen} tone="green" label="In stock" value={doneRecently} hint="Fully received, last 30 days" href={deliveriesAllowed ? "/shipments?tab=deliveries" : "/shipments?tab=history"} active={tab === "deliveries" || (!deliveriesAllowed && tab === "history")} />
      </KpiStrip>
      )}

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
              <span className={cn("rounded-full px-1.5 text-xs font-semibold", active ? "bg-white/20 text-white" : t.key === "investigation" && counts.investigation + openProblemCount > 0 ? "bg-brand-red text-white" : "bg-slate-100 text-slate-600")}>{countOf(t.key)}</span>
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
      ) : tab === "investigation" ? (
        <>
        <ProblemReports open={problems.open.map(asRow)} decided={problems.decided.map(asRow)} products={reportProducts} canReport={canReport} reportAction={reportProblemAction} decideAction={decideProblemAction} currencySymbol={currency.symbol} />
        {list.length === 0 ? (
          !canReport && problems.open.length === 0 && problems.decided.length === 0 ? (
            <section className="card overflow-hidden">
              <EmptyState icon={<SearchIcon size={22} />} title={empty.investigation.title} description={empty.investigation.text} />
            </section>
          ) : null
        ) : (
        <div className="space-y-4">
          {list.map((r) => {
            const s = r.s;
            const mine = issueViews.filter((v) => v.shipmentId === s.id);
            const openRows = mine.filter((v) => v.open > 0);
            const open = openRows.length;
            // everything still in question on this order, in the unit the person chose
            const inQuestion = openRows.reduce((t, v) => t + (unitMode === "pcs" ? v.open : inPacks(v.open, v.pack)), 0);
            const inQuestionText = unitMode === "pcs" ? `${fmtQty(inQuestion)} PCS` : `${fmtQty(Number(inQuestion.toFixed(1)))} CTN`;
            return (
              <section key={s.id} className="card overflow-hidden" aria-label={`Investigation ${s.shipmentNo}`}>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
                  <div>
                    <Link href={`/shipments/${s.id}`} className="font-semibold text-navy-700 hover:underline">
                      {s.shipmentNo}
                    </Link>
                    <span className="ml-2 text-sm text-slate-500">
                      {[s.supplier?.name, s.cargoName ?? s.reference].filter(Boolean).join(" · ")}
                      {s.arrivedAt ? ` · arrived ${formatDateTime(s.arrivedAt)}` : ""}
                    </span>
                  </div>
                  <span className="badge-red">{open > 0 ? `${open} product${open === 1 ? "" : "s"} to decide · ${inQuestionText} in question` : "Open"}</span>
                </div>
                {mine.length > 0 ? (
                  <IssueRecords mode={unitMode} currencySymbol={currency.symbol} records={mine} canAct={canDecide} action={decideIssueAction} />
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm text-slate-600">
                    <span>This order has a problem on record. Open it to see the details.</span>
                    <Link href={`/shipments/${s.id}`} className="btn-primary btn-sm">
                      Open order
                    </Link>
                  </div>
                )}
              </section>
            );
          })}
        </div>
        )}
        </>
      ) : (
      <section className="card overflow-hidden">
        {list.length === 0 ? (
          <EmptyState
            icon={tab === "way" ? <Truck size={22} /> : tab === "check" ? <ClipboardCheck size={22} /> : <PackageOpen size={22} />}
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
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
              <p className="text-sm text-slate-600">
                <span className="font-semibold text-slate-900">{shown.length}</span> {tab === "way" ? "on the way" : tab === "check" ? (staff ? "to count" : "to check") : tab === "history" ? "finished" : "in investigation"}
                {" · "}
                {Math.round(shown.reduce((t, r) => t + units(r.s), 0))} items
                {tab === "way" ? " · soonest first" : tab === "check" ? " · waiting longest first" : ""}
              </p>
              <form action="/shipments" className="flex items-center gap-2">
                <input type="hidden" name="tab" value={tab} />
                <input name="q" defaultValue={q} placeholder="Search deliveries" autoComplete="off" className="input h-9 w-full min-w-0 text-sm sm:w-64" aria-label="Search deliveries" />
                <button type="submit" className="btn-secondary btn-sm h-9">
                  Search
                </button>
                {q && (
                  <Link href={`/shipments?tab=${tab}`} className="text-sm text-slate-500 hover:text-slate-800">
                    Clear
                  </Link>
                )}
              </form>
            </div>
            {pageRows.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-500">Nothing matches &ldquo;{q}&rdquo;.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{staff ? "Delivery" : "Order"}</th>
                      <th className="hidden md:table-cell">Items</th>
                      <th className="hidden sm:table-cell">{tab === "way" ? "Expected" : "Arrived"}</th>
                      {staff && tab !== "way" && <th className="hidden lg:table-cell">Counted</th>}
                      <th className={staff ? "hidden sm:table-cell" : undefined}>Status</th>
                      {manage && <th className="hidden text-right lg:table-cell">Cost</th>}
                      <th className="text-right">&nbsp;</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r) => {
                      const s = r.s;
                      const late = r.phase === "ON_THE_WAY" && isLate(s);
                      const edge = late || r.phase === "INVESTIGATION" ? "border-l-brand-red" : r.phase === "ARRIVED" || r.phase === "CHECKING" ? "border-l-oil-400" : "border-l-transparent";
                      const total = units(s);
                      const got = counted.get(s.id) ?? 0;
                      const pct = total > 0 ? Math.min(100, Math.round((got / total) * 100)) : 0;
                      return (
                        <tr key={s.id}>
                          <td className={cn(staff && "border-l-[3px]", staff && edge)}>
                            <Link href={`/shipments/${s.id}`} className="whitespace-nowrap font-semibold text-navy-700 hover:underline">
                              {s.shipmentNo}
                            </Link>
                            <span className="block text-xs text-slate-500">{[s.supplier?.name, s.cargoName ?? s.reference].filter(Boolean).join(" · ") || `Announced ${formatDate(s.createdAt)}`}</span>
                            {staff && (
                              <span className="mt-0.5 block text-xs text-slate-500 md:hidden">
                                {productCount(s)} product{productCount(s) === 1 ? "" : "s"} · {Math.round(total)} items
                              </span>
                            )}
                            {staff && (
                              <span className="mt-1.5 block sm:hidden">
                                <PhaseBadge phase={r.phase} />
                              </span>
                            )}
                          </td>
                          <td className="hidden md:table-cell">
                            {productCount(s)} product{productCount(s) === 1 ? "" : "s"}
                            <span className="block text-xs text-slate-500">{Math.round(total)} items</span>
                          </td>
                          <td className="hidden sm:table-cell">
                            {r.phase === "ON_THE_WAY" ? (
                              <>
                                {s.expectedDate ? formatDate(s.expectedDate) : <span className="text-slate-400">No date</span>}
                                {late && <span className="badge-red ml-2">Late</span>}
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
                          {staff && tab !== "way" && (
                            <td className="hidden lg:table-cell">
                              {r.phase === "CANCELLED" ? (
                                <span className="text-slate-400">—</span>
                              ) : got <= 0 ? (
                                <span className="text-xs text-slate-500">Not counted yet</span>
                              ) : (
                                <div className="w-36">
                                  <p className="text-xs tabular-nums text-slate-600">
                                    <span className="font-semibold text-slate-900">{Math.round(got)}</span> of {Math.round(total)} items
                                  </p>
                                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Counted so far">
                                    <div className={cn("h-full rounded-full", pct >= 100 ? "bg-emerald-500" : "bg-oil-400")} style={{ width: `${pct}%` }} />
                                  </div>
                                </div>
                              )}
                            </td>
                          )}
                          <td className={staff ? "hidden sm:table-cell" : undefined}>
                            <PhaseBadge phase={r.phase} />
                          </td>
                          {manage && <td className="hidden text-right font-medium lg:table-cell">{formatMoney(cost(s), currency)}</td>}
                          <td className="whitespace-nowrap text-right">{action(r)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {pages > 1 && (
              <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-slate-600">
                <span>
                  {(pageNo - 1) * PAGE + 1}&ndash;{Math.min(pageNo * PAGE, shown.length)} of {shown.length}
                </span>
                <span className="flex items-center gap-2">
                  {pageNo > 1 ? (
                    <Link href={pageHref(pageNo - 1)} className="btn-secondary btn-sm">
                      Previous
                    </Link>
                  ) : null}
                  {pageNo < pages ? (
                    <Link href={pageHref(pageNo + 1)} className="btn-secondary btn-sm">
                      Next
                    </Link>
                  ) : null}
                </span>
              </div>
            )}
          </>
        )}
      </section>
      )}
    </>
  );
}
