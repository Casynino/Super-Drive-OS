import { PageHeader } from "@/components/ui";
import EntityForm from "@/components/EntityForm";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { saveCustomer } from "../actions";
import { CUSTOMER_TYPES } from "../types";

export const metadata = { title: "Add customer" };

export default async function NewCustomerPage() {
  const user = await requirePagePermission("customers.create");
  return (
    <>
      <PageHeader title="Add customer" back={{ href: "/customers", label: "Customers" }} />
      <div className="card card-pad max-w-2xl">
        <EntityForm
          action={saveCustomer}
          submitLabel="Create customer"
          fields={[
            { name: "name", label: "Customer / business name", required: true, span: 2 },
            { name: "contactPerson", label: "Contact person" },
            { name: "phone", label: "Phone number" },
            { name: "type", label: "Customer type", type: "select", value: "RETAIL", options: CUSTOMER_TYPES.map((t) => ({ value: t.value, label: t.label })), hint: "Wholesale and distributor customers get wholesale prices." },
            { name: "businessLocation", label: "Place (where they live or work)" },
            { name: "idNumber", label: "ID number", hint: "Needed before they can take goods on credit." },
            ...(can(user, "credit.set_limit")
              ? [{ name: "creditLimit", label: "Credit limit", value: "0", hint: "0 means this customer cannot buy on credit." }]
              : []),
            { name: "notes", label: "Notes", type: "textarea" as const, span: 2 },
          ]}
        />
      </div>
    </>
  );
}
