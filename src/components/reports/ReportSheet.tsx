import type { CSSProperties } from "react";
import type { Health } from "@/lib/reports/health";
import { Donut, HBars, HealthBlock, LineChart, Notes } from "./charts";
import { Change, CREAM, CREAM_LINE, DataTable, GOLD, INK, Keep, LINE, MUTED, NAVY, NAVY2, SectionTitle, SERIF, Tiles, fit, small, toneColor, type Table, type Tile } from "./EndOfDaySheet";

/**
 * A business report for any period (a week, a month, or dates the owner chooses) as a paper document, in the same style as the
 * end-of-day report: branded header, the figures that matter with their growth, numbered sections and signature lines.
 * Inline-styled, so it prints (or saves as PDF) on its own.
 */
export type ReportSection =
  | { kind: "table"; title: string; sub?: string; table: Table; empty: string }
  | { kind: "tiles"; title: string; sub?: string; tiles: Tile[]; cols: number }
  | { kind: "chart"; title: string; sub?: string; bars: { label: string; pct: number; highlight: boolean }[]; tiles?: Tile[] }
  | { kind: "health"; title: string; sub?: string; health: Health }
  | { kind: "notes"; title: string; sub?: string; items: { tone: "good" | "warn" | "info"; text: string; estimate?: boolean }[] }
  | { kind: "line"; title: string; sub?: string; labels: string[]; current: number[]; previous: number[] | null; currentName: string; previousName: string; tiles?: Tile[] }
  | { kind: "hbars"; title: string; sub?: string; rows: { label: string; value: number; text: string; note?: string }[]; empty: string; table?: Table }
  | { kind: "donut"; title: string; sub?: string; slices: { label: string; value: number; text: string }[]; centre: string; centreSub: string; empty: string; table?: Table };

export type ReportSheetData = {
  title: string;
  intro: string;
  number: string;
  preparedAt: string;
  rangeText: string;
  business: { name: string; address: string; phone: string };
  logoSrc: string;
  currencyCode: string;
  strip: Tile[];
  sections: ReportSection[];
  signatures: { preparedBy: string; preparedRole: string; approvedBy: string };
};

const root: CSSProperties = { background: "#fff", color: INK, fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", border: `1px solid ${LINE}`, borderRadius: 6, overflow: "hidden", maxWidth: 900, margin: "0 auto", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" };

export default function ReportSheet({ data: d }: { data: ReportSheetData }) {
  return (
    <div className="eod-sheet" style={root}>
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
            <div style={{ fontFamily: SERIF, fontSize: 26, fontWeight: 700, marginTop: 2 }}>{d.title}</div>
            <div style={{ fontSize: 13.5, marginTop: 5, color: "#e2e8f0" }}>{d.rangeText}</div>
            <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 10, marginTop: 5, color: "#94a3b8", lineHeight: 1.5 }}>
              <div>{d.number}</div>
              <div>prepared {d.preparedAt}</div>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 12, fontSize: 11.5, color: "#cbd5e1" }}>
          {d.intro} All amounts in {d.currencyCode}.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${d.strip.length}, minmax(0, 1fr))`, borderBottom: `1px solid ${LINE}` }}>
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
        {d.sections.map((sec, i) => {
          const n = String(i + 1).padStart(2, "0");
          if (sec.kind === "table")
            return (
              <div key={sec.title} style={sec.table.rows.length > 12 ? undefined : { breakInside: "avoid" }}>
                <SectionTitle n={n} title={sec.title} sub={sec.sub} />
                <DataTable t={sec.table} empty={sec.empty} />
              </div>
            );
          if (sec.kind === "tiles")
            return (
              <Keep key={sec.title}>
                <SectionTitle n={n} title={sec.title} sub={sec.sub} />
                <Tiles tiles={sec.tiles} cols={sec.cols} />
              </Keep>
            );
          if (sec.kind === "health")
            return (
              <Keep key={sec.title}>
                <SectionTitle n={n} title={sec.title} sub={sec.sub} />
                <HealthBlock health={sec.health} />
                <div style={{ marginTop: 12, background: CREAM, border: `1px solid ${CREAM_LINE}`, borderRadius: 6, padding: "10px 14px" }}>
                  <div style={{ ...small, marginBottom: 5 }}>What to do next</div>
                  {sec.health.advice.map((a, k) => (
                    <div key={k} style={{ display: "grid", gridTemplateColumns: "20px 1fr", fontSize: 11.5, color: INK, lineHeight: 1.45, padding: "2px 0" }}>
                      <span style={{ fontWeight: 700, color: GOLD }}>{k + 1}.</span>
                      <span>{a}</span>
                    </div>
                  ))}
                </div>
              </Keep>
            );
          if (sec.kind === "notes")
            return (
              <div key={sec.title}>
                <SectionTitle n={n} title={sec.title} sub={sec.sub} />
                <Notes items={sec.items} />
              </div>
            );
          if (sec.kind === "line")
            return (
              <Keep key={sec.title}>
                <SectionTitle n={n} title={sec.title} sub={sec.sub} />
                <div style={{ marginTop: 10 }}>
                  <LineChart labels={sec.labels} current={sec.current} previous={sec.previous} currentName={sec.currentName} previousName={sec.previousName} />
                </div>
                {sec.tiles && <Tiles tiles={sec.tiles} cols={sec.tiles.length} />}
              </Keep>
            );
          if (sec.kind === "hbars")
            return (
              <div key={sec.title} style={{ breakInside: "avoid" }}>
                <SectionTitle n={n} title={sec.title} sub={sec.sub} />
                {sec.rows.length === 0 ? <div style={{ marginTop: 10, fontSize: 12, color: MUTED }}>{sec.empty}</div> : <HBars rows={sec.rows} />}
                {sec.table && sec.rows.length > 0 && <DataTable t={sec.table} empty={sec.empty} />}
              </div>
            );
          if (sec.kind === "donut")
            return (
              <div key={sec.title} style={{ breakInside: "avoid" }}>
                <SectionTitle n={n} title={sec.title} sub={sec.sub} />
                {sec.slices.length === 0 ? <div style={{ marginTop: 10, fontSize: 12, color: MUTED }}>{sec.empty}</div> : <Donut slices={sec.slices} centre={sec.centre} centreSub={sec.centreSub} />}
                {sec.table && sec.slices.length > 0 && <DataTable t={sec.table} empty={sec.empty} />}
              </div>
            );
          return (
            <Keep key={sec.title}>
              <SectionTitle n={n} title={sec.title} sub={sec.sub} />
              <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 96, marginTop: 12, borderBottom: `1px solid ${LINE}` }}>
                {sec.bars.map((b, k) => (
                  <div key={k} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
                    <div style={{ height: `${b.pct}%`, background: b.highlight ? GOLD : "#7c8fb4", borderRadius: "4px 4px 0 0" }} />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                {sec.bars.map((b, k) => (
                  <span key={k} style={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 9, color: b.highlight ? INK : MUTED, fontWeight: b.highlight ? 700 : 400, overflow: "hidden", whiteSpace: "nowrap" }}>
                    {b.label}
                  </span>
                ))}
              </div>
              {sec.tiles && <Tiles tiles={sec.tiles} cols={sec.tiles.length} />}
            </Keep>
          );
        })}
      </div>

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
          {d.business.name} · {d.title} · {d.rangeText} · {d.number} · figures from the shop system
        </div>
      </div>
    </div>
  );
}
