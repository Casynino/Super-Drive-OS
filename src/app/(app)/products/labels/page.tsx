import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import BarcodeImage from "@/components/products/BarcodeImage";
import PrintButton from "@/components/PrintButton";
import { requirePagePermission } from "@/lib/auth/guard";
import { LABELS_ENABLED } from "@/lib/features";
import { db } from "@/lib/db";

export const metadata = { title: "Product labels" };

/**
 * Shelf labels with the product's barcode (the same code for every piece of that product).
 * A sheet is 3 labels across, 7 down (63.5 x 38.1 mm), the common A4 label paper. Several copies of one product are fine.
 */
export default async function ProductLabelsPage({ searchParams }: { searchParams: Promise<{ ids?: string; copies?: string }> }) {
  if (!LABELS_ENABLED) redirect("/products");
  await requirePagePermission("products.view");
  const sp = await searchParams;
  const ids = (sp.ids ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const copies = Math.min(Math.max(Number.parseInt(sp.copies ?? "1", 10) || 1, 1), 100);

  const products = await db.product.findMany({
    where: { status: "ACTIVE", barcode: { not: null }, ...(ids.length ? { id: { in: ids } } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, sku: true, barcode: true, size: true, brand: { select: { name: true } } },
    take: 300,
  });
  const labels = products.flatMap((p) => Array.from({ length: copies }, (_, i) => ({ key: `${p.id}-${i}`, p })));

  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Product labels" description="Barcode labels for the shelf. Print them on label paper (3 across, 7 down) or on plain A4 and cut." back={{ href: "/products", label: "Products" }} actions={<PrintButton label="Print labels" />} />
        <form method="get" className="card card-pad mb-5 flex flex-wrap items-end gap-3">
          {ids.length > 0 && <input type="hidden" name="ids" value={ids.join(",")} />}
          <div>
            <label className="label" htmlFor="copies">
              Copies of each label
            </label>
            <input id="copies" name="copies" type="number" min={1} max={100} defaultValue={copies} className="input w-28" />
          </div>
          <button className="btn-secondary" type="submit">
            Update
          </button>
          <p className="text-sm text-slate-500">
            {labels.length} label{labels.length === 1 ? "" : "s"} · {ids.length ? `${products.length} product${products.length === 1 ? "" : "s"} chosen` : "all active products"}
          </p>
        </form>
      </div>

      {labels.length === 0 ? (
        <p className="card card-pad text-sm text-slate-500">No products with a barcode to print yet.</p>
      ) : (
        <div className="grid justify-center gap-2 print:gap-0 [grid-template-columns:repeat(auto-fill,minmax(63.5mm,63.5mm))] print:[grid-template-columns:repeat(3,63.5mm)]">
          {labels.map(({ key, p }) => (
            <div key={key} style={{ background: "#fff", color: "#000" }} className="flex h-[38.1mm] w-[63.5mm] break-inside-avoid flex-col justify-between overflow-hidden rounded-md border border-dashed border-slate-300 p-[2.2mm] print:rounded-none print:border-transparent">
              <div className="leading-tight">
                <p className="line-clamp-2 text-[9.5pt] font-bold">{p.name}</p>
                <p className="text-[7pt] text-[#475569]">{[p.brand?.name, p.size].filter(Boolean).join(" · ")}</p>
              </div>
              <BarcodeImage value={p.barcode!} height={36} className="mx-auto max-h-[15mm]" />
              <p className="text-center font-mono text-[6.5pt] text-[#334155]">{p.sku} · Super Drive Oil</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
