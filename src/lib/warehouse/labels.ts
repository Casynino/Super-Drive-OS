import type { PickupAuth, PickupStatus } from "@/generated/prisma/client";

export const STATUS_LABEL: Record<PickupStatus, string> = {
  NEW: "New",
  PREPARING: "Preparing",
  READY: "Ready for collection",
  PARTIAL: "Partly collected",
  COMPLETED: "Collected",
  CANCELLED: "Cancelled",
};
/** The same words as plain text colour classes: one calm style, red only for a cancelled note. */
export const STATUS_TEXT: Record<PickupStatus, string> = {
  NEW: "text-navy-700 font-semibold",
  PREPARING: "text-amber-600 font-medium",
  READY: "text-emerald-600 font-semibold",
  PARTIAL: "text-amber-600 font-medium",
  COMPLETED: "text-slate-500",
  CANCELLED: "text-brand-red-dark",
};
export const AUTH_LABEL: Record<PickupAuth, string> = { PAID: "Paid", PART_PAID: "Part paid, rest on approved credit", CREDIT_APPROVED: "Credit · approved" };
export const OPEN_STATUSES: PickupStatus[] = ["NEW", "PREPARING", "READY", "PARTIAL"];

export const EVENT_LABEL = {
  RESERVED: "Goods reserved",
  PREPARING: "Preparing started",
  READY: "Marked ready",
  RELEASED: "Goods released",
  RESERVATION_FREED: "Reservation given back",
  SCAN_REJECTED: "Scan refused",
} as const;
