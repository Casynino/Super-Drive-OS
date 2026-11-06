import type { ItemEventKind, ItemStatus } from "@/generated/prisma/client";

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  AVAILABLE: "Available in shop",
  SOLD: "Sold",
  WITH_RESELLER: "With winga",
  DAMAGED: "Damaged",
  MISSING: "Missing",
  DISPOSED: "Disposed",
};

export const ITEM_STATUS_BADGE: Record<ItemStatus, string> = {
  AVAILABLE: "badge-green",
  SOLD: "badge-gray",
  WITH_RESELLER: "badge-blue",
  DAMAGED: "badge-red",
  MISSING: "badge-yellow",
  DISPOSED: "badge-gray",
};

export const ITEM_EVENT_LABEL: Record<ItemEventKind, string> = {
  RECEIVED: "Received",
  ADDED: "Added (stock found)",
  SOLD: "Sold",
  RETURNED: "Returned by customer",
  TRANSFERRED: "Transferred",
  ISSUED_TO_RESELLER: "Issued to winga",
  RETURNED_FROM_RESELLER: "Returned by winga",
  SOLD_BY_RESELLER: "Sold by winga",
  DAMAGED: "Damaged",
  MISSING: "Marked missing",
  RESTORED: "Restored to stock",
  DISPOSED: "Disposed",
};

export const ITEM_STATUSES = Object.keys(ITEM_STATUS_LABEL) as ItemStatus[];
