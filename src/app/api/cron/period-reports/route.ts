import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { runPeriodReport } from "@/lib/reports/whatsapp";

// The weekly report (Sunday 09:00 Tanzania time) and the monthly report (the 1st at 09:00) on WhatsApp, started by the scheduler:
//   /api/cron/period-reports?kind=weekly   and   /api/cron/period-reports?kind=monthly
// Safe to call as often as you like: a report that was already sent is never sent again.
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
  const kind = new URL(req.url).searchParams.get("kind");
  if (kind !== "weekly" && kind !== "monthly") return new Response("kind must be weekly or monthly", { status: 400 });
  const result = await runPeriodReport(db, { kind: kind === "weekly" ? "WEEKLY" : "MONTHLY", trigger: "SCHEDULED" });
  return Response.json(result);
}
