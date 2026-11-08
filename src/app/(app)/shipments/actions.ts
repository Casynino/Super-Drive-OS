"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/auth/can";
import { fail, formString, guarded, guardedAny, isUniqueViolation, type ActionState } from "@/lib/action";
import { notifyPermission } from "@/lib/notifications";
import { generateSku, nextBarcode, uniqueSku } from "@/lib/product-codes";
import { ImageError, processProductImage } from "@/lib/product-images";
import { InsufficientStockError } from "@/lib/inventory/engine";
import { decideIssue } from "@/lib/shipments/issues";
import { decideProblem, reportProblem } from "@/lib/shipments/problems";
import { ShipmentError, cancelShipment, confirmSession, createShipment, markArrived, resolveIssue, saveDraft } from "@/lib/shipments/engine";
import { getCurrency } from "@/lib/settings";
import { parseMoney } from "@/lib/money";
import type { PickerProduct } from "@/lib/inventory/types";

function parse<T extends z.ZodType>(schema: T, fd: FormData): z.infer<T> | null {
  try {
    const r = schema.safeParse(JSON.parse(formString(fd, "payloadJson") || "{}"));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
const BAD = "The form could not be read. Reload the page and try again.";

// ───────────── Owner: announce a shipment ─────────────

const createSchema = z.object({
  supplierId: z.string().min(1).nullable(),
  /** a supplier typed on the form that is not in the list yet; created together with the order */
  newSupplierName: z.string().trim().max(120).nullable().optional(),
  reference: z.string().trim().max(80).nullable(),
  cargoName: z.string().trim().max(80).nullable().optional(),
  expectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  locationId: z.string().min(1, "Choose where it will be delivered."),
  notes: z.string().trim().max(500).nullable(),
  lines: z.array(z.object({ productId: z.string().min(1), unitId: z.string().min(1), quantity: z.string().max(24), totalCost: z.string().max(24), sellingPrice: z.string().max(24).optional(), wholesalePrice: z.string().max(24).optional() })).min(1, "Add at least one product.").max(100),
  submissionKey: z.string().min(16).max(64),
});

export async function announceShipment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guarded("shipments.manage", async (user) => {
    const parsed = parse(createSchema, fd);
    if (!parsed) return fail(BAD);
    const { newSupplierName, ...p } = parsed;
    const currency = await getCurrency();
    // Adding a supplier needs the same right as the Suppliers screen.
    let newSupplier: string | null = null;
    if (newSupplierName) {
      if (newSupplierName.length < 2) return fail("Please fix the highlighted fields.", { supplierName: "Enter the supplier name." });
      if (!can(user, "suppliers.manage")) return fail("Please fix the highlighted fields.", { supplierName: "You cannot add new suppliers. Choose one from the list." });
      // a name that is already there is used, never duplicated
      const same = await db.supplier.findFirst({ where: { name: { equals: newSupplierName, mode: "insensitive" } } });
      if (same && same.status !== "ACTIVE") return fail("Please fix the highlighted fields.", { supplierName: "This supplier is switched off. Turn it on under Supplier Accounts first." });
      if (same) p.supplierId = same.id;
      else newSupplier = newSupplierName;
    }
    // New selling prices need the same permission as changing a price anywhere else.
    if (!can(user, "products.price") && p.lines.some((l) => l.sellingPrice?.trim() || l.wholesalePrice?.trim())) return fail("You are not allowed to set selling prices. Remove them and announce the shipment again.");
    const location = await db.location.findFirst({ where: { id: p.locationId, status: "ACTIVE" } });
    if (!location) return fail("Please fix the highlighted fields.", { locationId: "Choose an active location." });
    if (p.supplierId && !(await db.supplier.findFirst({ where: { id: p.supplierId, status: "ACTIVE" } }))) return fail("Please fix the highlighted fields.", { supplierId: "Choose an active supplier." });

    try {
      const s = await db.$transaction(
        async (tx) => {
          let supplierId = p.supplierId;
          if (newSupplier) {
            const sup = await tx.supplier.create({ data: { name: newSupplier } });
            await writeAudit(tx, { user, action: "supplier.create", entityType: "Supplier", entityId: sup.id, reference: sup.name, after: { name: sup.name, from: "purchase order form" } });
            supplierId = sup.id;
          }
          const created = await createShipment(tx, { user, ...p, supplierId, currencyDecimals: currency.decimals });
          const total = created.items.reduce((sum, i) => sum.plus(i.lineCost ?? 0), new Prisma.Decimal(0));
          await writeAudit(tx, { user, action: "shipment.create", entityType: "Shipment", entityId: created.id, reference: created.shipmentNo, after: { items: created.items.length, totalCost: total, cargo: p.cargoName, reference: p.reference, expectedDate: p.expectedDate } });
          await notifyPermission(tx, "shipments.receive", { type: "shipment.announced", title: `New purchase order on its way: ${created.shipmentNo}`, body: `${created.items.length} product${created.items.length === 1 ? "" : "s"} expected${p.expectedDate ? ` around ${p.expectedDate}` : ""}${p.cargoName ? ` · ${p.cargoName}` : p.reference ? ` · ${p.reference}` : ""}`, link: `/shipments/${created.id}` });
          return created;
        },
        { timeout: 30000, maxWait: 15000 },
      );
      revalidatePath("/shipments");
      if (newSupplier) revalidatePath("/suppliers");
      return { ok: true, message: s.id };
    } catch (e) {
      if (e instanceof ShipmentError) return fail(e.message, e.fieldErrors);
      const existing = await db.shipment.findUnique({ where: { submissionKey: p.submissionKey }, select: { id: true } });
      if (existing) return { ok: true, message: existing.id };
      if (newSupplier && isUniqueViolation(e)) return fail("Please fix the highlighted fields.", { supplierName: "A supplier with this name already exists. Pick it from the list." });
      throw e;
    }
  });
  if (result.ok && result.message) redirect(`/shipments/${result.message}?created=1`);
  return result;
}

export async function cancelShipmentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded("shipments.manage", async (user) => {
    const shipmentId = formString(fd, "shipmentId");
    const reason = formString(fd, "reason");
    try {
      await db.$transaction(async (tx) => {
        const s = await cancelShipment(tx, { shipmentId, user, reason });
        await writeAudit(tx, { user, action: "shipment.cancel", entityType: "Shipment", entityId: s.id, reference: s.shipmentNo, reason });
        await notifyPermission(tx, "shipments.receive", { type: "shipment.cancelled", title: `Shipment ${s.shipmentNo} was cancelled`, body: reason, link: `/shipments/${s.id}` });
      });
    } catch (e) {
      if (e instanceof ShipmentError) return fail(e.message, e.fieldErrors);
      throw e;
    }
    revalidatePath("/shipments");
    revalidatePath(`/shipments/${shipmentId}`);
    return { ok: true, message: "Shipment cancelled." };
  });
}

