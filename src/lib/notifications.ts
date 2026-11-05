import type { Tx } from "@/lib/inventory/engine";
import type { PermissionKey } from "@/lib/permissions";

export type NotificationInput = { type: string; title: string; body?: string; link?: string };

/** Tells one person (shows in their bell). Call inside the same transaction as the event. */
export async function notifyUser(tx: Pick<Tx, "notification">, userId: string, n: NotificationInput) {
  await tx.notification.create({ data: { userId, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null } });
}

/** Tells everyone who holds a permission (Super Admins always count). */
export async function notifyPermission(tx: Pick<Tx, "notification" | "user">, key: PermissionKey, n: NotificationInput, exceptUserId?: string) {
  const people = await tx.user.findMany({
    where: {
      status: "ACTIVE",
      ...(exceptUserId ? { id: { not: exceptUserId } } : {}),
      role: { OR: [{ isSuperAdmin: true }, { permissions: { some: { permission: { key } } } }] },
    },
    select: { id: true },
  });
  if (people.length) await tx.notification.createMany({ data: people.map((p) => ({ userId: p.id, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null })) });
}
