// Resellers (consignment). See the schema notes: ISSUING stock is a custody transfer (no sale, no cash, no receivable);
// a SOLD REPORT is what creates the invoice; money brought in is an ordinary payment allocated to those invoices.
//
// Lock order: reseller document counter -> (transfer counter -> stock balance rows) for issues and returns;
// sold reports follow the normal sale order (INV counter -> customer -> products -> balances -> PAY counter).
import { Prisma } from "@/generated/prisma/client";
import { postAdjustment, postTransfer } from "@/lib/inventory/documents";
import { nextDocumentNo, type Dec, type Tx } from "@/lib/inventory/engine";
import { resolveLines, type ResolvedLine } from "@/lib/inventory/lines";
import { owedSql } from "@/lib/sales/owed";
import { listPrice } from "@/lib/sales/pricing";
import { postSale } from "@/lib/sales/post-sale";

const D = Prisma.Decimal;

/** A problem the person can fix. fieldErrors keys: "name", "phone", "line.<i>", ... */
export class ResellerError extends Error {
  constructor(
    message: string,
    public fieldErrors: Record<string, string> = {},
  ) {
    super(message);
  }
}

export type ProfileInput = {
  name: string;
  businessName: string;
  phone: string;
  altPhone: string;
  address: string;
  salesLocation: string;
  idInfo: string;
  notes: string;
  settlementDays: string;
};

function cleanProfile(i: ProfileInput) {
  const fe: Record<string, string> = {};
  const name = i.name.trim();
  const phone = i.phone.trim();
  if (name.length < 2) fe.name = "Enter the reseller's full name.";
  if (phone.length < 6) fe.phone = "Enter a phone number.";
  const days = Number(i.settlementDays || "14");
  if (!Number.isInteger(days) || days < 0 || days > 365) fe.settlementDays = "Enter a number of days between 0 and 365.";
  if (Object.keys(fe).length) throw new ResellerError("Please fix the highlighted fields.", fe);
  const opt = (v: string) => v.trim() || null;
  return { name, businessName: opt(i.businessName), phone, altPhone: opt(i.altPhone), address: opt(i.address), salesLocation: opt(i.salesLocation), idInfo: opt(i.idInfo), notes: opt(i.notes), settlementDays: days };
}

/** Registers a reseller together with the account that holds their invoices and the location that holds their stock. */
export async function createReseller(tx: Tx, input: ProfileInput & { user: { id: string } }) {
  const p = cleanProfile(input);
  const code = await nextDocumentNo(tx, "RSL");
  const label = p.businessName ? `${p.name} (${p.businessName})` : p.name;
  const customer = await tx.customer.create({
    data: { name: label, contactPerson: p.name, phone: p.phone, businessLocation: p.salesLocation, type: "WHOLESALE", creditLimit: 0, notes: "Reseller account", createdById: input.user.id },
  });
  const location = await tx.location.create({ data: { code, name: `Reseller: ${label} (${code.slice(-6)})`, type: "RESELLER", address: p.salesLocation } });
  return tx.reseller.create({ data: { ...p, customerId: customer.id, locationId: location.id, createdById: input.user.id } });
}

export async function updateReseller(tx: Tx, input: ProfileInput & { id: string }) {
  const p = cleanProfile(input);
  const r = await tx.reseller.update({ where: { id: input.id }, data: p });
  // keep the account name in step with the profile
  await tx.customer.update({ where: { id: r.customerId }, data: { name: p.businessName ? `${p.name} (${p.businessName})` : p.name, contactPerson: p.name, phone: p.phone, businessLocation: p.salesLocation } });
  return r;
}

export async function setResellerStatus(tx: Tx, id: string, status: "ACTIVE" | "INACTIVE") {
  const r = await tx.reseller.update({ where: { id }, data: { status } });
  await tx.customer.update({ where: { id: r.customerId }, data: { status } });
  return r;
}

