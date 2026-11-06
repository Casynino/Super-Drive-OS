import Link from "next/link";
import { AlertTriangle, Handshake, PackageCheck, PackageX, QrCode, ScanBarcode, Search, ShoppingCart, Trash2, type LucideIcon } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import KpiCard from "@/components/dashboard/KpiCard";
import ProductLevelCard, { type ProductLevel } from "@/components/items/ProductLevelCard";
import ItemsTable, { type ItemRow } from "@/components/products/ItemsTable";
import { Prisma, type ItemStatus } from "@/generated/prisma/client";
import LabelExistingStock from "@/components/products/LabelExistingStock";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { ITEM_STATUSES, ITEM_STATUS_LABEL } from "@/lib/inventory/item-labels";
import { untrackedStock } from "@/lib/inventory/items";
import { labelExistingStockAction } from "./actions";
import { formatDate, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Items" };
const PAGE = 50;

type Search = { q?: string; status?: string; product?: string; shipment?: string; page?: string };

export default async function ItemsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePagePermission("inventory.view");
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const status = ITEM_STATUSES.includes(sp.status as ItemStatus) ? (sp.status as ItemStatus) : undefined;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  // everything except the chosen product, so the product cards stay visible while one product is picked
  const wide: Prisma.InventoryItemWhereInput = {
    ...(sp.shipment ? { shipmentId: sp.shipment } : {}),
    ...(q
      ? {
          OR: [
            { itemNo: { contains: q, mode: "insensitive" } },
            { token: q.toUpperCase().replace(/^SDOI:/, "") },
            { product: { name: { contains: q, mode: "insensitive" } } },
            { product: { sku: { contains: q, mode: "insensitive" } } },
            { shipment: { shipmentNo: { contains: q, mode: "insensitive" } } },
            { shipment: { reference: { contains: q, mode: "insensitive" } } },
            { shipment: { cargoName: { contains: q, mode: "insensitive" } } },
            { receipt: { receiptNo: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const base: Prisma.InventoryItemWhereInput = { ...wide, ...(sp.product ? { productId: sp.product } : {}) };
  const untracked = can(user, "inventory.adjust") ? (await untrackedStock(db)).reduce((sum, r) => sum + r.missing, 0) : 0;
  const [byStatus, byProduct, rows, product, shipment] = await Promise.all([
    db.inventoryItem.groupBy({ by: ["status"], where: base, _count: true }),
    db.inventoryItem.groupBy({ by: ["productId", "status"], where: wide, _count: true }),
    db.inventoryItem.findMany({
      where: { ...base, ...(status ? { status } : {}) },
      orderBy: { itemNo: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE + 1,
      select: { id: true, itemNo: true, status: true, receivedAt: true, updatedAt: true, product: { select: { id: true, name: true } }, location: { select: { name: true } }, shipment: { select: { id: true, shipmentNo: true } } },
    }),
    sp.product ? db.product.findUnique({ where: { id: sp.product }, select: { name: true } }) : null,
    sp.shipment ? db.shipment.findUnique({ where: { id: sp.shipment }, select: { shipmentNo: true } }) : null,
  ]);
  const productInfo = byProduct.length
    ? await db.product.findMany({ where: { id: { in: [...new Set(byProduct.map((r) => r.productId))] } }, select: { id: true, name: true, sku: true, minStock: true, image: { select: { updatedAt: true } } } })
    : [];
  const levels: ProductLevel[] = productInfo
    .map((pr) => {
      const n = (s: ItemStatus) => byProduct.find((r) => r.productId === pr.id && r.status === s)?._count ?? 0;
      const all = byProduct.filter((r) => r.productId === pr.id).reduce((sum, r) => sum + r._count, 0);
      return { id: pr.id, name: pr.name, sku: pr.sku, imageV: pr.image ? pr.image.updatedAt.getTime() : null, minStock: Number(pr.minStock), total: all, available: n("AVAILABLE"), reseller: n("WITH_RESELLER"), damaged: n("DAMAGED"), sold: n("SOLD") };
    })
    // what needs looking at first (out, then low), then by name
    .sort((a, b) => Number(a.available > 0) - Number(b.available > 0) || Number(a.available > a.minStock) - Number(b.available > b.minStock) || a.name.localeCompare(b.name));
  const counts = new Map(byStatus.map((s) => [s.status, s._count]));
  const total = byStatus.reduce((s, r) => s + r._count, 0);
  const more = rows.length > PAGE;
  const list: ItemRow[] = rows.slice(0, PAGE).map((r) => ({
    id: r.id,
    itemNo: r.itemNo,
    status: r.status,
    productId: r.product.id,
    productName: r.product.name,
    location: r.location.name,
    received: formatDate(r.receivedAt),
    shipmentId: r.shipment?.id ?? null,
    shipmentNo: r.shipment?.shipmentNo ?? null,
    lastMove: formatDateTime(r.updatedAt),
  }));

  const href = (over: Partial<Search>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: sp.q, status: sp.status, product: sp.product, shipment: sp.shipment, ...over })) if (v) p.set(k, v);
    const s = p.toString();
    return `/items${s ? `?${s}` : ""}`;
  };
  const share = (n: number) => (total > 0 ? `${Math.round((n / total) * 100)}% of all pieces` : "—");
  type Card = { key: string; label: string; icon: LucideIcon; tone: "navy" | "green" | "slate" | "blue" | "red" | "yellow"; value: number; hint: string; always?: boolean };
  const allCards: Card[] = [
    { key: "", label: "All pieces", icon: QrCode, tone: "navy", value: total, hint: "Each with its own QR code", always: true },
    { key: "AVAILABLE", label: "In the shop", icon: PackageCheck, tone: "green", value: counts.get("AVAILABLE") ?? 0, hint: share(counts.get("AVAILABLE") ?? 0), always: true },
    { key: "SOLD", label: "Sold", icon: ShoppingCart, tone: "slate", value: counts.get("SOLD") ?? 0, hint: share(counts.get("SOLD") ?? 0), always: true },
    { key: "WITH_RESELLER", label: "With resellers", icon: Handshake, tone: "blue", value: counts.get("WITH_RESELLER") ?? 0, hint: "Held on trust, not sold yet", always: true },
    { key: "DAMAGED", label: "Damaged", icon: AlertTriangle, tone: (counts.get("DAMAGED") ?? 0) > 0 ? "red" : "slate", value: counts.get("DAMAGED") ?? 0, hint: "Written off from stock", always: true },
    { key: "MISSING", label: "Missing", icon: PackageX, tone: "yellow", value: counts.get("MISSING") ?? 0, hint: "Marked missing" },
    { key: "DISPOSED", label: "Disposed", icon: Trash2, tone: "slate", value: counts.get("DISPOSED") ?? 0, hint: "Thrown away" },
  ];
  const cards = allCards.filter((c) => c.always || c.value > 0);

  return (
    <>
      <PageHeader
        title="Items"
        description="Every bottle, gallon or box has its own number and QR code. See how many there are and where they went, find one, print or reprint its label."
        actions={
          <>
            <Link href="/scan" className="btn-primary">
              <ScanBarcode size={16} /> Scan an item
            </Link>
            <Link href={`/items/labels${sp.shipment ? `?shipment=${sp.shipment}` : sp.product ? `?product=${sp.product}` : ""}`} className="btn-secondary">
              <QrCode size={16} /> Labels
            </Link>
          </>
        }
      />

      {untracked > 0 && <LabelExistingStock missing={untracked} action={labelExistingStockAction} />}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
        {cards.map((c) => (
          <KpiCard key={c.key || "all"} icon={c.icon} tone={c.tone} label={c.label} value={c.value.toLocaleString("en-US")} hint={c.hint} href={href({ status: c.key || undefined, page: undefined })} active={(sp.status ?? "") === c.key} />
        ))}
      </div>

      {levels.length > 0 && (
        <section className="mb-5" aria-label="Level by product">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Level by product</h2>
              <p className="text-sm text-slate-500">What is in the shop now and where the rest went. Press a product to see only its pieces.</p>
            </div>
            {sp.product && (
              <Link href={href({ product: undefined, page: undefined })} className="btn-secondary btn-sm">
                Show all products
              </Link>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {levels.map((l) => (
              <ProductLevelCard key={l.id} p={l} href={href({ product: sp.product === l.id ? undefined : l.id, page: undefined })} active={sp.product === l.id} />
            ))}
          </div>
        </section>
      )}

      {(product || shipment) && (
        <p className="mb-3 text-sm text-slate-600">
          Showing {product ? <strong>{product.name}</strong> : null}
          {shipment ? <strong>shipment {shipment.shipmentNo}</strong> : null}.{" "}
          <Link href="/items" className="text-navy-700 hover:underline">
            Show everything
          </Link>
        </p>
      )}

      <form method="get" className="card card-pad mb-4 flex flex-wrap items-end gap-3">
        {sp.product && <input type="hidden" name="product" value={sp.product} />}
        {sp.shipment && <input type="hidden" name="shipment" value={sp.shipment} />}
        {sp.status && <input type="hidden" name="status" value={sp.status} />}
        <div className="relative min-w-60 flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={q} placeholder="Item ID, product, code or shipment" className="input pl-9" aria-label="Search items" />
        </div>
        <button className="btn-primary" type="submit">
          Search
        </button>
        {q && (
          <Link href={href({ q: undefined })} className="btn-secondary">
            Clear
          </Link>
        )}
      </form>

      <section className="card overflow-hidden">
        {list.length === 0 ? (
          <EmptyState icon={<QrCode size={22} />} title="No items found" description={total === 0 && !q ? "Items appear here by themselves when stock is received." : "Try another search or status."} />
        ) : (
          <ItemsTable rows={list} />
        )}
        {(page > 1 || more) && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-slate-600">
            <span>Page {page}</span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={href({ page: page - 1 > 1 ? String(page - 1) : undefined })} className="btn-secondary btn-sm">
                  Previous
                </Link>
              )}
              {more && (
                <Link href={href({ page: String(page + 1) })} className="btn-secondary btn-sm">
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
