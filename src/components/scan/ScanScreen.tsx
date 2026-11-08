"use client";

import Link from "next/link";
import { useCallback, useState, useTransition } from "react";
import { CircleAlert, CircleCheck, ImageOff, Printer, ShoppingCart } from "lucide-react";
import type { ScanResult } from "@/app/(app)/scan/actions";
import { scanLookup } from "@/app/(app)/scan/actions";
import { ITEM_STATUS_BADGE } from "@/lib/inventory/item-labels";
import { cn } from "@/lib/utils";
import CodeScanner from "./CodeScanner";

type Hit = { id: number; code: string; result: ScanResult };

const TONE: Record<string, { box: string; icon: "ok" | "bad" }> = {
  AVAILABLE: { box: "border-emerald-300 bg-emerald-50 text-emerald-900", icon: "ok" },
  WITH_RESELLER: { box: "border-blue-300 bg-blue-50 text-blue-900", icon: "bad" },
  SOLD: { box: "border-slate-300 bg-slate-100 text-slate-800", icon: "bad" },
  DAMAGED: { box: "border-red-300 bg-brand-red-soft text-brand-red-dark", icon: "bad" },
  MISSING: { box: "border-yellow-300 bg-oil-soft text-yellow-900", icon: "bad" },
  DISPOSED: { box: "border-slate-300 bg-slate-100 text-slate-800", icon: "bad" },
};

function Picture({ id, v }: { id: string; v: number | null }) {
  return (
    <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-white">
      {v ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/product-image/${id}?size=thumb&v=${v}`} alt="" className="h-full w-full object-contain" />
      ) : (
        <ImageOff size={24} className="text-slate-300" />
      )}
    </div>
  );
}

function Detail({ result, canSell }: { result: ScanResult; canSell: boolean }) {
  if (result.kind === "none")
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-brand-red-soft p-4 text-brand-red-dark">
        <CircleAlert size={22} className="mt-0.5 shrink-0" />
        <p className="text-sm font-medium">{result.message}</p>
      </div>
    );

  const p = result.product;
  const head = (
    <div className="flex items-start gap-4">
      <Picture id={p.id} v={p.imageV} />
      <div className="min-w-0">
        <Link href={`/products/${p.id}`} className="text-lg font-semibold leading-snug text-slate-900 hover:underline">
          {p.name}
        </Link>
        <p className="text-sm text-slate-500">{[p.brand, p.size].filter(Boolean).join(" · ") || "—"}</p>
        {p.price && <p className="mt-1 text-xl font-semibold text-slate-900">{p.price}</p>}
        <p className="font-mono text-xs text-slate-400">{p.sku}</p>
      </div>
    </div>
  );

  if (result.kind === "product")
    return (
      <div className="card card-pad space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Product (not one single piece)</p>
        {head}
        {result.stock && (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <dt className="text-xs text-slate-500">On the shelf</dt>
              <dd className="text-xl font-semibold text-slate-900">{result.stock.shelf}</dd>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <dt className="text-xs text-slate-500">With winga</dt>
              <dd className="text-xl font-semibold text-slate-900">{result.stock.withResellers}</dd>
            </div>
          </dl>
        )}
        <p className="text-xs text-slate-500">This code is the same on every piece of this product. To check one particular piece, scan the QR code on its own label.</p>
      </div>
    );

  const it = result.item;
  const tone = TONE[it.status]!;
  return (
    <div className="card overflow-hidden">
      <div className={cn("flex items-center gap-3 border-b px-4 py-3", tone.box)}>
        {tone.icon === "ok" ? <CircleCheck size={26} className="shrink-0" /> : <CircleAlert size={26} className="shrink-0" />}
        <div className="min-w-0">
          <p className="text-lg font-semibold leading-tight">{it.statusLabel}</p>
          <p className="text-sm">{result.note ?? `At ${it.location}. Ready to sell.`}</p>
        </div>
      </div>
      <div className="space-y-4 p-4">
        {head}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          {[
            { k: "Item ID", v: <span className="font-mono font-semibold">{it.itemNo}</span> },
            { k: "Location", v: it.location },
            { k: "Received", v: it.received },
            { k: "Shipment", v: it.shipmentId ? <Link href={`/shipments/${it.shipmentId}`} className="text-navy-700 hover:underline">{it.shipmentNo}</Link> : "—" },
            ...(it.saleNo ? [{ k: "Sold on", v: it.saleNo }] : []),
            { k: "Last movement", v: it.lastMove },
          ].map((r) => (
            <div key={r.k}>
              <dt className="text-xs text-slate-500">{r.k}</dt>
              <dd className="text-slate-900">{r.v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <Link href={`/items/${it.itemNo}`} className="btn-secondary btn-sm">
            Full history
          </Link>
          <Link href={`/items/labels?ids=${it.id}`} className="btn-secondary btn-sm">
            <Printer size={14} /> Reprint label
          </Link>
          {canSell && it.status === "AVAILABLE" && (
            <Link href="/pos" className="btn-primary btn-sm">
              <ShoppingCart size={14} /> Sell it at the POS
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/** The Scan page: camera or scanner on top, the latest result below, and the last few scans to go back to. */
export default function ScanScreen({ canSell }: { canSell: boolean }) {
  const [hits, setHits] = useState<Hit[]>([]);
  const [shown, setShown] = useState<number | null>(null);
  const [pending, start] = useTransition();

  const onScan = useCallback(
    (code: string) => {
      start(async () => {
        const result = await scanLookup(code);
        setHits((h) => {
          const id = (h[0]?.id ?? 0) + 1;
          setShown(id);
          return [{ id, code, result }, ...h].slice(0, 8);
        });
      });
    },
    [],
  );
  const current = hits.find((h) => h.id === shown) ?? hits[0];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_1fr]">
      <div className="card card-pad">
        <CodeScanner onScan={onScan} busy={pending} />
      </div>
      <div className="space-y-4">
        {current ? <Detail result={current.result} canSell={canSell} /> : <div className="card card-pad text-sm text-slate-500">Scan a QR code or barcode and its details show here at once: what it is, where it is, and whether it can still be sold.</div>}
        {hits.length > 1 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Recent scans</p>
            <ul className="flex flex-wrap gap-2">
              {hits.map((h) => (
                <li key={h.id}>
                  <button type="button" onClick={() => setShown(h.id)} className={cn("rounded-full border px-3 py-1 text-xs font-medium transition", h.id === current?.id ? "border-navy-700 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-300")}>
                    {h.result.kind === "item" ? h.result.item.itemNo : h.result.kind === "product" ? h.result.product.sku : h.code.slice(0, 18)}
                    {h.result.kind === "item" && <span className={cn("ml-2 hidden rounded-full px-1.5 sm:inline", ITEM_STATUS_BADGE[h.result.item.status])}>{h.result.item.statusLabel}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