export async function resolveIssueAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded("shipments.manage", async (user) => {
    const shipmentId = formString(fd, "shipmentId");
    const note = formString(fd, "note");
    try {
      await db.$transaction(async (tx) => {
        const s = await resolveIssue(tx, { shipmentId, user, note });
        await writeAudit(tx, { user, action: "shipment.issue_resolved", entityType: "Shipment", entityId: s.id, reference: s.shipmentNo, reason: note });
      });
    } catch (e) {
      if (e instanceof ShipmentError) return fail(e.message, e.fieldErrors);
      throw e;
    }
    revalidatePath("/shipments");
    revalidatePath(`/shipments/${shipmentId}`);
    return { ok: true, message: "Investigation closed." };
  });
}

// ───────────── Owner: decide about one problem product ─────────────

const decideSchema = z.object({
  shipmentId: z.string().min(1),
  shipmentItemId: z.string().min(1),
  kind: z.enum(["MISSING", "DAMAGED", "EXTRA"]),
  action: z.enum(["FOUND", "NOT_DELIVERED", "WRITE_OFF", "KEEP", "DISCOUNT_SELL", "DISMISS"]),
  quantity: z.string().max(24),
  note: z.string().trim().max(500),
  newOrder: z.boolean(),
  discountPrice: z.string().max(24),
  submissionKey: z.string().min(16).max(80),
});

