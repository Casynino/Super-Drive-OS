import type { IssueAction } from "@/generated/prisma/client";
import type { IssueRecord } from "./issues";
import { ISSUE_TYPE_LABEL } from "./issues";
import { formatDateTime } from "@/lib/utils";

/** An investigation record as the browser gets it: dates are already written out, and no cost is in it. */
export type IssueView = {
  key: string;
  shipmentId: string;
  shipmentNo: string;
  supplierName: string | null;
  shipmentItemId: string;
  productId: string;
  productName: string;
  sku: string;
  imageV: number | null;
  unit: string;
  normalPrice: number | null;
  pack: { symbol: string; factor: number } | null;
  kind: IssueRecord["kind"];
  typeLabel: string;
  total: number;
  resolved: number;
  open: number;
  description: string;
  expected: number;
  arrived: number;
  /** what one piece cost: only for the owner, never sent to the shop */
  unitCost: number | null;
  reported: string | null;
  history: { at: string; by: string; action: IssueAction; quantity: number; receiptNo: string | null; newOrderNo: string | null; variantName: string | null; discountPrice: number | null; note: string | null }[];
};

export function toIssueViews(records: IssueRecord[]): IssueView[] {
  return records.map((r) => ({
    key: r.key,
    shipmentId: r.shipmentId,
    shipmentNo: r.shipmentNo,
    supplierName: r.supplierName,
    shipmentItemId: r.shipmentItemId,
    productId: r.productId,
    productName: r.productName,
    sku: r.sku,
    imageV: r.imageV,
    unit: r.unit,
    normalPrice: r.normalPrice,
    pack: r.pack,
    kind: r.kind,
    typeLabel: ISSUE_TYPE_LABEL[r.type],
    total: r.total,
    resolved: r.resolved,
    open: r.open,
    description: r.description,
    expected: r.expected,
    arrived: r.arrived,
    unitCost: r.unitCost,
    reported: r.reportedAt ? `${formatDateTime(r.reportedAt)}${r.reportedBy ? ` by ${r.reportedBy}` : ""}` : r.reportedBy ? `by ${r.reportedBy}` : null,
    history: r.history.map((h) => ({ ...h, at: formatDateTime(h.at) })),
  }));
}
