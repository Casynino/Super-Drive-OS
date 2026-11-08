import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

// Staff sign in with their email (Nino 2026-11-08): the database itself must keep every email present, lowercase and unique.
let roleId: string;
beforeAll(async () => {
  roleId = (await db.role.create({ data: { key: `ACC_${randomUUID()}`, name: "Accounts test role" } })).id;
});

const insert = (email: string | null, username = `u_${randomUUID()}`) =>
  db.$executeRaw`INSERT INTO "User" (id, username, email, name, "passwordHash", "roleId", "updatedAt") VALUES (${randomUUID()}, ${username}, ${email}, 'Test', 'x', ${roleId}, now())`;

describe("employee accounts", () => {
  it("cannot exist without an email address", async () => {
    await expect(insert(null)).rejects.toThrow();
  });

  it("only keeps lowercase emails, so a person cannot get two accounts that differ by capital letters", async () => {
    const email = `Mixed.Case_${randomUUID()}@Example.com`;
    await expect(insert(email)).rejects.toThrow();
    await insert(email.toLowerCase());
  });

  it("refuses a second account with the same email", async () => {
    const email = `same_${randomUUID()}@example.com`;
    await insert(email);
    await expect(insert(email)).rejects.toThrow();
  });

  it("is found by email, which is what the sign-in uses", async () => {
    const email = `find_${randomUUID()}@example.com`;
    await insert(email);
    const user = await db.user.findUnique({ where: { email } });
    expect(user?.email).toBe(email);
    expect(await db.user.findUnique({ where: { email: `nobody_${randomUUID()}@example.com` } })).toBeNull();
  });
});