const ACTION_TEXT: Record<"FOUND" | "NOT_DELIVERED" | "WRITE_OFF" | "KEEP" | "DISCOUNT_SELL" | "DISMISS", string> = {
  FOUND: "Found and returned to stock",
  NOT_DELIVERED: "Confirmed not delivered",
  WRITE_OFF: "Written off",
  KEEP: "Kept in stock",
  DISCOUNT_SELL: "Put on sale at a discount",
  DISMISS: "Removed from the list",
};

export async function decideIssueAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  // The owner AND the warehouse person decide investigations (Nino 2026-11-08: "he has all the power as well as the admin, they are the ones dealing with the products").
  // Checked here, never only in the screen. The warehouse person still never sees costs: the money side of a decision is worked out on the server.
  return guardedAny(["shipments.manage", "shipments.receive"], async (user) => {
    const parsed = decideSchema.safeParse({
      shipmentId: formString(fd, "shipmentId"),
      shipmentItemId: formString(fd, "shipmentItemId"),
      kind: formString(fd, "kind"),
      action: formString(fd, "action"),
      quantity: formString(fd, "quantity"),
      note: formString(fd, "note"),
      newOrder: formString(fd, "newOrder") === "on",
      discountPrice: formString(fd, "discountPrice"),
      submissionKey: formString(fd, "submissionKey"),
    });
    if (!parsed.success) return fail(BAD);
    const p = parsed.data;
    const currency = await getCurrency();
    // Setting a new selling price is a pricing right, not just an investigation right (the server checks it, whatever the screen shows).
    if (p.action === "DISCOUNT_SELL" && !can(user, "products.price") && !can(user, "shipments.receive")) return fail("You are not allowed to set selling prices.");
    // Quantities are typed in cartons first; the engine counts in base units, so a carton quantity is converted here from the product's own pack size.
    if (formString(fd, "qtyUnit") === "pack") {
      const it = await db.shipmentItem.findUnique({ where: { id: p.shipmentItemId }, select: { productId: true } });
      const packs = it ? await db.productUnit.findMany({ where: { productId: it.productId }, select: { factor: true } }) : [];
      const factor = packs.map((u) => Number(u.factor)).sort((a, b) => b - a)[0];
      const typed = Number(p.quantity.trim());
      if (!factor || factor <= 1 || !Number.isFinite(typed)) return fail("Enter how many.", { quantity: "Enter a number." });
      p.quantity = String(Number((typed * factor).toFixed(3)));
    }
    try {
      const r = await db.$transaction(
        async (tx) => {
          const res = await decideIssue(tx, { ...p, note: p.note || null, user, currencyDecimals: currency.decimals });
          if (!res.repeated) {
            const sh = await tx.shipment.findUniqueOrThrow({ where: { id: p.shipmentId }, select: { shipmentNo: true } });
            await writeAudit(tx, { user, action: "shipment.issue_decision", entityType: "Shipment", entityId: p.shipmentId, reference: sh.shipmentNo, reason: p.note || undefined, after: { kind: p.kind, action: p.action, quantity: p.quantity, productId: res.decision.productId, receipt: res.receiptNo, newOrder: res.newOrderNo, closed: res.closed } });
            // the owners always know what the warehouse decided
            if (!can(user, "shipments.manage")) await notifyPermission(tx, "shipments.manage", { type: "shipment.issue_decided", title: `${user.name} decided a problem on ${sh.shipmentNo}`, body: `${ACTION_TEXT[p.action]}${p.note ? `: ${p.note}` : ""}`, link: `/shipments/${p.shipmentId}` }, user.id);
          }
          return res;
        },
        { timeout: 30000, maxWait: 15000 },
      );
      revalidatePath("/shipments");
      revalidatePath(`/shipments/${p.shipmentId}`);
      revalidatePath("/inventory");
      revalidatePath("/products");
      const message = p.action === "FOUND" ? `Back in stock${r.receiptNo ? ` (receipt ${r.receiptNo})` : ""}.` : p.action === "NOT_DELIVERED" ? `Shortage recorded${r.newOrderNo ? ` and added to the new order ${r.newOrderNo}` : ""}.` : p.action === "WRITE_OFF" ? "Written off." : p.action === "DISMISS" ? "Removed from the list. It stays in the history." : p.action === "DISCOUNT_SELL" ? "On sale at the discounted price, as a separate \"damaged packaging\" product." : "Kept in stock.";
      return { ok: true, message: r.closed ? `${message} Nothing is left to decide, so the investigation is closed.` : message };
    } catch (e) {
      if (e instanceof ShipmentError) return fail(e.message, e.fieldErrors);
      throw e;
    }
  });
}

