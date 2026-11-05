import { cookies, headers } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "sdo_session";
const SESSION_MS = 12 * 60 * 60 * 1000; // one working day, then sign in again

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export type SessionUser = {
  id: string;
  username: string;
  name: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
  permissions: ReadonlySet<string>;
};

export async function getRequestMeta() {
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
    return { ipAddress: ip, userAgent: h.get("user-agent")?.slice(0, 255) ?? null };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}

/** Creates a DB-backed session and sets the cookie. The raw token only ever lives in the cookie. */
export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_MS);
  const meta = await getRequestMeta();

  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }); // housekeeping
  await db.session.create({
    data: { userId, tokenHash: sha256(token), expiresAt, userAgent: meta.userAgent, ipAddress: meta.ipAddress },
  });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

/** Current user with role + permissions, or null. Cached per request. Deactivated users are rejected immediately. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: {
        include: { role: { include: { permissions: { include: { permission: { select: { key: true } } } } } } },
      },
    },
  });
  if (!session || session.expiresAt <= new Date() || session.user.status !== "ACTIVE") return null;

  const { user } = session;
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    roleId: user.roleId,
    roleKey: user.role.key,
    roleName: user.role.name,
    isSuperAdmin: user.role.isSuperAdmin,
    mustChangePassword: user.mustChangePassword,
    permissions: new Set(user.role.permissions.map((rp) => rp.permission.key)),
  };
});
