import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/ui";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { getProductFormOptions } from "../options";
import ProductForm from "../ProductForm";

export const metadata = { title: "Add product" };

export default async function NewProductPage() {
  const user = await requirePagePermission("products.create");
  const { categories, brands, units, currency } = await getProductFormOptions();

  return (
    <>
      <PageHeader title="Add product" back={{ href: "/products", label: "Products" }} />
      {categories.length === 0 || units.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Add a category first"
            description="Products must belong to a category. Create your categories in Settings, then come back."
            action={
              can(user, "catalog.manage") ? (
                <Link href="/settings" className="btn-primary">
                  Open settings
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ProductForm
          categories={categories}
          brands={brands}
          units={units}
          currencySymbol={currency.symbol}
          canPrice={can(user, "products.price")}
          canCost={can(user, "products.cost")}
        />
      )}
    </>
  );
}
