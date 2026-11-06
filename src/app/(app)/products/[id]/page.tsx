import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { PageHeader, StatusBadge, Alert } from "@/components/ui";
import ItemsTable, { type ItemRow } from "@/components/products/ItemsTable";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/utils";
import { getProductFormOptions } from "../options";
import ProductForm, { type ProductFormData } from "../ProductForm";
import { setProductStatus } from "../actions";
import { removeProductImage, uploadProductImage } from "../image-actions";
import ProductImageCard from "@/components/products/ProductImageCard";
import ProductIdentityCard from "@/components/products/ProductIdentityCard";

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

  // Item records (each physical piece): totals by status and the latest pieces, for people who can view stock
  const canItems = can(user, "inventory.view");
  const [itemCounts, returnedPieces, latest] = canItems
    ? await Promise.all([
        db.inventoryItem.groupBy({ by: ["status"], where: { productId: id }, _count: true }),
        db.itemMovement.groupBy({ by: ["itemId"], where: { kind: "RETURNED", item: { productId: id } } }),
        db.inventoryItem.findMany({
          where: { productId: id },
          orderBy: { itemNo: "desc" },
          take: 15,
          select: { id: true, itemNo: true, status: true, receivedAt: true, updatedAt: true, location: { select: { name: true } }, shipment: { select: { id: true, shipmentNo: true } } },
        }),
      ])
    : [[], [], []];
  const n = (s: string) => itemCounts.find((c) => c.status === s)?._count ?? 0;
  const itemTotal = itemCounts.reduce((sum, c) => sum + c._count, 0);
  const itemRows: ItemRow[] = latest.map((r) => ({
    id: r.id,
    itemNo: r.itemNo,
    status: r.status,
    productId: id,
    productName: product.name,
    location: r.location.name,
    received: formatDate(r.receivedAt),
    shipmentId: r.shipment?.id ?? null,
    shipmentNo: r.shipment?.shipmentNo ?? null,
    lastMove: formatDateTime(r.updatedAt),
  }));
  const summary = [
    { label: "Total received", value: itemTotal },
    { label: "Available in shop", value: n("AVAILABLE"), tone: "text-emerald-700" },
    { label: "Sold", value: n("SOLD") },
    { label: "With resellers", value: n("WITH_RESELLER"), tone: "text-blue-700" },
    { label: "Returned", value: returnedPieces.length },
    { label: "Damaged", value: n("DAMAGED") + n("DISPOSED"), tone: n("DAMAGED") ? "text-brand-red-dark" : "" },
    { label: "Missing", value: n("MISSING") },
    { label: "Business stock", value: n("AVAILABLE") + n("WITH_RESELLER"), tone: "text-navy-700" },
  ];

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
    size: product.size ?? "",
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
          <Alert kind="success">Product created. Stock is added through Stock In or a purchase order.</Alert>
        </div>
      )}
      <ProductIdentityCard productId={product.id} sku={product.sku} barcode={product.barcode} />

      {canItems && (
        <section className="card mb-5 overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Individual items</h2>
              <p className="text-sm text-slate-500">Every piece received has its own number and QR code. Open one to see where it is and its whole history.</p>
            </div>
            <div className="flex gap-2">
              <Link href={`/items?product=${id}`} className="btn-secondary btn-sm">
                All items
              </Link>
              <Link href={`/items/labels?product=${id}`} className="btn-secondary btn-sm">
                <Printer size={14} /> Print labels
              </Link>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-px border-y border-line bg-line sm:grid-cols-4">
            {summary.map((s) => (
              <div key={s.label} className="bg-white px-5 py-3">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{s.label}</dt>
                <dd className={`mt-0.5 text-xl font-bold ${s.tone ?? "text-slate-900"}`}>{s.value}</dd>
              </div>
            ))}
          </dl>
          {itemRows.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">No pieces yet. They are created by themselves when this product's stock is received.</p>
          ) : (
            <ItemsTable rows={itemRows} showProduct={false} />
          )}
        </section>
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
