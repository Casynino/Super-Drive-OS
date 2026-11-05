import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { Alert, PageHeader } from "@/components/ui";
import CollectPaymentForm, { type OpenInvoice } from "@/components/pos/CollectPaymentForm";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { customerCredit } from "@/lib/sales/collections";
import { getCurrency } from "@/lib/settings";
import { formatDate } from "@/lib/utils";
import { applyCustomerCredit, recordCollection } from "../../../payments/actions";

export const metadata = { title: "Record payment" };

export default async function CustomerPayPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("payments.record");
  const { id } = await params;
  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) notFound();
  const [currency, credit, sales] = await Promise.all([
    getCurrency(),
    customerCredit(db, id),
    db.sale.findMany({ where: { customerId: id, status: "COMPLETED", paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
  ]);

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date());
  const invoices: OpenInvoice[] = sales.map((s) => ({
    id: s.id,
    saleNo: s.saleNo,
    date: formatDate(s.createdAt),
    dueDate: s.dueDate ? formatDate(s.dueDate) : null,
    total: s.total.toString(),
    owed: s.total.minus(s.amountPaid).toString(),
    overdue: Boolean(s.dueDate && s.dueDate.toISOString().slice(0, 10) < today),
  }));
  const owedTotal = sales.reduce((s, x) => s + Number(x.total.minus(x.amountPaid)), 0);
  const cur = { symbol: currency.symbol, decimals: currency.decimals };
  const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: currency.decimals });

  return (
    <>
      <PageHeader title="Record payment" description={`${customer.name}${customer.phone ? ` · ${customer.phone}` : ""}`} back={{ href: `/customers/${id}`, label: customer.name }} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <div className="card card-pad">
          <p className="text-[13px] font-medium text-slate-500">Currently owes</p>
          <p className="mt-1 text-2xl font-semibold text-brand-red-dark">
            {currency.symbol}&nbsp;{nf.format(owedTotal)}
          </p>
        </div>
        <div className="card card-pad">
          <p className="text-[13px] font-medium text-slate-500">Customer credit (paid in advance)</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">
            {currency.symbol}&nbsp;{nf.format(Number(credit))}
          </p>
        </div>
      </div>

      <div className="space-y-8">
        <CollectPaymentForm mode="collect" action={recordCollection} customerId={id} invoices={invoices} creditAvailable={0} submissionKey={randomUUID()} currency={cur} cancelHref={`/customers/${id}`} />

        {credit.gt(0) && invoices.length > 0 && (
          <section>
            <h2 className="mb-1 text-lg font-semibold text-slate-900">Use the customer’s credit</h2>
            <div className="mb-3">
              <Alert kind="info">No new money is received here. The customer’s advance payment is used to pay these invoices.</Alert>
            </div>
            <CollectPaymentForm mode="credit" action={applyCustomerCredit} customerId={id} invoices={invoices} creditAvailable={Number(credit)} submissionKey={randomUUID()} currency={cur} cancelHref={`/customers/${id}`} />
          </section>
        )}
      </div>
    </>
  );
}
