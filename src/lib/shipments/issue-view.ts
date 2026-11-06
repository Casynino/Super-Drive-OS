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
  pack: { symbol: string; factor: number } | null;
  kind: IssueRecord["kind"];
  typeLabel: string;
  total: number;
  resolved: number;
  open: number;
  description: string;
  reported: string | null;
  history: { at: string; by: string; text: string; note: string | null }[];
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
    pack: r.pack,
    kind: r.kind,
    typeLabel: ISSUE_TYPE_LABEL[r.type],
    total: r.total,
    resolved: r.resolved,
    open: r.open,
    description: r.description,
    reported: r.reportedAt ? `${formatDateTime(r.reportedAt)}${r.reportedBy ? ` by ${r.reportedBy}` : ""}` : r.reportedBy ? `by ${r.reportedBy}` : null,
    history: r.history.map((h) => ({ at: formatDateTime(h.at), by: h.by, text: h.text, note: h.note })),
  }));
}
