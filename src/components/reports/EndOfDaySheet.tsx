import type { CSSProperties } from "react";

/**
 * The end-of-day report as a paper document: a dark branded header with the business and the report number, a strip of the
 * six figures that matter, then numbered sections (what was sold, where the money came in, expenses, the cash count, where the
 * money is, the bank deposit, how the day compares, stock to watch) and signature lines.
 * Everything is inline-styled on purpose: it looks like paper in the dark theme, and it prints (or saves as PDF) on its own
 * in a blank page where no stylesheet is loaded.
 */
export type Tile = { label: string; value: string; note?: string; tone?: "red" | "green" | "plain"; change?: number | null };
export type Table = { columns: { label: string; right?: boolean }[]; rows: string[][]; total?: string[] };

export type DaySheetData = {
  number: string;
  preparedAt: string;
  dateText: string;
  business: { name: string; address: string; phone: string };
  logoSrc: string;
  shop: string;
  closingNo: string;
  currencyCode: string;
  strip: Tile[];
  products: Table;
  accounts: Table;
  expenses: Table;
  cash: { label: string; value: string; sign?: "+" | "−" | "="; strong?: boolean; tone?: "red" | "green" }[];
  money: Tile[];
  deposit: { lines: { label: string; value: string }[]; slipSrc: string | null; empty: string | null };
  compare: { bars: { label: string; pct: number; highlight: boolean }[]; tiles: Tile[] };
  stock: Table;
  corrections: Table | null;
  note: string | null;
  signatures: { preparedBy: string; preparedRole: string; approvedBy: string };
};

const INK = "#0f172a";
const MUTED = "#64748b";
const LINE = "#e5e7eb";
const NAVY = "#0b2a4d";
const NAVY2 = "#0E3D6E";
const GOLD = "#FDC400";
const GOLD_TEXT = "#b58900";
const CREAM = "#faf8f2";
const CREAM_LINE = "#ece6d6";
const GREEN = "#047857";
const RED = "#c0141b";
const SERIF = "Georgia, 'Times New Roman', serif";

const toneColor = (t?: "red" | "green" | "plain") => (t === "red" ? RED : t === "green" ? GREEN : INK);
const fit = (v: string, base: number) => (v.length > 15 ? base - 3 : v.length > 12 ? base - 1.5 : base);
const small: CSSProperties = { fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: MUTED };

function Change({ value }: { value?: number | null }) {
  if (value === null || value === undefined) return null;
  const up = value >= 0;
  return (
    <span style={{ display: "inline-block", padding: "1px 7px", borderRadius: 999, fontSize: 10.5, fontWeight: 600, background: up ? "#d1fae5" : "#fee2e2", color: up ? GREEN : RED }}>
      {up ? "▲" : "▼"} {Math.abs(value)}%
    </span>
  );
}

function Keep({ children }: { children: React.ReactNode }) {
  return <div style={{ breakInside: "avoid", pageBreakInside: "avoid" }}>{children}</div>;
}

function SectionTitle({ n, title, sub }: { n: string; title: string; sub?: string }) {
  return (
    <div style={{ marginTop: 18, paddingBottom: 6, borderBottom: `1px solid ${LINE}`, breakAfter: "avoid" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, color: GOLD_TEXT, fontWeight: 700 }}>{n}</span>
        <span style={{ fontSize: 17, fontWeight: 700, color: INK }}>{title}</span>
      </div>
      {sub && <div style={{ marginTop: 3, marginLeft: 26, fontSize: 11.5, color: MUTED }}>{sub}</div>}
    </div>
  );
}

