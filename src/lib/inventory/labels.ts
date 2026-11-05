// Client-safe labels for stock movements and links to the document a movement belongs to.
export const MOVEMENT_LABELS: Record<string, { label: string; badge: string }> = {
  RECEIVED: { label: "Received", badge: "badge-green" },
  SOLD: { label: "Sold", badge: "badge-blue" },
  CUSTOMER_RETURN: { label: "Customer return", badge: "badge-green" },
  SUPPLIER_RETURN: { label: "Supplier return", badge: "badge-yellow" },
  TRANSFER_IN: { label: "Transfer in", badge: "badge-blue" },
  TRANSFER_OUT: { label: "Transfer out", badge: "badge-blue" },
  DAMAGED: { label: "Damaged / missing", badge: "badge-red" },
  ADJUSTMENT: { label: "Adjustment", badge: "badge-yellow" },
  CORRECTION: { label: "Count correction", badge: "badge-yellow" },
};

export const ADJUSTMENT_KIND_LABELS: Record<string, string> = {
  INCREASE: "Stock increase",
  DECREASE: "Stock decrease",
  DAMAGE: "Damaged / missing",
  COUNT: "Stock count",
};

export function documentHref(referenceType: string | null, referenceId: string | null): string | null {
  if (!referenceType || !referenceId) return null;
  if (referenceType === "StockReceipt") return `/inventory/receiving/${referenceId}`;
  if (referenceType === "StockTransfer") return `/inventory/transfers/${referenceId}`;
  if (referenceType === "StockAdjustment") return `/inventory/adjustments/${referenceId}`;
  return null;
}
