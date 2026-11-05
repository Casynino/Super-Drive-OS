import { PageHeader } from "@/components/ui";
import EntityForm from "@/components/EntityForm";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { createEmployee } from "../actions";

export const metadata = { title: "Add employee" };

export default async function NewEmployeePage() {
  const user = await requirePagePermission("employees.manage");
  const roles = await db.role.findMany({
    where: user.isSuperAdmin ? {} : { isSuperAdmin: false },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <>
      <PageHeader title="Add employee" back={{ href: "/employees", label: "Employees" }} />
      <div className="card card-pad max-w-2xl">
        <EntityForm
          action={createEmployee}
          submitLabel="Create employee"
          fields={[
            { name: "name", label: "Full name", required: true },
            { name: "username", label: "Username", required: true, hint: "Used to sign in. Lowercase, no spaces.", autoComplete: "off" },
            { name: "email", label: "Email", type: "email", hint: "Optional." },
            { name: "phone", label: "Phone", hint: "Optional." },
            {
              name: "roleId",
              label: "Role",
              type: "select",
              required: true,
              options: [{ value: "", label: "Choose role…" }, ...roles.map((r) => ({ value: r.id, label: r.name }))],
            },
            { name: "password", label: "Temporary password", type: "password", required: true, hint: "At least 8 characters with a letter and a number. They must change it at first sign-in.", autoComplete: "new-password" },
          ]}
        />
      </div>
    </>
  );
}
