import type { CSSProperties } from "react";
// Colours are CSS variables: on screen the note wears the system's colours (dark or light, like the app); on paper it always prints
// in its own light colours (the dark set below only applies to screens).
const INK = "var(--pn-ink)";
const MUTED = "var(--pn-muted)";
const LINE = "var(--pn-line)";
const NAVY = "var(--pn-navy)";
const NAVY2 = "var(--pn-head)";
const GOLD = "var(--pn-gold)";
const small: CSSProperties = { fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: MUTED };

/**
 * The pickup note as paper, on A5 pages (148 x 210 mm). It is also the DELIVERY NOTE: the goods listed are handed over against it
 * and signed for. Many products simply continue on the next A5 page (every page carries the number and a QR code, the last page has
 * the totals and the signatures). The QR carries only a secret reference; everything is looked up when it is scanned.
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

// how many product rows fit: first page / later pages, and when that page also carries the totals and signatures
const FIRST_MORE = 12;
const FIRST_LAST = 5;
const NEXT_MORE = 17;
const NEXT_LAST = 10;
const ROW_MM = 9.5;

/** Splits the lines over A5 pages. The last page always has room for the totals and the signatures. */
export function paginate<T>(lines: T[]): T[][] {
  if (lines.length <= FIRST_LAST) return [lines];
  const pages: T[][] = [lines.slice(0, FIRST_MORE)];
  let rest = lines.slice(FIRST_MORE);
  while (rest.length > NEXT_LAST) {
    pages.push(rest.slice(0, NEXT_MORE));
    rest = rest.slice(NEXT_MORE);
  }
  pages.push(rest); // may be empty: a last page with only the signatures
  return pages;
}

