import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, CircleCheck, ClipboardList, Boxes, Lock, Package, PackageCheck, PackageOpen, ScanLine, ScrollText, Search, Timer, TriangleAlert, Truck } from "lucide-react";
import KpiCard from "@/components/dashboard/KpiCard";
import { ColumnsChart, DonutChart } from "@/components/dashboard/Charts";
import HomeBanner from "@/components/HomeBanner";
import QuickIcons from "@/components/QuickIcons";
import BarList from "@/components/reports/BarList";
import { qtyText } from "@/lib/qty";
import { getUnitMode } from "@/lib/unit-mode";
import { can } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { getWarehouseSnapshot } from "@/lib/warehouse/dashboard";
import { EVENT_LABEL } from "@/lib/warehouse/labels";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Home" };

const nf = (v: number) => new Intl.NumberFormat("en-US").format(Math.round(v));
const dayWord = (d: Date) => {
  const n = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`;
};

/** The warehouse attendant's day: what needs him, the numbers that matter, what is waiting and what is coming. */
export default async function WarehouseHome() {
  const user = await requireUser();
  if (!can(user, "warehouse.operate")) redirect(can(user, "warehouse.view") ? "/warehouse/overview" : "/forbidden");
  const [s, mine] = await Promise.all([
    getWarehouseSnapshot(db),
    db.warehouseEvent.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 8, include: { pickupNote: { select: { noteNo: true } }, product: { select: { name: true } } } }),
  ]);
  const unitMode = await getUnitMode();
  const arrived = s.inbound.filter((i) => i.arrivedAt);
  const onTheWay = s.inbound.filter((i) => !i.arrivedAt);

  const attention: { key: string; title: string; detail: string; figure?: string; href: string; tone: "red" | "amber" | "blue" }[] = [
    ...(s.issuesOpen > 0 ? [{ key: "issues", title: `${s.issuesOpen} deliver${s.issuesOpen === 1 ? "y" : "ies"} with a discrepancy`, detail: "Goods missing, damaged or different from the order.", href: "/warehouse/discrepancies", tone: "red" as const }] : []),
    ...(s.isNew > 0 ? [{ key: "new", title: `${s.isNew} new order${s.isNew === 1 ? "" : "s"} to prepare`, detail: "Sold, paid or on approved credit, and waiting for you.", figure: s.oldest ? `oldest ${dayWord(s.oldest.createdAt)}` : undefined, href: "/warehouse/orders?f=new", tone: "amber" as const }] : []),
    ...(arrived.length > 0 ? [{ key: "arrived", title: `${arrived.length} deliver${arrived.length === 1 ? "y" : "ies"} to count`, detail: "Arrived at the warehouse. Count it and confirm what is good and what is not.", href: "/shipments", tone: "amber" as const }] : []),
    ...(s.partial > 0 ? [{ key: "partial", title: `${s.partial} partly collected`, detail: "Part of the goods left. The rest is still reserved for the person.", href: "/warehouse/orders?f=partial", tone: "amber" as const }] : []),
    ...(s.ready > 0 ? [{ key: "ready", title: `${s.ready} ready for collection`, detail: "Picked and set aside. Waiting for the person to come.", href: "/warehouse/orders?f=ready", tone: "blue" as const }] : []),
    ...(s.out + s.low > 0 ? [{ key: "stock", title: `${s.out} out of stock, ${s.low} running low`, detail: "Tell the Director so more can be ordered.", href: "/warehouse/stock?s=out", tone: "amber" as const }] : []),
  ];
  const max = Math.max(1, ...s.days.flatMap((d) => [d.received, d.released]));
  const totalIn = s.days.reduce((t, d) => t + d.received, 0);
  const totalOut = s.days.reduce((t, d) => t + d.released, 0);

  // the five things he does all day, one tap each (a phone shows them as icons)
  const quick: { href: string; label: string; icon: typeof ScanLine; n?: number; primary?: boolean }[] = [
    { href: "/warehouse/scan", label: "Scan", icon: ScanLine, primary: true },
    { href: "/shipments", label: "Receiving", icon: Truck, n: arrived.length },
    { href: "/warehouse/orders", label: "Pickups", icon: ClipboardList, n: s.isNew },
    { href: "/warehouse/stock", label: "Stock", icon: Boxes, n: s.out + s.low },
    { href: "/warehouse/discrepancies", label: "Issues", icon: ScrollText, n: s.issuesOpen },
  ];
  const okN = Math.max(s.activeProducts - s.out - s.low, 0);
  const COUNT = { symbol: "", decimals: 0 }; // the charts format numbers as money; these are plain counts
  const shelfTop = Math.max(1, ...s.shelf.map((p) => p.available));
  const ordersTotal = s.ordersPerDay.reduce((t, d) => t + d.value, 0);
  const hoursText = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`);
  const reservedRows = s.shelf
    .filter((p) => p.reserved > 0)
    .sort((a, b) => b.reserved - a.reserved)
    .slice(0, 6)
    .map((p) => ({ label: p.name, value: p.reserved, text: qtyText(p.reserved, p.pack, p.symbol, unitMode).main }));
  const totalN = Math.max(s.activeProducts, 1);

  return (
    <>
      <HomeBanner user={user} />

      <QuickIcons fill className="mb-5" label="Quick actions" items={quick.map((q) => ({ href: q.href, label: q.label, icon: q.icon, n: q.n, accent: q.primary }))} />


      <form action="/warehouse/orders" method="get" className="mb-5 flex gap-2">
        <input type="hidden" name="f" value="open" />
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input name="q" placeholder="Find a pickup note, customer, sale or product" className="input h-11 pl-10" aria-label="Find an order" />
        </div>
        <button className="btn-secondary h-11" type="submit">
          Search
        </button>
      </form>

      <section className="mb-5" aria-label="Needs your attention">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          Needs your attention <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] normal-case tracking-normal text-slate-600">{attention.length}</span>
        </h2>
        {attention.length === 0 ? (
          <div className="card flex items-center gap-3 px-5 py-5 text-sm text-emerald-700">
            <CircleCheck size={20} /> Nothing needs you right now. The warehouse is up to date.
          </div>
        ) : (
          <ul className="card divide-y divide-line overflow-hidden">
            {attention.map((a) => (
              <li key={a.key}>
                <Link href={a.href} className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50 sm:px-5">
                  <span className={cn("h-9 w-1 shrink-0 rounded-full", a.tone === "red" ? "bg-brand-red" : a.tone === "amber" ? "bg-oil-400" : "bg-sky-500")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-900">{a.title}</span>
                    <span className="block truncate text-xs text-slate-500">{a.detail}</span>
                  </span>
                  {a.figure && <span className="hidden shrink-0 text-xs text-slate-500 sm:block">{a.figure}</span>}
                  <ChevronRight size={16} className="shrink-0 text-slate-400" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Orders going out</h2>
      <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Orders going out">
        <KpiCard icon={ClipboardList} tone="navy" label="New orders" value={nf(s.isNew)} hint="waiting for you" href="/warehouse/orders?f=new" />
        <KpiCard icon={Timer} tone="yellow" label="Being prepared" value={nf(s.preparing)} hint="you are on them now" href="/warehouse/orders?f=preparing" />
        <KpiCard icon={PackageOpen} tone="green" label="Ready for collection" value={nf(s.ready)} hint="picked and set aside" href="/warehouse/orders?f=ready" />
        <KpiCard icon={CircleCheck} tone="slate" label="Collected today" value={nf(s.collectedToday)} hint={`${nf(s.completed)} collected in total`} href="/warehouse/history?range=today" />
      </section>

      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Stock on the shelf</h2>
      <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Stock on the shelf">
        <KpiCard icon={PackageCheck} tone="green" label="Available" value={nf(s.available)} hint="pieces you can still sell" href="/warehouse/stock" />
        <KpiCard icon={Lock} tone="yellow" label="Reserved" value={nf(s.reserved)} hint="sold, waiting to be collected" href="/warehouse/stock?s=reserved" />
        <KpiCard icon={Boxes} tone="navy" label="Products in stock" value={nf(s.inStockProducts)} hint={`of ${nf(s.activeProducts)} products`} href="/warehouse/stock" />
        <KpiCard icon={TriangleAlert} tone={s.out + s.low > 0 ? "red" : "green"} label="Low or out" value={nf(s.out + s.low)} hint={`${s.out} out · ${s.low} running low`} href="/warehouse/stock?s=out" />
      </section>

      {/* Stock: every product on the shelf with its level, and what is going on around it */}
      <div className="mb-5 grid items-start gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <section className="card overflow-hidden" aria-label="Stock by product">
          <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Stock by product</h2>
              <p className="text-xs text-slate-500">
                <span className="font-semibold text-emerald-600">{okN} healthy</span> · <span className="font-semibold text-yellow-600">{s.low} low</span> · <span className="font-semibold text-rose-600">{s.out} out</span>, lowest first
              </p>
            </div>
            <Link href="/warehouse/stock" className="text-sm font-medium text-navy-700 hover:underline">
              All stock
            </Link>
          </div>
          {s.shelf.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">No products have been added yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2 sm:px-5">Product</th>
                    <th className="px-2 py-2 text-right">Available</th>
                    <th className="hidden px-2 py-2 text-right md:table-cell">Reserved</th>
                    <th className="hidden px-2 py-2 text-right md:table-cell">Minimum</th>
                    <th className="hidden w-44 px-4 py-2 sm:px-5 md:table-cell">Level</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {s.shelf.map((p) => {
                    const pct = p.status === "out" ? 0 : p.min > 0 ? Math.min(100, Math.max(4, (p.available / (p.min * 3)) * 100)) : Math.min(100, Math.max(4, (p.available / shelfTop) * 100));
                    return (
                      <tr key={p.id}>
                        <td className="w-full max-w-0 px-4 py-2 sm:px-5">
                          <div className="flex items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-gradient-to-b from-white to-slate-100">
                              {p.imageV ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={`/api/product-image/${p.id}?size=thumb&v=${p.imageV}`} alt="" loading="lazy" className="h-full w-full object-contain" />
                              ) : (
                                <Package size={16} className="text-slate-300" />
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium text-slate-900">{p.name}</span>
                              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-100 md:hidden">
                                <span className={cn("block h-full rounded-full", p.status === "out" ? "bg-rose-500" : p.status === "low" ? "bg-oil-400" : "bg-emerald-500")} style={{ width: `${pct}%` }} />
                              </span>
                            </span>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums text-slate-900">{qtyText(p.available, p.pack, p.symbol, unitMode).main}</td>
                        <td className="hidden whitespace-nowrap px-2 py-2 text-right tabular-nums text-slate-600 md:table-cell">{p.reserved > 0 ? qtyText(p.reserved, p.pack, p.symbol, unitMode).main : "—"}</td>
                        <td className="hidden whitespace-nowrap px-2 py-2 text-right tabular-nums text-slate-500 md:table-cell">{p.min > 0 ? qtyText(p.min, p.pack, p.symbol, unitMode).main : "—"}</td>
                        <td className="hidden px-4 py-2 sm:px-5 md:table-cell">
                          <div className="flex items-center gap-2">
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                              <span className={cn("block h-full rounded-full", p.status === "out" ? "bg-rose-500" : p.status === "low" ? "bg-oil-400" : "bg-emerald-500")} style={{ width: `${pct}%` }} />
                            </span>
                            {p.status !== "ok" && <span className={cn("shrink-0 text-[11px] font-semibold", p.status === "out" ? "text-rose-600" : "text-yellow-600")}>{p.status === "out" ? "Out" : "Low"}</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="grid gap-4">
          <section className="card card-pad" aria-label="Orders right now">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-900">Orders right now</h2>
              <Link href="/warehouse/orders" className="text-sm font-medium text-navy-700 hover:underline">
                Pickups
              </Link>
            </div>
            <p className="mb-2 text-xs text-slate-500">All the orders the shop has sent to the warehouse</p>
            <div className="h-60">
              <DonutChart data={s.byStatus} money={COUNT} centre={nf(s.byStatus.reduce((t, x) => t + x.value, 0))} centreLabel="Orders" empty="No orders yet." />
            </div>
          </section>

          <section className="card card-pad" aria-label="Reserved by product">
            <h2 className="text-base font-semibold text-slate-900">Waiting to be collected</h2>
            <p className="mb-4 text-xs text-slate-500">Reserved for customers, by product ({nf(s.reserved)} pieces in all)</p>
            <BarList highlightFirst={false} empty="Nothing is reserved." rows={reservedRows} />
          </section>
        </div>
      </div>

      <div className="mb-5 grid items-start gap-4 lg:grid-cols-2">
        <section className="card card-pad" aria-label="Orders per day">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-900">Orders per day</h2>
            <p className="text-xs font-medium tabular-nums text-slate-600">{nf(ordersTotal)} in 14 days</p>
          </div>
          <p className="mb-3 text-xs text-slate-500">{s.avgHandoverHours === null ? "Orders sent to the warehouse, the last 14 days" : `Average time to hand over an order: ${hoursText(s.avgHandoverHours)}`}</p>
          <div className="h-56">
            <ColumnsChart data={s.ordersPerDay} money={COUNT} label="Orders" empty="No orders in the last 14 days." />
          </div>
        </section>
        <section className="card card-pad">
          <h2 className="text-base font-semibold text-slate-900">How long orders have been waiting</h2>
          <p className="mb-4 text-xs text-slate-500">{s.open} order{s.open === 1 ? "" : "s"} still to collect</p>
          <BarList highlightFirst={false} rows={s.age.map((a) => ({ label: a.label, value: a.value, text: `${a.value} order${a.value === 1 ? "" : "s"}` }))} empty="No order is waiting." />
        </section>
      </div>

      <div className="mb-5 grid items-start gap-4 lg:grid-cols-2">
        <section className="card card-pad">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-900">Goods in and out</h2>
            <p className="text-xs font-medium tabular-nums">
              <span className="text-emerald-600">{nf(totalIn)} in</span> <span className="text-slate-400">/</span> <span className="text-navy-700">{nf(totalOut)} out</span>
            </p>
          </div>
          <p className="mb-3 text-xs text-slate-500">Pieces received and handed over, the last 14 days</p>
          <div className="flex h-36 items-end gap-1.5 border-b border-line" role="img" aria-label="Goods received and released per day">
            {s.days.map((d) => (
              <div key={d.day} className="flex h-full flex-1 items-end justify-center gap-0.5" title={`${d.day}: ${nf(d.received)} in, ${nf(d.released)} out`}>
                <div className="w-1/2 max-w-[10px] rounded-t bg-emerald-500" style={{ height: `${(d.received / max) * 100}%`, minHeight: d.received > 0 ? 3 : 0 }} />
                <div className="w-1/2 max-w-[10px] rounded-t bg-navy-500" style={{ height: `${(d.released / max) * 100}%`, minHeight: d.released > 0 ? 3 : 0 }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-1.5 text-[10px] text-slate-500">
            {s.days.map((d) => (
              <span key={d.day} className="flex-1 text-center">
                {d.day.slice(8)}
              </span>
            ))}
          </div>
          <div className="mt-2 flex gap-4 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Received
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-navy-500" /> Handed over
            </span>
          </div>
        </section>

        <section className="card overflow-hidden" aria-label="Moving by product">
          <div className="border-b border-line px-4 py-3 sm:px-5">
            <h2 className="text-base font-semibold text-slate-900">What moved, by product</h2>
            <p className="text-xs text-slate-500">Received and handed over, the last 14 days</p>
          </div>
          {s.moves.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">No goods moved in the last 14 days.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2 sm:px-5">Product</th>
                  <th className="px-2 py-2 text-right">In</th>
                  <th className="px-4 py-2 text-right sm:px-5">Out</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {s.moves.map((m) => (
                  <tr key={m.product.id}>
                    <td className="w-full max-w-0 truncate px-4 py-2 font-medium text-slate-900 sm:px-5">{m.product.name}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums text-emerald-600">{m.received > 0 ? `+${qtyText(m.received, m.product.pack, m.product.symbol, unitMode).main}` : "—"}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right font-semibold tabular-nums text-navy-700 sm:px-5">{m.released > 0 ? `−${qtyText(m.released, m.product.pack, m.product.symbol, unitMode).main}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Coming in</h2>
              <p className="text-xs text-slate-500">
                {onTheWay.length} on the way · {arrived.length} arrived, to count
              </p>
            </div>
            <Link href="/shipments" className="text-sm font-medium text-navy-700 hover:underline">
              Receiving
            </Link>
          </div>
          {s.inbound.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">No delivery is expected.</p>
          ) : (
            <ul className="divide-y divide-line">
              {s.inbound.map((i) => (
                <li key={i.id}>
                  <Link href={`/shipments/${i.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm transition hover:bg-slate-50 sm:px-5">
                    <span className="min-w-0">
                      <span className="font-mono text-[13px] font-semibold text-slate-900">{i.shipmentNo}</span>
                      <span className="ml-2 text-slate-600">{i.cargoName ?? i.supplier?.name ?? i.reference ?? ""}</span>
                      <span className="block text-xs text-slate-500">
                        {i._count.items} product{i._count.items === 1 ? "" : "s"}
                        {i.expectedDate ? ` · expected ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(i.expectedDate)}` : ""}
                      </span>
                    </span>
                    <span className={cn("shrink-0 text-xs font-medium", i.arrivedAt ? "text-amber-600" : "text-slate-500")}>{i.arrivedAt ? (i.status === "PARTIAL" ? "Part counted" : "Arrived, count it") : "On the way"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3 sm:px-5">
            <h2 className="text-base font-semibold text-slate-900">Your activity</h2>
            <p className="text-xs text-slate-500">What you have done, newest first</p>
          </div>
          {mine.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">Nothing yet. Preparing and handing over goods will show here.</p>
          ) : (
            <ul className="divide-y divide-line">
              {mine.map((e) => (
                <li key={e.id} className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm sm:px-5">
                  <span className="min-w-0">
                    <span className="font-medium text-slate-900">{EVENT_LABEL[e.type]}</span>
                    <span className="ml-2 text-slate-500">{e.pickupNote?.noteNo ?? e.product?.name ?? ""}</span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">{formatDateTime(e.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
