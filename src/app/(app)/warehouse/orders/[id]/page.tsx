import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/ui";
import OrderActions from "@/components/warehouse/OrderActions";
import ReleaseForm from "@/components/warehouse/ReleaseForm";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { largestPack, qtyText } from "@/lib/qty";
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
    return { it, text, waiting, sym };
  });
  const canRelease = operate && !block;
  const fact = (label: string, value: React.ReactNode) => (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );

  return (
    <>
      <PageHeader
        title={note.noteNo}
        description={`Sale ${note.sale.saleNo} · ${formatDateTime(note.createdAt)}`}
        back={{ href: "/warehouse/orders", label: "Collections" }}
        actions={
          <Link href={`/print/pickup/${note.id}`} target="_blank" className="btn-secondary">
            <ExternalLink size={15} /> Open the note
          </Link>
        }
      />

      {/* the release card hides this banner once the goods are handed over in this visit (it would read like an error right after a success) */}
      <div id="note-banner">
      {block && block.code === "ALREADY_COLLECTED" && !sp.scanned ? (
        <div className="mb-5 rounded-xl border border-line bg-slate-50 px-4 py-3 text-sm text-slate-700">All the goods on this note were handed over. It cannot be used again.</div>
      ) : block ? (
        <div className="mb-5 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3.5 text-rose-900" role="alert">
          <p className="text-base font-bold">{block.message}</p>
          <p className="mt-0.5 text-sm">No goods can be released on this note.</p>
        </div>
      ) : sp.scanned ? (
        <div className="mb-5 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Scanned. Check the goods against the list, then release them.</div>
      ) : null}
      </div>

      {!block && note.auth !== "PAID" && (
        <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status">
          <p className="font-semibold">{note.sale.customer?.reseller ? "Winga order · not fully paid" : "Not fully paid"}</p>
          <p className="mt-0.5">{note.auth === "CREDIT_APPROVED" ? "This sale is on credit. It was approved at the till and the customer is recorded, so the goods may be handed over." : "Part of this sale is on credit. It was approved at the till and the customer is recorded, so the goods may be handed over."}</p>
        </div>
      )}

      {/* the hand-over comes first: who it is for, the products with pictures, one big button */}
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
          lines={(canRelease ? lines.filter((l) => l.waiting.gt(0)) : []).map((l) => ({ id: l.it.id, productId: l.it.product.id, name: l.it.product.name, sku: l.it.product.sku, waiting: Number(l.waiting), waitingText: l.text(Number(l.waiting)).main, symbol: l.sym, imageV: l.it.product.image ? l.it.product.image.updatedAt.getTime() : null }))}
        />
      )}
      {canRelease && (note.status === "NEW" || note.status === "PREPARING") && (
        <section className="card card-pad mb-5">
          <h2 className="mb-1 text-base font-semibold text-slate-900">Prepare first (optional)</h2>
          <p className="mb-3 text-sm text-slate-500">Pick the goods and set them aside, then mark the order ready so the person knows to come.</p>
          <OrderActions noteId={note.id} status={note.status} />
        </section>
      )}

      <section className="card mb-5 px-4 py-4 sm:px-5">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          {fact(
            "Customer",
            <span className="inline-flex flex-wrap items-center gap-2">
              {note.sale.customer?.name ?? "Walk-in"}
              {note.sale.customer?.reseller && <span className="rounded-full bg-oil-400/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-800 dark:text-oil-400">Winga</span>}
            </span>,
          )}
          {fact("Sold by", note.createdBy.name)}
          {fact("Payment", AUTH_LABEL[note.auth])}
          {fact("Collection", <span className={STATUS_TEXT[note.status]}>{STATUS_LABEL[note.status]}</span>)}
          {note.readyAt && fact("Made ready", `${formatDateTime(note.readyAt)}${note.readyBy ? ` · ${note.readyBy.name}` : ""}`)}
          {note.completedAt && fact("Collected", `${formatDateTime(note.completedAt)}${note.completedBy ? ` · ${note.completedBy.name}` : ""}`)}
          {note.cancelledAt && fact("Cancelled", `${formatDateTime(note.cancelledAt)}${note.cancelReason ? ` · ${note.cancelReason}` : ""}`)}
          {fact("Where", note.location.name)}
        </dl>
      </section>

      <section className="card mb-5 overflow-hidden">
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <h2 className="text-base font-semibold text-slate-900">Products to hand over</h2>
        </div>
        <div className="table-wrap">
          <table className="table w-full md:table-fixed">
            <colgroup>
              <col className="md:w-[40%]" />
              <col className="md:w-[20%]" />
              <col className="md:w-[20%]" />
              <col className="md:w-[20%]" />
            </colgroup>
            <thead>
              <tr>
                <th>Product</th>
                <th className="text-right">Sold</th>
                <th className="text-right">Handed over</th>
                <th className="text-right">Still waiting</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(({ it, text, waiting }) => (
                <tr key={it.id}>
                  <td>
                    <span className="font-medium text-slate-900">{it.product.name}</span>
                    <span className="block font-mono text-[11px] text-slate-500">{it.product.sku}</span>
                  </td>
                  <td className="text-right tabular-nums">
                    {text(Number(it.quantity)).main}
                    {text(Number(it.quantity)).pieces && <span className="block text-[11px] text-slate-500">{text(Number(it.quantity)).pieces}</span>}
                  </td>
                  <td className="text-right tabular-nums text-slate-600">{Number(it.releasedQty) > 0 ? text(Number(it.releasedQty)).main : "—"}</td>
                  <td className={cn("text-right tabular-nums", waiting.gt(0) ? "font-semibold text-slate-900" : "text-slate-400")}>
                    {waiting.gt(0) ? text(Number(waiting)).main : "—"}
                    {Number(it.cancelledQty) > 0 && <span className="block text-[11px] font-normal text-slate-500">{text(Number(it.cancelledQty)).main} given back</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3 sm:px-5">
            <h2 className="text-base font-semibold text-slate-900">Collections</h2>
          </div>
          {note.releases.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">Nothing has been handed over yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {note.releases.map((r) => (
                <li key={r.id} className="px-4 py-3 text-sm sm:px-5">
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
        </section>
        <section className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3 sm:px-5">
            <h2 className="text-base font-semibold text-slate-900">History</h2>
          </div>
          {events.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">No activity yet.</p>
          ) : (
            <ul className="divide-y divide-line md:max-h-96 md:overflow-y-auto">
              {events.map((e) => (
                <li key={e.id} className="px-4 py-2.5 text-sm sm:px-5">
                  <p className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-slate-900">{EVENT_LABEL[e.type]}</span>
                    <span className="text-xs text-slate-500">{formatDateTime(e.createdAt)}</span>
                  </p>
                  <p className="text-slate-600">
                    {e.user.name}
                    {e.product ? ` · ${e.product.name}` : ""}
                    {e.quantity ? ` · ${e.quantity.toString()}` : ""}
                  </p>
                  {e.previousReserved && e.newReserved && (
                    <p className="text-xs text-slate-500">
                      Reserved {e.previousReserved.toString()} → {e.newReserved.toString()}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