// ───────────── Shop: the delivery is here ─────────────

export async function markArrivedAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded("shipments.receive", async (user) => {
    const shipmentId = formString(fd, "shipmentId");
    try {
      await db.$transaction(async (tx) => {
        const { shipment, already } = await markArrived(tx, { shipmentId, user });
        if (already) return;
        await writeAudit(tx, { user, action: "shipment.arrived", entityType: "Shipment", entityId: shipment.id, reference: shipment.shipmentNo });
        await notifyPermission(tx, "shipments.manage", { type: "shipment.arrived", title: `${shipment.shipmentNo} has arrived at the shop`, body: `${user.name} marked it as arrived. It is being checked now.`, link: `/shipments/${shipment.id}` });
      });
    } catch (e) {
      if (e instanceof ShipmentError) return fail(e.message, e.fieldErrors);
      throw e;
    }
    revalidatePath("/shipments");
    revalidatePath(`/shipments/${shipmentId}`);
    return { ok: true, message: "Marked as arrived. You can check it now." };
  });
}

// ───────────── Shop: save / confirm the count ─────────────

const countSchema = z.object({
  shipmentId: z.string().min(1),
  intent: z.enum(["save", "confirm"]),
  finish: z.boolean(),
  notes: z.string().trim().max(500).nullable(),
  lines: z
    .array(z.object({ shipmentItemId: z.string().nullable(), productId: z.string().min(1), unitId: z.string().min(1), good: z.string().max(24), damaged: z.string().max(24), note: z.string().max(200).nullable() }))
    .max(200),
});

