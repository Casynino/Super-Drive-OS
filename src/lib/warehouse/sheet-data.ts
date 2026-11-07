import { can } from "@/lib/auth/can";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { pickupQrText, qrSvg } from "@/lib/qr";
import { getBusinessProfile, getCurrency } from "@/lib/settings";
import type { PickupNoteData } from "@/components/warehouse/PickupNoteSheet";
import { stamp } from "@/lib/warehouse/pickup";
import { AUTH_LABEL, STATUS_LABEL } from "@/lib/warehouse/labels";

/**
 * Everything the pickup note paper needs, for one note. Used by the print page and by the till's "Sale complete" pop-up (its small
 * preview), so the two always show the same note. "forbidden" = this person may not see this note; null = it does not exist.
 */
export async function loadPickupSheetData(user: SessionUser, id: string): Promise<{ data: PickupNoteData; noteNo: string } | "forbidden" | null> {
  const note = await db.pickupNote.findUnique({
    where: { id },
    include: {
      location: { select: { name: true } },
      sale: { select: { saleNo: true, salespersonId: true, total: true, createdAt: true, customer: { select: { name: true, reseller: { select: { id: true } } } }, salesperson: { select: { name: true } }, items: { orderBy: { id: "asc" }, select: { id: true, enteredQty: true, unitPrice: true, lineTotal: true, product: { select: { name: true, sku: true } }, enteredUnit: { select: { symbol: true } } } } } },
    },
  });
  if (!note) return null;
  const own = can(user, "sales.view_own") && note.sale.salespersonId === user.id;
  const seePrices = can(user, "sales.view_all") || own || can(user, "warehouse.view");
  if (!seePrices && !can(user, "warehouse.operate")) return "forbidden";

  const [profile, currency] = await Promise.all([getBusinessProfile(), getCurrency()]);
  const money = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, currency);
  const svg = await qrSvg(pickupQrText(note.token));
  const statusText = note.status === "COMPLETED" && note.completedAt ? `${STATUS_LABEL[note.status]} · ${stamp(note.completedAt)}` : STATUS_LABEL[note.status];
  return {
    noteNo: note.noteNo,
    data: {
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
    },
  };
}
