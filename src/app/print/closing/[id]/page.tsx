import { notFound, redirect } from "next/navigation";
import EndOfDaySheet from "@/components/reports/EndOfDaySheet";
import PrintBar from "@/components/reports/PrintBar";
import { can } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { loadDaySheet } from "@/lib/reports/day-sheet";

export const metadata = { title: "Closing report" };

/** The end-of-day report on its own, as paper: opened from the list or the report page, it can be printed or saved as PDF. */
export default async function PrintClosingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string; save?: string }> }) {
  const user = await requireUser();
  const canReview = can(user, "closing.approve");
  if (!can(user, "closing.submit") && !canReview) redirect("/forbidden");
  const { id } = await params;
  const sp = await searchParams;
  const r = await loadDaySheet(db, id, { seeProfit: can(user, "dashboard.financials") || can(user, "reports.financial"), onlyBy: canReview ? undefined : user.id, logoSrc: "/brand/logo-full.png" });
  if (!r) notFound();
  return (
    <div className="print-wrap" style={{ minHeight: "100vh", background: "#e5e7eb", padding: "20px 12px 40px", position: "relative", zIndex: 1 }}>
      <style>{`*{-webkit-print-color-adjust:exact;print-color-adjust:exact}@page{size:A4;margin:0}@media print{.print-hide{display:none!important}html,body{background:#fff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.print-wrap{background:#fff!important;padding:11mm 10mm!important;min-height:0!important}.eod-sheet{border:none!important;border-radius:0!important}}`}</style>
      <PrintBar auto={sp.print === "1"} save={sp.save === "1"} title={`Closing · ${r.data.dateText}`} />
      <EndOfDaySheet data={r.data} />
    </div>
  );
}
