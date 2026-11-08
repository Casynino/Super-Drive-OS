// Problems reported by hand: the warehouse person (or the owner) finds a product that is already in stock damaged on the shelf, or cannot find it.
//
//   report   the pieces leave the SELLABLE stock at once (a normal DAMAGE or DECREASE stock adjustment, so the ledger, item history and audit stay whole).
//            Reserved pieces (goods already sold and waiting for pickup) cannot be reported: moveStock refuses to eat into them.
//   decide   once, and the decision is final:
//            FOUND          the pieces turned up (or it was a mistake)  -> a stock increase puts them back
//            WRITE_OFF      they cannot be sold                          -> damaged pieces are marked DISPOSED; nothing else moves (the stock is already out)
//            DISCOUNT_SELL  damaged but sellable                         -> moved into the "(damaged packaging)" product at a lower price (damaged only)
//
// Call inside db.$transaction. Lock order: problem row -> (adjustment counter -> products -> balances).
import { Prisma, type IssueAction, type IssueKind } from "@/generated/prisma/client";
import { postAdjustment } from "@/lib/inventory/documents";
import { disposeReportedItems, isTracked } from "@/lib/inventory/items";
import { resolveLines } from "@/lib/inventory/lines";
import type { Tx } from "@/lib/inventory/engine";
import { largestPack } from "@/lib/qty";
import { putOnDiscount } from "./discount";
import { ShipmentError } from "./engine";

const D = Prisma.Decimal;
type Reader = Pick<Tx, "stockProblem">;

export type ReportKind = Extract<IssueKind, "DAMAGED" | "MISSING">;
export const PROBLEM_KIND_LABEL: Record<ReportKind, string> = { DAMAGED: "Damaged", MISSING: "Lost" };
export const PROBLEM_ACTION_LABEL: Partial<Record<IssueAction, string>> = {
  FOUND: "Found and returned to stock",
  WRITE_OFF: "Written off",
  DISCOUNT_SELL: "Put on sale at a discount",
};
const FITS: Record<ReportKind, IssueAction[]> = { DAMAGED: ["FOUND", "WRITE_OFF", "DISCOUNT_SELL"], MISSING: ["FOUND", "WRITE_OFF"] };
export const actionsFor = (kind: ReportKind): IssueAction[] => FITS[kind];

const q = (n: Prisma.Decimal | number) => String(Number(Number(n).toFixed(3)));

export type ReportInput = {
  productId: string;
  locationId: string;
  kind: ReportKind;
  /** base units (pieces) */
  quantity: string;
  note: string;
  /** one per form; a double submit is answered with the first result */
  submissionKey: string;
  user: { id: string };
};

/** Report a problem on a product in stock: the pieces are taken off the sellable stock now. */
export async function reportProblem(tx: Tx, input: ReportInput) {
  if (input.kind !== "DAMAGED" && input.kind !== "MISSING") throw new ShipmentError("Choose damaged or lost.");
  const qty = new D(input.quantity.trim() === "" ? "NaN" : input.quantity.trim());
  if (!qty.isFinite() || qty.lte(0)) throw new ShipmentError("Enter how many pieces.", { quantity: "Enter a number above zero." });
  const note = input.note.trim();
  if (note.length < 3) throw new ShipmentError("Write a short note about what happened.", { note: "Say what happened, in a few words." });
  if ((await isTracked(tx, input.productId)) && !qty.isInteger()) throw new ShipmentError("Enter a whole number of pieces.", { quantity: "Whole pieces only." });

  const again = await tx.stockProblem.findUnique({ where: { submissionKey: input.submissionKey } });
  if (again) return { problem: again, repeated: true };

  const product = await tx.product.findUnique({ where: { id: input.productId }, select: { baseUnitId: true, name: true } });
  if (!product) throw new ShipmentError("This product no longer exists.");
  const resolved = await resolveLines(tx, [{ productId: input.productId, unitId: product.baseUnitId, quantity: qty.toString() }]);
  if (!resolved.ok) throw new ShipmentError(resolved.message);

  const { adjustment } = await postAdjustment(tx, {
    kind: input.kind === "DAMAGED" ? "DAMAGE" : "DECREASE",
    locationId: input.locationId,
    reason: `${input.kind === "DAMAGED" ? "Damaged" : "Lost"} (under investigation): ${note}`,
    submissionKey: `problem:${input.submissionKey}`,
    lines: resolved.lines,
    user: input.user,
  });
  const problem = await tx.stockProblem.create({
    data: { productId: input.productId, locationId: input.locationId, kind: input.kind, quantity: qty, note, adjustmentId: adjustment.id, submissionKey: input.submissionKey, reportedById: input.user.id },
  });
  return { problem, repeated: false, adjustmentNo: adjustment.adjustmentNo };
}

export type DecideProblemInput = {
  problemId: string;
  action: IssueAction;
  note: string | null;
  /** DISCOUNT_SELL only: the new selling price per carton (per piece when the product has no carton) */
  discountPrice?: string;
  user: { id: string };
  currencyDecimals: number;
};

