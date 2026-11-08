import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, CircleCheck, ClipboardList, Boxes, Lock, Package, PackageCheck, PackageOpen, ScanLine, ScrollText, Search, Timer, TriangleAlert, Truck } from "lucide-react";
import KpiCard from "@/components/dashboard/KpiCard";
import HomeBanner from "@/components/HomeBanner";
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
  const totalN = Math.max(s.activeProducts, 1);

  return (
    <>
      <HomeBanner user={user} />

      <nav aria-label="Quick actions" className="mb-5 grid grid-cols-5 gap-2 sm:gap-3">
        {quick.map((q) => (
          <Link key={q.href} href={q.href} className={cn("relative flex flex-col items-center gap-1.5 rounded-2xl border px-1 py-3 text-[11px] font-semibold transition hover:-translate-y-0.5 sm:text-[13px]", q.primary ? "border-navy-600 bg-navy-600 text-[#ffffff] hover:bg-navy-700" : "border-line bg-white text-slate-700 hover:border-navy-300 hover:text-slate-900")}>
            <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl sm:h-11 sm:w-11", q.primary ? "bg-white/15 text-[#ffffff]" : "bg-navy-50 text-navy-700")}>
              <q.icon size={21} />
            </span>
            {q.label}
            {q.n ? <span className="absolute right-1.5 top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand-red px-1 text-[10px] font-bold leading-none text-white sm:right-3 sm:top-3">{q.n > 99 ? "99+" : q.n}</span> : null}
          </Link>
        ))}
      </nav>


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

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <section className="card overflow-hidden" aria-label="Stock to watch">
          <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Stock to watch</h2>
              <p className="text-xs text-slate-500">{s.watch.length === 0 ? "Everything is in stock." : `${s.out} out of stock, ${s.low} running low`}</p>
            </div>
            <Link href="/warehouse/stock" className="text-sm font-medium text-navy-700 hover:underline">
              All stock
            </Link>
          </div>
          <div className="px-4 pt-4 sm:px-5">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${okN} healthy, ${s.low} running low, ${s.out} out of stock`}>
              <div className="bg-emerald-500" style={{ width: `${(okN / totalN) * 100}%` }} />
              <div className="bg-oil-400" style={{ width: `${(s.low / totalN) * 100}%` }} />
              <div className="bg-rose-500" style={{ width: `${(s.out / totalN) * 100}%` }} />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              <span className="font-semibold text-emerald-600">{okN} healthy</span> · <span className="font-semibold text-yellow-600">{s.low} low</span> · <span className="font-semibold text-rose-600">{s.out} out</span>
            </p>
          </div>
          {s.watch.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">{s.activeProducts === 0 ? "No products have been added yet." : "Nothing is running low."}</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {s.watch.map((a) => {
                const pct = a.isOut ? 0 : Math.min(100, Math.max(4, (Number(a.qty) / Math.max(Number(a.min), 1)) * 100));
                return (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-gradient-to-b from-white to-slate-100">
                      {a.imageV ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/product-image/${a.id}?size=thumb&v=${a.imageV}`} alt="" loading="lazy" className="h-full w-full object-contain" />
                      ) : (
                        <Package size={18} className="text-slate-300" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{a.name}</span>
                      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <span className={`block h-full rounded-full ${a.isOut ? "bg-rose-500" : "bg-oil-400"}`} style={{ width: `${pct}%` }} />
                      </span>
                    </span>
                    <span className={a.isOut ? "badge-red" : "badge-yellow"}>{a.isOut ? "Out of stock" : `${qtyText(Number(a.qty), a.pack, a.symbol, unitMode).main} left`}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

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
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <section className="card card-pad">
          <h2 className="text-base font-semibold text-slate-900">How long orders have been waiting</h2>
          <p className="mb-4 text-xs text-slate-500">{s.open} order{s.open === 1 ? "" : "s"} still to collect</p>
          <BarList highlightFirst={false} rows={s.age.map((a) => ({ label: a.label, value: a.value, text: `${a.value} order${a.value === 1 ? "" : "s"}` }))} empty="No order is waiting." />
        </section>
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
      </div>

      <div className="grid gap-4">
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
