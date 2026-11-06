import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer, Search } from "lucide-react";
import { Alert, EmptyState } from "@/components/ui";
import ProductHero, { ProductTabs, type HeroStock } from "@/components/products/ProductHero";
import ItemsTable, { type ItemRow } from "@/components/products/ItemsTable";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { Prisma, type ItemStatus } from "@/generated/prisma/client";
import { ITEM_STATUSES, ITEM_STATUS_LABEL } from "@/lib/inventory/item-labels";
import { formatMoney } from "@/lib/money";
import { largestPack, packNote } from "@/lib/qty";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import { LABELS_ENABLED, PIECE_LIST_ENABLED } from "@/lib/features";
import { getProductFormOptions } from "../options";
import ProductForm, { type ProductFormData } from "../ProductForm";
import { setProductStatus } from "../actions";
import { removeProductImage, uploadProductImage } from "../image-actions";
import ProductImageCard from "@/components/products/ProductImageCard";
import ProductIdentityCard from "@/components/products/ProductIdentityCard";

export const metadata = { title: "Product" };
const PIECES_PAGE = 25;

type Sp = { created?: string; tab?: string; pstatus?: string; pq?: string; ppage?: string };

export default async function EditProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Sp> }) {
  const user = await requirePagePermission("products.view");
  const { id } = await params;
  const sp = await searchParams;

  const product = await db.product.findUnique({ where: { id }, include: { units: { include: { unit: { select: { symbol: true } } } }, baseUnit: { select: { symbol: true } }, category: { select: { name: true } }, brand: { select: { name: true } } } });
  if (!product) notFound();
  const image = await db.productImage.findUnique({ where: { productId: id }, select: { updatedAt: true } });
  const currency = (await getProductFormOptions({ categoryId: product.categoryId, brandId: product.brandId ?? undefined, unitIds: [product.baseUnitId, ...product.units.map((u) => u.unitId)] })).currency;

  // Pieces (each physical item) and where the stock is: only for people who can view stock
  const canItems = can(user, "inventory.view");
  const showPieces = PIECE_LIST_ENABLED && canItems;
  const tab: "pieces" | "details" = showPieces && sp.tab !== "details" ? "pieces" : "details";
  const pstatus = ITEM_STATUSES.includes(sp.pstatus as ItemStatus) ? (sp.pstatus as ItemStatus) : undefined;
  const pq = sp.pq?.trim() ?? "";
  const ppage = Math.max(1, Number.parseInt(sp.ppage ?? "1", 10) || 1);
  const pieceWhere: Prisma.InventoryItemWhereInput = {
    productId: id,
    ...(pq ? { OR: [{ itemNo: { contains: pq, mode: "insensitive" } }, { token: pq.toUpperCase().replace(/^SDOI:/, "") }, { shipment: { shipmentNo: { contains: pq, mode: "insensitive" } } }] } : {}),
  };

  const [itemCounts, returnedPieces, pieces, shelf, held] = canItems
    ? await Promise.all([
        db.inventoryItem.groupBy({ by: ["status"], where: pieceWhere, _count: true }),
        db.itemMovement.groupBy({ by: ["itemId"], where: { kind: "RETURNED", item: { productId: id } } }),
        tab === "pieces"
          ? db.inventoryItem.findMany({
              where: { ...pieceWhere, ...(pstatus ? { status: pstatus } : {}) },
              orderBy: { itemNo: "desc" },
              skip: (ppage - 1) * PIECES_PAGE,
              take: PIECES_PAGE + 1,
              select: { id: true, itemNo: true, status: true, receivedAt: true, updatedAt: true, location: { select: { name: true } }, shipment: { select: { id: true, shipmentNo: true } } },
            })
          : Promise.resolve([]),
        db.stockBalance.aggregate({ where: { productId: id, location: { type: { not: "RESELLER" } } }, _sum: { quantity: true } }),
        db.stockBalance.aggregate({ where: { productId: id, location: { type: "RESELLER" } }, _sum: { quantity: true } }),
      ])
    : [[], [], [], null, null];
  const n = (s: ItemStatus) => itemCounts.find((c) => c.status === s)?._count ?? 0;
  const pieceTotal = itemCounts.reduce((sum, c) => sum + c._count, 0);
  const morePieces = pieces.length > PIECES_PAGE;
  const itemRows: ItemRow[] = pieces.slice(0, PIECES_PAGE).map((r) => ({
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

  // the numbers at the top ignore the piece search, so they always describe the whole product
  const wholeCounts = canItems && pq ? await db.inventoryItem.groupBy({ by: ["status"], where: { productId: id }, _count: true }) : itemCounts;
  const w = (s: ItemStatus) => wholeCounts.find((c) => c.status === s)?._count ?? 0;
  const stock: HeroStock | null = canItems
    ? { available: Number(shelf?._sum.quantity ?? 0), reseller: Number(held?._sum.quantity ?? 0), sold: w("SOLD"), returned: returnedPieces.length, damaged: w("DAMAGED") + w("DISPOSED"), missing: w("MISSING") }
    : null;

  const canEdit = can(user, "products.edit");
  const canCost = can(user, "products.cost");
  const str = (d: { toString(): string } | null) => (d === null ? "" : d.toString());
  const { categories, brands, units } = await getProductFormOptions({
    categoryId: product.categoryId,
    brandId: product.brandId ?? undefined,
    unitIds: [product.baseUnitId, ...product.units.map((u) => u.unitId)],
  });

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
    defaultSalesUnitId: product.defaultSalesUnitId ?? "",
    defaultPurchaseUnitId: product.defaultPurchaseUnitId ?? "",
    allowPieceSales: product.allowPieceSales,
    units: product.units.map((u) => ({
      unitId: u.unitId,
      factor: str(u.factor),
      sellingPrice: str(u.sellingPrice),
      wholesalePrice: str(u.wholesalePrice),
    })),
  };

  const here = (over: Partial<Sp>) => {
    const p = new URLSearchParams({ tab: "pieces" });
    for (const [k, v] of Object.entries({ pstatus: sp.pstatus, pq: sp.pq, ...over })) if (v) p.set(k, v);
    return `/products/${id}?${p.toString()}`;
  };
  const chips: { key: string; label: string; n: number }[] = [
    { key: "", label: "All", n: pieceTotal },
    ...ITEM_STATUSES.map((s) => ({ key: s, label: ITEM_STATUS_LABEL[s], n: n(s) })).filter((c) => c.n > 0 || c.key === "AVAILABLE"),
  ];

  return (
    <>
      <Link href="/products" className="mb-2 inline-block text-sm text-slate-500 hover:text-navy-700">
        ← Products
      </Link>
      <ProductHero
        id={product.id}
        name={product.name}
        sku={product.sku}
        subtitle={[product.category.name, product.brand?.name, packNote(largestPack(product.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor }))), product.baseUnit.symbol)].filter(Boolean).join(" · ")}
        status={product.status}
        imageV={image ? image.updatedAt.getTime() : null}
        price={formatMoney(product.sellingPrice, currency)}
        wholesale={product.wholesalePrice && Number(product.wholesalePrice) > 0 ? formatMoney(product.wholesalePrice, currency) : null}
        minStock={Number(product.minStock)}
        stock={stock}
        pack={largestPack(product.units.map((u) => ({ symbol: u.unit.symbol, factor: u.factor })))}
        baseSymbol={product.baseUnit.symbol}
      />
      {sp.created && (
        <div className="mb-4">
          <Alert kind="success">Product created. Stock is added through Deliveries or a purchase order.</Alert>
        </div>
      )}

      {showPieces && <ProductTabs id={id} tab={tab} pieces={pq ? wholeCounts.reduce((sum, c) => sum + c._count, 0) : pieceTotal} />}

      {tab === "pieces" && (
        <section className="card overflow-hidden" aria-label="Pieces">
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Every piece of {product.name}</h2>
              <p className="text-sm text-slate-500">Each piece has its own number. Open one to see where it is and its whole history.</p>
            </div>
            {LABELS_ENABLED && (
              <Link href={`/items/labels?product=${id}`} className="btn-secondary btn-sm">
                <Printer size={14} /> Print labels
              </Link>
            )}
          </div>

          <form method="get" className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
            <input type="hidden" name="tab" value="pieces" />
            {sp.pstatus && <input type="hidden" name="pstatus" value={sp.pstatus} />}
            <div className="relative min-w-52 flex-1">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input name="pq" defaultValue={pq} placeholder="Item ID or order number" className="input pl-9" aria-label="Search pieces" />
            </div>
            <button className="btn-primary" type="submit">
              Search
            </button>
            {pq && (
              <Link href={here({ pq: undefined, ppage: undefined })} className="btn-secondary">
                Clear
              </Link>
            )}
          </form>

          <nav className="flex gap-1.5 overflow-x-auto border-t border-line px-5 py-3" aria-label="Piece status">
            {chips.map((c) => {
              const active = (sp.pstatus ?? "") === c.key;
              return (
                <Link key={c.key || "all"} href={here({ pstatus: c.key || undefined, ppage: undefined })} aria-current={active ? "page" : undefined} className={cn("inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition", active ? "border-navy-700 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900")}>
                  {c.label}
                  <span className={cn("rounded-full px-1.5 text-xs font-semibold", active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600")}>{c.n}</span>
                </Link>
              );
            })}
          </nav>

          {itemRows.length === 0 ? (
            <div className="border-t border-line">
              <EmptyState title="No pieces here" description={pieceTotal === 0 && !pq ? "They are created by themselves when this product's stock is received." : "Try another status or search."} />
            </div>
          ) : (
            <div className="border-t border-line">
              <ItemsTable rows={itemRows} showProduct={false} />
            </div>
          )}
          {(ppage > 1 || morePieces) && (
            <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-slate-600">
              <span>Page {ppage}</span>
              <div className="flex gap-2">
                {ppage > 1 && (
                  <Link href={here({ ppage: ppage - 1 > 1 ? String(ppage - 1) : undefined })} className="btn-secondary btn-sm">
                    Previous
                  </Link>
                )}
                {morePieces && (
                  <Link href={here({ ppage: String(ppage + 1) })} className="btn-secondary btn-sm">
                    Next
                  </Link>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {tab === "details" && (
        <>
          {LABELS_ENABLED && <ProductIdentityCard productId={product.id} sku={product.sku} barcode={product.barcode} />}
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
      )}
    </>
  );
}
