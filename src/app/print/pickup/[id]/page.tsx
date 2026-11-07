import { notFound, redirect } from "next/navigation";
import PrintBar from "@/components/reports/PrintBar";
import PickupNoteSheet from "@/components/warehouse/PickupNoteSheet";
import { requireUser } from "@/lib/auth/guard";
import { loadPickupSheetData } from "@/lib/warehouse/sheet-data";

export const metadata = { title: "Pickup note · Delivery note" };

/**
 * The pickup note (also the delivery note) as A5 pages: open it, print it or save it as a PDF. On screen it wears the system's colours
 * (dark or light, like the rest of the app); on paper it always prints in its own light colours.
 */
export default async function PrintPickupPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string; save?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const sheet = await loadPickupSheetData(user, id);
  if (sheet === null) notFound();
  if (sheet === "forbidden") redirect("/forbidden");

  return (
    <div className="print-wrap" style={{ minHeight: "100vh", padding: "20px 12px 40px", position: "relative", zIndex: 1 }}>
      <style>{`*{-webkit-print-color-adjust:exact;print-color-adjust:exact}.print-wrap{background:#e5e7eb;--pb-ink:#0f172a}@media screen{html.dark .print-wrap{background:#0a1220;--pb-ink:#e8eef8}}@page{size:A5 portrait;margin:0}@media print{.print-hide{display:none!important}html,body{background:#fff!important}.print-wrap{background:#fff!important;padding:0!important;min-height:0!important}}`}</style>
      <PrintBar auto={sp.print === "1"} save={sp.save === "1"} title={`Pickup note / delivery note ${sheet.noteNo}`} />
      <PickupNoteSheet d={sheet.data} />
    </div>
  );
}
