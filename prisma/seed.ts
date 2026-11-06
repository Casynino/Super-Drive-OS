// Idempotent bootstrap: permissions, built-in roles, base units, default location, core settings,
// and (only when the system has no users) the first Super Admin taken from environment variables.
// It never creates products, customers, sales, stock or any other business data.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { DEFAULT_ROLES, PERMISSIONS } from "../src/lib/permissions";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const BASE_UNITS = [
  { name: "Litre", symbol: "L", allowsDecimal: true },
  { name: "Piece", symbol: "PCS", allowsDecimal: false },
  { name: "Bottle", symbol: "btl", allowsDecimal: false },
  { name: "Container", symbol: "cont", allowsDecimal: false },
  { name: "Drum", symbol: "drum", allowsDecimal: false },
  { name: "Carton", symbol: "CTN", allowsDecimal: false },
  { name: "Box", symbol: "box", allowsDecimal: false },
];

async function main() {
  // 1. Permissions (sync registry → table). A permission that is NEW in this run is also granted to the
  //    built-in roles that list it by default, so upgrades work; later edits by the owner are never overwritten.
  const newlyAdded: string[] = [];
  for (const p of PERMISSIONS) {
    const existed = await db.permission.findUnique({ where: { key: p.key }, select: { id: true } });
    await db.permission.upsert({
      where: { key: p.key },
      update: { module: p.module, label: p.label },
      create: { key: p.key, module: p.module, label: p.label },
    });
    if (!existed) newlyAdded.push(p.key);
  }
  await db.permission.deleteMany({ where: { key: { notIn: PERMISSIONS.map((p) => p.key) } } });

  // 2. Built-in roles - created once; later edits by the owner are never overwritten
  const permIds = new Map((await db.permission.findMany({ select: { id: true, key: true } })).map((p) => [p.key, p.id]));
  for (const role of DEFAULT_ROLES) {
    const existing = await db.role.findUnique({ where: { key: role.key } });
    if (existing) {
      for (const key of role.permissions.filter((k) => newlyAdded.includes(k))) {
        await db.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: existing.id, permissionId: permIds.get(key)! } },
          update: {},
          create: { roleId: existing.id, permissionId: permIds.get(key)! },
        });
      }
      continue;
    }
    await db.role.create({
      data: {
        key: role.key,
        name: role.name,
        description: role.description,
        isSystem: true,
        isSuperAdmin: role.isSuperAdmin ?? false,
        permissions: { create: role.permissions.map((k) => ({ permissionId: permIds.get(k)! })) },
      },
    });
  }

  // 3. Units, default location, settings (never overwrite existing rows)
  await db.unit.createMany({ data: BASE_UNITS, skipDuplicates: true });

  if ((await db.location.count()) === 0) {
    await db.location.create({ data: { code: "STORE", name: "Store Warehouse – Dar es Salaam", type: "WAREHOUSE", isDefault: true, pickupRequired: true } });
  }

  await db.setting.createMany({
    data: [
      { key: "businessName", value: "Super Drive Oil" },
      { key: "businessPhone", value: "+255 750 496 756" }, // the shop's WhatsApp number (from its Instagram page); printed on receipts and used in payment reminders
      { key: "paymentAccounts", value: `CRDB BANK\nJina: ABEL JACOB KIJYOMBO\nAkaunti: 0152841983800\n\nNMB BANK\nJina: ABEL JACOB KIJYOMBO\nAkaunti: 20410052450\n\nM-PESA\nJina: Abely Jacob\nNamba: 37453908` }, // where customers pay; copied into payment reminders (editable in Settings → Business)
      { key: "currency", value: { code: "TZS", symbol: "TSh", decimals: 0 } },
      { key: "creditTermsDays", value: 30 },
      { key: "expenseApprovalLimit", value: 0 }, // 0 = no approval needed: expenses are recorded and paid at once (the owner may set a limit later)
    ],
    skipDuplicates: true,
  });

  // Cash accounts (structure, no money): cash, mobile money and bank for every location
  for (const loc of await db.location.findMany({ select: { id: true } })) {
    for (const [method, name] of [["CASH", "Cash on hand"], ["MOBILE_MONEY", "Mobile money"], ["BANK", "Bank account"]] as const) {
      if (!(await db.cashAccount.findFirst({ where: { locationId: loc.id, method, isDefault: true }, select: { id: true } }))) await db.cashAccount.create({ data: { locationId: loc.id, method, name, isDefault: true } });
    }
  }
  // Starting expense categories (the examples from the brief); only when none exist, so the owner's edits are never undone
  if ((await db.expenseCategory.count()) === 0) {
    await db.expenseCategory.createMany({ data: ["Transport", "Fuel", "Shop cleaning", "Delivery charges", "Small operational purchases", "Other"].map((name) => ({ name })) });
  }

  // 4. First Super Admin (only when there are no users at all)
  if ((await db.user.count()) === 0) {
    const username = process.env.ADMIN_USERNAME?.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;
    const name = process.env.ADMIN_NAME?.trim() || "Business Owner";
    if (!username || !password || password.length < 12) {
      throw new Error("Set ADMIN_USERNAME and ADMIN_PASSWORD (min 12 chars) in .env to create the first Super Admin.");
    }
    const role = await db.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
    const user = await db.user.create({
      data: { username, name, roleId: role.id, passwordHash: await bcrypt.hash(password, 12), mustChangePassword: false },
    });
    await db.auditLog.create({
      data: { userId: user.id, userName: user.name, action: "user.create", entityType: "User", entityId: user.id, reason: "Initial Super Admin created by seed" },
    });
    console.log(`Created first Super Admin "${username}".`);
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
