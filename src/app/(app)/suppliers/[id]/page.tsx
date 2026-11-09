import { notFound } from "next/navigation";
import { Alert, PageHeader, StatusBadge } from "@/components/ui";
import EntityForm from "@/components/EntityForm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import SupplierPayForm from "@/components/cash/SupplierPayForm";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { getSupplierBalances } from "@/lib/cash/supplier";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";
import { formatDate } from "@/lib/utils";
import { paySupplierAction } from "../pay-actions";
import { defaultLocationId, listAccounts } from "@/lib/cash/ledger";
import { db } from "@/lib/db";
import { saveSupplier } from "../actions";

export const metadata = { title: "Supplier" };

export default async function SupplierPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; paid?: string }> }) {
  const user = await requireUser();
  if (!canAny(user, ["suppliers.manage", "suppliers.view", "suppliers.pay"])) redirect("/forbidden");
  const canManage = can(user, "suppliers.manage");
  const canPay = can(user, "suppliers.pay");
  const { id } = await params;
  const sp = await searchParams;
  const s = await db.supplier.findUnique({ where: { id } });
  if (!s) notFound();
  const currency = await getCurrency();
  const m = (v: Parameters<typeof formatMoney>[0]) => formatMoney(v, currency);
  const [balances, shipments, payments] = canPay
    ? await Promise.all([
        getSupplierBalances(db),
        db.shipment.findMany({ where: { supplierId: id, status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, take: 15, select: { id: true, shipmentNo: true, createdAt: true, reference: true, items: { where: { unexpected: false }, select: { lineCost: true } } } }),
        db.supplierPayment.findMany({ where: { supplierId: id }, orderBy: { paidAt: "desc" }, take: 15, include: { createdBy: { select: { name: true } } } }),
      ])
    : [[], [], []];
  const bal = balances.find((b) => b.id === id);

  return (
    <>
      <PageHeader title={s.name} back={{ href: "/suppliers", label: "Suppliers" }} actions={<StatusBadge status={s.status} />} />
      {sp.created && (
        <div className="mb-4">
          <Alert kind="success">Supplier created.</Alert>
        </div>
      )}
      {sp.paid && <div className="mb-4"><Alert kind="success">Payment <strong>{sp.paid}</strong> recorded. The money left the account you chose.</Alert></div>}

      {canPay && bal && (
        <>
          <div className="mb-5 grid grid-cols-1 gap-3 min-[360px]:grid-cols-3 sm:gap-4">
            <div className="card card-pad"><p className="text-[13px] font-medium text-slate-500">Supplied to us</p><p className="mt-1 text-xl font-semibold tabular-nums">{m(bal.purchases)}</p></div>
            <div className="card card-pad"><p className="text-[13px] font-medium text-slate-500">Paid so far</p><p className="mt-1 text-xl font-semibold tabular-nums">{m(bal.paid)}</p></div>
            <div className={`card card-pad ${bal.owed > 0 ? "border-amber-200 bg-oil-soft/50" : ""}`}><p className="text-[13px] font-medium text-slate-500">We still owe</p><p className="mt-1 text-xl font-semibold tabular-nums">{m(bal.owed)}</p></div>
          </div>
          <div className="mb-5 grid gap-5 lg:grid-cols-2">
            <section className="card card-pad">
              <h2 className="mb-3 text-base font-semibold text-slate-900">Pay this supplier</h2>
              <SupplierPayForm action={paySupplierAction} accounts={await listAccounts(db, await defaultLocationId(db))} supplierId={id} submissionKey={randomUUID()} shipments={shipments.map((x) => ({ id: x.id, label: `${x.shipmentNo}${x.reference ? ` · ${x.reference}` : ""}` }))} />
            </section>
            <section className="card overflow-hidden">
              <h2 className="border-b border-line px-4 py-3 text-base font-semibold text-slate-900 sm:px-5">Payments made</h2>
              {payments.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-slate-500">No payments yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {payments.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-3 sm:px-5">
                      <span>
                        <span className="font-medium">{p.paymentNo}</span>
                        <span className="ml-2 text-slate-500">{formatDate(p.paidAt)}</span>
                        <span className="block text-xs text-slate-500">{p.method === "CASH" ? "Cash" : p.method === "BANK" ? "Bank" : "Mobile money"}{p.reference ? ` · ${p.reference}` : ""} · {p.createdBy.name}</span>
                      </span>
                      <span className="font-semibold tabular-nums">{m(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          <section className="card mb-5 overflow-hidden">
            <h2 className="border-b border-line px-4 py-3 text-base font-semibold text-slate-900 sm:px-5">Shipments from this supplier</h2>
            {shipments.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-slate-500">No shipments yet. Choose this supplier when you announce a shipment.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {shipments.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2 px-4 py-3 sm:px-5">
                    <span>
                      <Link href={`/shipments/${x.id}`} className="font-medium text-navy-700 hover:underline">{x.shipmentNo}</Link>
                      <span className="ml-2 text-slate-500">{formatDate(x.createdAt)}{x.reference ? ` · ${x.reference}` : ""}</span>
                    </span>
                    <span className="font-semibold tabular-nums">{m(x.items.reduce((t, i) => t + Number(i.lineCost ?? 0), 0))}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {canManage && (
      <div className="card card-pad max-w-2xl">
        <EntityForm
          action={saveSupplier}
          submitLabel="Save changes"
          hidden={{ id: s.id }}
          fields={[
            { name: "name", label: "Supplier / business name", value: s.name, required: true, span: 2 },
            { name: "contactPerson", label: "Contact person", value: s.contactPerson ?? "" },
            { name: "phone", label: "Phone", value: s.phone ?? "" },
            { name: "email", label: "Email", type: "email", value: s.email ?? "" },
            { name: "address", label: "Address", value: s.address ?? "" },
            {
              name: "status",
              label: "Status",
              type: "select",
              value: s.status,
              options: [
                { value: "ACTIVE", label: "Active" },
                { value: "INACTIVE", label: "Inactive (hidden when receiving stock)" },
              ],
            },
            { name: "notes", label: "Notes", type: "textarea", value: s.notes ?? "", span: 2 },
          ]}
        />
      </div>
      )}
    </>
  );
}
