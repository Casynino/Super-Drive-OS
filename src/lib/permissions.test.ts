import { describe, expect, it } from "vitest";
import { can } from "./auth/can";
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
    for (const forbidden of ["inventory.adjust", "products.cost", "products.price", "reports.financial", "sales.cancel", "payments.record"]) {
      expect(sales).not.toContain(forbidden);
    }
    const keeper = DEFAULT_ROLES.find((r) => r.key === "STOREKEEPER")!.permissions;
    for (const forbidden of ["sales.pos", "products.price", "payments.record", "inventory.adjust"]) {
      expect(keeper).not.toContain(forbidden);
    }
  });
});

describe("can()", () => {
  it("super admin always passes", () => {
    expect(can({ isSuperAdmin: true, permissions: new Set() }, "audit.view")).toBe(true);
  });
  it("others need the exact permission", () => {
    const u = { isSuperAdmin: false, permissions: new Set(["products.view"]) };
    expect(can(u, "products.view")).toBe(true);
    expect(can(u, "products.edit")).toBe(false);
  });
});
