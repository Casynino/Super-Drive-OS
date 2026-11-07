import { redirect } from "next/navigation";
import ShopOverview from "../dashboard/ShopOverview";
import { can } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";

export const metadata = { title: "Today" };

// The shop attendant's overview of the day. The people who run the business have their own dashboard (Home).
export default async function OverviewPage() {
  const user = await requireUser();
  if (can(user, "dashboard.view")) redirect("/dashboard");
  return <ShopOverview user={user} />;
}
