import { PageHeader } from "@/components/ui";
import EntityForm from "@/components/EntityForm";
import { requirePagePermission } from "@/lib/auth/guard";
import { saveSupplier } from "../actions";

export const metadata = { title: "Add supplier" };

export default async function NewSupplierPage() {
  await requirePagePermission("suppliers.manage");
  return (
    <>
      <PageHeader title="Add supplier" back={{ href: "/suppliers", label: "Suppliers" }} />
      <div className="card card-pad max-w-2xl">
        <EntityForm
          action={saveSupplier}
          submitLabel="Create supplier"
          fields={[
            { name: "name", label: "Supplier / business name", required: true, span: 2 },
            { name: "contactPerson", label: "Contact person" },
            { name: "phone", label: "Phone" },
            { name: "email", label: "Email", type: "email" },
            { name: "address", label: "Address" },
            { name: "notes", label: "Notes", type: "textarea", span: 2 },
          ]}
        />
      </div>
    </>
  );
}
