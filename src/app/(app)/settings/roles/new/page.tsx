import { PageHeader } from "@/components/ui";
import EntityForm from "@/components/EntityForm";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { createRole } from "../actions";

export const metadata = { title: "Add a position" };

export default async function NewRolePage() {
  await requirePagePermission("roles.manage");
  const roles = await db.role.findMany({ where: { isSuperAdmin: false }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <>
      <PageHeader title="Add a position" description="For example Driver, Sales rep or Cashier. You choose what it can do on the next page." back={{ href: "/settings/roles", label: "Positions" }} />
      <div className="card card-pad max-w-2xl">
        <EntityForm
          action={createRole}
          submitLabel="Create the position"
          fields={[
            { name: "name", label: "Name of the position", required: true, hint: "For example Delivery driver." },
            { name: "description", label: "What this person does", type: "textarea", span: 2, hint: "Optional. One line is enough." },
            { name: "copyFrom", label: "Start from", type: "select", options: [{ value: "", label: "Nothing allowed yet" }, ...roles.map((r) => ({ value: r.id, label: `Same as ${r.name}` }))], hint: "Copies what that position can do. You can change every tick afterwards." },
          ]}
        />
      </div>
    </>
  );
}
