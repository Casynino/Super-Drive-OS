import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import PrintButton from "@/components/PrintButton";
import { Alert, DetailGrid, PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getBusinessProfile, getCurrency } from "@/lib/settings";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Stock issue" };

export default async function IssueDocumentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  await requirePagePermission("resellers.view");
  const { id } = await params;
  const sp = await searchParams;
  const doc = await db.resellerIssue.findUnique({
    where: { id },
    include: { reseller: true, createdBy: { select: { name: true } }, fromLocation: { select: { name: true } }, items: { include: { product: { select: { name: true, sku: true } }, enteredUnit: { select: { name: true, symbol: true } } }, orderBy: { id: "asc" } } },
  });
  if (!doc) notFound();
  const [currency, biz] = await Promise.all([getCurrency(), getBusinessProfile()]);

  return (
    <>
      <div className="print:hidden">
        <PageHeader title={doc.issueNo} back={{ href: `/resellers/${doc.resellerId}`, label: doc.reseller.name }} description="Stock issuance document" actions={<PrintButton label="Print document" />} />
        {sp.done && (
          <div className="mb-4">
            <Alert kind="success">
              <span className="flex items-center gap-2">
                <CheckCircle2 size={16} /> The stock was issued. It is now held in {doc.reseller.name}&apos;s name. Print this document for them to sign.
              </span>
            </Alert>
          </div>
        )}
      </div>

      <article className="card card-pad mx-auto max-w-3xl print:max-w-none print:border-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
          <div>
            <p className="text-lg font-bold text-slate-900">{biz.name}</p>
            <p className="text-sm text-slate-500">{[biz.address, biz.phone].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stock issuance document</p>
            <p className="text-lg font-bold text-navy-800">{doc.issueNo}</p>
            <p className="text-sm text-slate-500">{formatDateTime(doc.createdAt)}</p>
          </div>
        </header>

        <div className="my-4">
          <DetailGrid
            items={[
              { label: "Issued to", value: `${doc.reseller.name}${doc.reseller.businessName ? ` (${doc.reseller.businessName})` : ""}` },
              { label: "Phone", value: doc.reseller.phone },
              { label: "Sells at", value: doc.reseller.salesLocation },
              { label: "Taken from", value: doc.fromLocation.name },
            ]}
          />
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 font-medium">Product</th>
              <th className="py-2 text-right font-medium">Quantity</th>
              <th className="py-2 text-right font-medium">Price</th>
              <th className="py-2 text-right font-medium">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {doc.items.map((i) => (
              <tr key={i.id}>
                <td className="py-2.5">
                  <span className="font-medium text-slate-900">{i.product.name}</span>
                  <span className="block text-xs text-slate-500">{i.product.sku}</span>
                </td>
                <td className="py-2.5 text-right tabular-nums">{i.enteredQty.toString()} {i.enteredUnit.name.toLowerCase()}{Number(i.enteredQty) === 1 ? "" : "s"}</td>
                <td className="py-2.5 text-right tabular-nums">{formatMoney(i.unitPrice, currency)}</td>
                <td className="py-2.5 text-right font-medium tabular-nums">{formatMoney(i.lineValue, currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300">
              <td colSpan={3} className="py-3 text-right font-semibold">Total expected value</td>
              <td className="py-3 text-right text-lg font-bold tabular-nums">{formatMoney(doc.expectedValue, currency)}</td>
            </tr>
          </tfoot>
        </table>

        {doc.notes && <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">Note: {doc.notes}</p>}
        <p className="mt-4 text-xs text-slate-500">These goods remain the property of {biz.name} until sold. The reseller will report what is sold and pay for it, and return what is unsold. Nothing is owed until a sale is reported.</p>

        <div className="mt-10 grid grid-cols-2 gap-8 text-sm">
          <div>
            <div className="border-b border-slate-400 pb-8" />
            <p className="mt-1.5 text-slate-600">Issued by: {doc.createdBy.name}</p>
          </div>
          <div>
            <div className="border-b border-slate-400 pb-8" />
            <p className="mt-1.5 text-slate-600">Received by: {doc.reseller.name}</p>
          </div>
        </div>
      </article>
    </>
  );
}
