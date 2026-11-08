// SAMPLE DATA, so the owner can see every screen with data in it. Local development database only.
//
// It plays the last ~70 days of a small oil shop THROUGH THE REAL ENGINES (purchase orders, receiving, item numbers,
// sales by scan and by quantity, credit, collections, returns, expenses, deposits, daily closings, supplier payments,
// resellers), so every number agrees with every other. After each simulated half-day it moves that batch of records back
// in time (the only thing it does outside the engines, with the database's "history is read-only" guards switched off for
// that one step) so the charts, debts by age, month-against-month and closings look like a real shop.
//
// It refuses to run anywhere but the local `superdrive_dev` database (or the one named in DEMO_ALLOW_DB for testing),
// and refuses if the database already holds sales, receipts or purchase orders.
// Use: npm run db:demo   (makes a backup first)      Undo: npm run db:demo-undo   (puts the backup back)
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient, type PaymentMethod } from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/auth/password";
import { postManualCash } from "../src/lib/cash/deposits";
import { recordExpense } from "../src/lib/cash/expenses";
import { submitClosing, getClosingPreview } from "../src/lib/cash/closing";
import { paySupplier } from "../src/lib/cash/supplier";
import { createReseller, issueStock, reportSold, returnStock } from "../src/lib/resellers/engine";
import { postCollection } from "../src/lib/sales/collections";
import { CreditLimitError, SaleError, postSale, type SaleInput } from "../src/lib/sales/post-sale";
import { completeReversal, createReversalRequest } from "../src/lib/sales/reversals";
import { cancelShipment, confirmSession, createShipment, markArrived, resolveIssue, saveDraft, type CountLine } from "../src/lib/shipments/engine";

const D = Prisma.Decimal;
const url = process.env.DATABASE_URL ?? "";
const match = /^postgres(?:ql)?:\/\/(?:[^@/]*@)?(localhost|127\.0\.0\.1)(?::\d+)?\/([^?]+)/.exec(url);
const allowed = new Set(["superdrive_dev", ...(process.env.DEMO_ALLOW_DB ? [process.env.DEMO_ALLOW_DB] : [])]);
if (!match || !allowed.has(match[2]!)) {
  console.error("Refusing to run: sample data can only go into the local superdrive_dev database.");
  process.exit(1);
}
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 4 }) });

// ───────────── helpers ─────────────
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261106);
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)]!;
const chance = (p: number) => rnd() < p;
/** its own random stream, so adding things here does not change the sales that were tuned */
const xr = mulberry32(777);
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const round500 = (n: number) => Math.round(n / 500) * 500;
const TZ = "Africa/Dar_es_Salaam";
const dayStr = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(ms));
const isoDay = (offset: number) => dayStr(Date.now() + offset * 86400000);
const START = -70;
/** cash the shop keeps in the till overnight; everything else counted at closing goes to the bank */
const FLOAT = 100000;
const key = () => randomUUID();
const log = (m: string) => console.log(`  ${m}`);

/** Date columns written while "today" is real get moved by the batch shift, so to land on simulated day `e` while acting on day `d`, pass this. */
const forDay = (e: number, d: number) => isoDay(e - d);

// ───────────── moving a batch back in time ─────────────
type Col = { table: string; col: string; kind: "ts" | "date" };
let byTable = new Map<string, Col[]>();
async function loadColumns() {
  const rows = await db.$queryRaw<{ table_name: string; column_name: string; data_type: string }[]>`
    SELECT c.table_name, c.column_name, c.data_type FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.data_type IN ('timestamp without time zone', 'timestamp with time zone', 'date')
       AND c.table_name NOT IN ('_prisma_migrations', 'Session')`;
  byTable = new Map();
  for (const r of rows) {
    const list = byTable.get(r.table_name) ?? [];
    list.push({ table: r.table_name, col: r.column_name, kind: r.data_type === "date" ? "date" : "ts" });
    byTable.set(r.table_name, list);
  }
}

/** Everything written since t0 (new rows and rows that were just updated) moves to simulated day d at the given hour. */
async function shift(t0: Date, d: number, hour: number) {
  if (d > 0) return;
  const [Y, M, Dd] = isoDay(d).split("-").map(Number) as [number, number, number];
  const target = Date.UTC(Y, M - 1, Dd, hour - 3, int(0, 50)); // Dar es Salaam is UTC+3
  const ms = Math.max(Date.now() - target, 0);
  if (d === 0 && ms < 60_000) return; // today, and that hour has not come yet: leave the real time
  const days = -d;
  const T0 = `'${t0.toISOString()}'::timestamp`;
  await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica"); // history guards off for this step only
      for (const [table, cols] of byTable) {
        const ts = cols.filter((c) => c.kind === "ts");
        if (ts.length === 0) continue;
        // date columns move together with the row's own time stamp (createdAt, or the table's first one, e.g. submittedAt)
        const anchor = (ts.find((c) => c.col === "createdAt") ?? ts[0]!).col;
        const sets = [
          ...ts.map((c) => `"${c.col}" = CASE WHEN "${c.col}" >= ${T0} THEN "${c.col}" - interval '${ms} milliseconds' ELSE "${c.col}" END`),
          ...cols.filter((c) => c.kind === "date").map((c) => `"${c.col}" = CASE WHEN "${anchor}" >= ${T0} THEN ("${c.col}" - interval '${days} days')::date ELSE "${c.col}" END`),
        ];
        await tx.$executeRawUnsafe(`UPDATE "${table}" SET ${sets.join(", ")} WHERE ${ts.map((c) => `"${c.col}" >= ${T0}`).join(" OR ")}`);
      }
    },
    { timeout: 180000, maxWait: 30000 },
  );
}
async function batch(d: number, hour: number, fn: () => Promise<void>) {
  const t0 = new Date(Date.now() - 1500);
  await fn();
  await shift(t0, d, hour);
}

