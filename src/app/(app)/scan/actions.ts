"use server";

import type { ItemStatus } from "@/generated/prisma/client";
import { can } from "@/lib/auth/can";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ITEM_STATUS_LABEL } from "@/lib/inventory/item-labels";
import { findItemByCode, parseItemCode } from "@/lib/inventory/items";
import { formatMoney } from "@/lib/money";
import { PRODUCT_QR_PREFIX } from "@/lib/qr";
import { getCurrency } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/utils";

export type ScanProduct = { id: string; name: string; brand: string | null; size: string | null; sku: string; barcode: string | null; price: string | null; imageV: number | null };

export type ScanResult =
  | {
      kind: "item";
      product: ScanProduct;
      item: { id: string; itemNo: string; token: string; status: ItemStatus; statusLabel: string; location: string; locationId: string; received: string; shipmentNo: string | null; shipmentId: string | null; saleNo: string | null; soldAt: string | null; lastMove: string };
      /** a plain sentence about what this status means right now ("This product has already been sold.") */
      note: string | null;
    }
  | { kind: "product"; product: ScanProduct; stock: { shelf: string; withResellers: string } | null }
  | { kind: "none"; message: string };

const statusNote = (s: ItemStatus, soldAt: string | null): string | null =>
  s === "SOLD" ? `This product has already been sold${soldAt ? ` (${soldAt})` : ""}.`
  : s === "WITH_RESELLER" ? "This product is currently assigned to a reseller."
  : s === "DAMAGED" ? "This item was marked damaged. It is not for sale."
  : s === "MISSING" ? "This item was marked missing. If you are holding it, tell the owner."
  : s === "DISPOSED" ? "This item was disposed of."
  : null;

/**
 * Looks up whatever was scanned or typed: an item's QR code or number, a product barcode or QR, a product code.
 * Read only. For people who can see stock or sell.
 */
export async function scanLookup(raw: string): Promise<ScanResult> {
  const user = await getSessionUser();
  if (!user || !(can(user, "inventory.view") || can(user, "sales.pos"))) return { kind: "none", message: "You are not allowed to look things up." };
  const code = raw.trim();
  if (!code) return { kind: "none", message: "Type or scan a code." };
  const [currency, showPrice] = [await getCurrency(), can(user, "products.view") || can(user, "sales.pos")];

  const card = (p: { id: string; name: string; sku: string; barcode: string | null; size: string | null; sellingPrice: { toString(): string }; brand: { name: string } | null; image: { updatedAt: Date } | null }): ScanProduct => ({
    id: p.id,
    name: p.name,
    brand: p.brand?.name ?? null,
    size: p.size,
    sku: p.sku,
    barcode: p.barcode,
    price: showPrice ? formatMoney(p.sellingPrice.toString(), currency) : null,
    imageV: p.image ? p.image.updatedAt.getTime() : null,
  });
  const productSelect = { id: true, name: true, sku: true, barcode: true, size: true, sellingPrice: true, brand: { select: { name: true } }, image: { select: { updatedAt: true } } } as const;

  // 1. an individual piece
  if (parseItemCode(code)) {
    const found = await findItemByCode(db, code);
    if (!found) return { kind: "none", message: "No item has this code. Check the label and try again." };
    const item = await db.inventoryItem.findUniqueOrThrow({
      where: { id: found.id },
      include: { product: { select: productSelect }, location: { select: { name: true } }, shipment: { select: { id: true, shipmentNo: true } } },
    });
    const sold = item.status === "SOLD" ? await db.itemMovement.findFirst({ where: { itemId: item.id, toStatus: "SOLD" }, orderBy: { createdAt: "desc" }, select: { createdAt: true, referenceNo: true } }) : null;
    const soldAt = sold ? formatDateTime(sold.createdAt) : null;
    return {
      kind: "item",
      product: card(item.product),
      item: {
        id: item.id,
        itemNo: item.itemNo,
        token: item.token,
        status: item.status,
        statusLabel: ITEM_STATUS_LABEL[item.status],
        location: item.location.name,
        locationId: item.locationId,
        received: formatDate(item.receivedAt),
        shipmentNo: item.shipment?.shipmentNo ?? null,
        shipmentId: item.shipment?.id ?? null,
        saleNo: sold?.referenceNo ?? null,
        soldAt,
        lastMove: formatDateTime(item.updatedAt),
      },
      note: statusNote(item.status, soldAt),
    };
  }

  // 2. a product: barcode number, SDOP: QR, or product code
  const key = code.startsWith(PRODUCT_QR_PREFIX) ? code.slice(PRODUCT_QR_PREFIX.length) : code;
  const digits = key.replace(/\s/g, "");
  const product = await db.product.findFirst({
    where: { OR: [{ barcode: digits }, ...(/^\d{12}$/.test(digits) ? [{ barcode: `0${digits}` }] : []), { sku: { equals: key.toUpperCase() } }] },
    select: productSelect,
  });
  if (!product) return { kind: "none", message: "Nothing matches this code. Check it and try again." };
  let stock: { shelf: string; withResellers: string } | null = null;
  if (can(user, "inventory.view")) {
    const rows = await db.stockBalance.groupBy({ by: ["locationId"], where: { productId: product.id }, _sum: { quantity: true } });
    const locs = await db.location.findMany({ where: { id: { in: rows.map((r) => r.locationId) } }, select: { id: true, type: true } });
    const type = new Map(locs.map((l) => [l.id, l.type]));
    const sum = (reseller: boolean) => rows.filter((r) => (type.get(r.locationId) === "RESELLER") === reseller).reduce((s, r) => s + Number(r._sum.quantity ?? 0), 0);
    stock = { shelf: String(sum(false)), withResellers: String(sum(true)) };
  }
  return { kind: "product", product: card(product), stock };
}

/** For the POS: can this exact piece be sold at this location right now? (The sale itself checks again under a lock.) */
export type PosScanResult = { ok: true; itemId: string; itemNo: string; token: string; productId: string; productName: string } | { ok: false; message: string };

export async function posScan(raw: string, locationId: string): Promise<PosScanResult> {
  const user = await getSessionUser();
  if (!user || !can(user, "sales.pos")) return { ok: false, message: "You are not allowed to sell." };
  if (!parseItemCode(raw)) return { ok: false, message: "That is not an item code. Scan the QR code on the product." };
  const found = await findItemByCode(db, raw);
  if (!found) return { ok: false, message: "This item was not found. Check the label and scan again." };
  const it = await db.inventoryItem.findUniqueOrThrow({ where: { id: found.id }, select: { id: true, itemNo: true, token: true, status: true, locationId: true, productId: true, product: { select: { name: true, status: true, sellingPrice: true } } } });
  if (it.status === "SOLD") return { ok: false, message: "This product has already been sold." };
  if (it.status === "WITH_RESELLER") return { ok: false, message: "This product is currently assigned to a reseller." };
  if (it.locationId !== locationId) return { ok: false, message: "This product is not available at this location." };
  if (it.status !== "AVAILABLE") return { ok: false, message: `This item cannot be sold: it is ${ITEM_STATUS_LABEL[it.status].toLowerCase()}.` };
  if (it.product.status !== "ACTIVE") return { ok: false, message: `${it.product.name} is not for sale any more.` };
  if (it.product.sellingPrice.lte(0)) return { ok: false, message: `No selling price is set for ${it.product.name}.` };
  return { ok: true, itemId: it.id, itemNo: it.itemNo, token: it.token, productId: it.productId, productName: it.product.name };
}
