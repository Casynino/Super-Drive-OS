import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, DetailGrid, PageHeader, StatusBadge } from "@/components/ui";
import EntityForm from "@/components/EntityForm";
import { Prisma } from "@/generated/prisma/client";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { customerCredit } from "@/lib/sales/collections";
import { customerOutstanding } from "@/lib/sales/outstanding";
import { PaymentStatusBadge } from "../../sales/StatusBadge";
import { getCurrency } from "@/lib/settings";
import { formatDate, formatDateTime } from "@/lib/utils";
import { saveCustomer } from "../actions";
import { CUSTOMER_TYPES } from "../types";

export const metadata = { title: "Customer" };

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; creditApplied?: string }> }) {
  const user = await requirePagePermission("customers.view");
  const { id } = await params;
  const sp = await searchParams;
  const c = await db.customer.findUnique({ where: { id } });
  if (!c) notFound();
  const currency = await getCurrency();
  const canEdit = can(user, "customers.edit");
  const canLimit = can(user, "credit.set_limit");
  const showCredit = can(user, "credit.view");
  const owes = showCredit ? await customerOutstanding(db, c.id) : null;
  const salesCount = can(user, "sales.view_all") ? await db.sale.count({ where: { customerId: c.id } }) : null;
  const advance = showCredit ? await customerCredit(db, c.id) : null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date());
  const [openInvoices, recentPayments] = showCredit
    ? await Promise.all([
        db.sale.findMany({ where: { customerId: c.id, status: "COMPLETED", paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
        db.payment.findMany({ where: { customerId: c.id, source: "DEBT_COLLECTION" }, orderBy: { receivedAt: "desc" }, take: 8 }),
      ])
    : [[], []];
  const isOverdue = (due: Date | null) => Boolean(due && due.toISOString().slice(0, 10) < today);
  const overdueAmount = openInvoices.filter((i) => isOverdue(i.dueDate)).reduce((s, i) => s.plus(i.total).minus(i.amountPaid), new Prisma.Decimal(0));

  return (
    <>
      <PageHeader title={c.name} description={`Customer since ${formatDate(c.createdAt)}`} back={{ href: "/customers", label: "Customers" }} actions={
          <>
            <StatusBadge status={c.status} />
            {showCredit && (
              <Link href={`/customers/${c.id}/statement`} className="btn-secondary">
                Statement
              </Link>
            )}
            {can(user, "payments.record") && (
              <Link href={`/customers/${c.id}/pay`} className="btn-primary">
                Record payment
              </Link>
            )}
          </>
        }
      />
      {sp.created && (
        <div className="mb-4">
          <Alert kind="success">Customer created.</Alert>
        </div>
      )}
      {sp.creditApplied && (
        <div className="mb-4">
          <Alert kind="success">The customer’s credit was applied to the selected invoices.</Alert>
        </div>
      )}

      {showCredit && (
        <>
          <div className="card card-pad mb-5">
            <DetailGrid
              items={[
                { label: "Credit limit", value: c.creditLimit.gt(0) ? formatMoney(c.creditLimit, currency) : "No credit allowed" },
                { label: "Currently owes", value: <span className={owes?.gt(0) ? "font-semibold text-brand-red-dark" : ""}>{formatMoney(owes ?? 0, currency)}</span> },
                { label: "Overdue", value: <span className={overdueAmount.gt(0) ? "font-semibold text-brand-red-dark" : ""}>{formatMoney(overdueAmount, currency)}</span> },
                { label: "Available credit", value: c.creditLimit.gt(0) ? formatMoney(Prisma.Decimal.max(c.creditLimit.minus(owes ?? 0), 0), currency) : "—" },
                { label: "Paid in advance", value: advance?.gt(0) ? formatMoney(advance, currency) : "—" },
                {
                  label: "Sales",
                  value:
                    salesCount !== null ? (
                      <Link href={`/sales?customer=${c.id}`} className="text-navy-700 hover:underline">
                        {salesCount} {salesCount === 1 ? "sale" : "sales"}
                      </Link>
                    ) : null,
                },
              ]}
            />
          </div>

          <section className="card mb-5 overflow-hidden">
            <h2 className="border-b border-line px-5 py-3 text-base font-semibold text-slate-900">Unpaid invoices</h2>
            {openInvoices.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">Nothing owed. All invoices are paid.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th className="hidden sm:table-cell">Date</th>
                      <th>Due</th>
                      <th className="hidden text-right md:table-cell">Total</th>
                      <th className="text-right">Owed</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openInvoices.map((i) => (
                      <tr key={i.id}>
                        <td>
                          <Link href={`/sales/${i.id}`} className="font-medium text-navy-700 hover:underline">
                            {i.saleNo}
                          </Link>
                        </td>
                        <td className="hidden text-slate-600 sm:table-cell">{formatDate(i.createdAt)}</td>
                        <td className={isOverdue(i.dueDate) ? "font-medium text-brand-red-dark" : "text-slate-600"}>
                          {i.dueDate ? formatDate(i.dueDate) : "—"}
                          {isOverdue(i.dueDate) && <span className="badge-red ml-2">Overdue</span>}
                        </td>
                        <td className="hidden text-right md:table-cell">{formatMoney(i.total, currency)}</td>
                        <td className="text-right font-semibold">{formatMoney(i.total.minus(i.amountPaid), currency)}</td>
                        <td>
                          <PaymentStatusBadge status={i.paymentStatus} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {recentPayments.length > 0 && (
            <section className="card mb-5 overflow-hidden">
              <h2 className="border-b border-line px-5 py-3 text-base font-semibold text-slate-900">Recent payments received</h2>
              <ul className="divide-y divide-slate-100 text-sm">
                {recentPayments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <span>
                      <Link href={`/payments/${p.id}`} className="font-medium text-navy-700 hover:underline">
                        {p.paymentNo}
                      </Link>
                      <span className="ml-2 text-xs text-slate-500">{formatDateTime(p.receivedAt)}</span>
                    </span>
                    <span className="font-semibold text-emerald-700">{formatMoney(p.amount, currency)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <div className="card card-pad max-w-2xl">
        <EntityForm
          action={saveCustomer}
          submitLabel="Save changes"
          hidden={{ id: c.id }}
          disabled={!canEdit}
          fields={[
            { name: "name", label: "Customer / business name", value: c.name, required: true, span: 2 },
            { name: "contactPerson", label: "Contact person", value: c.contactPerson ?? "" },
            { name: "phone", label: "Phone number", value: c.phone ?? "" },
            { name: "type", label: "Customer type", type: "select", value: c.type, options: CUSTOMER_TYPES.map((t) => ({ value: t.value, label: t.label })) },
            { name: "businessLocation", label: "Business location", value: c.businessLocation ?? "" },
            ...(canLimit ? [{ name: "creditLimit", label: "Credit limit", value: c.creditLimit.toString(), hint: "0 means no credit." }] : []),
            ...(can(user, "customers.deactivate")
              ? [{ name: "status", label: "Status", type: "select" as const, value: c.status, options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive (cannot buy)" }] }]
              : []),
            { name: "notes", label: "Notes", type: "textarea" as const, value: c.notes ?? "", span: 2 },
          ]}
        />
      </div>
    </>
  );
}