// ───────────── the cast ─────────────
type Who = { id: string; name: string };
let owner!: Who, manager!: Who, amina!: Who, salim!: Who, baraka!: Who;
let locId = "";
let pieceUnit = "";
type Prod = { id: string; name: string; baseUnitId: string; cartonUnitId: string | null; factor: number; retail: number; wholesale: number; cost: number; liters: number };
let prods: Prod[] = [];
let suppliers: { id: string; name: string }[] = [];
type Cust = { id: string; name: string; type: string; limit: number };
let customers: Cust[] = [];
let walkIns: Cust[] = [];
let resellers: { id: string; name: string; customerId: string; locationId: string }[] = [];
const expenseCat = new Map<string, string>();
const accounts: { name: string; username: string; password: string; role: string }[] = [];

async function tx<T>(fn: (t: Prisma.TransactionClient) => Promise<T>, timeout = 60000): Promise<T> {
  return db.$transaction(fn, { timeout, maxWait: 30000 });
}

async function setup(d: number) {
  const ownerUser = await db.user.findFirstOrThrow({ where: { role: { isSuperAdmin: true } }, orderBy: { createdAt: "asc" } });
  owner = { id: ownerUser.id, name: ownerUser.name };
  const loc = await db.location.findFirstOrThrow({ where: { isDefault: true } });
  locId = loc.id;
  pieceUnit = (await db.unit.findFirstOrThrow({ where: { symbol: "PCS" } })).id;

  // staff (their passwords are random, written to .backups/demo-accounts.txt, never printed)
  const roles = new Map((await db.role.findMany({ select: { id: true, key: true } })).map((r) => [r.key, r.id]));
  const mk = async (name: string, username: string, roleKey: string, phone: string): Promise<Who> => {
    const password = `Demo-${randomUUID().slice(0, 8)}9`;
    const u = await db.user.create({ data: { name, username, email: `${username}@superdrive.local`, phone, passwordHash: await hashPassword(password), roleId: roles.get(roleKey)! } });
    accounts.push({ name, username, password, role: roleKey });
    return { id: u.id, name };
  };
  manager = await mk("Juma Mwangi", "juma", "SALESPERSON", "0713 555 201");
  amina = await mk("Amina Hassan", "amina", "SALESPERSON", "0754 555 202");
  salim = await mk("Salim Bakari", "salim", "SALESPERSON", "0765 555 203");
  baraka = await mk("Baraka Said", "baraka", "WAREHOUSE", "0782 555 204");
  await mk("Neema Joseph", "neema", "SALESPERSON", "0716 555 205");

  // settings the cash screens use
  // no approval limit: expenses are recorded and paid at once (the shop rule since 2026-11-07)

  // expense categories on top of the starting ones
  for (const name of ["Rent", "Salaries", "Electricity and water", "Marketing"]) if (!(await db.expenseCategory.findFirst({ where: { name } }))) await db.expenseCategory.create({ data: { name } });
  for (const c of await db.expenseCategory.findMany()) expenseCat.set(c.name, c.id);

  // prices (the catalogue had none): about 16,000 per litre, a little more for the car makers' own oils; wholesale 8% lower; landed cost 62%
  const products = await db.product.findMany({ where: { status: "ACTIVE" }, include: { units: { include: { unit: true } } }, orderBy: { name: "asc" } });
  prods = [];
  for (const p of products) {
    const liters = Number(/(\d+)\s*L/i.exec(p.name)?.[1] ?? 1);
    const maker = /nissan|toyota/i.test(p.name) ? 1.15 : /castrol/i.test(p.name) ? 1.1 : 1;
    const retail = round500(liters * 16000 * maker + (liters === 1 ? 2000 : 0));
    const wholesale = round500(retail * 0.92);
    const cost = Math.round(retail * 0.62);
    const carton = p.units.find((u) => u.unit.symbol === "CTN");
    await db.product.update({ where: { id: p.id }, data: { sellingPrice: retail, wholesalePrice: wholesale, purchasePrice: cost, minStock: liters === 1 ? 24 : 10 } });
    await db.productPriceHistory.createMany({ data: [{ productId: p.id, field: "sellingPrice", oldValue: null, newValue: retail, changedById: owner.id }, { productId: p.id, field: "wholesalePrice", oldValue: null, newValue: wholesale, changedById: owner.id }] });
    prods.push({ id: p.id, name: p.name, baseUnitId: p.baseUnitId, cartonUnitId: carton?.unitId ?? null, factor: carton ? Number(carton.factor) : 1, retail, wholesale, cost, liters });
  }

  // suppliers and customers
  suppliers = [];
  for (const [name, phone, contact] of [
    ["Guangzhou Auto Lubricants Co.", "+86 20 5555 0101", "Mr. Li Wei"],
    ["Shenzhen Oil Trading Ltd", "+86 755 5555 0188", "Ms. Chen Mei"],
    ["Dar Lubes Distributors", "0222 555 310", "Bw. Omari"],
  ] as const) {
    const s = await db.supplier.create({ data: { name, phone, contactPerson: contact } });
    suppliers.push({ id: s.id, name });
  }
  const custData: { name: string; type: "RETAIL" | "WHOLESALE" | "DISTRIBUTOR" | "BUSINESS"; limit: number; phone: string; place: string }[] = [
    { name: "Mwenge Auto Garage", type: "WHOLESALE", limit: 2500000, phone: "0712 600 111", place: "Mwenge" },
    { name: "Sinza Motors", type: "WHOLESALE", limit: 2000000, phone: "0713 600 112", place: "Sinza" },
    { name: "Kinondoni Transport Co.", type: "BUSINESS", limit: 4000000, phone: "0714 600 113", place: "Kinondoni" },
    { name: "City Link Logistics", type: "BUSINESS", limit: 3500000, phone: "0715 600 114", place: "Ilala" },
    { name: "Pwani Auto Spares", type: "DISTRIBUTOR", limit: 6000000, phone: "0716 600 115", place: "Kariakoo" },
    { name: "Temeke Wholesalers", type: "WHOLESALE", limit: 1500000, phone: "0717 600 116", place: "Temeke" },
    { name: "Ubungo Bus Services", type: "BUSINESS", limit: 3000000, phone: "0718 600 117", place: "Ubungo" },
    { name: "Mbezi Lubricants Shop", type: "WHOLESALE", limit: 1200000, phone: "0719 600 118", place: "Mbezi" },
  ];
  customers = [];
  for (const c of custData) {
    const row = await db.customer.create({ data: { name: c.name, type: c.type, creditLimit: c.limit, phone: c.phone, businessLocation: c.place, createdById: manager.id } });
    customers.push({ id: row.id, name: c.name, type: c.type, limit: c.limit });
  }
  walkIns = [];
  for (const [n, ph] of [["Joseph Mushi", "0754 700 201"], ["Fatma Ally", "0765 700 202"], ["Rashid Kombo", "0784 700 203"], ["Grace Mollel", "0713 700 204"], ["Daudi Mwakyusa", "0752 700 205"], ["Zawadi Peter", "0766 700 206"]] as const) {
    const row = await db.customer.create({ data: { name: n, type: "RETAIL", phone: ph, createdById: amina.id } });
    walkIns.push({ id: row.id, name: n, type: "RETAIL", limit: 0 });
  }

  // money in the accounts when the system started
  for (const [method, amount] of [["CASH", "600000"], ["MOBILE_MONEY", "350000"], ["BANK", "20000000"]] as [PaymentMethod, string][]) {
    await tx((t) => postManualCash(t, { user: owner, locationId: locId, method, kind: "OPENING", amount, reason: "Opening balance when the system started", submissionKey: key(), currencyDecimals: 0 }));
  }
  void d;
}

