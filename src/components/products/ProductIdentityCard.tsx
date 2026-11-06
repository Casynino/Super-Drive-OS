import Link from "next/link";
import { Printer } from "lucide-react";
import { productQrText } from "@/lib/qr";
import BarcodeImage from "./BarcodeImage";
import QrImage from "./QrImage";

/** The product's codes, made by the system: product code, barcode and QR code, with a link to print labels. */
export default function ProductIdentityCard({ productId, sku, barcode }: { productId: string; sku: string; barcode: string | null }) {
  return (
    <section className="card card-pad mb-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Product identity</h2>
          <p className="text-sm text-slate-500">Made by the system when the product was added. Scan it at the POS or on the Scan page.</p>
        </div>
        <Link href={`/products/labels?ids=${productId}`} className="btn-secondary btn-sm">
          <Printer size={14} /> Print labels
        </Link>
      </div>
      <div className="mt-4 grid gap-5 md:grid-cols-[1fr_260px_150px] md:items-center">
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Product code</dt>
            <dd className="mt-0.5 font-mono text-lg font-semibold text-slate-900">{sku}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Barcode number</dt>
            <dd className="mt-0.5 font-mono text-base text-slate-800">{barcode ?? "Made when you save the product"}</dd>
          </div>
        </dl>
        <div>
          {barcode ? (
            <div className="overflow-hidden rounded-lg border border-line bg-white p-1">
              <BarcodeImage value={barcode} />
            </div>
          ) : null}
          <p className="mt-1 text-center text-[11px] text-slate-500">Barcode (identifies the product)</p>
        </div>
        <div>
          {barcode ? (
            <div className="mx-auto w-[130px] overflow-hidden rounded-lg border border-line bg-white p-1">
              <QrImage text={productQrText(barcode)} label="Product QR code" />
            </div>
          ) : null}
          <p className="mt-1 text-center text-[11px] text-slate-500">QR code</p>
        </div>
      </div>
    </section>
  );
}
