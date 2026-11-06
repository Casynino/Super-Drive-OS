import { PageHeader } from "@/components/ui";
import WarehouseScanner from "@/components/warehouse/WarehouseScanner";
import { requirePagePermission } from "@/lib/auth/guard";

export const metadata = { title: "Scanner" };

/** Scan the QR code on a pickup note. The server checks it and opens the note with exactly what to hand over. */
export default async function ScanPage() {
  await requirePagePermission("warehouse.operate");
  return (
    <>
      <PageHeader title="Scanner" description="Scan the QR code on the pickup note the person brings." />
      <WarehouseScanner />
    </>
  );
}