// ───────────── purchase orders ─────────────
async function createPO(d: number, user: Who, supplierId: string, cargo: string, perProduct: number, expectedOffset: number, only?: string[]) {
  const chosen = prods.filter((p) => !only || only.some((n) => p.name.includes(n)));
  const lines = chosen.map((p) => {
    const pieces = Math.max(p.factor, Math.round((perProduct * 1.7 * ORDER_SIZE[POPULARITY[prods.indexOf(p) % POPULARITY.length]!]! * (0.8 + rnd() * 0.4)) / p.factor) * p.factor);
    const unitId = p.cartonUnitId ?? p.baseUnitId;
    const qty = p.cartonUnitId ? pieces / p.factor : pieces;
    return { productId: p.id, unitId, quantity: String(qty), totalCost: String(Math.round(p.cost * 0.97 * pieces)), sellingPrice: "", wholesalePrice: "" };
  });
  const s = await tx((t) => createShipment(t, { user, supplierId, reference: null, cargoName: cargo, expectedDate: forDay(expectedOffset, d), locationId: locId, notes: null, lines, submissionKey: key(), currencyDecimals: 0 }));
  return s;
}
async function arrive(id: string, user: Who) {
  await tx((t) => markArrived(t, { shipmentId: id, user }));
}
/** The shop counts. `fraction` of each line arrived good, `damaged` pieces of one product broke, `finish` = nothing more is coming. */
async function count(id: string, user: Who, opts: { fraction?: number; before?: Map<string, number>; damaged?: Record<string, number>; finish?: boolean }) {
  // everything is counted in cartons (the unit it was ordered in); `before` and `damaged` are carton counts too
  const items = await db.shipmentItem.findMany({ where: { shipmentId: id, unexpected: false } });
  const lines: CountLine[] = [];
  const counted = opts.before ?? new Map<string, number>();
  const now = new Map<string, number>();
  for (const it of items) {
    const p = prods.find((x) => x.id === it.productId)!;
    const expected = Number(it.expectedQty) / p.factor;
    const target = opts.fraction === undefined ? expected : Math.floor(expected * opts.fraction);
    const already = counted.get(it.productId) ?? 0;
    const bad = opts.damaged?.[it.productId] ?? 0;
    const good = Math.max(target - already - bad, 0);
    now.set(it.productId, already + good + bad);
    if (good + bad > 0) lines.push({ shipmentItemId: null, productId: it.productId, unitId: p.cartonUnitId ?? p.baseUnitId, good: String(good), damaged: String(bad), note: bad ? "Cartons crushed in transit" : null });
  }
  const saved = await tx((t) => saveDraft(t, { shipmentId: id, user, notes: null, finish: Boolean(opts.finish), lines }));
  await tx((t) => confirmSession(t, { shipmentId: id, sessionId: saved.sessionId, user }), 180000);
  return now;
}