type LineIn = { productId: string; unitId: string; quantity: string };

async function loadReseller(tx: Tx, id: string, opts: { mustBeActive: boolean }) {
  await tx.$queryRaw`SELECT "id" FROM "Reseller" WHERE "id" = ${id} FOR SHARE`;
  const r = await tx.reseller.findUnique({ where: { id } });
  if (!r) throw new ResellerError("This reseller no longer exists.");
  if (opts.mustBeActive && r.status !== "ACTIVE") throw new ResellerError(`${r.name} is deactivated. Reactivate them before issuing more stock.`);
  return r;
}

function mapLineErrors(resolved: { errors: Record<number, string>; message: string }) {
  return new ResellerError(resolved.message, Object.fromEntries(Object.entries(resolved.errors).map(([i, m]) => [`line.${i}`, m])));
}

// ───────────── Issue stock ─────────────

export async function issueStock(tx: Tx, input: { user: { id: string }; resellerId: string; fromLocationId: string; lines: LineIn[]; notes: string | null; submissionKey: string; currencyDecimals: number }) {
  const reseller = await loadReseller(tx, input.resellerId, { mustBeActive: true });
  const from = await tx.location.findUnique({ where: { id: input.fromLocationId } });
  if (!from || from.status !== "ACTIVE" || from.type === "RESELLER") throw new ResellerError("Choose the shop location the stock comes from.", { fromLocationId: "Choose a shop location." });

  const resolved = await resolveLines(tx, input.lines);
  if (!resolved.ok) throw mapLineErrors(resolved);

  const errors: Record<string, string> = {};
  const priced = resolved.lines.flatMap((l) => {
    const unitPrice = listPrice(l, true).toDecimalPlaces(input.currencyDecimals); // resellers buy at wholesale prices (retail when none is set)
    if (unitPrice.lte(0)) {
      errors[`line.${l.index}`] = `No selling price is set for ${l.productName}. Ask the owner to set it first.`;
      return [];
    }
    return [{ l, unitPrice, lineValue: l.enteredQty.mul(unitPrice).toDecimalPlaces(input.currencyDecimals) }];
  });
  if (Object.keys(errors).length) throw new ResellerError("Please fix the highlighted items.", errors);

  const issueNo = await nextDocumentNo(tx, "ISS");
  const expectedValue = priced.reduce((s, p) => s.plus(p.lineValue), new D(0));
  // Insert first: a double-submitted form fails here (unique key) before any stock moves.
  const issue = await tx.resellerIssue.create({
    data: {
      issueNo, resellerId: reseller.id, fromLocationId: from.id, toLocationId: reseller.locationId, expectedValue, notes: input.notes?.trim() || null, createdById: input.user.id, submissionKey: input.submissionKey,
      items: { create: priced.map(({ l, unitPrice, lineValue }) => ({ productId: l.productId, enteredQty: l.enteredQty, enteredUnitId: l.enteredUnitId, factor: l.factor, quantity: l.quantity, unitPrice, basePrice: unitPrice.div(l.factor).toDecimalPlaces(4), lineValue })) },
    },
  });
  // The stock moves out of the shop shelf into the reseller's custody (traceable ledger rows on both sides)
  const transfer = await postTransfer(tx, { fromLocationId: from.id, toLocationId: reseller.locationId, notes: `Issued to ${reseller.name} (${issueNo})`, submissionKey: `${input.submissionKey}:transfer`, lines: priced.map((p) => p.l), user: input.user });
  return { issue, reseller, transferNo: transfer.transferNo };
}

// ───────────── What the reseller sold ─────────────