const PAGE: CSSProperties = { width: "148mm", height: "210mm", boxSizing: "border-box", background: "var(--pn-paper)", color: INK, fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", margin: "0 auto 8mm", boxShadow: "0 1px 4px rgba(15,23,42,0.18)" };
const CSS = `@media screen{.a5-doc{overflow-x:auto}}.a5-doc{--pn-paper:#fff;--pn-ink:#0f172a;--pn-muted:#64748b;--pn-line:#e5e7eb;--pn-navy:#0b2a4d;--pn-head:#0E3D6E;--pn-gold:#FDC400;--pn-gold-text:#a07c00;--pn-zebra:#fafafa;--pn-note:#faf8f2;--pn-note-line:#ece6d6}
.a5-logo-light{display:block}.a5-logo-dark{display:none}
@media screen{html.dark .a5-doc{--pn-paper:#101b30;--pn-ink:#e8eef8;--pn-muted:#93a3bd;--pn-line:#22304a;--pn-navy:#8fb4e8;--pn-head:#8cbcf7;--pn-gold-text:#FDC400;--pn-zebra:#0d1829;--pn-note:#14233d;--pn-note-line:#22304a}html.dark .a5-logo-light{display:none}html.dark .a5-logo-dark{display:block}}
.a5-qr svg{display:block;width:100%;height:100%}@media print{.a5-page{margin:0!important;box-shadow:none!important;break-after:page;page-break-after:always}.a5-page:last-child{break-after:auto;page-break-after:auto}}`;

/** `preview` = only the first page, without the gap and shadow: used small inside the till's "Sale complete" pop-up. */
export default function PickupNoteSheet({ d, preview }: { d: PickupNoteData; preview?: boolean }) {
  const allPages = paginate(d.lines);
  const pages = preview ? allPages.slice(0, 1) : allPages;
  const hasPrices = d.total !== null;
  let counter = 0;

  const fact = (label: string, value: string) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ ...small, fontSize: 7.5 }}>{label}</div>
      <div style={{ marginTop: 1.5, fontSize: 10, fontWeight: 600, color: INK, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{value}</div>
    </div>
  );

  const th: CSSProperties = { ...small, fontSize: 7.5, padding: "0 1mm" };
  const tableHead = (
    <div style={{ display: "grid", gridTemplateColumns: hasPrices ? "6mm 1fr 17mm 21mm 24mm" : "6mm 1fr 24mm", alignItems: "end", height: "7mm", borderBottom: `0.4mm solid ${NAVY}`, margin: "0 8mm" }}>
      <span style={th}>#</span>
      <span style={th}>Product</span>
      <span style={{ ...th, textAlign: "right" }}>Qty</span>
      {hasPrices && <span style={{ ...th, textAlign: "right" }}>Price</span>}
      {hasPrices && <span style={{ ...th, textAlign: "right" }}>Total</span>}
    </div>
  );

  return (
    <div className="a5-doc">
      <style>{CSS}</style>
      {pages.map((rows, pi) => {
        const first = pi === 0;
        const last = pi === allPages.length - 1;
        return (
          <section key={pi} className="a5-page" style={preview ? { ...PAGE, margin: 0, boxShadow: "none" } : PAGE}>
            {first ? (
              <>
                <div style={{ padding: "6mm 8mm 3.5mm", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "4mm" }}>
                  <div style={{ minWidth: 0 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="a5-logo-light" src={d.logoSrc} alt="" style={{ height: "11mm", width: "auto" }} />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="a5-logo-dark" src={d.logoSrc.replace("logo-full.png", "logo-full-dark.png")} alt="" style={{ height: "11mm", width: "auto" }} />
                    <div style={{ marginTop: "1.8mm", fontSize: 8, lineHeight: 1.4, color: MUTED }}>
                      {d.business.address && <div>{d.business.address}</div>}
                      {d.business.phone && <div>{d.business.phone}</div>}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "0.04em", color: NAVY2, lineHeight: 1 }}>PICKUP NOTE</div>
                    <div style={{ marginTop: "1mm", fontSize: 7.5, fontWeight: 700, letterSpacing: "0.16em", color: "var(--pn-gold-text)" }}>ALSO THE DELIVERY NOTE</div>
                    <div style={{ marginTop: "2mm", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12.5, fontWeight: 700, color: INK }}>{d.noteNo}</div>
                    <div style={{ marginTop: 0.5, fontSize: 8.5, color: MUTED }}>{d.when}</div>
                  </div>
                </div>
                <div style={{ height: "1.1mm", background: GOLD, margin: "0 8mm" }} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 29mm", gap: "5mm", padding: "4mm 8mm 3.5mm", alignItems: "center" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2.8mm 4mm" }}>
                    {fact("Customer", d.customer)}
                    {fact("Sales representative", d.salesperson)}
                    {fact("Sales transaction", d.saleNo)}
                    {fact("Payment", d.payment)}
                    {fact("Collect from", d.where)}
                    {fact("Status", d.collection)}
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div className="a5-qr" style={{ width: "27mm", height: "27mm", border: `0.3mm solid ${LINE}`, borderRadius: "1.5mm", padding: "1mm", boxSizing: "border-box", margin: "0 auto", background: "#fff" }} dangerouslySetInnerHTML={{ __html: d.qrSvg }} />
                    <div style={{ marginTop: "1mm", fontSize: 7, color: MUTED }}>Scan at the warehouse</div>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ padding: "6mm 8mm 3mm", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `0.4mm solid ${GOLD}`, margin: "0 0 3mm" }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.04em", color: NAVY2 }}>PICKUP NOTE · DELIVERY NOTE</div>
                  <div style={{ marginTop: 1, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 10, fontWeight: 700 }}>
                    {d.noteNo} <span style={{ fontFamily: "inherit", fontWeight: 400, color: MUTED }}>· continued</span>
                  </div>
                  <div style={{ marginTop: 0.5, fontSize: 8, color: MUTED }}>{d.customer}</div>
                </div>
                <div className="a5-qr" style={{ width: "15mm", height: "15mm", border: `0.3mm solid ${LINE}`, borderRadius: "1mm", padding: "0.6mm", boxSizing: "border-box", background: "#fff" }} dangerouslySetInnerHTML={{ __html: d.qrSvg }} />
              </div>
            )}

            {(rows.length > 0 || first) && tableHead}
            <div style={{ margin: "0 8mm" }}>
              {rows.map((l) => {
                const n = ++counter;
                return (
                  <div key={n} style={{ display: "grid", gridTemplateColumns: hasPrices ? "6mm 1fr 17mm 21mm 24mm" : "6mm 1fr 24mm", alignItems: "center", height: `${ROW_MM}mm`, borderBottom: `0.2mm solid ${LINE}`, background: n % 2 === 0 ? "var(--pn-zebra)" : "var(--pn-paper)", fontSize: 9.5 }}>
                    <span style={{ padding: "0 1mm", color: MUTED, fontSize: 8.5 }}>{n}</span>
                    <span style={{ padding: "0 1mm", minWidth: 0 }}>
                      <span style={{ display: "block", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name}</span>
                      <span style={{ display: "block", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 7, color: MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.sku}</span>
                    </span>
                    <span style={{ padding: "0 1mm", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{l.qty}</span>
                    {hasPrices && <span style={{ padding: "0 1mm", textAlign: "right", fontVariantNumeric: "tabular-nums", color: MUTED, fontSize: 8.5 }}>{l.unitPrice}</span>}
                    {hasPrices && <span style={{ padding: "0 1mm", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{l.total}</span>}
                  </div>
                );
              })}
            </div>
            {!last && <div style={{ margin: "2mm 8mm 0", fontSize: 8, color: MUTED, textAlign: "right" }}>Continued on the next page…</div>}

            {last && (
              <div style={{ marginTop: "auto", padding: "0 8mm 13mm" }}>
                {hasPrices && (
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "3mm" }}>
                    <div style={{ minWidth: "55mm", display: "flex", justifyContent: "space-between", gap: "6mm", borderTop: `0.4mm solid ${NAVY}`, paddingTop: "1.6mm", fontSize: 10.5, fontWeight: 800 }}>
                      <span>Total ({d.currencyCode})</span>
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>{d.total}</span>
                    </div>
                  </div>
                )}
                <div style={{ background: "var(--pn-note)", border: "0.25mm solid var(--pn-note-line)", borderRadius: "1.5mm", padding: "2.2mm 3mm", fontSize: 7.8, lineHeight: 1.45, color: INK }}>
                  This note is also the <strong>delivery note</strong>. The warehouse scans the QR code, checks the goods against this list and hands them over. The customer signs to confirm the goods were received in the right quantities and in good order. A note can be used once.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6mm", marginTop: "8mm" }}>
                  {["Released by (warehouse)", "Received by (customer)"].map((label) => (
                    <div key={label} style={{ borderTop: `0.3mm dashed ${MUTED}`, paddingTop: "1.2mm" }}>
                      <div style={{ ...small, fontSize: 7.5, letterSpacing: "0.06em" }}>{label}</div>
                      <div style={{ marginTop: "1mm", fontSize: 7, color: MUTED }}>Name · signature · date</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ position: "absolute", left: "8mm", right: "8mm", bottom: "5mm", display: "flex", justifyContent: "space-between", fontSize: 7, color: MUTED, borderTop: `0.2mm solid ${LINE}`, paddingTop: "1.2mm" }}>
              <span>
                {d.business.name} · {d.noteNo} · sale {d.saleNo}
              </span>
              <span>
                Page {pi + 1} of {allPages.length}
              </span>
            </div>
          </section>
        );
      })}
    </div>
  );
}