export async function saveCount(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guarded("shipments.receive", async (user) => {
    const p = parse(countSchema, fd);
    if (!p) return fail(BAD);
    const submitter = formString(fd, "intent");
    if (submitter === "save" || submitter === "confirm") p.intent = submitter; // the button that was pressed wins
    try {
      const out = await db.$transaction(
        async (tx) => {
          const saved = await saveDraft(tx, { shipmentId: p.shipmentId, user, notes: p.notes, finish: p.finish, lines: p.lines });
          if (p.intent === "save") return { confirmed: null };
          const c = await confirmSession(tx, { shipmentId: p.shipmentId, sessionId: saved.sessionId, user });
          const base = { user, entityType: "Shipment", entityId: p.shipmentId, reference: `${c.shipmentNo} · count ${c.sessionNo}` };
          await writeAudit(tx, { ...base, action: "shipment.received", after: { receipt: c.receiptNo, finished: c.finished, damaged: c.damaged, missing: c.missing.length, extra: c.extra } });
          const bits = [c.damaged.gt(0) ? `${c.damaged.toString()} damaged` : null, c.missing.length ? `${c.missing.length} product${c.missing.length === 1 ? "" : "s"} missing` : null, c.extra ? "more than announced" : null].filter(Boolean);
          await notifyPermission(
            tx,
            "shipments.manage",
            c.problem
              ? { type: "shipment.issue", title: `${c.shipmentNo} needs your investigation`, body: `${user.name} counted it: ${bits.join(", ")}`, link: `/shipments/${p.shipmentId}` }
              : { type: "shipment.received", title: `${c.shipmentNo} ${c.finished ? "was received in full" : "was partly received"}`, body: `Counted by ${user.name}`, link: `/shipments/${p.shipmentId}` },
          );
          return { confirmed: c };
        },
        { timeout: 30000, maxWait: 15000 },
      );
      revalidatePath("/shipments");
      revalidatePath(`/shipments/${p.shipmentId}`);
      revalidatePath("/inventory", "layout");
      return out.confirmed ? { ok: true, message: "confirmed" } : { ok: true, message: "Draft saved. Nothing has been added to stock yet." };
    } catch (e) {
      if (e instanceof ShipmentError) {
        if (e.code === "ALREADY_CONFIRMED") return { ok: true, message: "confirmed" }; // double click
        return fail(e.message, e.fieldErrors);
      }
      throw e;
    }
  });
  if (result.ok && result.message === "confirmed") redirect(`/shipments/${parse(countSchema, fd)?.shipmentId ?? ""}?counted=1`);
  return result;
}

// ───────────── Owner: add a brand-new product while announcing a shipment ─────────────

export async function createProductForShipment(fd: FormData): Promise<{ ok: true; product: PickerProduct } | { ok: false; error: string }> {
  const out: { product?: PickerProduct } = {};
  const result = await guarded("products.create", async (user) => {
    const name = formString(fd, "name");
    const categoryId = formString(fd, "categoryId");
    const brandId = formString(fd, "brandId") || null;
    const packaging = formString(fd, "packaging") || null;
    const perCarton = Number.parseInt(formString(fd, "perCarton") || "0", 10);
    if (name.length < 2 || name.length > 150) return fail("Enter the product name.");
    const category = await db.category.findFirst({ where: { id: categoryId, status: "ACTIVE" } });
    if (!category) return fail("Choose a category.");
    const brand = brandId ? await db.brand.findFirst({ where: { id: brandId, status: "ACTIVE" } }) : null;
    if (brandId && !brand) return fail("Choose a valid brand.");
    if (perCarton && (perCarton < 2 || perCarton > 1000)) return fail("Pieces per carton must be between 2 and 1000.");
    if (await db.product.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } })) return fail("A product with this name already exists. Pick it from the list instead.");

    const piece = await db.unit.findFirst({ where: { symbol: "PCS" } });
    const ctn = await db.unit.findFirst({ where: { symbol: "CTN" } });
    if (!piece || (perCarton && !ctn)) return fail("The Piece / Carton units are missing. Add them in Settings first.");

    // Selling price is optional and only for people allowed to set prices.
    let price = new Prisma.Decimal(0);
    const rawPrice = formString(fd, "sellingPrice");
    if (rawPrice && can(user, "products.price")) {
      const currency = await getCurrency();
      const parsed = parseMoney(rawPrice, currency.decimals);
      if (!parsed) return fail("Enter the selling price as a valid amount.");
      price = parsed;
    }

    // Picture (optional)
    const file = fd.get("image");
    let image: Awaited<ReturnType<typeof processProductImage>> | null = null;
    if (file instanceof File && file.size > 0) {
      try {
        image = await processProductImage(Buffer.from(await file.arrayBuffer()));
      } catch (e) {
        if (e instanceof ImageError) return fail(e.message);
        throw e;
      }
    }

    let sku = "";
    const created = await db.$transaction(async (tx) => {
      // The system makes both codes: a readable one from the name and a unique barcode.
      sku = await uniqueSku(tx, generateSku(name, brand?.name));
      const p = await tx.product.create({
        data: {
          sku,
          barcode: await nextBarcode(tx),
          name,
          categoryId: category.id,
          brandId: brand?.id ?? null,
          packagingType: packaging,
          baseUnitId: piece.id,
          purchasePrice: 0,
          sellingPrice: price,
          createdById: user.id,
          ...(perCarton ? { units: { create: [{ unitId: ctn!.id, factor: perCarton }] }, defaultSalesUnitId: ctn!.id, defaultPurchaseUnitId: ctn!.id } : {}),
        },
      });
      if (price.gt(0)) await tx.productPriceHistory.create({ data: { productId: p.id, field: "sellingPrice", oldValue: null, newValue: price, changedById: user.id } });
      if (image) await tx.productImage.create({ data: { productId: p.id, mime: image.mime, full: new Uint8Array(image.full), thumb: new Uint8Array(image.thumb), width: image.width, height: image.height, updatedById: user.id } });
      await writeAudit(tx, { user, action: "product.create", entityType: "Product", entityId: p.id, reference: sku, after: { name, category: category.name, brand: brand?.name ?? null, perCarton: perCarton || null, via: "shipment form" } });
      return p;
    });

    out.product = {
      id: created.id,
      name: created.name,
      sku: created.sku,
      barcode: created.barcode,
      sellingPrice: price.toString(),
      wholesalePrice: null,
      imageV: image ? Date.now() : null,
      baseUnitId: piece.id,
      units: [
        { id: piece.id, name: piece.name, symbol: piece.symbol, factor: "1", allowsDecimal: piece.allowsDecimal },
        ...(perCarton ? [{ id: ctn!.id, name: ctn!.name, symbol: ctn!.symbol, factor: String(perCarton), allowsDecimal: ctn!.allowsDecimal }] : []),
      ],
    };
    revalidatePath("/products");
    return { ok: true };
  });
  if (result.error || !out.product) return { ok: false, error: result.error ?? "Could not create the product." };
  return { ok: true, product: out.product };
}


