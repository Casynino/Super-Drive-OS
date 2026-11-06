import Link from "next/link";
import { QrCode, ScanBarcode, Search } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import ItemsTable, { type ItemRow } from "@/components/products/ItemsTable";
import { Prisma, type ItemStatus } from "@/generated/prisma/client";
import LabelExistingStock from "@/components/products/LabelExistingStock";
import { can } from "@/lib/auth/can";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { ITEM_STATUSES, ITEM_STATUS_LABEL } from "@/lib/inventory/item-labels";
import { untrackedStock } from "@/lib/inventory/items";
import { labelExistingStockAction } from "./actions";
import { cn, formatDate, formatDateTime } from "@/lib/utils";

export const metadata = { title: "Items" };
const PAGE = 50;

type Search = { q?: string; status?: string; product?: string; shipment?: string; page?: string };

export default async function ItemsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePagePermission("inventory.view");
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const status = ITEM_STATUSES.includes(sp.status as ItemStatus) ? (sp.status as ItemStatus) : undefined;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const base: Prisma.InventoryItemWhereInput = {
    ...(sp.product ? { productId: sp.product } : {}),
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
            { receipt: { receiptNo: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const untracked = can(user, "inventory.adjust") ? (await untrackedStock(db)).reduce((sum, r) => sum + r.missing, 0) : 0;
  const [byStatus, rows, product, shipment] = await Promise.all([
    db.inventoryItem.groupBy({ by: ["status"], where: base, _count: true }),
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
  const tabs: { key: string; label: string; n: number }[] = [{ key: "", label: "All", n: total }, ...ITEM_STATUSES.map((s) => ({ key: s, label: ITEM_STATUS_LABEL[s], n: counts.get(s) ?? 0 })).filter((t) => t.n > 0 || t.key === "AVAILABLE")];

  return (
    <>
      <PageHeader
        title="Items"
        description="Every single bottle, gallon or box has its own number and QR code. Find one, see where it is, print or reprint its label."
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

      <nav className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Item status">
        {tabs.map((t) => {
          const active = (sp.status ?? "") === t.key;
          return (
            <Link key={t.key || "all"} href={href({ status: t.key || undefined, page: undefined })} aria-current={active ? "page" : undefined} className={cn("inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition", active ? "border-navy-700 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900")}>
              {t.label}
              <span className={cn("rounded-full px-1.5 text-xs font-semibold", active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600")}>{t.n}</span>
            </Link>
          );
        })}
      </nav>

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
