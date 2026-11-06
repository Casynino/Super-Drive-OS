import { redirect } from "next/navigation";

// Positions and their permissions now live on the Employees page: one place, not two.
export default function RolesPage() {
  redirect("/employees");
}
