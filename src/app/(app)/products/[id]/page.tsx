import { notFound } from "next/navigation";
import { PageHeader, StatusBadge, Alert } from "@/components/ui";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/utils";
import { getProductFormOptions } from "../options";
import ProductForm, { type ProductFormData } from "../ProductForm";
import { setProductStatus } from "../actions";
import { removeProductImage, uploadProductImage } from "../image-actions";
import ProductImageCard from "@/components/products/ProductImageCard";

export const metadata = { title: "Product" };

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const user = await requirePagePermission("products.view");
  const { id } = await params;
  const sp = await searchParams;

  const product = await db.product.findUnique({ where: { id }, include: { units: true } });
  if (!product) notFound();
  const image = await db.productImage.findUnique({ where: { productId: id }, select: { updatedAt: true } });

  const { categories, brands, units, currency } = await getProductFormOptions({
    categoryId: product.categoryId,
    brandId: product.brandId ?? undefined,
    unitIds: [product.baseUnitId, ...product.units.map((u) => u.unitId)],
  });

  const canEdit = can(user, "products.edit");
  const canCost = can(user, "products.cost");
  const str = (d: { toString(): string } | null) => (d === null ? "" : d.toString());

  const data: ProductFormData = {
    id: product.id,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode ?? "",
    categoryId: product.categoryId,
    brandId: product.brandId ?? "",
    packagingType: product.packagingType ?? "",
    description: product.description ?? "",
    baseUnitId: product.baseUnitId,
    purchasePrice: canCost ? str(product.purchasePrice) : "",
    sellingPrice: str(product.sellingPrice),
    wholesalePrice: str(product.wholesalePrice),
    minStock: str(product.minStock),
    units: product.units.map((u) => ({
      unitId: u.unitId,
      factor: str(u.factor),
      sellingPrice: str(u.sellingPrice),
      wholesalePrice: str(u.wholesalePrice),
    })),
  };

  return (
    <>
      <PageHeader
        title={product.name}
        description={`${product.sku} · Added ${formatDateTime(product.createdAt)}`}
        back={{ href: "/products", label: "Products" }}
        actions={<StatusBadge status={product.status} />}
      />
      {sp.created && (
        <div className="mb-4">
          <Alert kind="success">Product created. Stock is added through Stock Receiving.</Alert>
        </div>
      )}
      <ProductImageCard productId={product.id} productName={product.name} version={image ? image.updatedAt.getTime() : null} canEdit={canEdit} upload={uploadProductImage} remove={removeProductImage} />
      <ProductForm
        product={data}
        categories={categories}
        brands={brands}
        units={units}
        currencySymbol={currency.symbol}
        canPrice={can(user, "products.price")}
        canCost={canCost}
        readOnly={!canEdit}
      />

      {can(user, "products.deactivate") && (
        <form action={setProductStatus} className="card card-pad mt-5 flex flex-wrap items-center justify-between gap-3">
          <input type="hidden" name="id" value={product.id} />
          <input type="hidden" name="status" value={product.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"} />
          <div>
            <p className="text-sm font-semibold text-slate-900">{product.status === "ACTIVE" ? "Deactivate product" : "Reactivate product"}</p>
            <p className="text-sm text-slate-500">
              {product.status === "ACTIVE"
                ? "It will no longer appear in the POS. History and stock records are kept."
                : "It will be available for sale again."}
            </p>
          </div>
          <button type="submit" className={product.status === "ACTIVE" ? "btn-danger" : "btn-secondary"}>
            {product.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
          </button>
        </form>
      )}
    </>
  );
}
