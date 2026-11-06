import Link from "next/link";
import { randomUUID } from "node:crypto";
import { EmptyState, PageHeader } from "@/components/ui";
import StockDocumentForm from "@/components/inventory/StockDocumentForm";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { getCurrency } from "@/lib/settings";
import { createReceipt } from "../../actions";
import { getActiveLocations, getPickerProducts, todayInBusinessTz } from "../../data";

export const metadata = { title: "Receive stock" };

export default async function NewReceiptPage() {
  const user = await requirePagePermission("inventory.receive");
  const [products, locations, suppliers, currency] = await Promise.all([
    getPickerProducts(),
    getActiveLocations(),
    can(user, "suppliers.view") ? db.supplier.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
    getCurrency(),
  ]);

  return (
    <>
      <PageHeader title="Receive stock" back={{ href: "/inventory/receiving", label: "Stock in" }} />
      {products.length === 0 || locations.length === 0 ? (
        <div className="card">
          <EmptyState
            title={products.length === 0 ? "Add products first" : "Add a stock location first"}
            description="Stock can only be received for products that exist. Register them, then come back."
            action={
              <Link href={products.length === 0 ? "/products/new" : "/settings"} className="btn-primary">
                {products.length === 0 ? "Add a product" : "Open settings"}
              </Link>
            }
          />
        </div>
      ) : (
        <StockDocumentForm
          variant="receipt"
          action={createReceipt}
          products={products}
          locations={locations}
          suppliers={suppliers}
          stockByLocation={{}}
          submissionKey={randomUUID()}
          cancelHref="/inventory/receiving"
          currencySymbol={currency.symbol}
          today={todayInBusinessTz()}
          canCost={can(user, "products.cost")}
        />
      )}
    </>
  );
}
