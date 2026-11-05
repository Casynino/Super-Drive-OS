import { Prisma } from "@/generated/prisma/client";
import { getRequestMeta } from "@/lib/auth/session";

type AuditClient = { auditLog: Prisma.TransactionClient["auditLog"] };

export type AuditEntry = {
  user?: { id: string; name: string } | null;
  action: string; // e.g. "product.update"
  entityType: string; // e.g. "Product"
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  reference?: string | null;
};

/** Converts Decimals/Dates etc. to plain JSON; undefined/null → column stays NULL. */
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Write an audit row. Pass the transaction client (`tx`) so the audit entry commits or rolls back
 * together with the change it describes.
 */
export async function writeAudit(client: AuditClient, entry: AuditEntry) {
  const meta = await getRequestMeta();
  await client.auditLog.create({
    data: {
      userId: entry.user?.id ?? null,
      userName: entry.user?.name ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: toJson(entry.before),
      after: toJson(entry.after),
      reason: entry.reason ?? null,
      reference: entry.reference ?? null,
      ipAddress: meta.ipAddress,
    },
  });
}

/** Shallow diff helper: returns only the fields that changed, as {before, after}. */
export function diffFields<T extends Record<string, unknown>>(before: T, after: T) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}