/** Latest agreed price per BASE unit for every product ever issued to this reseller. */
async function agreedPrices(tx: Pick<Tx, "$queryRaw">, resellerId: string) {
  const rows = await tx.$queryRaw<{ productId: string; basePrice: Dec }[]>`
    SELECT DISTINCT ON (i."productId") i."productId", i."basePrice"
      FROM "ResellerIssueItem" i JOIN "ResellerIssue" s ON s."id" = i."issueId"
     WHERE s."resellerId" = ${resellerId}
     ORDER BY i."productId", s."createdAt" DESC`;
  return new Map(rows.map((r) => [r.productId, new D(r.basePrice)]));
}

export async function reportSold(
  tx: Tx,
  input: {
    user: { id: string };
    canDiscount: boolean;
    resellerId: string;
    lines: (LineIn & { unitPrice?: string })[];
    discountReason: string | null;
    notes: string | null;
    submissionKey: string;
    currencyDecimals: number;
  },
) {
  const reseller = await loadReseller(tx, input.resellerId, { mustBeActive: false });
  const basePrices = await agreedPrices(tx, reseller.id);
  const result = await postSale(tx, {
    user: input.user,
    can: { discount: input.canDiscount, credit: true, approveCreditException: false },
    customerId: reseller.customerId,
    locationId: reseller.locationId,
    mode: "CREDIT",
    method: null,
    partAmount: null,
    reference: null,
    notes: input.notes ? `Reseller report: ${input.notes}` : "Reseller sold report",
    discountReason: input.discountReason,
    lines: input.lines.map((l) => ({ productId: l.productId, unitId: l.unitId, quantity: l.quantity, unitPrice: l.unitPrice ?? "" })),
    creditException: null,
    reseller: { id: reseller.id, basePrices },
    submissionKey: input.submissionKey,
    currencyDecimals: input.currencyDecimals,
    creditTermsDays: reseller.settlementDays,
  });
  return { sale: result.sale, reseller };
}

// ───────────── Returns from the reseller ─────────────

export async function returnStock(
  tx: Tx,
  input: { user: { id: string }; resellerId: string; toLocationId: string; lines: (LineIn & { condition: "RESELLABLE" | "DAMAGED" })[]; notes: string | null; submissionKey: string },
) {
  const reseller = await loadReseller(tx, input.resellerId, { mustBeActive: false });
  const to = await tx.location.findUnique({ where: { id: input.toLocationId } });
  if (!to || to.status !== "ACTIVE" || to.type === "RESELLER") throw new ResellerError("Choose the shop location the stock goes back to.", { toLocationId: "Choose a shop location." });

  // Good and damaged goods are resolved separately: the same product may be in both lists (some bottles fine, some broken).
  const goodRaw = input.lines.filter((l) => l.condition === "RESELLABLE");
  const badRaw = input.lines.filter((l) => l.condition === "DAMAGED");
  if (goodRaw.length + badRaw.length === 0) throw new ResellerError("Add at least one product.", { lines: "Add at least one product." });
  const good = goodRaw.length ? await resolveLines(tx, goodRaw) : ({ ok: true, lines: [] as ResolvedLine[] } as const);
  const bad = badRaw.length ? await resolveLines(tx, badRaw) : ({ ok: true, lines: [] as ResolvedLine[] } as const);
  if (!good.ok) throw new ResellerError(good.message, Object.fromEntries(Object.entries(good.errors).map(([i, m]) => [`good.${i}`, m])));
  if (!bad.ok) throw new ResellerError(bad.message, Object.fromEntries(Object.entries(bad.errors).map(([i, m]) => [`damaged.${i}`, m])));

  const returnNo = await nextDocumentNo(tx, "RRT");
  const item = (l: (typeof good.lines)[number], condition: "RESELLABLE" | "DAMAGED") => ({ productId: l.productId, enteredQty: l.enteredQty, enteredUnitId: l.enteredUnitId, factor: l.factor, quantity: l.quantity, condition });
  const ret = await tx.resellerReturn.create({
    data: {
      returnNo, resellerId: reseller.id, fromLocationId: reseller.locationId, toLocationId: to.id, notes: input.notes?.trim() || null, createdById: input.user.id, submissionKey: input.submissionKey,
      items: { create: [...good.lines.map((l) => item(l, "RESELLABLE")), ...bad.lines.map((l) => item(l, "DAMAGED"))] },
    },
  });
  // Good goods go back on the shop shelf; damaged ones are written off straight from the reseller's custody
  if (good.lines.length) await postTransfer(tx, { fromLocationId: reseller.locationId, toLocationId: to.id, notes: `Returned by ${reseller.name} (${returnNo})`, submissionKey: `${input.submissionKey}:transfer`, lines: good.lines, user: input.user });
  if (bad.lines.length) await postAdjustment(tx, { kind: "DAMAGE", locationId: reseller.locationId, reason: `Damaged stock returned by ${reseller.name} (${returnNo})`, submissionKey: `${input.submissionKey}:damage`, lines: bad.lines, user: input.user });
  return { ret, reseller };
}