// ───────────── selling ─────────────
const stock = new Map<string, number>();
async function loadStock() {
  stock.clear();
  for (const r of await db.stockBalance.findMany({ where: { locationId: locId } })) stock.set(r.productId, Number(r.quantity));
}
/** Some oils sell much better than others, so a few run low and the rest stay well stocked. */
const POPULARITY = [7, 4, 3, 3, 2, 1, 3, 1, 2, 1, 1];
/** Orders are sized to how well each oil sells: bestsellers are ordered in bigger numbers but still run low. */
const ORDER_SIZE: Record<number, number> = { 7: 0.8, 4: 0.7, 3: 0.55, 2: 0.4, 1: 0.3 };
function pickPopular(list: Prod[]): Prod {
  const w = list.map((p) => POPULARITY[prods.indexOf(p) % POPULARITY.length]!);
  let r = rnd() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) if ((r -= w[i]!) <= 0) return list[i]!;
  return list[list.length - 1]!;
}
const methodMix = (): PaymentMethod => (chance(0.62) ? "CASH" : chance(0.78) ? "MOBILE_MONEY" : "BANK");

async function oneSale(cashier: Who) {
  const inStock = prods.filter((p) => (stock.get(p.id) ?? 0) >= p.factor); // sold by the carton only
  if (inStock.length === 0) return;
  const business = chance(0.3) ? pick(customers) : null;
  const regular = !business && chance(0.35) ? pick(walkIns) : null;
  const buyer = business ?? regular;
  const lines: SaleInput["lines"] = [];
  const picked = new Set<string>();
  for (let i = 0, n = business ? int(1, 4) : int(1, 3); i < n; i++) {
    const p = pickPopular(inStock);
    if (picked.has(p.id)) continue;
    picked.add(p.id);
    const have = stock.get(p.id) ?? 0;
    // the business sells by the carton: whole cartons only, never single pieces
    const cartonsHave = Math.floor(have / p.factor);
    const qty = Math.min(business ? int(1, 3) : 1, cartonsHave);
    if (qty < 1) continue;
    const unitId = p.cartonUnitId ?? p.baseUnitId;
    const pieces = qty * p.factor;
    const bulk = Boolean(p.cartonUnitId);
    const itemCodes: string[] | undefined = undefined;
    const discount = chance(0.07);
    const list = business && ["WHOLESALE", "DISTRIBUTOR"].includes(business.type) ? p.wholesale : p.retail;
    lines.push({ productId: p.id, unitId, quantity: String(qty), unitPrice: discount ? String(round500(list * 0.95) * (bulk ? p.factor : 1)) : "", itemCodes });
    stock.set(p.id, have - pieces);
  }
  if (lines.length === 0) return;
  const hasDiscount = lines.some((l) => l.unitPrice !== "");
  let mode: SaleInput["mode"] = "FULL";
  if (buyer && buyer.limit > 0) mode = chance(0.45) ? "CREDIT" : chance(0.25) ? "PART" : "FULL";
  const make = (m: SaleInput["mode"]): SaleInput => ({
    user: cashier,
    can: { discount: hasDiscount, credit: true, approveCreditException: false },
    customerId: buyer?.id ?? null,
    locationId: locId,
    mode: m,
    method: m === "CREDIT" ? null : methodMix(),
    partAmount: null,
    reference: null,
    notes: null,
    discountReason: hasDiscount ? "Regular customer" : null,
    lines,
    creditException: null,
    submissionKey: key(),
    currencyDecimals: 0,
    creditTermsDays: 14,
  });
  try {
    const input = make(mode);
    if (mode === "PART") {
      // a part payment between a fifth and a half of the total (the total is re-checked by the engine)
      const approx = lines.reduce((s, l) => s + Number(l.quantity) * (prods.find((p) => p.id === l.productId)!.retail) * (l.unitId === prods.find((p) => p.id === l.productId)!.cartonUnitId ? prods.find((p) => p.id === l.productId)!.factor : 1), 0);
      input.partAmount = String(round500(approx * (0.2 + rnd() * 0.3)) || 500);
    }
    await tx((t) => postSale(t, input));
  } catch (e) {
    if (e instanceof CreditLimitError || e instanceof SaleError) {
      // over the credit limit or a mismatch: the customer simply pays in full instead
      try {
        await tx((t) => postSale(t, make("FULL")));
      } catch {
        for (const l of lines) {
          const p = prods.find((x) => x.id === l.productId)!;
          stock.set(p.id, (stock.get(p.id) ?? 0) + Number(l.quantity) * (l.unitId === p.cartonUnitId ? p.factor : 1));
        }
      }
      return;
    }
    throw e;
  }
}

