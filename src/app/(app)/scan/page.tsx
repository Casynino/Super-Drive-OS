import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import ScanScreen from "@/components/scan/ScanScreen";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";

export const metadata = { title: "Scan" };

export default async function ScanPage() {
  const user = await requireUser();
  if (!canAny(user, ["inventory.view", "sales.pos"])) redirect("/forbidden");
  return (
    <>
      <PageHeader title="Scan" description="Scan the QR code on a piece, or a product barcode, to see what it is and whether it has been sold." />
      <ScanScreen canSell={can(user, "sales.pos")} />
    </>
  );
}
