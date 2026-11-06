"use client";

import Link from "next/link";
import { useState } from "react";
import { Printer } from "lucide-react";
import type { ItemStatus } from "@/generated/prisma/client";
import { ITEM_STATUS_BADGE, ITEM_STATUS_LABEL } from "@/lib/inventory/item-labels";

export type ItemRow = {
  id: string;
  itemNo: string;
  status: ItemStatus;
  productId: string;
  productName: string;
  location: string;
  received: string;
  shipmentId: string | null;
  shipmentNo: string | null;
  lastMove: string;
};

/** The list of pieces with tick boxes: tick some and print just their labels (same QR codes as always). */
export default function ItemsTable({ rows, showProduct = true }: { rows: ItemRow[]; showProduct?: boolean }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allOn = rows.length > 0 && rows.every((r) => picked.has(r.id));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-400" checked={allOn} onChange={() => setPicked(allOn ? new Set() : new Set(rows.map((r) => r.id)))} />
          Select all on this page
        </label>
        {picked.size > 0 ? (
          <Link href={`/items/labels?ids=${[...picked].join(",")}`} className="btn-primary btn-sm">
            <Printer size={14} /> Print {picked.size} label{picked.size === 1 ? "" : "s"}
          </Link>
        ) : (
          <span className="text-xs text-slate-500">Tick pieces to print or reprint their labels</span>
        )}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="w-8" />
              <th>Item ID</th>
              {showProduct && <th>Product</th>}
              <th>Status</th>
              <th className="hidden md:table-cell">Location</th>
              <th className="hidden lg:table-cell">Received</th>
              <th className="hidden lg:table-cell">Shipment</th>
              <th className="hidden xl:table-cell">Last movement</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <input type="checkbox" className="h-4 w-4 rounded border-slate-400" checked={picked.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.itemNo}`} />
                </td>
                <td>
                  <Link href={`/items/${r.itemNo}`} className="font-mono text-[13px] font-semibold text-navy-700 hover:underline">
                    {r.itemNo}
                  </Link>
                </td>
                {showProduct && (
                  <td>
                    <Link href={`/products/${r.productId}`} className="hover:underline">
                      {r.productName}
                    </Link>
                  </td>
                )}
                <td>
                  <span className={ITEM_STATUS_BADGE[r.status]}>{ITEM_STATUS_LABEL[r.status]}</span>
                </td>
                <td className="hidden text-slate-600 md:table-cell">{r.location}</td>
                <td className="hidden text-slate-600 lg:table-cell">{r.received}</td>
                <td className="hidden lg:table-cell">
                  {r.shipmentId ? (
                    <Link href={`/shipments/${r.shipmentId}`} className="text-navy-700 hover:underline">
                      {r.shipmentNo}
                    </Link>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="hidden text-slate-600 xl:table-cell">{r.lastMove}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
