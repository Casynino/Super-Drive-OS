import type { CSSProperties } from "react";

/**
 * The packing list as a paper document: business header, where the goods come from, then every product with its picture,
 * how it is packed and how many pieces, and a box to tick when it is counted. Used on the purchase order page and for the
 * draft in the form, and printed (or saved as PDF) from both.
 * Everything is inline-styled on purpose: it looks like paper in the dark theme, and it also works in the blank window
 * the form opens for printing, where no stylesheet is loaded.
 */
export type SheetRow = {
  name: string;
  code: string | null;
  barcode: string | null;
  imageUrl: string | null;
  /** as ordered, e.g. "10 ctn" */
  packed: string;
  pieces: number;
  /** buying price per piece and for the line; only shown when `showPrices` is on */
  unitPrice: number | null;
  lineTotal: number | null;
};

export type SheetData = {
  /** the order number, or "Draft" before it is sealed */
  number: string;
  draft?: boolean;
  dateText: string;
  business: { name: string; address: string; phone: string };
  supplier: string | null;
  cargo: string | null;
  expected: string | null;
  deliverTo: string | null;
  notes: string | null;
  preparedBy: string | null;
  currencySymbol: string;
  showPrices: boolean;
  rows: SheetRow[];
};

const INK = "#0f172a";
const MUTED = "#64748b";
const LINE = "#e2e8f0";
const NAVY = "#0E3D6E";
const YELLOW = "#FDC400";

const qty = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);
const cash = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n));

const th: CSSProperties = { padding: "8px 10px", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: MUTED, background: "#f1f5f9", textAlign: "left", borderBottom: `1px solid ${LINE}` };
const td: CSSProperties = { padding: "10px", fontSize: 13, color: INK, borderBottom: `1px solid ${LINE}`, verticalAlign: "middle" };

export default function PackingListSheet({ data }: { data: SheetData }) {
  const pieces = data.rows.reduce((s, r) => s + (Number.isFinite(r.pieces) ? r.pieces : 0), 0);
  const total = data.rows.reduce((s, r) => s + (r.lineTotal ?? 0), 0);
  const facts = [
    { k: "From", v: data.supplier },
    { k: "Cargo company", v: data.cargo },
    { k: "Expected arrival", v: data.expected },
    { k: "Deliver to", v: data.deliverTo },
  ];

  return (
    <article className="pl-sheet" style={{ background: "#fff", color: INK, border: `1px solid ${LINE}`, borderRadius: 12, padding: 32, maxWidth: 860, margin: "0 auto", fontFamily: "inherit", lineHeight: 1.4 }}>
      <style>{`
        @media screen { .pl-sheet { overflow-x: auto; } }
        @media print { .pl-sheet { border: 0 !important; border-radius: 0 !important; padding: 0 !important; max-width: none !important; } }
        .pl-sheet tr { break-inside: avoid; page-break-inside: avoid; }
        .pl-sheet thead { display: table-header-group; }
      `}</style>

      <header style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 16, paddingBottom: 16, borderBottom: `3px solid ${NAVY}` }}>
        <div>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{data.business.name}</p>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: MUTED }}>{[data.business.address, data.business.phone].filter(Boolean).join(" · ")}</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", color: MUTED }}>PACKING LIST</p>
          <p style={{ margin: "2px 0 0", fontSize: 20, fontWeight: 700, color: NAVY }}>
            {data.number}
            {data.draft && <span style={{ marginLeft: 8, padding: "2px 8px", borderRadius: 999, background: YELLOW, color: "#1f2937", fontSize: 11, fontWeight: 700, verticalAlign: "middle" }}>NOT SENT YET</span>}
          </p>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: MUTED }}>{data.dateText}</p>
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px 20px", padding: "16px 0" }}>
        {facts.map((f) => (
          <div key={f.k}>
            <p style={{ margin: 0, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: MUTED }}>{f.k}</p>
            <p style={{ margin: "2px 0 0", fontSize: 14, fontWeight: 600 }}>{f.v || "—"}</p>
          </div>
        ))}
      </div>
      {data.notes && (
        <p style={{ margin: "0 0 14px", padding: "8px 12px", borderRadius: 8, background: "#f8fafc", border: `1px solid ${LINE}`, fontSize: 13 }}>
          <strong>Note: </strong>
          {data.notes}
        </p>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...th, width: 34, textAlign: "center" }}>No.</th>
            <th style={{ ...th, width: 56 }}>Photo</th>
            <th style={th}>Product</th>
            <th style={{ ...th, textAlign: "right" }}>Packed as</th>
            <th style={{ ...th, textAlign: "right" }}>Pieces</th>
            {data.showPrices && <th style={{ ...th, textAlign: "right" }}>Price / piece</th>}
            {data.showPrices && <th style={{ ...th, textAlign: "right" }}>Line total</th>}
            <th style={{ ...th, width: 56, textAlign: "center" }}>Counted</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={i}>
              <td style={{ ...td, textAlign: "center", color: MUTED }}>{i + 1}</td>
              <td style={td}>
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 44, border: `1px solid ${LINE}`, borderRadius: 8, background: "#fff", overflow: "hidden" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {r.imageUrl ? <img src={r.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : null}
                </span>
              </td>
              <td style={td}>
                <span style={{ display: "block", fontWeight: 600 }}>{r.name}</span>
                <span style={{ display: "block", fontSize: 11, color: MUTED, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{[r.code, r.barcode].filter(Boolean).join("  ·  ")}</span>
              </td>
              <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>{r.packed}</td>
              <td style={{ ...td, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{qty(r.pieces)}</td>
              {data.showPrices && <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.unitPrice === null ? "—" : `${data.currencySymbol} ${cash(r.unitPrice)}`}</td>}
              {data.showPrices && <td style={{ ...td, textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{r.lineTotal === null ? "—" : `${data.currencySymbol} ${cash(r.lineTotal)}`}</td>}
              <td style={{ ...td, textAlign: "center" }}>
                <span style={{ display: "inline-block", width: 16, height: 16, border: `1.5px solid ${MUTED}`, borderRadius: 3 }} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4} style={{ padding: "12px 10px", fontSize: 13, fontWeight: 700, textAlign: "right" }}>
              Total · {data.rows.length} product{data.rows.length === 1 ? "" : "s"}
            </td>
            <td style={{ padding: "12px 10px", fontSize: 14, fontWeight: 700, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{qty(pieces)}</td>
            {data.showPrices && <td />}
            {data.showPrices && <td style={{ padding: "12px 10px", fontSize: 14, fontWeight: 700, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{`${data.currencySymbol} ${cash(total)}`}</td>}
            <td />
          </tr>
        </tfoot>
      </table>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 40, marginTop: 40 }}>
        {[
          { k: "Prepared by", v: data.preparedBy },
          { k: "Received at the shop by", v: null },
        ].map((s) => (
          <div key={s.k} style={{ flex: "1 1 220px" }}>
            <div style={{ height: 28, borderBottom: `1px solid ${INK}`, fontSize: 13, display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>{s.v ?? ""}</div>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: MUTED }}>{s.k}  ·  name, signature and date</p>
          </div>
        ))}
      </div>
    </article>
  );
}