async function owedInvoices(customerId: string) {
  return db.$queryRaw<{ id: string; owed: Prisma.Decimal }[]>`
    SELECT s."id", (s."total" - s."returnedTotal" - s."amountPaid" + s."refundedTotal") AS owed FROM "Sale" s
     WHERE s."customerId" = ${customerId} AND s."status" <> 'CANCELLED' AND (s."total" - s."returnedTotal" - s."amountPaid" + s."refundedTotal") > 0
     ORDER BY s."createdAt" ASC`;
}
async function collect(customerId: string, who: Who, fractionOfDebt: number) {
  const open = await owedInvoices(customerId);
  const debt = open.reduce((s, o) => s + Number(o.owed), 0);
  if (debt < 5000) return;
  let want = fractionOfDebt >= 1 ? debt : Math.max(round500(debt * fractionOfDebt), 5000);
  const allocations: { saleId: string; amount: string }[] = [];
  for (const o of open) {
    if (want <= 0) break;
    const a = Math.min(Number(o.owed), want);
    allocations.push({ saleId: o.id, amount: String(a) });
    want -= a;
  }
  const amount = allocations.reduce((s, a) => s + Number(a.amount), 0);
  await tx((t) => postCollection(t, { user: who, customerId, method: methodMix(), amount: String(amount), reference: null, notes: null, allocations, keepExtraAsCredit: false, submissionKey: key(), currencyDecimals: 0 }));
}

async function returnOne(d: number, leavePending: boolean) {
  const sale = await db.sale.findFirst({ where: { status: "COMPLETED", paymentStatus: "PAID", channel: "SHOP", createdAt: { gte: new Date(Date.now() - 5 * 86400000) } }, orderBy: { createdAt: "desc" }, include: { items: true } });
  const line = sale?.items[0];
  if (!sale || !line) return;
  const damaged = chance(0.4);
  const req = await tx((t) => createReversalRequest(t, { user: amina, saleId: sale.id, kind: "RETURN", reason: damaged ? "Carton was leaking when opened" : "Customer bought the wrong grade", refundMethod: "CASH", refundReference: null, lines: [{ saleItemId: line.id, quantity: "1", condition: damaged ? "DAMAGED" : "RESELLABLE" }], submissionKey: key() }));
  if (!leavePending) await tx((t) => completeReversal(t, { reversalId: req.id, approver: manager, note: null, dp: 0 }));
  void d;
}

