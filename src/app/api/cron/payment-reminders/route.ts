import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { runPaymentReminders } from "@/lib/credit/auto-reminders";

// Called by the scheduler (Vercel Cron, or any service that can send a GET with a bearer token).
// Safe to call as often as you like: a customer is messaged at most once a day, and only when the owner has switched
// automatic reminders on and the WhatsApp Business keys are set.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorised(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const given = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  return given.length === want.length && timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

export async function GET(req: Request) {
  if (!authorised(req)) return new Response("Unauthorized", { status: 401 });
  const result = await runPaymentReminders(db, { trigger: "SCHEDULED" });
  return Response.json(result);
}
