import { redirect } from "next/navigation";

/** There is nothing to approve any more: returns are decided on the sale, expenses are paid at once, a day's count is signed off on its End of day page. */
export default function ApprovalsPage() {
  redirect("/dashboard");
}