// ───────────── the whole story ─────────────
let pickupSwitch: string | null = null;
async function main() {
  if ((await db.sale.count()) > 0 || (await db.stockReceipt.count()) > 0 || (await db.shipment.count()) > 0) {
    console.error("This database already has sales, receipts or purchase orders. Sample data is only added to an empty one.");
    process.exit(1);
  }
  // The sample is a finished history: every sale was collected long ago, so the warehouse pickup step is switched off while the story is played
  // (and back on at the end). Real sales from now on reserve stock and make pickup notes.
  const dflt = await db.location.findFirst({ where: { isDefault: true, pickupRequired: true }, select: { id: true } });
  if (dflt) {
    pickupSwitch = dflt.id;
    await db.location.update({ where: { id: dflt.id }, data: { pickupRequired: false } });
  }
  await loadColumns();
  console.log("Setting up people, prices, suppliers, customers and opening balances…");
  await batch(START, 9, () => setup(START));

  const events = new Map<number, (() => Promise<void>)[]>();
  const at = (d: number, fn: () => Promise<void>) => events.set(d, [...(events.get(d) ?? []), fn]);

  // purchase orders: announced, brought by other cargo companies, counted by the shop
  const po: Record<string, { id: string }> = {};
  at(-70, async () => void (po.p1 = await createPO(-70, owner, suppliers[0]!.id, "Lakeside Cargo", 170, -66)));
  at(-67, async () => { await arrive(po.p1!.id, amina); await count(po.p1!.id, amina, {}); });
  at(-62, async () => void (await tx((t) => paySupplier(t, { user: owner, supplierId: suppliers[0]!.id, shipmentId: po.p1!.id, amount: "6000000", method: "BANK", reference: "TT-GZ-20931", notes: "First payment", submissionKey: key(), currencyDecimals: 0 }))));
  let firstCount = new Map<string, number>();
  at(-50, async () => void (po.p2 = await createPO(-50, owner, suppliers[0]!.id, "Dar Express Cargo", 120, -46)));
  at(-46, async () => { await arrive(po.p2!.id, salim); firstCount = await count(po.p2!.id, salim, { fraction: 0.6 }); });
  at(-44, async () => { const bad = prods.find((p) => p.name.includes("5W-30 5L"))!; await count(po.p2!.id, salim, { before: firstCount, damaged: { [bad.id]: 1 }, finish: true }); });
  at(-40, async () => void (await tx((t) => resolveIssue(t, { shipmentId: po.p2!.id, user: owner, note: "Cargo company accepted the damage claim: 6 jugs will be credited on the next order." }))));
  at(-36, async () => void (await tx((t) => paySupplier(t, { user: owner, supplierId: suppliers[0]!.id, shipmentId: po.p2!.id, amount: "4500000", method: "BANK", reference: "TT-GZ-21877", notes: null, submissionKey: key(), currencyDecimals: 0 }))));
  at(-32, async () => void (po.p3 = await createPO(-32, owner, suppliers[1]!.id, "Safari Air Freight", 100, -29)));
  at(-29, async () => { await arrive(po.p3!.id, amina); await count(po.p3!.id, amina, {}); });
  at(-25, async () => void (await tx((t) => paySupplier(t, { user: owner, supplierId: suppliers[1]!.id, shipmentId: po.p3!.id, amount: "3800000", method: "BANK", reference: "TT-SZ-30112", notes: null, submissionKey: key(), currencyDecimals: 0 }))));
  at(-22, async () => void (po.p4 = await createPO(-22, owner, suppliers[2]!.id, "Lakeside Cargo", 40, -18, ["5W-30", "15W-40"])));
  at(-21, async () => void (await tx((t) => cancelShipment(t, { shipmentId: po.p4!.id, user: owner, reason: "The supplier could not ship on time, ordered again from another supplier." }))));
  at(-14, async () => void (po.p5 = await createPO(-14, owner, suppliers[0]!.id, "Dar Express Cargo", 90, -10)));
  at(-11, async () => { await arrive(po.p5!.id, amina); await count(po.p5!.id, amina, { fraction: 0.85, finish: true }); }); // some of it never came: open investigation
  at(-8, async () => void (po.p6 = await createPO(-8, owner, suppliers[1]!.id, "Safari Air Freight", 100, -4)));
  at(-4, async () => { await arrive(po.p6!.id, salim); }); // at the shop, waiting to be checked
  at(-5, async () => void (po.p7 = await createPO(-5, owner, suppliers[0]!.id, "Lakeside Cargo", 120, 2)));
  at(-3, async () => void (po.p8 = await createPO(-3, owner, suppliers[1]!.id, "Dar Express Cargo", 120, 6)));
  at(-1, async () => void (po.p9 = await createPO(-1, owner, suppliers[2]!.id, "Safari Air Freight", 40, -3, ["1L"])));

  // resellers (stock goes out on trust and comes back as sales)
  at(-58, async () => {
    const mkR = (name: string, biz: string, phone: string, place: string) => tx((t) => createReseller(t, { user: manager, name, businessName: biz, phone, altPhone: "", address: place, salesLocation: place, idInfo: "", notes: "", settlementDays: "14" }));
    for (const r of [await mkR("Hamisi Rajabu", "Hamisi Traders", "0715 800 301", "Mbagala market"), await mkR("Neema Kimaro", "Mama Neema Shop", "0765 800 302", "Gongo la Mboto")]) resellers.push({ id: r.id, name: r.name, customerId: r.customerId, locationId: r.locationId });
  });
  const issue = async (r: number, perLine: number, names: string[]) => {
    // never more than half of what is on the shelf, so the shop keeps selling
    await loadStock();
    const lines = prods
      .filter((p) => names.some((n) => p.name.includes(n)))
      .map((p) => ({ productId: p.id, unitId: p.cartonUnitId ?? p.baseUnitId, quantity: String(Math.min(Math.ceil(perLine / 3), Math.floor(((stock.get(p.id) ?? 0) * 0.5) / p.factor))) }))
      .filter((l) => Number(l.quantity) > 0);
    if (lines.length) await tx((t) => issueStock(t, { user: amina, resellerId: resellers[r]!.id, fromLocationId: locId, lines, notes: "Weekly stock", submissionKey: key(), currencyDecimals: 0 }));
  };
  const sold = async (r: number, share: number) => {
    const bal = await db.stockBalance.findMany({ where: { locationId: resellers[r]!.locationId, quantity: { gt: 0 } } });
    const lines = bal.map((b) => { const p = prods.find((x) => x.id === b.productId)!; return { productId: b.productId, unitId: p.cartonUnitId ?? p.baseUnitId, quantity: String(Math.floor((Number(b.quantity) / p.factor) * share)) }; }).filter((l) => Number(l.quantity) > 0);
    if (lines.length) await tx((t) => reportSold(t, { user: amina, canDiscount: false, resellerId: resellers[r]!.id, lines, discountReason: null, notes: null, submissionKey: key(), currencyDecimals: 0 }));
  };
  at(-57, async () => { await issue(0, 12, ["15W-40 5L", "20W-50 5L", "1L"]); await issue(1, 8, ["5W-30 5L", "20W-50 1L", "NS-2"]); });
  at(-44, async () => { await sold(0, 0.6); await sold(1, 0.5); });
  at(-38, async () => void (await collect(resellers[0]!.customerId, amina, 1)));
  at(-30, async () => {
    const r = resellers[1]!;
    const bal = await db.stockBalance.findMany({ where: { locationId: r.locationId, quantity: { gt: 0 } }, take: 2 });
    const lines = bal.map((b, i) => ({ productId: b.productId, unitId: prods.find((p) => p.id === b.productId)!.cartonUnitId ?? prods.find((p) => p.id === b.productId)!.baseUnitId, quantity: "1", condition: (i === 0 ? "RESELLABLE" : "DAMAGED") as "RESELLABLE" | "DAMAGED" }));
    if (lines.length) await tx((t) => returnStock(t, { user: amina, resellerId: r.id, toLocationId: locId, lines, notes: "Unsold and one broken", submissionKey: key() }));
  });
  at(-20, async () => { await issue(0, 10, ["15W-40 5L", "5W-30 5L", "Quartz", "1L"]); await issue(1, 10, ["20W-50 5L", "15W-40 1L", "20W-50 1L"]); });
  at(-12, async () => { await sold(0, 0.7); await sold(1, 0.6); });
  at(-9, async () => void (await collect(resellers[1]!.customerId, amina, 0.6)));
  at(-6, async () => { await issue(0, 8, ["15W-40 5L", "20W-50 5L"]); });
  at(-2, async () => { await sold(1, 0.4); });

  const returnDays = new Set([-52, -35, -21, -9]);
  const bigExpenses = new Map<number, { cat: string; what: string; amount: string; method: PaymentMethod }[]>([
    [-40, [{ cat: "Rent", what: "Shop rent for the month", amount: "900000", method: "BANK" }, { cat: "Salaries", what: "Staff salaries", amount: "1450000", method: "BANK" }]],
    [-10, [{ cat: "Rent", what: "Shop rent for the month", amount: "900000", method: "BANK" }, { cat: "Salaries", what: "Staff salaries", amount: "1450000", method: "BANK" }]],
  ]);

  let firstSalesDay = 1;
  let bad = 0;
  console.log("Playing the days…");
  for (let d = START; d <= 0; d++) {
    const dow = new Date(`${isoDay(d)}T12:00:00Z`).getUTCDay(); // 0 Sunday
    const factor = [0.55, 1, 0.9, 0.95, 1, 1.25, 1.5][dow]! * (0.75 + 0.5 * ((d - START) / -START));
    const trading = d > -67; // the first delivery is counted on day -67
    if (trading && firstSalesDay === 1) firstSalesDay = d;
    const nSales = trading ? Math.max(0, Math.round(1.7 * factor + int(-1, 1))) : 0; // cartons are big sales: a few a day
    const closed = d < 0 && d >= firstSalesDay;
    const morning = Math.ceil(nSales * 0.45);

    await batch(d, 10, async () => {
      for (const fn of events.get(d) ?? []) await fn();
      await loadStock();
      for (let i = 0; i < morning; i++) await oneSale(pick([amina, amina, salim, manager]));
      if (trading && chance(0.2)) {
        // a credit customer pays something
        for (const c of [...customers].sort(() => rnd() - 0.5)) {
          const open = await owedInvoices(c.id);
          if (open.length) {
            await collect(c.id, pick([amina, salim]), chance(0.5) ? 1 : 0.4 + rnd() * 0.3);
            break;
          }
        }
      }
      if (trading && chance(0.35)) {
        const e = pick([["Transport", "Delivery by motorbike"], ["Fuel", "Fuel for the delivery van"], ["Shop cleaning", "Cleaning materials"], ["Small operational purchases", "Packing tape and bags"], ["Other", "Airtime and small repairs"]] as const);
        await tx((t) => recordExpense(t, { user: pick([amina, salim]), categoryId: expenseCat.get(e[0])!, description: e[1], amount: String(round500(int(5, 28) * 1000)), method: "CASH", expenseDate: "", notes: null, receiptId: null, submissionKey: key(), currencyDecimals: 0, approvalLimit: new D(0), canApprove: false }));
      }
      if (trading && d >= -8 && (d === 0 || xr() < 0.6)) {
        // small cash spending in the last days too, so this month shows some
        const e = ([["Transport", "Delivery by motorbike"], ["Fuel", "Fuel for the delivery van"], ["Shop cleaning", "Cleaning materials"], ["Other", "Airtime and small repairs"]] as const)[Math.floor(xr() * 4)]!;
        await tx((t) => recordExpense(t, { user: d % 2 ? amina : salim, categoryId: expenseCat.get(e[0])!, description: e[1], amount: String(round500((5 + Math.floor(xr() * 24)) * 1000)), method: "CASH", expenseDate: "", notes: null, receiptId: null, submissionKey: key(), currencyDecimals: 0, approvalLimit: new D(0), canApprove: false }));
      }
      for (const b of bigExpenses.get(d) ?? []) {
        const e = await tx((t) => recordExpense(t, { user: amina, categoryId: expenseCat.get(b.cat)!, description: b.what, amount: b.amount, method: b.method, expenseDate: "", notes: null, receiptId: null, submissionKey: key(), currencyDecimals: 0, approvalLimit: new D(0), canApprove: false }));
        void e;
      }
      if (returnDays.has(d)) await returnOne(d, false);
    });

    await batch(d, 15, async () => {
      await loadStock();
      for (let i = morning; i < nSales; i++) await oneSale(pick([amina, amina, salim, manager]));
      if (d === -2) {
        // a second expense waiting for the owner, and a return waiting for the manager
        await tx((t) => recordExpense(t, { user: salim, categoryId: expenseCat.get("Electricity and water")!, description: "Electricity bill", amount: "186000", method: "MOBILE_MONEY", expenseDate: "", notes: null, receiptId: null, submissionKey: key(), currencyDecimals: 0, approvalLimit: new D(0), canApprove: false }));
      }
    });

    if (closed) {
      await batch(d, 19, async () => {
        const preview = await tx((t) => getClosingPreview(t, locId));
        const expected = Number(preview.expectedCash);
        bad++;
        const r = rnd();
        const diff = d === -2 ? -4500 : r < 0.72 ? 0 : r < 0.92 ? int(-8, 8) * 100 : int(-6, 6) * 700 || 1800;
        // the shop counts and banks everything except a small float for change and small expenses
        const counted = Math.max(Math.round(expected + diff), 0);
        const toBank = Math.floor(Math.max(counted - FLOAT, 0) / 100) * 100;
        const closing = await tx((t) => submitClosing(t, { user: amina, locationId: locId, day: "", countedCash: String(counted), notes: diff === 0 ? null : "Counted twice, this is the real count.", deposit: toBank > 0 ? { amount: String(toBank), bankReference: `DEP-${isoDay(d).replaceAll("-", "")}`, notes: null, slipId: null } : null, submissionKey: key(), currencyDecimals: 0 }));
        void closing;
      });
    }
    if (d % 10 === 0) log(`day ${d}: ${nSales} sales`);
  }

  // one return waiting for the manager, today
  await returnOne(0, true);

  // the closing summary keeps the day it was made for
  await db.$transaction(async (t) => {
    await t.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    await t.$executeRawUnsafe(`UPDATE "DailyClosing" SET "summary" = jsonb_set("summary"::jsonb, '{businessDate}', to_jsonb("businessDate"::text))`);
  });

  // a few notifications so the bell is alive
  const note = (userId: string, type: string, title: string, body: string, link: string) => db.notification.create({ data: { userId, type, title, body, link } });
  await note(owner.id, "shipment.arrived", "A purchase order has arrived at the shop", "The shop marked it arrived and is checking it.", "/shipments");
  await note(owner.id, "shipment.issue", "A purchase order needs your investigation", "Some goods never arrived.", "/shipments?tab=investigation");
  await note(manager.id, "reversal.requested", "A return is waiting for you", "A customer brought a bottle back.", "/sales");
  await note(amina.id, "shipment.announced", "A new purchase order is on its way", "Check it when it arrives.", "/shipments");

  // the logins of the sample staff, kept in a private file (never printed)
  const dir = join(__dirname, "..", ".backups");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "demo-accounts.txt"), ["Sample staff logins (the owner's login is unchanged)", "", ...accounts.map((a) => `${a.role.padEnd(12)} ${a.name.padEnd(16)} email: ${(a.username + "@superdrive.local").padEnd(26)} password: ${a.password}`), ""].join("\n"));

  const counts = await Promise.all([db.sale.count(), db.customer.count(), db.inventoryItem.count(), db.shipment.count(), db.expense.count(), db.dailyClosing.count()]);
  console.log(`Done: ${counts[0]} sales, ${counts[1]} customers, ${counts[2]} item records, ${counts[3]} purchase orders, ${counts[4]} expenses, ${counts[5]} daily closings.`);
  void bad;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (pickupSwitch) await db.location.update({ where: { id: pickupSwitch }, data: { pickupRequired: true } });
    await db.$disconnect();
  });
