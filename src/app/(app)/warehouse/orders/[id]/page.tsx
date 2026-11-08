import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { ExternalLink, Printer } from "lucide-react";
import { PageHeader } from "@/components/ui";
import QrImage from "@/components/products/QrImage";
import OrderActions from "@/components/warehouse/OrderActions";
import ReleaseForm from "@/components/warehouse/ReleaseForm";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { largestPack, qtyText } from "@/lib/qty";
import { pickupQrText } from "@/lib/qr";
import { loadPickup, pickupBlock } from "@/lib/warehouse/pickup";
import { AUTH_LABEL, EVENT_LABEL, STATUS_LABEL, STATUS_TEXT } from "@/lib/warehouse/labels";
import { cn, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Collection" };

/** One pickup note: what to prepare, who it is for, whether it can be released, and everything that happened to it. */
export default async function CollectionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ scanned?: string }> }) {
  const user = await requireUser();
  if (!canAny(user, ["warehouse.operate", "warehouse.view"])) redirect("/forbidden");
  const { id } = await params;
  const sp = await searchParams;
  const note = await loadPickup(db, { id });
  if (!note) notFound();
  const operate = can(user, "warehouse.operate");
  const block = pickupBlock(note);
  const events = await db.warehouseEvent.findMany({ where: { pickupNoteId: note.id }, orderBy: { createdAt: "desc" }, take: 40, include: { user: { select: { name: true } }, product: { select: { name: true } } } });

  const lines = note.items.map((it) => {
    const pack = largestPack(it.product.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor })));
    const sym = it.product.baseUnit.symbol;
    const text = (q: number) => qtyText(q, pack, sym);
    const waiting = it.quantity.minus(it.releasedQty).minus(it.cancelledQty);
    return { it, text, waiting, sym, pack };
  });
  const canRelease = operate && !block;
  const hasWaiting = lines.some((l) => l.waiting.gt(0));
  const winga = note.sale.customer?.reseller ? <span className="rounded-full bg-oil-400/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-800 dark:text-oil-400">Winga</span> : null;
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-slate-900">{value}</dd>
    </div>
  );

  return (
    <>
      <PageHeader
        title={note.noteNo}
        description={`Sale ${note.sale.saleNo} · ${formatDateTime(note.createdAt)}`}
        back={{ href: "/warehouse/orders", label: "Collections" }}
        actions={<span className={cn("rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold", STATUS_TEXT[note.status])}>{STATUS_LABEL[note.status]}</span>}
      />

      {/* the release card hides this banner once the goods are handed over in this visit (it would read like an error right after a success) */}
      <div id="note-banner">
        {block && block.code === "ALREADY_COLLECTED" && !sp.scanned ? (
          <div className="mb-4 rounded-xl border border-line bg-slate-50 px-4 py-2.5 text-sm text-slate-700">All the goods on this note were handed over. It cannot be used again.</div>
        ) : block ? (
          <div className="mb-4 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-rose-900" role="alert">
            <p className="text-sm font-semibold">{block.message}</p>
            <p className="text-xs">No goods can be released on this note.</p>
          </div>
        ) : sp.scanned ? (
          <div className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900">Scanned. Check the goods against the list, then release them.</div>
        ) : null}
      </div>

      {!block && note.auth !== "PAID" && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-950" role="status">
          <span className="font-semibold">{note.sale.customer?.reseller ? "Winga order, not fully paid. " : "Not fully paid. "}</span>
          {note.auth === "CREDIT_APPROVED" ? "It is on credit, approved at the till with the customer recorded, so the goods may be handed over." : "Part of it is on credit, approved at the till with the customer recorded, so the goods may be handed over."}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
        <div className="min-w-0 space-y-4">
          {/* stays mounted after the release so its "Handed over" card (Scan next) is not lost when the page refreshes; with nothing to release it draws nothing */}
          {operate && (
            <ReleaseForm
              noteId={note.id}
              noteNo={note.noteNo}
              submissionKey={randomUUID()}
              customer={note.sale.customer?.name ?? "Walk-in customer"}
              winga={Boolean(note.sale.customer?.reseller)}
              saleNo={note.sale.saleNo}
              paymentLabel={AUTH_LABEL[note.auth]}
              lines={(canRelease ? lines.filter((l) => l.waiting.gt(0)) : []).map((l) => ({ id: l.it.id, productId: l.it.product.id, name: l.it.product.name, sku: l.it.product.sku, waiting: Number(l.waiting), waitingText: l.text(Number(l.waiting)).main, symbol: l.sym, imageV: l.it.product.image ? l.it.product.image.updatedAt.getTime() : null, pack: l.pack }))}
            />
          )}

          {/* when there is nothing left to release (done, cancelled, or no right to release) the products are listed here: sold, handed over, waiting */}
          {!(canRelease && hasWaiting) && (
            <section className="card overflow-hidden" aria-label="Products on this note">
              <h2 className="border-b border-line px-4 py-3 text-base font-semibold text-slate-900 sm:px-5">Products</h2>
              <ul className="divide-y divide-line">
                {lines.map(({ it, text, waiting }) => (
                  <li key={it.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-900">{it.product.name}</span>
                      <span className="block font-mono text-[11px] text-slate-500">{it.product.sku}</span>
                    </span>
                    <span className="shrink-0 text-right text-sm tabular-nums">
                      <span className="block font-semibold text-slate-900">{text(Number(it.quantity)).main}</span>
                      <span className="block text-[11px] text-slate-500">
                        {Number(it.releasedQty) > 0 ? `${text(Number(it.releasedQty)).main} handed over` : "none handed over"}
                        {waiting.gt(0) ? ` · ${text(Number(waiting)).main} waiting` : ""}
                        {Number(it.cancelledQty) > 0 ? ` · ${text(Number(it.cancelledQty)).main} given back` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <details className="card group overflow-hidden">
            <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-semibold text-slate-900 sm:px-5">
              <span>Handed over ({note.releases.length})</span>
              <span className="text-xs font-normal text-slate-500 group-open:hidden">Show</span>
            </summary>
            {note.releases.length === 0 ? (
              <p className="border-t border-line px-5 py-4 text-sm text-slate-500">Nothing has been handed over yet.</p>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {note.releases.map((r) => (
                  <li key={r.id} className="px-4 py-2.5 text-sm sm:px-5">
                    <p className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-mono text-[13px] font-semibold text-slate-900">{r.releaseNo}</span>
                      <span className="text-xs text-slate-500">{formatDateTime(r.createdAt)}</span>
                    </p>
                    <p className="text-slate-600">
                      Released by {r.releasedBy.name}
                      {r.collectedBy ? ` · taken by ${r.collectedBy}` : ""}
                    </p>
                    {r.remark && <p className="text-xs text-slate-500">“{r.remark}”</p>}
                  </li>
                ))}
              </ul>
            )}
          </details>

          <details className="card group overflow-hidden">
            <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-semibold text-slate-900 sm:px-5">
              <span>History ({events.length})</span>
              <span className="text-xs font-normal text-slate-500 group-open:hidden">Show</span>
            </summary>
            {events.length === 0 ? (
              <p className="border-t border-line px-5 py-4 text-sm text-slate-500">No activity yet.</p>
            ) : (
              <ul className="divide-y divide-line border-t border-line md:max-h-96 md:overflow-y-auto">
                {events.map((e) => (
                  <li key={e.id} className="px-4 py-2 text-sm sm:px-5">
                    <p className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium text-slate-900">{EVENT_LABEL[e.type]}</span>
                      <span className="text-xs text-slate-500">{formatDateTime(e.createdAt)}</span>
                    </p>
                    <p className="text-xs text-slate-600">
                      {e.user.name}
                      {e.product ? ` · ${e.product.name}` : ""}
                      {e.quantity ? ` · ${e.quantity.toString()}` : ""}
                      {e.previousReserved && e.newReserved ? ` · reserved ${e.previousReserved.toString()} → ${e.newReserved.toString()}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </div>

        <aside className="space-y-4">
          <section className="card p-4 text-center" aria-label="The note's QR code">
            <div className="mx-auto h-36 w-36 rounded-lg bg-[#ffffff] p-2 ring-1 ring-black/10">
              <QrImage text={pickupQrText(note.token)} label={`QR code of ${note.noteNo}`} className="h-full w-full" />
            </div>
            <p className="mt-2 font-mono text-sm font-semibold text-slate-900">{note.noteNo}</p>
            <p className="text-xs text-slate-500">Scan this code to open the note</p>
            <div className="mt-3 flex justify-center gap-2">
              <Link href={`/print/pickup/${note.id}`} target="_blank" className="btn-secondary btn-sm">
                <ExternalLink size={13} /> Open
              </Link>
              <Link href={`/print/pickup/${note.id}?print=1`} target="_blank" className="btn-secondary btn-sm">
                <Printer size={13} /> Print
              </Link>
            </div>
          </section>

          <section className="card px-4 py-2.5" aria-label="Details">
            <dl className="divide-y divide-line">
              {row("Customer", <span className="inline-flex flex-wrap items-center justify-end gap-1.5">{note.sale.customer?.name ?? "Walk-in"} {winga}</span>)}
              {row("Sold by", note.createdBy.name)}
              {row("Payment", AUTH_LABEL[note.auth].split(",")[0])}
              {row("Status", <span className={STATUS_TEXT[note.status]}>{STATUS_LABEL[note.status]}</span>)}
              {row("Where", note.location.name.split(" – ")[0])}
              {note.readyAt && row("Made ready", `${formatDateTime(note.readyAt)}${note.readyBy ? ` · ${note.readyBy.name.split(" ")[0]}` : ""}`)}
              {note.completedAt && row("Collected", `${formatDateTime(note.completedAt)}${note.completedBy ? ` · ${note.completedBy.name.split(" ")[0]}` : ""}`)}
              {note.cancelledAt && row("Cancelled", `${formatDateTime(note.cancelledAt)}${note.cancelReason ? ` · ${note.cancelReason}` : ""}`)}
            </dl>
          </section>

          {canRelease && (note.status === "NEW" || note.status === "PREPARING") && (
            <section className="card px-4 py-3" aria-label="Prepare">
              <h2 className="text-sm font-semibold text-slate-900">Prepare first (optional)</h2>
              <p className="mb-2.5 text-xs text-slate-500">Set the goods aside, then mark the order ready so the person knows to come.</p>
              <OrderActions noteId={note.id} status={note.status} />
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
