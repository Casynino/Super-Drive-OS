import { describe, expect, it } from "vitest";
import { can, canGrant } from "./auth/can";
import { SHOP_FLOOR_PERMISSIONS } from "./permissions";
import { DEFAULT_ROLES, PERMISSION_KEYS } from "./permissions";

describe("permission registry", () => {
  it("has unique keys", () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it("default roles only reference known permissions", () => {
    for (const role of DEFAULT_ROLES) {
      for (const p of role.permissions) expect(PERMISSION_KEYS).toContain(p);
    }
  });

  it("restricted roles do not get sensitive permissions by default", () => {
    const sales = DEFAULT_ROLES.find((r) => r.key === "SALESPERSON")!.permissions;
    // The shop attendant runs the shop but never sees costs, profit, valuation or business-wide finances,
    // and can neither approve things nor manage people and settings.
    for (const forbidden of [
      "inventory.adjust", "products.cost", "products.price", "inventory.valuation", "reports.financial", "dashboard.financials", "finance.view",
      "returns.approve", "shipments.manage", "credit.approve_exception", "credit.set_limit", "sales.view_all", "audit.view", "employees.manage", "roles.manage", "settings.manage", "suppliers.pay",
    ]) {
      expect(sales).not.toContain(forbidden);
    }
    for (const needed of ["sales.pos", "payments.record", "expenses.create", "closing.submit", "returns.create"]) expect(sales).toContain(needed);
    // receiving goods is the warehouse attendant's job, never the shop attendant's
    for (const forbidden of ["shipments.receive", "inventory.receive", "warehouse.operate"]) expect(sales).not.toContain(forbidden);
    const warehouse = DEFAULT_ROLES.find((r) => r.key === "WAREHOUSE")!.permissions;
    for (const forbidden of ["sales.pos", "products.price", "products.cost", "inventory.valuation", "payments.record", "inventory.adjust", "dashboard.financials", "reports.financial"]) {
      expect(warehouse).not.toContain(forbidden);
    }
    for (const needed of ["shipments.receive", "warehouse.operate"]) expect(warehouse).toContain(needed);
  });

  it("there are exactly three positions: owner, warehouse and shop attendant", () => {
    expect(DEFAULT_ROLES.map((r) => r.key).sort()).toEqual(["SALESPERSON", "SUPER_ADMIN", "WAREHOUSE"]);
  });
});

describe("can()", () => {
  it("super admin has every management permission", () => {
    const owner = { isSuperAdmin: true, permissions: new Set<string>() };
    for (const key of ["audit.view", "roles.manage", "products.price", "returns.approve", "employees.manage", "inventory.adjust", "dashboard.financials"] as const) expect(can(owner, key)).toBe(true);
  });

  it("the owner does NOT get the shop attendant's jobs unless explicitly granted", () => {
    const owner = { isSuperAdmin: true, permissions: new Set<string>() };
    for (const key of SHOP_FLOOR_PERMISSIONS) expect(can(owner, key as never)).toBe(false);
    expect(can({ isSuperAdmin: true, permissions: new Set(["sales.pos"]) }, "sales.pos")).toBe(true);
    // ...but he can still hand those permissions to staff
    expect(canGrant(owner, "sales.pos")).toBe(true);
    expect(canGrant({ isSuperAdmin: false, permissions: new Set() }, "sales.pos")).toBe(false);
  });
  it("others need the exact permission", () => {
    const u = { isSuperAdmin: false, permissions: new Set(["products.view"]) };
    expect(can(u, "products.view")).toBe(true);
    expect(can(u, "products.edit")).toBe(false);
  });
});
