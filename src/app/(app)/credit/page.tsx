import Link from "next/link";
import { HandCoins } from "lucide-react";
import { EmptyState, PageHeader, Stat } from "@/components/ui";
import { Prisma } from "@/generated/prisma/client";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { PaymentStatusBadge } from "../sales/StatusBadge";
import { getCurrency } from "@/lib/settings";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Credit management" };

const D = Prisma.Decimal;
const dec = (v: Prisma.Decimal | string | number | null | undefined) => new D((v ?? 0).toString());

export default async function CreditPage() {
  await requirePagePermission("credit.view");
  const currency = await getCurrency();
  const money = (v: Prisma.Decimal) => formatMoney(v, currency);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date());

  const [totals, aging, debtors, advance, recentCredit, recentCollections] = await Promise.all([
    db.$queryRaw<{ status: string; n: bigint; owed: Prisma.Decimal | string }[]>`
      SELECT "paymentStatus"::text AS status, COUNT(*) AS n, SUM("total" - "amountPaid") AS owed
        FROM "Sale" WHERE "status" = 'COMPLETED' AND "total" > "amountPaid" GROUP BY "paymentStatus"`,
    db.$queryRaw<{ bucket: string; n: bigint; owed: Prisma.Decimal | string }[]>`
      SELECT CASE
               WHEN "dueDate" IS NULL OR "dueDate" >= ${today}::date THEN 'current'
               WHEN ${today}::date - "dueDate" <= 30 THEN 'd1_30'
               WHEN ${today}::date - "dueDate" <= 60 THEN 'd31_60'
               WHEN ${today}::date - "dueDate" <= 90 THEN 'd61_90'
               ELSE 'd90_plus' END AS bucket,
             COUNT(*) AS n, SUM("total" - "amountPaid") AS owed
        FROM "Sale" WHERE "status" = 'COMPLETED' AND "total" > "amountPaid" GROUP BY 1`,
    db.$queryRaw<{ id: string; name: string; owed: Prisma.Decimal | string; overdue: Prisma.Decimal | string; invoices: bigint }[]>`
      SELECT c."id", c."name", SUM(s."total" - s."amountPaid") AS owed,
             SUM(CASE WHEN s."dueDate" < ${today}::date THEN s."total" - s."amountPaid" ELSE 0 END) AS overdue,
             COUNT(*) AS invoices
        FROM "Sale" s JOIN "Customer" c ON c."id" = s."customerId"
       WHERE s."status" = 'COMPLETED' AND s."total" > s."amountPaid"
       GROUP BY c."id", c."name" ORDER BY owed DESC LIMIT 8`,
    db.$queryRaw<{ s: Prisma.Decimal | string | null }[]>`
      SELECT COALESCE(SUM(p."amount" - COALESCE(a."s", 0)), 0) AS s
        FROM "Payment" p LEFT JOIN (SELECT "paymentId", SUM("amount") AS s FROM "PaymentAllocation" GROUP BY "paymentId") a ON a."paymentId" = p."id"
       WHERE p."customerId" IS NOT NULL`,
    db.sale.findMany({ where: { status: "COMPLETED", dueDate: { not: null } }, orderBy: { createdAt: "desc" }, take: 6, include: { customer: { select: { name: true } } } }),
    db.payment.findMany({ where: { source: "DEBT_COLLECTION" }, orderBy: { receivedAt: "desc" }, take: 6, include: { customer: { select: { name: true } } } }),
  ]);

  const byStatus = (s: string) => totals.find((t) => t.status === s);
  const totalOwed = totals.reduce((s, t) => s.plus(dec(t.owed)), new D(0));
  const bucket = (b: string) => aging.find((a) => a.bucket === b);
  const overdueOwed = ["d1_30", "d31_60", "d61_90", "d90_plus"].reduce((s, b) => s.plus(dec(bucket(b)?.owed)), new D(0));
  const overdueCount = ["d1_30", "d31_60", "d61_90", "d90_plus"].reduce((s, b) => s + Number(bucket(b)?.n ?? 0), 0);
  const advanceHeld = dec(advance[0]?.s);

  const agingRows: [string, string][] = [
    ["current", "Not yet due"],
    ["d1_30", "1–30 days overdue"],
    ["d31_60", "31–60 days overdue"],
    ["d61_90", "61–90 days overdue"],
    ["d90_plus", "Over 90 days overdue"],
  ];

  return (
    <>
      <PageHeader title="Credit management" description="What customers owe, who is overdue, and what has been collected." />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label="Total outstanding" value={money(totalOwed)} hint={`${Number(byStatus("UNPAID")?.n ?? 0) + Number(byStatus("PARTIALLY_PAID")?.n ?? 0)} open invoices`} />
        <Stat label="Overdue" value={money(overdueOwed)} hint={`${overdueCount} invoice${overdueCount === 1 ? "" : "s"} past due date`} />
        <Stat label="Unpaid invoices" value={money(dec(byStatus("UNPAID")?.owed))} hint={`${Number(byStatus("UNPAID")?.n ?? 0)} invoices, nothing paid`} />
        <Stat label="Part-paid invoices" value={money(dec(byStatus("PARTIALLY_PAID")?.owed))} hint={`${Number(byStatus("PARTIALLY_PAID")?.n ?? 0)} invoices, balance left`} />
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <section className="card overflow-hidden">
          <h2 className="border-b border-line px-5 py-3 text-base font-semibold text-slate-900">How overdue is the debt?</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {agingRows.map(([key, label]) => {
              const b = bucket(key);
              const owed = dec(b?.owed);
              const pct = totalOwed.gt(0) ? owed.div(totalOwed).mul(100).toNumber() : 0;
              return (
                <li key={key} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className={key === "current" ? "text-slate-700" : "font-medium text-slate-900"}>{label}</span>
                    <span className={`font-semibold ${key === "current" || owed.isZero() ? "text-slate-700" : "text-brand-red-dark"}`}>{money(owed)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${key === "current" ? "bg-navy-400" : "bg-brand-red"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
          {advanceHeld.gt(0) && <p className="border-t border-line bg-oil-soft px-5 py-2.5 text-xs text-yellow-900">Customers have also paid {money(advanceHeld)} in advance (not yet applied to invoices).</p>}
        </section>

        <section className="card overflow-hidden">
          <h2 className="border-b border-line px-5 py-3 text-base font-semibold text-slate-900">Who owes the most</h2>
          {debtors.length === 0 ? (
            <EmptyState icon={<HandCoins size={22} />} title="No customer owes anything" />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {debtors.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="min-w-0">
                    <Link href={`/customers/${d.id}`} className="block truncate font-medium text-navy-700 hover:underline">
                      {d.name}
                    </Link>
                    <span className="text-xs text-slate-500">
                      {Number(d.invoices)} invoice{Number(d.invoices) === 1 ? "" : "s"}
                      {dec(d.overdue).gt(0) && <span className="ml-1.5 font-medium text-brand-red-dark">· {money(dec(d.overdue))} overdue</span>}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold">{money(dec(d.owed))}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card overflow-hidden">
          <h2 className="border-b border-line px-5 py-3 text-base font-semibold text-slate-900">Recent credit sales</h2>
          {recentCredit.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">No credit sales yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {recentCredit.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="min-w-0">
                    <Link href={`/sales/${s.id}`} className="font-medium text-navy-700 hover:underline">
                      {s.saleNo}
                    </Link>
                    <span className="block truncate text-xs text-slate-500">
                      {s.customer?.name} · due {s.dueDate ? formatDate(s.dueDate) : "—"}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <PaymentStatusBadge status={s.paymentStatus} />
                    <span className="font-semibold">{money(s.total)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card overflow-hidden">
          <h2 className="border-b border-line px-5 py-3 text-base font-semibold text-slate-900">Recent debt collections</h2>
          {recentCollections.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">No payments collected on credit yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {recentCollections.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="min-w-0">
                    <Link href={`/payments/${p.id}`} className="font-medium text-navy-700 hover:underline">
                      {p.paymentNo}
                    </Link>
                    <span className="block truncate text-xs text-slate-500">{p.customer?.name}</span>
                  </span>
                  <span className="shrink-0 font-semibold text-emerald-700">{money(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
