import { can, canAny } from "@/lib/auth/can";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

// Receipts and deposit slips, for signed-in staff who may see the record they belong to.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const att = await db.attachment.findUnique({ where: { id }, select: { mime: true, data: true } });
  if (!att) return new Response("Not found", { status: 404 });

  let allowed = canAny(user, ["expenses.view", "expenses.approve", "cash.view", "closing.approve"]) || can(user, "settings.manage");
  if (!allowed) {
    // Everyone else only sees the receipts and slips they recorded themselves
    const own = await db.attachment.findFirst({ where: { id, OR: [{ expenses: { some: { requestedById: user.id } } }, { deposits: { some: { createdById: user.id } } }] }, select: { id: true } });
    allowed = !!own;
  }
  if (!allowed) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(att.data), { headers: { "Content-Type": att.mime, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
}
