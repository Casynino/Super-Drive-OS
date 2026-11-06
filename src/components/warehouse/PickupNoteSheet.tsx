import type { CSSProperties } from "react";
import { CREAM, CREAM_LINE, GOLD, INK, LINE, MUTED, NAVY, NAVY2, SERIF, small } from "@/components/reports/EndOfDaySheet";

/**
 * The pickup note as a paper document: branding, the QR code, who and what, the goods to collect, and a place to sign.
 * The QR carries only a secret reference; everything on this page is looked up from the system when it is scanned.
 */
export type PickupNoteData = {
  business: { name: string; address: string; phone: string };
  logoSrc: string;
  noteNo: string;
  qrSvg: string;
  saleNo: string;
  customer: string;
  salesperson: string;
  when: string;
  payment: string;
  collection: string;
  where: string;
  lines: { name: string; sku: string; qty: string; unitPrice: string | null; total: string | null }[];
  total: string | null;
  currencyCode: string;
};

const root: CSSProperties = { background: "#fff", color: INK, fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", border: `1px solid ${LINE}`, borderRadius: 6, overflow: "hidden", maxWidth: 820, margin: "0 auto", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" };

export default function PickupNoteSheet({ d }: { d: PickupNoteData }) {
  const fact = (label: string, value: string) => (
    <div>
      <div style={small}>{label}</div>
      <div style={{ marginTop: 3, fontSize: 13.5, fontWeight: 600, color: INK }}>{value}</div>
    </div>
  );
  return (
    <div className="eod-sheet" style={root}>
      <div style={{ background: `linear-gradient(115deg, ${NAVY} 0%, ${NAVY2} 100%)`, color: "#fff", padding: "20px 30px 16px", borderBottom: `4px solid ${GOLD}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start" }}>
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={d.logoSrc} alt="" style={{ height: 54, width: "auto", background: "#fff", borderRadius: 10, padding: 4 }} />
            <div>
              <div style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 700, lineHeight: 1.15 }}>{d.business.name}</div>
              <div style={{ marginTop: 4, fontSize: 9.5, letterSpacing: "0.14em", color: GOLD, fontWeight: 600 }}>STORE WAREHOUSE · DAR ES SALAAM</div>
              <div style={{ marginTop: 6, fontSize: 11.5, lineHeight: 1.5, color: "#cbd5e1" }}>
                {d.business.address && <div>{d.business.address}</div>}
                {d.business.phone && <div>{d.business.phone}</div>}
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.25em", color: GOLD, fontWeight: 600 }}>PICKUP NOTE</div>
            <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 24, fontWeight: 700, marginTop: 2 }}>{d.noteNo}</div>
            <div style={{ fontSize: 12.5, marginTop: 5, color: "#e2e8f0" }}>{d.when}</div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 170px", gap: 24, padding: "20px 30px", borderBottom: `1px solid ${LINE}`, alignItems: "center" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "16px 22px" }}>
          {fact("Customer", d.customer)}
          {fact("Sales representative", d.salesperson)}
          {fact("Sales transaction", d.saleNo)}
          {fact("Payment", d.payment)}
          {fact("Collection", d.collection)}
          {fact("Collect from", d.where)}
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: 8, lineHeight: 0 }} dangerouslySetInnerHTML={{ __html: d.qrSvg }} />
          <div style={{ marginTop: 6, fontSize: 10, color: MUTED }}>Scan at the warehouse</div>
        </div>
      </div>

      <div style={{ padding: "6px 30px 18px" }}>
        <div style={{ ...small, margin: "12px 0 6px" }}>Goods to collect</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${INK}` }}>
              <th style={{ textAlign: "left", padding: "6px 4px", ...small }}>Product</th>
              <th style={{ textAlign: "right", padding: "6px 4px", ...small }}>Quantity</th>
              {d.total !== null && <th style={{ textAlign: "right", padding: "6px 4px", ...small }}>Unit price</th>}
              {d.total !== null && <th style={{ textAlign: "right", padding: "6px 4px", ...small }}>Total</th>}
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${LINE}`, background: i % 2 ? "#fafafa" : "#fff" }}>
                <td style={{ padding: "8px 4px" }}>
                  <div style={{ fontWeight: 600 }}>{l.name}</div>
                  <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 10, color: MUTED }}>{l.sku}</div>
                </td>
                <td style={{ padding: "8px 4px", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{l.qty}</td>
                {d.total !== null && <td style={{ padding: "8px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: MUTED }}>{l.unitPrice}</td>}
                {d.total !== null && <td style={{ padding: "8px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.total}</td>}
              </tr>
            ))}
          </tbody>
          {d.total !== null && (
            <tfoot>
              <tr>
                <td colSpan={3} style={{ padding: "9px 4px", textAlign: "right", fontWeight: 700 }}>
                  Total ({d.currencyCode})
                </td>
                <td style={{ padding: "9px 4px", textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{d.total}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div style={{ background: CREAM, borderTop: `1px solid ${CREAM_LINE}`, padding: "14px 30px 12px", breakInside: "avoid" }}>
        <div style={{ fontSize: 11.5, color: INK, lineHeight: 1.5 }}>
          Take this note to the Store Warehouse. The attendant scans the QR code, checks the goods against this list and hands them over. A note can be used once: after the goods are collected it cannot be used again.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 28, marginTop: 24 }}>
          {["Released by (warehouse) · date & signature", "Collected by · name, date & signature"].map((l) => (
            <div key={l} style={{ borderTop: `1px dashed ${MUTED}`, paddingTop: 5, ...small, letterSpacing: "0.06em", fontSize: 9.5 }}>
              {l}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, textAlign: "center", fontSize: 10.5, color: MUTED }}>
          {d.business.name} · {d.noteNo} · sale {d.saleNo}
        </div>
      </div>
    </div>
  );
}