function DataTable({ t, empty }: { t: Table; empty: string }) {
  if (t.rows.length === 0) return <p style={{ margin: "12px 0 0", fontSize: 13, color: MUTED }}>{empty}</p>;
  const cell = (right?: boolean): CSSProperties => ({ padding: "6px 10px", fontSize: 12, textAlign: right ? "right" : "left", color: INK, fontVariantNumeric: "tabular-nums" });
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
      <thead>
        <tr>
          {t.columns.map((c) => (
            <th key={c.label} style={{ ...small, padding: "8px 10px", textAlign: c.right ? "right" : "left", borderBottom: `1px solid ${INK}`, fontWeight: 600 }}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {t.rows.map((r, i) => (
          <tr key={i} style={{ background: i % 2 === 1 ? CREAM : "transparent", breakInside: "avoid" }}>
            {r.map((v, j) => (
              <td key={j} style={{ ...cell(t.columns[j]?.right), fontWeight: j === 0 ? 500 : 400, color: j === 0 ? INK : j === 1 || j === 2 ? INK : MUTED }}>
                {v}
              </td>
            ))}
          </tr>
        ))}
        {t.total && (
          <tr style={{ borderTop: `2px solid ${CREAM_LINE}` }}>
            {t.total.map((v, j) => (
              <td key={j} style={{ ...cell(t.columns[j]?.right), fontWeight: 700 }}>
                {v}
              </td>
            ))}
          </tr>
        )}
      </tbody>
    </table>
  );
}

function Tiles({ tiles, cols }: { tiles: Tile[]; cols: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 10, marginTop: 12 }}>
      {tiles.map((t) => (
        <div key={t.label} style={{ background: CREAM, border: `1px solid ${CREAM_LINE}`, borderRadius: 14, padding: "10px 12px", breakInside: "avoid" }}>
          <div style={small}>{t.label}</div>
          <div style={{ marginTop: 5, fontSize: fit(t.value, 15), fontWeight: 700, whiteSpace: "nowrap", color: toneColor(t.tone), fontVariantNumeric: "tabular-nums" }}>
            {t.value}
          </div>
          {t.change !== undefined && t.change !== null && (
            <div style={{ marginTop: 4 }}>
              <Change value={t.change} />
            </div>
          )}
          {t.note && <div style={{ marginTop: 3, fontSize: 11, color: MUTED }}>{t.note}</div>}
        </div>
      ))}
    </div>
  );
}

