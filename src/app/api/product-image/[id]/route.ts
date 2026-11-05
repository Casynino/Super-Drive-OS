import { createHash } from "node:crypto";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

// Product pictures, for signed-in staff only. The page adds ?v=<version> so browsers can cache them for a year.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getSessionUser())) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const size = new URL(req.url).searchParams.get("size") === "full" ? "full" : "thumb";

  const meta = await db.productImage.findUnique({ where: { productId: id }, select: { mime: true, updatedAt: true } });
  if (!meta) return new Response("Not found", { status: 404 });

  const etag = `"${createHash("sha1").update(`${id}:${size}:${meta.updatedAt.getTime()}`).digest("hex")}"`;
  const headers = { ETag: etag, "Cache-Control": "private, max-age=31536000, immutable", "Content-Type": meta.mime, "X-Content-Type-Options": "nosniff" };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });

  const row = size === "full"
    ? await db.productImage.findUnique({ where: { productId: id }, select: { full: true } })
    : await db.productImage.findUnique({ where: { productId: id }, select: { thumb: true } });
  const bytes = row && ("full" in row ? row.full : row.thumb);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), { headers });
}
