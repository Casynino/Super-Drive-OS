import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, DetailGrid, PageHeader, StatusBadge } from "@/components/ui";
import EntityForm from "@/components/EntityForm";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { customerOutstanding } from "@/lib/sales/outstanding";
import { getCurrency } from "@/lib/settings";
import { formatDate } from "@/lib/utils";
import { saveCustomer } from "../actions";
import { CUSTOMER_TYPES } from "../types";

export const metadata = { title: "Customer" };

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
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

  return (
    <>
      <PageHeader title={c.name} description={`Customer since ${formatDate(c.createdAt)}`} back={{ href: "/customers", label: "Customers" }} actions={<StatusBadge status={c.status} />} />
      {sp.created && (
        <div className="mb-4">
          <Alert kind="success">Customer created.</Alert>
        </div>
      )}

      {showCredit && (
        <div className="card card-pad mb-5">
          <DetailGrid
            items={[
              { label: "Credit limit", value: c.creditLimit.gt(0) ? formatMoney(c.creditLimit, currency) : "No credit allowed" },
              { label: "Currently owes", value: <span className={owes?.gt(0) ? "font-semibold text-brand-red-dark" : ""}>{formatMoney(owes ?? 0, currency)}</span> },
              { label: "Available credit", value: c.creditLimit.gt(0) ? formatMoney(c.creditLimit.minus(owes ?? 0).clampedTo(0, c.creditLimit), currency) : "—" },
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