export default function EndOfDaySheet({ data: d }: { data: DaySheetData }) {
  return (
    <div className="eod-sheet" style={{ background: "#fff", color: INK, fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", border: `1px solid ${LINE}`, borderRadius: 6, overflow: "hidden", maxWidth: 900, margin: "0 auto", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}>
      {/* header */}
      <div style={{ background: `linear-gradient(115deg, ${NAVY} 0%, ${NAVY2} 100%)`, color: "#fff", padding: "20px 32px 16px", borderBottom: `4px solid ${GOLD}` }}>
        <div style={{ display: "flex", flexWrap: "nowrap", justifyContent: "space-between", gap: 18 }}>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start", minWidth: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={d.logoSrc} alt="" style={{ height: 58, width: "auto", background: "#fff", borderRadius: 10, padding: 4 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: SERIF, fontSize: 21, fontWeight: 700, lineHeight: 1.15, whiteSpace: "nowrap" }}>{d.business.name}</div>
              <div style={{ marginTop: 5, fontSize: 9.5, letterSpacing: "0.14em", color: GOLD, fontWeight: 600, whiteSpace: "nowrap" }}>SALES · STOCK · DISTRIBUTION</div>
              <div style={{ marginTop: 7, fontSize: 11.5, lineHeight: 1.5, color: "#cbd5e1" }}>
                {d.business.address && <div>{d.business.address}</div>}
                {d.business.phone && <div>{d.business.phone}</div>}
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.25em", color: GOLD, fontWeight: 600 }}>REPORT</div>
            <div style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 700, marginTop: 2 }}>End of day</div>
            <div style={{ fontSize: 13.5, marginTop: 5, color: "#e2e8f0" }}>{d.dateText}</div>
            <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 10, marginTop: 5, color: "#94a3b8", lineHeight: 1.5 }}>
              <div>{d.number}</div>
              <div>
                {d.shop} · prepared {d.preparedAt}
              </div>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 12, fontSize: 11.5, color: "#cbd5e1" }}>
          What was sold, where the money came in, what was spent, the cash count and where the money is. All amounts in {d.currencyCode}.
        </div>
      </div>

      {/* the six figures */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", borderBottom: `1px solid ${LINE}` }}>
        {d.strip.map((t, i) => (
          <div key={t.label} style={{ padding: "13px 12px", borderLeft: i === 0 ? "none" : `1px solid ${LINE}`, minWidth: 0 }}>
            <div style={small}>{t.label}</div>
            <div style={{ marginTop: 5, fontSize: fit(t.value, 14), fontWeight: 700, color: toneColor(t.tone), fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{t.value}</div>
            {t.change !== undefined && t.change !== null && (
              <div style={{ marginTop: 3 }}>
                <Change value={t.change} />
              </div>
            )}
            {t.note && <div style={{ marginTop: 3, fontSize: 11, color: MUTED }}>{t.note}</div>}
          </div>
        ))}
      </div>

      <div style={{ padding: "0 32px 22px" }}>
        <SectionTitle n="01" title="What was sold" sub="Each product, after returns" />
        <DataTable t={d.products} empty="Nothing was sold." />

        <Keep>
        <SectionTitle n="02" title="Where the money came in" sub="By account, paid at the sale and on debts" />
        <DataTable t={d.accounts} empty="No money came in." />
        </Keep>

        <Keep>
        <SectionTitle n="03" title="Expenses" sub="What the shop spent, by category" />
        <DataTable t={d.expenses} empty="Nothing was spent." />
        </Keep>

        <Keep>
        <SectionTitle n="04" title="The cash count" sub="From yesterday's closing balance to what was counted" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, marginTop: 8 }}>
          {[d.cash.slice(0, d.cash.findIndex((r) => r.sign === "=") + 1), d.cash.slice(d.cash.findIndex((r) => r.sign === "=") + 1)].map((rows, k) => (
        <table key={k} style={{ width: "100%", borderCollapse: "collapse", alignSelf: "start" }}>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} style={{ borderTop: r.strong ? `2px solid ${CREAM_LINE}` : undefined, breakInside: "avoid" }}>
                <td style={{ padding: "5px 10px", fontSize: 12.5, color: INK, fontWeight: r.strong ? 700 : 400 }}>
                  {r.sign && <span style={{ display: "inline-block", width: 18, color: MUTED, fontWeight: 700 }}>{r.sign}</span>}
                  {r.label}
                </td>
                <td style={{ padding: "5px 10px", fontSize: 12.5, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: r.strong ? 700 : 500, color: r.tone === "red" ? RED : r.tone === "green" ? GREEN : INK }}>{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
          ))}
        </div>
        </Keep>

        <Keep>
        <SectionTitle n="05" title="Where the money is" sub="When the day closed, and what went to the bank" />
        <Tiles tiles={d.money} cols={4} />
        {d.deposit.empty ? (
          <p style={{ margin: "12px 0 0", fontSize: 12.5, color: MUTED }}>{d.deposit.empty}</p>
        ) : (
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginTop: 14, breakInside: "avoid" }}>
            {d.deposit.slipSrc && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={d.deposit.slipSrc} alt="Deposit slip" style={{ height: 110, width: "auto", borderRadius: 8, border: `1px solid ${LINE}` }} />
            )}
            <table style={{ borderCollapse: "collapse" }}>
              <tbody>
                {d.deposit.lines.map((l) => (
                  <tr key={l.label}>
                    <td style={{ padding: "4px 18px 4px 0", fontSize: 12, color: MUTED }}>{l.label}</td>
                    <td style={{ padding: "4px 0", fontSize: 13, fontWeight: 600, color: INK }}>{l.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </Keep>


        <Keep>
        <SectionTitle n="06" title="How this day compares" sub="Sales of the last 14 days, this day in yellow" />
        <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 96, marginTop: 12, borderBottom: `1px solid ${LINE}` }}>
          {d.compare.bars.map((b) => (
            <div key={b.label} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
              <div style={{ height: `${b.pct}%`, background: b.highlight ? GOLD : "#7c8fb4", borderRadius: "5px 5px 0 0" }} />
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 5, marginTop: 4 }}>
          {d.compare.bars.map((b) => (
            <span key={b.label} style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 9.5, color: b.highlight ? INK : MUTED, fontWeight: b.highlight ? 700 : 400 }}>
              {b.label}
            </span>
          ))}
        </div>
        <Tiles tiles={d.compare.tiles} cols={4} />
        </Keep>

        <Keep>
        <SectionTitle n="07" title="Stock to watch" sub="Products that are out or below their minimum" />
        <DataTable t={d.stock} empty="Every product is above its minimum." />
        </Keep>

        {d.corrections && (
          <>
            <SectionTitle n="08" title="Corrections after closing" sub="Made by the owner, with the reason" />
            <DataTable t={d.corrections} empty="" />
          </>
        )}

        {d.note && (
          <p style={{ margin: "22px 0 0", padding: "10px 14px", background: CREAM, border: `1px solid ${CREAM_LINE}`, borderRadius: 10, fontSize: 12.5, color: INK }}>
            <span style={{ ...small, display: "block", marginBottom: 3 }}>Note from the shop</span>“{d.note}”
          </p>
        )}
      </div>

      {/* signatures */}
      <div style={{ background: CREAM, borderTop: `1px solid ${CREAM_LINE}`, padding: "16px 32px 12px", breakInside: "avoid" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: INK }}>
          {d.signatures.preparedBy} <span style={{ fontWeight: 400, color: MUTED }}>· {d.signatures.preparedRole}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 28, marginTop: 26 }}>
          {["Prepared by · date & signature", "Checked by · date & signature", `Approved by (${d.signatures.approvedBy}) · date & signature`].map((l) => (
            <div key={l} style={{ borderTop: `1px dashed ${MUTED}`, paddingTop: 5, ...small, letterSpacing: "0.06em", fontSize: 9.5 }}>
              {l}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, textAlign: "center", fontSize: 10.5, color: MUTED }}>
          {d.business.name} · End of day · {d.dateText} · {d.number} · figures from the shop system
        </div>
      </div>
    </div>
  );
}
