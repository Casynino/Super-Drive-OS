import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { EmptyState, PageHeader } from "@/components/ui";
import StockDocumentForm from "@/components/inventory/StockDocumentForm";
import { can } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { getCurrency } from "@/lib/settings";
import { createAdjustment } from "../../actions";
import { getActiveLocations, getPickerProducts, getStockByLocation } from "../../data";

export const metadata = { title: "New adjustment" };

export default async function NewAdjustmentPage() {
  const user = await requireUser();
  // Only offer the kinds this person is allowed to record (the server checks again on submit).
  const allowedKinds = [
    can(user, "inventory.report_damage") && { value: "DAMAGE", label: "Damaged or missing stock" },
    can(user, "inventory.count") && { value: "COUNT", label: "Stock count (set to counted quantity)" },
    can(user, "inventory.adjust") && { value: "INCREASE", label: "Increase stock (found / correction)" },
    can(user, "inventory.adjust") && { value: "DECREASE", label: "Decrease stock (correction)" },
  ].filter(Boolean) as { value: string; label: string }[];
  if (allowedKinds.length === 0) redirect("/forbidden");

  const [products, locations, stockByLocation, currency] = await Promise.all([getPickerProducts(), getActiveLocations(), getStockByLocation(), getCurrency()]);

  return (
    <>
      <PageHeader title="New stock adjustment" back={{ href: "/inventory/adjustments", label: "Stock adjustments" }} />
      {products.length === 0 || locations.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Nothing to adjust yet"
            description="Add products and receive stock first."
            action={
              <Link href="/products/new" className="btn-primary">
                Add a product
              </Link>
            }
          />
        </div>
      ) : (
        <StockDocumentForm
          variant="adjustment"
          action={createAdjustment}
          products={products}
          locations={locations}
          stockByLocation={stockByLocation}
          submissionKey={randomUUID()}
          cancelHref="/inventory/adjustments"
          currencySymbol={currency.symbol}
          allowedKinds={allowedKinds}
        />
      )}
    </>
  );
}