// ───────────── Warehouse / owner: report a problem on a product that is already in stock ─────────────

const reportSchema = z.object({
  productId: z.string().min(1),
  kind: z.enum(["DAMAGED", "MISSING"]),
  quantity: z.string().min(1).max(24),
  /** "pack" = typed in cartons (converted with the product's own carton size), otherwise pieces */
  qtyUnit: z.enum(["pack", "base"]),
  note: z.string().trim().min(3).max(300),
  submissionKey: z.string().min(16).max(80),
});

export async function reportProblemAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return guardedAny(["inventory.report_damage", "shipments.manage"], async (user) => {
    const parsed = reportSchema.safeParse({ productId: formString(fd, "productId"), kind: formString(fd, "kind"), quantity: formString(fd, "quantity"), qtyUnit: formString(fd, "qtyUnit") || "base", note: formString(fd, "note"), submissionKey: formString(fd, "submissionKey") });
    if (!parsed.success) return fail("Choose the product, say what happened and how many.", { note: "Say what happened, in a few words." });
    const p = parsed.data;
    let quantity = p.quantity;
    if (p.qtyUnit === "pack") {
      const packs = await db.productUnit.findMany({ where: { productId: p.productId }, select: { factor: true } });
      const factor = packs.map((u) => Number(u.factor)).sort((a, b) => b - a)[0];
      const typed = Number(p.quantity.trim());
      if (!factor || factor <= 1 || !Number.isFinite(typed)) return fail("Enter how many.", { quantity: "Enter a number." });
      quantity = String(Number((typed * factor).toFixed(3)));
    }
    const location = await db.location.findFirst({ where: { isDefault: true }, select: { id: true } });
    if (!location) return fail("No warehouse is set up.");
    try {
      const r = await db.$transaction(
        async (tx) => {
          const res = await reportProblem(tx, { productId: p.productId, locationId: location.id, kind: p.kind, quantity, note: p.note, submissionKey: p.submissionKey, user });
          if (!res.repeated) {
            const prod = await tx.product.findUniqueOrThrow({ where: { id: p.productId }, select: { name: true } });
            await writeAudit(tx, { user, action: "stock_problem.reported", entityType: "StockProblem", entityId: res.problem.id, reference: res.adjustmentNo, reason: p.note, after: { product: prod.name, kind: p.kind, quantity } });
            await notifyPermission(tx, "shipments.manage", { type: "stock_problem.reported", title: `${prod.name}: ${p.kind === "DAMAGED" ? "damaged" : "lost"} at the warehouse`, body: `${user.name} reported ${quantity} pieces. ${p.note}`, link: "/shipments?tab=investigation" }, user.id);
          }
          return res;
        },
        { timeout: 30000, maxWait: 15000 },
      );
      revalidatePath("/shipments");
      revalidatePath("/inventory");
      revalidatePath("/warehouse", "layout");
      revalidatePath("/products");
      return { ok: true, message: r.repeated ? "Already reported." : "Reported. The pieces are off the shelf now and under investigation." };
    } catch (e) {
      if (e instanceof ShipmentError) return fail(e.message, e.fieldErrors);
      if (e instanceof InsufficientStockError) return fail(`Only ${Number(e.available)} pieces are free to report. The rest are reserved for customers waiting to collect.`, { quantity: `At most ${Number(e.available)} pieces.` });
      throw e;
    }
  });
}

