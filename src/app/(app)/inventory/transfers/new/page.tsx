import Link from "next/link";
import { randomUUID } from "node:crypto";
import { EmptyState, PageHeader } from "@/components/ui";
import StockDocumentForm from "@/components/inventory/StockDocumentForm";
import { requirePagePermission } from "@/lib/auth/guard";
import { getCurrency } from "@/lib/settings";
import { createTransfer } from "../../actions";
import { getActiveLocations, getPickerProducts, getStockByLocation } from "../../data";

export const metadata = { title: "New transfer" };

export default async function NewTransferPage() {
  await requirePagePermission("inventory.transfer");
  const [products, locations, stockByLocation, currency] = await Promise.all([getPickerProducts(), getActiveLocations(), getStockByLocation(), getCurrency()]);

  return (
    <>
      <PageHeader title="New stock transfer" back={{ href: "/inventory/transfers", label: "Stock transfers" }} />
      {locations.length < 2 ? (
        <div className="card">
          <EmptyState
            title="You need at least two locations"
            description="Transfers move stock between locations. Add another location (for example a shop) in Settings."
            action={
              <Link href="/settings" className="btn-primary">
                Open settings
              </Link>
            }
          />
        </div>
      ) : (
        <StockDocumentForm
          variant="transfer"
          action={createTransfer}
          products={products}
          locations={locations}
          stockByLocation={stockByLocation}
          submissionKey={randomUUID()}
          cancelHref="/inventory/transfers"
          currencySymbol={currency.symbol}
        />
      )}
    </>
  );
}