// ───────────── The reseller's account ─────────────

export type ResellerAccount = Awaited<ReturnType<typeof getResellerAccount>>;

/** Everything the owner needs to see about one reseller, all derived from records. */
export async function getResellerAccount(db: Pick<Tx, "$queryRaw" | "reseller" | "payment" | "stockBalance" | "resellerIssue">, resellerId: string) {
  const reseller = await db.reseller.findUniqueOrThrow({ where: { id: resellerId } });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date());

  const [issued, sold, returned, money, lastPay, lastIssue, stock, prices] = await Promise.all([
    db.$queryRaw<{ productId: string; qty: Dec; value: Dec }[]>`
      SELECT i."productId", SUM(i."quantity") AS qty, SUM(i."lineValue") AS value
        FROM "ResellerIssueItem" i JOIN "ResellerIssue" s ON s."id" = i."issueId" WHERE s."resellerId" = ${resellerId} GROUP BY 1`,
    db.$queryRaw<{ productId: string; qty: Dec }[]>`
      SELECT si."productId", SUM(si."quantity" - COALESCE(r.q, 0)) AS qty
        FROM "SaleItem" si JOIN "Sale" s ON s."id" = si."saleId"
        LEFT JOIN (SELECT ri."saleItemId", SUM(ri."quantity") AS q FROM "ReversalItem" ri JOIN "SaleReversal" rv ON rv."id" = ri."reversalId" WHERE rv."status" = 'COMPLETED' GROUP BY 1) r ON r."saleItemId" = si."id"
       WHERE s."resellerId" = ${resellerId} GROUP BY 1`,
    db.$queryRaw<{ productId: string; qty: Dec }[]>`
      SELECT i."productId", SUM(i."quantity") AS qty FROM "ResellerReturnItem" i JOIN "ResellerReturn" r ON r."id" = i."returnId" WHERE r."resellerId" = ${resellerId} GROUP BY 1`,
    db.$queryRaw<{ sold: Dec | null; collected: Dec | null; owed: Dec | null; overdue: Dec | null; reports: bigint; lastReport: Date | null }[]>`
      SELECT SUM("total" - "returnedTotal") AS sold, SUM("amountPaid" - "refundedTotal") AS collected,
             SUM(${owedSql()}) AS owed,
             SUM(CASE WHEN "dueDate" < ${today}::date THEN ${owedSql()} ELSE 0 END) AS overdue,
             COUNT(*) AS reports, MAX("createdAt") AS "lastReport"
        FROM "Sale" WHERE "resellerId" = ${resellerId} AND "status" = 'COMPLETED'`,
    db.payment.findFirst({ where: { customerId: reseller.customerId }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
    db.resellerIssue.findFirst({ where: { resellerId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.stockBalance.findMany({ where: { locationId: reseller.locationId, quantity: { gt: 0 } }, select: { productId: true, quantity: true } }),
    agreedPrices(db, resellerId),
  ]);

  const sum = (rows: { qty: Dec }[]) => rows.reduce((s, r) => s.plus(r.qty), new D(0));
  const m = money[0];
  const remainingValue = stock.reduce((s, b) => s.plus(b.quantity.mul(prices.get(b.productId) ?? 0)), new D(0));
  return {
    reseller,
    issuedValue: issued.reduce((s, r) => s.plus(r.value), new D(0)),
    issuedQty: sum(issued),
    soldQty: sum(sold),
    soldValue: new D(m?.sold ?? 0),
    returnedQty: sum(returned),
    remainingQty: stock.reduce((s, b) => s.plus(b.quantity), new D(0)),
    remainingValue,
    collected: new D(m?.collected ?? 0),
    outstanding: new D(m?.owed ?? 0),
    overdue: new D(m?.overdue ?? 0),
    reports: Number(m?.reports ?? 0),
    lastReportAt: m?.lastReport ?? null,
    lastPaymentAt: lastPay?.receivedAt ?? null,
    lastIssueAt: lastIssue?.createdAt ?? null,
  };
}


/** Per product: what was issued, sold and returned, what the reseller still holds, and the agreed price. */
export async function getResellerProducts(db: Pick<Tx, "$queryRaw" | "stockBalance" | "reseller" | "product">, resellerId: string) {
  const reseller = await db.reseller.findUniqueOrThrow({ where: { id: resellerId }, select: { locationId: true } });
  const [issued, sold, returned, stock, prices] = await Promise.all([
    db.$queryRaw<{ productId: string; qty: Dec }[]>`SELECT i."productId", SUM(i."quantity") AS qty FROM "ResellerIssueItem" i JOIN "ResellerIssue" s ON s."id" = i."issueId" WHERE s."resellerId" = ${resellerId} GROUP BY 1`,
    db.$queryRaw<{ productId: string; qty: Dec }[]>`
      SELECT si."productId", SUM(si."quantity" - COALESCE(r.q, 0)) AS qty
        FROM "SaleItem" si JOIN "Sale" s ON s."id" = si."saleId"
        LEFT JOIN (SELECT ri."saleItemId", SUM(ri."quantity") AS q FROM "ReversalItem" ri JOIN "SaleReversal" rv ON rv."id" = ri."reversalId" WHERE rv."status" = 'COMPLETED' GROUP BY 1) r ON r."saleItemId" = si."id"
       WHERE s."resellerId" = ${resellerId} GROUP BY 1`,
    db.$queryRaw<{ productId: string; qty: Dec }[]>`SELECT i."productId", SUM(i."quantity") AS qty FROM "ResellerReturnItem" i JOIN "ResellerReturn" r ON r."id" = i."returnId" WHERE r."resellerId" = ${resellerId} GROUP BY 1`,
    db.stockBalance.findMany({ where: { locationId: reseller.locationId }, select: { productId: true, quantity: true } }),
    agreedPrices(db, resellerId),
  ]);
  const q = (rows: { productId: string; qty: Dec }[]) => new Map(rows.map((r) => [r.productId, new D(r.qty)]));
  const [mi, ms, mr] = [q(issued), q(sold), q(returned)];
  const held = new Map(stock.map((b) => [b.productId, b.quantity]));
  const ids = [...new Set([...mi.keys(), ...held.keys()])];
  const names = await db.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, sku: true, baseUnit: { select: { symbol: true } } }, orderBy: { name: "asc" } });
  return names.map((p) => {
    const price = prices.get(p.id) ?? new D(0);
    const remaining = held.get(p.id) ?? new D(0);
    return { productId: p.id, name: p.name, sku: p.sku, symbol: p.baseUnit.symbol, issued: mi.get(p.id) ?? new D(0), sold: ms.get(p.id) ?? new D(0), returned: mr.get(p.id) ?? new D(0), remaining, basePrice: price, remainingValue: remaining.mul(price) };
  });
}
