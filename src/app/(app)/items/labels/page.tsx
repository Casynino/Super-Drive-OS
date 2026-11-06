import Link from "next/link";
import { Printer } from "lucide-react";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import QrImage from "@/components/products/QrImage";
import PrintButton from "@/components/PrintButton";
import { Prisma } from "@/generated/prisma/client";
import { requirePagePermission } from "@/lib/auth/guard";
import { LABELS_ENABLED } from "@/lib/features";
import { db } from "@/lib/db";
import { itemQrText } from "@/lib/qr";
import { cn } from "@/lib/utils";

export const metadata = { title: "Item labels" };

const MAX = 1000;

/**
 * QR labels for individual pieces. A label always shows the piece's own QR and number: reprinting prints the SAME code,
 * it never makes a new identity. Pick pieces by shipment, receipt, product or a list of ids. Print on label paper
 * (3 across) or one label per page for a roll printer; "Save as PDF" in the print window makes a PDF.
 */
export default async function ItemLabelsPage({ searchParams }: { searchParams: Promise<{ shipment?: string; receipt?: string; product?: string; ids?: string; status?: string; layout?: string }> }) {
  if (!LABELS_ENABLED) redirect("/products");
  await requirePagePermission("inventory.view");
  const sp = await searchParams;
  const ids = (sp.ids ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX);
  const layout = sp.layout === "roll" ? "roll" : "sheet";

  const where: Prisma.InventoryItemWhereInput = {
    ...(ids.length ? { id: { in: ids } } : {}),
    ...(sp.shipment ? { shipmentId: sp.shipment } : {}),
    ...(sp.receipt ? { receiptId: sp.receipt } : {}),
    ...(sp.product ? { productId: sp.product } : {}),
    // by default only pieces that are still in stock; asking for specific pieces prints them whatever their status
    ...(!ids.length && sp.status !== "ALL" ? { status: { in: ["AVAILABLE", "WITH_RESELLER"] } } : {}),
  };
  const hasFilter = ids.length > 0 || sp.shipment || sp.receipt || sp.product;
  const items = hasFilter
    ? await db.inventoryItem.findMany({ where, orderBy: { itemNo: "asc" }, take: MAX + 1, select: { id: true, itemNo: true, token: true, product: { select: { name: true, size: true, brand: { select: { name: true } } } } } })
    : [];
  const truncated = items.length > MAX;
  const labels = items.slice(0, MAX);

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ shipment: sp.shipment, receipt: sp.receipt, product: sp.product, ids: sp.ids, status: sp.status, layout: sp.layout, ...over })) if (v) p.set(k, v);
    return `/items/labels?${p.toString()}`;
  };

  return (
    <>
      {layout === "roll" && <style>{`@media print { @page { size: 50mm 30mm; margin: 0 } }`}</style>}
      <div className="print:hidden">
        <PageHeader
          title="Item labels"
          description="One QR label for each piece. Reprinting gives the same code, never a new one. Choose Save as PDF in the print window to download a PDF."
          back={{ href: "/items", label: "Items" }}
          actions={<PrintButton label={`Print ${labels.length} label${labels.length === 1 ? "" : "s"}`} />}
        />
        <div className="card card-pad mb-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            {hasFilter ? (
              <>
                <span className="font-semibold text-slate-900">{labels.length}</span> label{labels.length === 1 ? "" : "s"} ready{truncated ? ` (showing the first ${MAX}; print in parts)` : ""}.
                {!ids.length && sp.status !== "ALL" && <> Only pieces still in stock. <Link href={qs({ status: "ALL" })} className="text-navy-700 hover:underline">Include sold and other pieces</Link></>}
              </>
            ) : (
              "Choose pieces on the Items page, or open a shipment and press Print labels."
            )}
          </p>
          <div className="inline-flex rounded-lg border border-line bg-white p-0.5" role="group" aria-label="Label layout">
            {[
              { key: "sheet", label: "Label sheet (A4)" },
              { key: "roll", label: "Roll printer (one per page)" },
            ].map((o) => (
              <Link key={o.key} href={qs({ layout: o.key === "sheet" ? undefined : o.key })} aria-current={layout === o.key ? "true" : undefined} className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition", layout === o.key ? "bg-navy-50 text-navy-800" : "text-slate-500 hover:text-slate-800")}>
                {o.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {labels.length === 0 ? (
        hasFilter ? (
          <p className="card card-pad text-sm text-slate-500">Nothing to print for this selection.</p>
        ) : (
          <div className="card card-pad print:hidden">
            <Link href="/items" className="btn-primary">
              <Printer size={16} /> Go to Items
            </Link>
          </div>
        )
      ) : (
        <div className={cn(layout === "sheet" ? "grid justify-center gap-2 print:gap-0 [grid-template-columns:repeat(auto-fill,minmax(63.5mm,63.5mm))] print:[grid-template-columns:repeat(3,63.5mm)]" : "flex flex-col items-center gap-3 print:block")}>
          {labels.map((it) => (
            <div
              key={it.id}
              style={{ background: "#fff", color: "#000" }} // a label is always black on white, whatever theme the screen uses
              className={cn(
                "flex break-inside-avoid items-stretch gap-[2mm] overflow-hidden rounded-md border border-dashed border-slate-300 p-[2mm] print:rounded-none print:border-transparent",
                layout === "sheet" ? "h-[33.9mm] w-[63.5mm]" : "h-[30mm] w-[50mm] print:break-after-page",
              )}
            >
              <div className="aspect-square h-full shrink-0">
                <QrImage text={itemQrText(it.token)} label={`QR code for ${it.itemNo}`} className="h-full w-full" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col justify-between leading-tight">
                <div>
                  <p className="text-[6.5pt] font-extrabold uppercase tracking-wider text-[#0E3D6E]">Super Drive Oil</p>
                  <p className="mt-[0.6mm] line-clamp-3 text-[8pt] font-bold">{it.product.name}</p>
                  <p className="text-[6.5pt] text-[#475569]">{[it.product.brand?.name, it.product.size].filter(Boolean).join(" · ")}</p>
                </div>
                <p className="font-mono text-[6.5pt] font-bold tracking-tight">{it.itemNo}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
