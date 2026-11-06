import { PageHeader } from "@/components/ui";
import EntityForm from "@/components/EntityForm";
import { requirePagePermission } from "@/lib/auth/guard";
import { createResellerAction } from "../actions";

export const metadata = { title: "Register winga" };

const resellerFields = (v: Record<string, string> = {}) => [
  { name: "name", label: "Full name", value: v.name ?? "", required: true },
  { name: "businessName", label: "Business name (optional)", value: v.businessName ?? "" },
  { name: "phone", label: "Phone number", value: v.phone ?? "", required: true },
  { name: "altPhone", label: "Alternative phone (optional)", value: v.altPhone ?? "" },
  { name: "salesLocation", label: "Where they sell", value: v.salesLocation ?? "", placeholder: "e.g. Mwenge market" },
  { name: "address", label: "Address (optional)", value: v.address ?? "" },
  { name: "idInfo", label: "ID / licence number (optional)", value: v.idInfo ?? "" },
  { name: "settlementDays", label: "Days to pay after reporting a sale", value: v.settlementDays ?? "14", hint: "After this many days, what they owe counts as overdue." },
  { name: "notes", label: "Notes (optional)", type: "textarea" as const, value: v.notes ?? "", span: 2 as const },
];

export default async function NewResellerPage() {
  await requirePagePermission("resellers.manage");
  return (
    <>
      <PageHeader title="Register a winga" back={{ href: "/resellers", label: "Winga" }} description="A winga takes stock to sell elsewhere and brings the money back later. Registering also opens their account." />
      <div className="card card-pad max-w-3xl">
        <EntityForm action={createResellerAction} submitLabel="Register reseller" fields={resellerFields()} />
      </div>
    </>
  );
}
