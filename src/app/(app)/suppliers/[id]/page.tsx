import { notFound } from "next/navigation";
import { Alert, PageHeader, StatusBadge } from "@/components/ui";
import EntityForm from "@/components/EntityForm";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { saveSupplier } from "../actions";

export const metadata = { title: "Supplier" };

export default async function SupplierPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  await requirePagePermission("suppliers.manage");
  const { id } = await params;
  const sp = await searchParams;
  const s = await db.supplier.findUnique({ where: { id } });
  if (!s) notFound();

  return (
    <>
      <PageHeader title={s.name} back={{ href: "/suppliers", label: "Suppliers" }} actions={<StatusBadge status={s.status} />} />
      {sp.created && (
        <div className="mb-4">
          <Alert kind="success">Supplier created.</Alert>
        </div>
      )}
      <div className="card card-pad max-w-2xl">
        <EntityForm
          action={saveSupplier}
          submitLabel="Save changes"
          hidden={{ id: s.id }}
          fields={[
            { name: "name", label: "Supplier / business name", value: s.name, required: true, span: 2 },
            { name: "contactPerson", label: "Contact person", value: s.contactPerson ?? "" },
            { name: "phone", label: "Phone", value: s.phone ?? "" },
            { name: "email", label: "Email", type: "email", value: s.email ?? "" },
            { name: "address", label: "Address", value: s.address ?? "" },
            {
              name: "status",
              label: "Status",
              type: "select",
              value: s.status,
              options: [
                { value: "ACTIVE", label: "Active" },
                { value: "INACTIVE", label: "Inactive (hidden when receiving stock)" },
              ],
            },
            { name: "notes", label: "Notes", type: "textarea", value: s.notes ?? "", span: 2 },
          ]}
        />
      </div>
    </>
  );
}
