"use server";

import { db } from "@/lib/db";
import { getRequestMeta, getSessionUser } from "./session";

/**
 * Called by the app whenever a signed-in person opens a page. It writes one activity row (who, which page, when, from where),
 * so the Admin can follow everything everyone does. Opening the same page again within 15 seconds is not counted twice.
 * Tracking can never break a page: any problem here is ignored.
 */
export async function trackPage(path: string, title: string): Promise<void> {
  try {
    const user = await getSessionUser();
    if (!user || typeof path !== "string") return;
    const clean = path.split("?")[0]!.slice(0, 300);
    if (!clean.startsWith("/") || clean.startsWith("//") || clean.startsWith("/audit")) return;
    const recent = await db.activityLog.findFirst({ where: { userId: user.id, path: clean, createdAt: { gt: new Date(Date.now() - 15_000) } }, select: { id: true } });
    if (recent) return;
    const meta = await getRequestMeta();
    await db.activityLog.create({
      data: { userId: user.id, userName: user.name, roleName: user.roleName, path: clean, title: String(title ?? "").slice(0, 120) || null, ipAddress: meta.ipAddress, userAgent: meta.userAgent },
    });
  } catch {
    /* never in the way of the page */
  }
}
