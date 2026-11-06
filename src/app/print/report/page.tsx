import { redirect } from "next/navigation";
import PrintBar from "@/components/reports/PrintBar";
import ReportSheet from "@/components/reports/ReportSheet";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { defaultLocationId } from "@/lib/cash/ledger";
import { db } from "@/lib/db";
import { cleanRange, loadPeriodSheet } from "@/lib/reports/period-sheet";

export const metadata = { title: "Business report" };

/** The business report of a week, a month or any dates, as paper: open it, download it as PDF or print it. */
export default async function PrintReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; print?: string; save?: string }> }) {
  const user = await requireUser();
  if (!canAny(user, ["reports.view", "reports.financial"])) redirect("/forbidden");
  const sp = await searchParams;
  const { from, to } = cleanRange(sp.from, sp.to);
  const role = await db.user.findUnique({ where: { id: user.id }, select: { role: { select: { name: true } } } });
  const r = await loadPeriodSheet(db, await defaultLocationId(db), { from, to, seeProfit: can(user, "dashboard.financials") || can(user, "reports.financial"), preparedBy: user.name, preparedRole: role?.role.name ?? "", logoSrc: "/brand/logo-full.png" });
  return (
    <div className="print-wrap" style={{ minHeight: "100vh", background: "#e5e7eb", padding: "20px 12px 40px", position: "relative", zIndex: 1 }}>
      <style>{`*{-webkit-print-color-adjust:exact;print-color-adjust:exact}@page{size:A4;margin:0}@media print{.print-hide{display:none!important}html,body{background:#fff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.print-wrap{background:#fff!important;padding:11mm 10mm!important;min-height:0!important}.eod-sheet{border:none!important;border-radius:0!important}}`}</style>
      <PrintBar auto={sp.print === "1" || sp.save === "1"} save={sp.save === "1"} title={`${r.title} · ${r.data.rangeText}`} />
      <ReportSheet data={r.data} />
    </div>
  );
}
