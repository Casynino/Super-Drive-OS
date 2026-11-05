"use server";

import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can, canAny } from "@/lib/auth/can";
import { getSessionUser } from "@/lib/auth/session";

/** A reprint is allowed (the receipt may be lost) but it is always recorded, so a copy can never pass as the original unnoticed. */
export async function logReceiptReprint(saleId: string) {
  const user = await getSessionUser();
  if (!user || !canAny(user, ["sales.view_own", "sales.view_all"])) return;
  const sale = await db.sale.findUnique({ where: { id: saleId }, select: { saleNo: true, salespersonId: true } });
  if (!sale || (!can(user, "sales.view_all") && sale.salespersonId !== user.id)) return;
  await db.$transaction((tx) => writeAudit(tx, { user, action: "receipt.reprint", entityType: "Sale", entityId: saleId, reference: sale.saleNo }));
}