const decideProblemSchema = z.object({
  problemId: z.string().min(1),
  action: z.enum(["FOUND", "WRITE_OFF", "DISCOUNT_SELL"]),
  note: z.string().trim().max(300),
  discountPrice: z.string().max(24),
});

export async function decideProblemAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return guardedAny(["shipments.manage", "shipments.receive"], async (user) => {
    const parsed = decideProblemSchema.safeParse({ problemId: formString(fd, "problemId"), action: formString(fd, "action"), note: formString(fd, "note"), discountPrice: formString(fd, "discountPrice") });
    if (!parsed.success) return fail(BAD);
    const p = parsed.data;
    if (p.action === "DISCOUNT_SELL" && !can(user, "products.price") && !can(user, "shipments.receive")) return fail("You are not allowed to set selling prices.");
    // typed per carton, like the investigation of an order; the engine counts in pieces
    const currency = await getCurrency();
    try {
      const r = await db.$transaction(
        async (tx) => {
          const res = await decideProblem(tx, { problemId: p.problemId, action: p.action, note: p.note || null, discountPrice: p.discountPrice, user, currencyDecimals: currency.decimals });
          await writeAudit(tx, { user, action: "stock_problem.decided", entityType: "StockProblem", entityId: p.problemId, reason: p.note || undefined, after: { action: p.action, product: res.productName, quantity: String(res.quantity) } });
          if (!can(user, "shipments.manage")) await notifyPermission(tx, "shipments.manage", { type: "stock_problem.decided", title: `${user.name} decided a problem on ${res.productName}`, body: `${ACTION_TEXT[p.action]}${p.note ? `: ${p.note}` : ""}`, link: "/shipments?tab=investigation" }, user.id);
          return res;
        },
        { timeout: 30000, maxWait: 15000 },
      );
      void r;
      revalidatePath("/shipments");
      revalidatePath("/inventory");
      revalidatePath("/warehouse", "layout");
      revalidatePath("/products");
      return { ok: true, message: p.action === "FOUND" ? "Back in stock." : p.action === "WRITE_OFF" ? "Written off." : "On sale at the discounted price, as a separate \"damaged packaging\" product." };
    } catch (e) {
      if (e instanceof ShipmentError) return fail(e.message, e.fieldErrors);
      throw e;
    }
  });
}
