import { redirect } from "next/navigation";
import OwnerHome from "./OwnerHome";
import ShopOverview from "./ShopOverview";
import { can } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
  // The people who run the business see the management dashboard.
  if (can(user, "dashboard.view")) return <OwnerHome user={user} />;
  // The shop attendant's home is the POS: signing in starts selling (the overview of the day is its own page in the menu).
  if (can(user, "sales.pos")) redirect("/pos");
  // The warehouse attendant has his own home: the warehouse
  if (can(user, "warehouse.operate")) redirect("/warehouse");
  return <ShopOverview user={user} />;
}
