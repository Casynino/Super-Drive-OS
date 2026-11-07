"use server";

// Collect money and take goods back WITHOUT leaving the page (pop-ups at the till and on the Winga page).
// The rules are the same as the full pages: postCollection for money, a normal RETURN reversal for goods.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { guarded } from "@/lib/action";
import { notifyPermission } from "@/lib/notifications";
import { CollectionError, postCollection } from "@/lib/sales/collections";
import { customerOutstanding, customerOverdue } from "@/lib/sales/outstanding";
import { owedOf } from "@/lib/sales/owed";
import { ReversalError, completeReversal, createReversalRequest, returnedBySaleItem } from "@/lib/sales/reversals";
import { getCurrency } from "@/lib/settings";
import { can } from "@/lib/auth/can";
import { methodLabel } from "@/lib/sales/types";
import { formatDate } from "@/lib/utils";

export type TillLine = { id: string; name: string; qty: string; unit: string; unitValue: string };
export type TillOrder = { id: string; saleNo: string; date: string; dueDate: string | null; overdue: boolean; total: string; owed: string; lines: TillLine[] };
export type TillSummary = { owed: string; openOrders: number; late?: { amount: string; since: string } };
export type TillData = { customer: { name: string; winga: boolean }; summary: TillSummary; orders: TillOrder[] };
export type TillResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export type SaleDone = {
  id: string;
  saleNo: string;
  total: string;
  paid: string;
  owed: string;
  status: "PAID" | "PARTIALLY_PAID" | "UNPAID";
  customerId: string | null;
  customer: string | null;
  winga: boolean;
  dueDate: string | null;
  method: string | null;
  lines: { name: string; qty: string; unit: string; amount: string }[];
  pickup: { id: string; noteNo: string } | null;
  customerSummary: TillSummary | null;
};

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date());

async function summaryOf(customerId: string): Promise<TillSummary> {
  const [owed, late, open] = await Promise.all([
    customerOutstanding(db, customerId),
    customerOverdue(db, customerId, today()),
    db.sale.findMany({ where: { customerId, status: "COMPLETED", paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] } }, select: { total: true, returnedTotal: true, amountPaid: true, refundedTotal: true } }),
  ]);
  return { owed: owed.toString(), openOrders: open.filter((s) => owedOf(s).gt(0)).length, ...(late.amount.gt(0) && late.since ? { late: { amount: late.amount.toString(), since: late.since.toISOString().slice(0, 10) } } : {}) };
}

