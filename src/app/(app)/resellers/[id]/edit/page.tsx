import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import EntityForm from "@/components/EntityForm";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { updateResellerAction } from "../../actions";

export const metadata = { title: "Edit winga" };

export default async function EditResellerPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("resellers.manage");
  const { id } = await params;
  const r = await db.reseller.findUnique({ where: { id } });
  if (!r) notFound();
  const v: Record<string, string> = { name: r.name, businessName: r.businessName ?? "", phone: r.phone, altPhone: r.altPhone ?? "", salesLocation: r.salesLocation ?? "", address: r.address ?? "", idInfo: r.idInfo ?? "", settlementDays: String(r.settlementDays), notes: r.notes ?? "" };
  const fields = [
    { name: "name", label: "Full name", value: v.name, required: true },
    { name: "businessName", label: "Business name (optional)", value: v.businessName },
    { name: "phone", label: "Phone number", value: v.phone, required: true },
    { name: "altPhone", label: "Alternative phone (optional)", value: v.altPhone },
    { name: "salesLocation", label: "Where they sell", value: v.salesLocation },
    { name: "address", label: "Address (optional)", value: v.address },
    { name: "idInfo", label: "ID / licence number (optional)", value: v.idInfo },
    { name: "settlementDays", label: "Days to pay after reporting a sale", value: v.settlementDays },
    { name: "notes", label: "Notes (optional)", type: "textarea" as const, value: v.notes, span: 2 as const },
  ];
  return (
    <>
      <PageHeader title={`Edit ${r.name}`} back={{ href: `/resellers/${r.id}`, label: r.name }} />
      <div className="card card-pad max-w-3xl">
        <EntityForm action={updateResellerAction} submitLabel="Save changes" hidden={{ id: r.id }} fields={fields} />
      </div>
    </>
  );
}
