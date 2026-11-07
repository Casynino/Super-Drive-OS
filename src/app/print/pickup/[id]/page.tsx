import { notFound, redirect } from "next/navigation";
import PrintBar from "@/components/reports/PrintBar";
import PickupNoteSheet from "@/components/warehouse/PickupNoteSheet";
import { can } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { pickupQrText, qrSvg } from "@/lib/qr";
import { getBusinessProfile, getCurrency } from "@/lib/settings";
import { stamp } from "@/lib/warehouse/pickup";
import { AUTH_LABEL, STATUS_LABEL } from "@/lib/warehouse/labels";

export const metadata = { title: "Pickup note" };

/** The pickup note on its own, as paper with its QR code: open it, print it or save it as a PDF. */
export default async function PrintPickupPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string; save?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const note = await db.pickupNote.findUnique({
    where: { id },
    include: {
      location: { select: { name: true } },
      sale: { select: { saleNo: true, salespersonId: true, total: true, createdAt: true, customer: { select: { name: true, reseller: { select: { id: true } } } }, salesperson: { select: { name: true } }, items: { orderBy: { id: "asc" }, select: { id: true, enteredQty: true, unitPrice: true, lineTotal: true, product: { select: { name: true, sku: true } }, enteredUnit: { select: { symbol: true } } } } } },
    },
  });
  if (!note) notFound();
  const own = can(user, "sales.view_own") && note.sale.salespersonId === user.id;
  const seePrices = can(user, "sales.view_all") || own || can(user, "warehouse.view");
  if (!seePrices && !can(user, "warehouse.operate")) redirect("/forbidden");

  const [profile, currency] = await Promise.all([getBusinessProfile(), getCurrency()]);
  const money = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, currency);
  const svg = await qrSvg(pickupQrText(note.token));
  const statusText = note.status === "COMPLETED" && note.completedAt ? `${STATUS_LABEL[note.status]} · ${stamp(note.completedAt)}` : STATUS_LABEL[note.status];

  return (
    <div className="print-wrap" style={{ minHeight: "100vh", background: "#e5e7eb", padding: "20px 12px 40px", position: "relative", zIndex: 1 }}>
      <style>{`*{-webkit-print-color-adjust:exact;print-color-adjust:exact}@page{size:A4;margin:0}@media print{.print-hide{display:none!important}html,body{background:#fff!important}.print-wrap{background:#fff!important;padding:10mm!important;min-height:0!important}.eod-sheet{border:none!important;border-radius:0!important}}`}</style>
      <PrintBar auto={sp.print === "1"} save={sp.save === "1"} title={`Pickup note ${note.noteNo}`} />
      <PickupNoteSheet
        d={{
          business: { name: profile.name, address: profile.address, phone: profile.phone },
          logoSrc: "/brand/logo-full.png",
          noteNo: note.noteNo,
          qrSvg: svg,
          saleNo: note.sale.saleNo,
          customer: note.sale.customer ? `${note.sale.customer.name}${note.sale.customer.reseller ? " · Winga" : ""}` : "Walk-in customer",
          salesperson: note.sale.salesperson.name,
          when: stamp(note.createdAt),
          payment: AUTH_LABEL[note.auth],
          collection: statusText,
          where: note.location.name,
          lines: note.sale.items.map((i) => ({ name: i.product.name, sku: i.product.sku, qty: `${i.enteredQty.toString()} ${i.enteredUnit.symbol}`, unitPrice: seePrices ? money(i.unitPrice) : null, total: seePrices ? money(i.lineTotal) : null })),
          total: seePrices ? money(note.sale.total) : null,
          currencyCode: currency.code,
        }}
      />
    </div>
  );
}