/** Decide a reported problem, once. Updates stock in the same transaction. */
export async function decideProblem(tx: Tx, input: DecideProblemInput) {
  await tx.$queryRaw`SELECT "id" FROM "StockProblem" WHERE "id" = ${input.problemId} FOR UPDATE`;
  const p = await tx.stockProblem.findUnique({ where: { id: input.problemId }, include: { adjustment: { select: { adjustmentNo: true } }, product: { select: { name: true, baseUnitId: true, purchasePrice: true, avgCost: true } } } });
  if (!p) throw new ShipmentError("This problem no longer exists.");
  if (p.action) throw new ShipmentError("This problem was already decided.");
  const kind = p.kind as ReportKind;
  if (!FITS[kind].includes(input.action)) throw new ShipmentError("That action does not fit this problem.");
  const note = input.note?.trim() || null;
  if (input.action === "WRITE_OFF" && (note?.length ?? 0) < 3) throw new ShipmentError("Write a short reason.", { note: "Give a short reason." });

  const refs = { referenceType: "StockProblem", referenceId: p.id, referenceNo: p.adjustment.adjustmentNo };
  let foundAdjustmentId: string | null = null;
  let variantProductId: string | null = null;
  let discountPerBase: Prisma.Decimal | null = null;
  const unitCost = p.product.avgCost.gt(0) ? p.product.avgCost : p.product.purchasePrice;

  if (input.action === "FOUND") {
    const resolved = await resolveLines(tx, [{ productId: p.productId, unitId: p.product.baseUnitId, quantity: p.quantity.toString() }]);
    if (!resolved.ok) throw new ShipmentError(resolved.message);
    const { adjustment } = await postAdjustment(tx, {
      kind: "INCREASE",
      locationId: p.locationId,
      reason: `Found after investigation (${p.adjustment.adjustmentNo})${note ? `: ${note}` : ""}`,
      submissionKey: `problem-found:${p.id}`,
      lines: resolved.lines,
      user: input.user,
    });
    foundAdjustmentId = adjustment.id;
  } else if (input.action === "WRITE_OFF") {
    await disposeReportedItems(tx, { adjustmentId: p.adjustmentId, productId: p.productId, qty: p.quantity, ...refs, note: note ?? "Written off after investigation", userId: input.user.id });
  } else if (input.action === "DISCOUNT_SELL") {
    const moved = await putOnDiscount(tx, {
      productId: p.productId,
      qty: p.quantity,
      discountPrice: input.discountPrice ?? "",
      unitCost,
      locationId: p.locationId,
      currencyDecimals: input.currencyDecimals,
      user: input.user,
      ...refs,
      reason: `Damaged packaging reported at the warehouse (${p.adjustment.adjustmentNo}), put on sale at a discount${note ? `: ${note}` : ""}`,
      disposeOriginal: async (variantName) => {
        await disposeReportedItems(tx, { adjustmentId: p.adjustmentId, productId: p.productId, qty: p.quantity, ...refs, note: `Moved to ${variantName} to be sold at a discount`, userId: input.user.id });
      },
    });
    variantProductId = moved.variantProductId;
    discountPerBase = moved.perBase;
  }

  const decided = await tx.stockProblem.update({
    where: { id: p.id },
    data: { action: input.action, decisionNote: note, foundAdjustmentId, variantProductId, discountPrice: discountPerBase, decidedById: input.user.id, decidedAt: new Date() },
  });
  return { problem: decided, productName: p.product.name, quantity: p.quantity };
}

export type ProblemView = {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  imageV: number | null;
  unit: string;
  pack: { symbol: string; factor: number } | null;
  /** what one carton (or piece) normally sells for; used to check a discount is lower */
  normalPrice: number | null;
  kind: ReportKind;
  quantity: number;
  note: string;
  adjustmentNo: string;
  reportedBy: string;
  reportedAt: Date;
  action: IssueAction | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  variantName: string | null;
  discountPrice: number | null;
};

/** Open problems first (oldest first), then the decided ones (newest first, `decidedLimit` of them). */
export async function loadProblems(db: Reader, opts: { decidedLimit?: number } = {}): Promise<{ open: ProblemView[]; decided: ProblemView[] }> {
  const include = {
    product: { select: { name: true, sku: true, sellingPrice: true, baseUnit: { select: { symbol: true } }, image: { select: { updatedAt: true } }, units: { select: { factor: true, sellingPrice: true, unit: { select: { symbol: true } } } } } },
    adjustment: { select: { adjustmentNo: true } },
    reportedBy: { select: { name: true } },
    decidedBy: { select: { name: true } },
    variantProduct: { select: { name: true } },
  } as const;
  const [open, decided] = await Promise.all([
    db.stockProblem.findMany({ where: { action: null }, orderBy: { reportedAt: "asc" }, include }),
    db.stockProblem.findMany({ where: { action: { not: null } }, orderBy: { decidedAt: "desc" }, take: opts.decidedLimit ?? 15, include }),
  ]);
  type Row = (typeof open)[number];
  const view = (r: Row): ProblemView => {
    const top = [...r.product.units].filter((u) => u.factor.gt(1)).sort((a, b) => b.factor.comparedTo(a.factor))[0];
    const price = top ? (top.sellingPrice ?? r.product.sellingPrice.mul(top.factor)) : r.product.sellingPrice;
    return {
      id: r.id,
      productId: r.productId,
      productName: r.product.name,
      sku: r.product.sku,
      imageV: r.product.image ? r.product.image.updatedAt.getTime() : null,
      unit: r.product.baseUnit.symbol,
      pack: largestPack(r.product.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor }))),
      normalPrice: price.gt(0) ? Number(price) : null,
      kind: r.kind as ReportKind,
      quantity: Number(r.quantity),
      note: r.note,
      adjustmentNo: r.adjustment.adjustmentNo,
      reportedBy: r.reportedBy.name,
      reportedAt: r.reportedAt,
      action: r.action,
      decisionNote: r.decisionNote,
      decidedBy: r.decidedBy?.name ?? null,
      decidedAt: r.decidedAt,
      variantName: r.variantProduct?.name ?? null,
      discountPrice: r.discountPrice ? Number(r.discountPrice) : null,
    };
  };
  return { open: open.map(view), decided: decided.map(view) };
}

export { q as problemQty };