/** A customer's unpaid orders, oldest first: for "Collect payment" (what is owed) and for "Return goods" (what can still go back). */
export async function loadTillOrders(customerId: string, kind: "collect" | "return"): Promise<TillResult<TillData>> {
  const out: { data?: TillData } = {};
  const result = await guarded(kind === "collect" ? "payments.record" : "returns.create", async () => {
    const customer = await db.customer.findUnique({ where: { id: customerId }, select: { name: true, reseller: { select: { id: true } } } });
    if (!customer) return { error: "This customer was not found." };
    if (kind === "return" && !customer.reseller) return { error: "Taking goods back here is for Winga. For other customers use Return / cancel on the invoice." };
    const sales = await db.sale.findMany({
      where: { customerId, status: "COMPLETED", paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { items: { orderBy: { id: "asc" }, select: { id: true, enteredQty: true, lineTotal: true, product: { select: { name: true } }, enteredUnit: { select: { symbol: true } } } } },
    });
    const day = today();
    const orders: TillOrder[] = [];
    for (const s of sales) {
      const owed = owedOf(s);
      if (!owed.gt(0)) continue;
      let lines: TillLine[] = [];
      if (kind === "return") {
        const done = await returnedBySaleItem(db, s.id, true);
        lines = s.items
          .map((it) => ({ it, left: it.enteredQty.minus(done.qty.get(it.id) ?? 0) }))
          .filter((x) => x.left.gt(0))
          .map((x) => ({ id: x.it.id, name: x.it.product.name, qty: x.left.toString(), unit: x.it.enteredUnit.symbol, unitValue: x.it.lineTotal.div(x.it.enteredQty).toFixed(2) }));
        if (lines.length === 0) continue;
      }
      orders.push({ id: s.id, saleNo: s.saleNo, date: formatDate(s.createdAt), dueDate: s.dueDate ? formatDate(s.dueDate) : null, overdue: Boolean(s.dueDate && s.dueDate.toISOString().slice(0, 10) < day), total: s.total.minus(s.returnedTotal).toString(), owed: owed.toString(), lines });
    }
    out.data = { customer: { name: customer.name, winga: Boolean(customer.reseller) }, summary: await summaryOf(customerId), orders };
    return { ok: true };
  });
  if (!result.ok || !out.data) return { ok: false, error: result.error ?? "Could not load this customer's orders." };
  return { ok: true, ...out.data };
}

const collectSchema = z.object({
  customerId: z.string().min(1),
  amount: z.string().max(24),
  method: z.enum(["CASH", "MOBILE_MONEY", "BANK"], { error: "Choose how the customer paid." }),
  accountId: z.string().max(40).nullable().optional(),
  reference: z.string().trim().max(80).nullable(),
  allocations: z.array(z.object({ saleId: z.string().min(1), amount: z.string().max(24) })).max(100),
  submissionKey: z.string().min(16).max(64),
});

/** Money from a customer, spread over their orders (the till works out oldest first). Same rules and ledger rows as the Record payment page. */
export async function collectAtTill(input: z.input<typeof collectSchema>): Promise<TillResult<{ paymentId: string; paymentNo: string; summary: TillSummary }>> {
  const out: { id?: string; no?: string } = {};
  const result = await guarded("payments.record", async (user) => {
    const p = collectSchema.safeParse(input);
    if (!p.success) return { error: p.error.issues[0]?.message ?? "The payment could not be read." };
    const d = p.data;
    const currency = await getCurrency();
    try {
      const pay = await db.$transaction(
        async (tx) => {
          const r = await postCollection(tx, { user, customerId: d.customerId, method: d.method, accountId: d.accountId ?? null, amount: d.amount, reference: d.reference, notes: null, allocations: d.allocations, keepExtraAsCredit: false, submissionKey: d.submissionKey, currencyDecimals: currency.decimals });
          await writeAudit(tx, { user, action: "payment.collect", entityType: "Payment", entityId: r.payment.id, reference: r.payment.paymentNo, after: { customerId: d.customerId, method: d.method, amount: r.payment.amount, allocated: r.allocated, invoices: r.invoices.map((i) => `${i.saleNo}: ${i.amount}`), source: "till pop-up" } });
          return r.payment;
        },
        { timeout: 30000, maxWait: 15000 },
      );
      out.id = pay.id;
      out.no = pay.paymentNo;
    } catch (e) {
      if (e instanceof CollectionError) return { error: Object.values(e.fieldErrors ?? {})[0] ?? e.message };
      const existing = await db.payment.findUnique({ where: { submissionKey: d.submissionKey }, select: { id: true, paymentNo: true } });
      if (!existing) throw e;
      out.id = existing.id; // double tap: already recorded
      out.no = existing.paymentNo;
    }
    revalidatePath("/customers", "layout");
    revalidatePath("/credit");
    revalidatePath("/sales");
    revalidatePath("/resellers");
    return { ok: true };
  });
  if (!result.ok || !out.id) return { ok: false, error: result.error ?? "Could not record the payment." };
  return { ok: true, paymentId: out.id, paymentNo: out.no ?? "", summary: await summaryOf(input.customerId) };
}

const returnSchema = z.object({
  customerId: z.string().min(1),
  items: z.array(z.object({ saleItemId: z.string().min(1), quantity: z.string().max(24) })).min(1, "Choose at least one item to take back.").max(200),
  submissionKey: z.string().min(16).max(64),
});

/**
 * Goods a Winga did not sell go back to the store, and what he owes goes down by their value. It completes at once (no approval)
 * because no money moves: if part of an order was already paid, a refund would be needed, so it is refused and goes through
 * Return / cancel on the invoice instead. Audited, and the owners are told.
 */
export async function returnWingaItems(input: z.input<typeof returnSchema>): Promise<TillResult<{ summary: TillSummary; saleNos: string[] }>> {
  const out: { saleNos?: string[] } = {};
  const result = await guarded("returns.create", async (user) => {
    const p = returnSchema.safeParse(input);
    if (!p.success) return { error: p.error.issues[0]?.message ?? "The return could not be read." };
    const d = p.data;
    const customer = await db.customer.findUnique({ where: { id: d.customerId }, select: { name: true, reseller: { select: { id: true } } } });
    if (!customer?.reseller) return { error: "Taking goods back here is for Winga." };
    const items = await db.saleItem.findMany({ where: { id: { in: d.items.map((i) => i.saleItemId) } }, select: { id: true, saleId: true, sale: { select: { saleNo: true, customerId: true, status: true } } } });
    if (items.length !== new Set(d.items.map((i) => i.saleItemId)).size || items.some((i) => i.sale.customerId !== d.customerId || i.sale.status !== "COMPLETED")) return { error: "Some of these goods are not on this Winga's open orders." };
    const bySale = new Map<string, { saleNo: string; lines: { saleItemId: string; quantity: string; condition: "RESELLABLE" }[] }>();
    for (const it of d.items) {
      const row = items.find((x) => x.id === it.saleItemId)!;
      if (!(Number(it.quantity) > 0)) continue;
      const g = bySale.get(row.saleId) ?? { saleNo: row.sale.saleNo, lines: [] };
      g.lines.push({ saleItemId: it.saleItemId, quantity: it.quantity, condition: "RESELLABLE" });
      bySale.set(row.saleId, g);
    }
    if (bySale.size === 0) return { error: "Enter how many to take back." };
    const currency = await getCurrency();
    const names: string[] = [];
    try {
      await db.$transaction(
        async (tx) => {
          for (const [saleId, g] of bySale) {
            const req = await createReversalRequest(tx, { user, saleId, kind: "RETURN", reason: "Winga returned the goods he did not sell", refundMethod: null, refundReference: null, lines: g.lines, submissionKey: `${d.submissionKey}:${saleId}` });
            const r = await completeReversal(tx, { reversalId: req.id, approver: user, dp: currency.decimals });
            await writeAudit(tx, { user, action: "winga.goods_returned", entityType: "SaleReversal", entityId: req.id, reference: `${req.reversalNo} · ${g.saleNo}`, reason: "Winga returned the goods he did not sell", after: { winga: customer.name, returnValue: r.returnValue, refund: r.refund, source: "till pop-up" } });
            await notifyPermission(tx, "returns.approve", { type: "reversal.winga", title: `${customer.name} returned goods (${g.saleNo})`, body: `${user.name} took the goods back to the store. Value ${r.returnValue.toString()}.`, link: `/sales/${saleId}` }, user.id);
            names.push(g.saleNo);
          }
        },
        { timeout: 30000, maxWait: 15000 },
      );
    } catch (e) {
      if (e instanceof ReversalError) {
        if (e.fieldErrors.refundMethod) return { error: "This Winga already paid part of an order you chose, so some money would have to go back. Use Return / cancel on that invoice for it." };
        const firstError = Object.values(e.fieldErrors)[0];
        return { error: firstError ?? e.message };
      }
      const [firstId] = bySale.keys();
      const existing = await db.saleReversal.findUnique({ where: { submissionKey: `${d.submissionKey}:${firstId}` }, select: { status: true } });
      if (!existing) throw e;
      names.push(...[...bySale.values()].map((g) => g.saleNo)); // double tap: already done
    }
    out.saleNos = names;
    revalidatePath("/sales");
    revalidatePath("/credit");
    revalidatePath("/customers", "layout");
    revalidatePath("/resellers");
    revalidatePath("/inventory", "layout");
    revalidatePath("/warehouse", "layout");
    return { ok: true };
  });
  if (!result.ok || !out.saleNos) return { ok: false, error: result.error ?? "Could not take the goods back." };
  return { ok: true, saleNos: out.saleNos, summary: await summaryOf(input.customerId) };
}

/** What the "Sale complete" pop-up shows for a sale just made at the till. */
export async function loadSaleDone(saleId: string): Promise<TillResult<{ sale: SaleDone }>> {
  const out: { sale?: SaleDone } = {};
  const result = await guarded("sales.pos", async (user) => {
    const s = await db.sale.findUnique({
      where: { id: saleId },
      include: {
        customer: { select: { id: true, name: true, reseller: { select: { id: true } } } },
        pickupNote: { select: { id: true, noteNo: true } },
        items: { orderBy: { id: "asc" }, select: { enteredQty: true, lineTotal: true, product: { select: { name: true } }, enteredUnit: { select: { symbol: true } } } },
        allocations: { select: { payment: { select: { method: true } } }, take: 1 },
      },
    });
    if (!s || (!can(user, "sales.view_all") && s.salespersonId !== user.id)) return { error: "This sale was not found." };
    out.sale = {
      id: s.id,
      saleNo: s.saleNo,
      total: s.total.toString(),
      paid: s.amountPaid.minus(s.refundedTotal).toString(),
      owed: owedOf(s).toString(),
      status: s.paymentStatus as SaleDone["status"],
      customerId: s.customerId,
      customer: s.customer?.name ?? null,
      winga: Boolean(s.customer?.reseller),
      dueDate: s.dueDate ? formatDate(s.dueDate) : null,
      method: s.allocations[0] ? methodLabel(s.allocations[0].payment.method) : null,
      lines: s.items.map((i) => ({ name: i.product.name, qty: i.enteredQty.toString(), unit: i.enteredUnit.symbol, amount: i.lineTotal.toString() })),
      pickup: s.pickupNote,
      customerSummary: s.customerId ? await summaryOf(s.customerId) : null,
    };
    return { ok: true };
  });
  if (!result.ok || !out.sale) return { ok: false, error: result.error ?? "Could not load the sale." };
  return { ok: true, sale: out.sale };
}
