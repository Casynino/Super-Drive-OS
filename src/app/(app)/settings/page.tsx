import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader, StatusBadge } from "@/components/ui";
import EntityForm from "@/components/EntityForm";
import ListRow from "@/components/settings/ListRow";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { getCashSettings } from "@/lib/cash/settings";
import { formatMoney } from "@/lib/money";
import { getBusinessProfile, getCurrency, getReturnsNeedApproval } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { saveCashSettings, saveExpenseCategory, setExpenseCategoryStatus } from "../cash/settings-actions";
import { saveBrand, saveBusinessProfile, saveCategory, saveLocation, saveUnit, setEntityStatus } from "./actions";

export const metadata = { title: "Settings" };

const TABS = [
  { key: "business", label: "Business" },
  { key: "expenses", label: "Expenses" },
  { key: "products", label: "Products" },
  { key: "locations", label: "Locations" },
] as const;

const TYPES = [
  { value: "WAREHOUSE", label: "Warehouse" },
  { value: "SHOP", label: "Shop" },
  { value: "OTHER", label: "Other" },
];

function StatusForm({ entity, id, status, blockedReason }: { entity: string; id: string; status: "ACTIVE" | "INACTIVE"; blockedReason?: string }) {
  if (blockedReason) return <span className="text-xs text-slate-400">{blockedReason}</span>;
  return (
    <form action={setEntityStatus}>
      <input type="hidden" name="entity" value={entity} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status === "ACTIVE" ? "INACTIVE" : "ACTIVE"} />
      <button type="submit" className={status === "ACTIVE" ? "btn-danger btn-sm" : "btn-secondary btn-sm"}>
        {status === "ACTIVE" ? "Deactivate" : "Reactivate"}
      </button>
    </form>
  );
}

/** A settings list: a title, an add line on top, ONE header for the columns, then the lines. */
function ListCard({ title, description, headers, template, add, children, empty }: { title: string; description?: string; headers: string[]; template: string; add?: React.ReactNode; children: React.ReactNode; empty?: string }) {
  const lines = Array.isArray(children) ? children.length : children ? 1 : 0;
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line px-4 py-3.5 sm:px-5">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      {add && <div className="border-b border-line bg-slate-50/60 px-4 py-3 sm:px-5">{add}</div>}
      <div className="hidden items-center gap-3 border-b border-line px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:px-5 md:flex">
        <div className="grid min-w-0 flex-1 gap-3" style={{ gridTemplateColumns: template }}>
          {headers.map((h) => (
            <span key={h}>{h}</span>
          ))}
        </div>
        <span className="min-w-[4.75rem]" />
        <span className="w-[16rem] text-right">Status</span>
      </div>
      {lines === 0 ? <p className="px-5 py-6 text-sm text-slate-500">{empty ?? "Nothing here yet."}</p> : <div className="divide-y divide-line">{children}</div>}
    </section>
  );
}

/** One line of a list: the editable fields on the left, the count, the status and the on/off button on the right. */
function Line({ children, side }: { children: React.ReactNode; side: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-5">
      {children}
      <div className="flex w-full items-center justify-end gap-3 md:w-[16rem]">{side}</div>
    </div>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  if (!canAny(user, ["settings.view", "catalog.manage"])) redirect("/forbidden");
  const canCatalog = can(user, "catalog.manage");
  const canSettings = can(user, "settings.manage");
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "business";

  const [categories, brands, units, locations, profile, currency, activeBaseUse, cashSettings, expenseCategories, returnsNeedApproval] = await Promise.all([
    db.category.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { products: true } } } }),
    db.brand.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { products: true } } } }),
    db.unit.findMany({ orderBy: { name: "asc" } }),
    db.location.findMany({ where: { type: { not: "RESELLER" } }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    getBusinessProfile(),
    getCurrency(),
    db.product.groupBy({ by: ["baseUnitId"], where: { status: "ACTIVE" }, _count: { _all: true } }),
    getCashSettings(db),
    db.expenseCategory.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { expenses: true } } } }),
    getReturnsNeedApproval(),
  ]);
  const baseUse = new Map(activeBaseUse.map((r) => [r.baseUnitId, r._count._all]));

  return (
    <>
      <PageHeader
        title="Settings"
        description="Business details and the lists used when registering products and stock."
        actions={
          <>
            <Link href="/settings/whatsapp" className="btn-secondary">
              WhatsApp report
            </Link>
            <Link href="/settings/reminders" className="btn-secondary">
              Payment reminders
            </Link>
          </>
        }
      />

      <nav className="mb-5 flex flex-wrap gap-2" aria-label="Settings">
        {TABS.map((t) => (
          <Link key={t.key} href={t.key === "business" ? "/settings" : `/settings?tab=${t.key}`} className={cn("rounded-full border px-4 py-1.5 text-sm font-medium transition", tab === t.key ? "border-navy-600 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900")}>
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "business" && (
        <section className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3.5 sm:px-5">
            <h2 className="text-base font-semibold text-slate-900">Business</h2>
            <p className="mt-0.5 text-sm text-slate-500">Shown in the app header and printed on receipts.</p>
          </div>
          <div className="px-4 py-4 sm:px-5">
            <EntityForm
              action={saveBusinessProfile}
              submitLabel="Save"
              disabled={!canSettings}
              fields={[
                { name: "businessName", label: "Business name", value: profile.name, required: true },
                { name: "businessPhone", label: "Phone", value: profile.phone },
                { name: "businessAddress", label: "Address", value: profile.address },
                { name: "creditTermsDays", label: "Credit period (days)", value: String(profile.creditTermsDays), hint: "How long customers have to pay a credit sale before it is overdue." },
                { name: "returnsNeedApproval", label: "Returns and cancellations", type: "select" as const, value: returnsNeedApproval ? "yes" : "no", options: [{ value: "no", label: "Done at once (the owner is told)" }, { value: "yes", label: "The owner must approve first" }], hint: "Goods always go back to the store and the money back to the customer. A reason is always needed." },
                { name: "paymentAccounts", label: "Payment accounts text (a fallback)", type: "textarea" as const, value: profile.paymentAccountsManual, span: 2 as const, hint: profile.paymentAccountsSource === "accounts" ? "Not used right now: payment reminders copy the bank and mobile-money accounts from Accounts. This text is only used when none of them has a number." : "Payment reminders copy the bank and mobile-money accounts from Accounts once they have numbers. Until then this text is used. Each account on its own lines, with a blank line between accounts." },
              ]}
            />
          </div>
          <p className="border-t border-line bg-slate-50/60 px-4 py-3 text-sm text-slate-500 sm:px-5">
            Currency: <span className="font-medium text-slate-700">{currency.code}</span> ({currency.symbol}). It cannot be changed, because every recorded amount depends on it.
          </p>
        </section>
      )}

      {tab === "expenses" && (
        <div className="space-y-5">
          <section className="card overflow-hidden">
            <div className="border-b border-line px-4 py-3.5 sm:px-5">
              <h2 className="text-base font-semibold text-slate-900">Spending without asking you</h2>
              <p className="mt-0.5 text-sm text-slate-500">0 means no approval is needed: every expense is recorded and paid straight away. Type an amount only if you want bigger expenses to wait for your OK.</p>
            </div>
            <div className="max-w-md px-4 py-4 sm:px-5">
              <EntityForm action={saveCashSettings} submitLabel="Save" disabled={!canSettings} fields={[{ name: "expenseApprovalLimit", label: `Limit (${currency.symbol})`, value: cashSettings.expenseApprovalLimit.toString() }]} />
            </div>
          </section>

          <ListCard
            title="Expense categories"
            description="What the shop's expenses are called. A category can have its own limit; empty uses the general one."
            headers={["Name", "Own limit"]}
            template="minmax(0,1.6fr) minmax(0,1fr)"
            add={canSettings ? <ListRow action={saveExpenseCategory} fields={[{ name: "name", label: "New category" }, { name: "approvalLimit", label: "Own limit (optional)", placeholder: `Own limit (${formatMoney(cashSettings.expenseApprovalLimit, currency)})` }]} template="minmax(0,1.6fr) minmax(0,1fr)" button="Add" primary /> : undefined}
          >
            {expenseCategories.map((c) => (
              <Line
                key={c.id}
                side={
                  <>
                    <span className="mr-auto text-xs text-slate-500 md:mr-0">
                      {c._count.expenses} expense{c._count.expenses === 1 ? "" : "s"}
                    </span>
                    <StatusBadge status={c.status} />
                    {canSettings && (
                      <form action={setExpenseCategoryStatus}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="status" value={c.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"} />
                        <button type="submit" className={c.status === "ACTIVE" ? "btn-danger btn-sm" : "btn-secondary btn-sm"}>
                          {c.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                        </button>
                      </form>
                    )}
                  </>
                }
              >
                <ListRow action={saveExpenseCategory} hidden={{ id: c.id }} fields={[{ name: "name", label: "Name", value: c.name }, { name: "approvalLimit", label: "Own limit", value: c.approvalLimit?.toString() ?? "", placeholder: "General limit" }]} template="minmax(0,1.6fr) minmax(0,1fr)" button="Save" disabled={!canSettings} />
              </Line>
            ))}
          </ListCard>
        </div>
      )}

      {tab === "products" && (
        <div className="space-y-5">
          <ListCard
            title="Categories"
            description="Group your products, for example Engine Oil or Transmission Fluid."
            headers={["Name", "Description"]}
            template="minmax(0,1.2fr) minmax(0,2fr)"
            empty="No categories yet."
            add={canCatalog ? <ListRow action={saveCategory} fields={[{ name: "name", label: "New category" }, { name: "description", label: "Description (optional)" }]} template="minmax(0,1.2fr) minmax(0,2fr)" button="Add" primary /> : undefined}
          >
            {categories.map((c) => (
              <Line
                key={c.id}
                side={
                  <>
                    <span className="mr-auto text-xs text-slate-500 md:mr-0">
                      {c._count.products} product{c._count.products === 1 ? "" : "s"}
                    </span>
                    <StatusBadge status={c.status} />
                    {canCatalog && <StatusForm entity="category" id={c.id} status={c.status} />}
                  </>
                }
              >
                <ListRow action={saveCategory} hidden={{ id: c.id }} fields={[{ name: "name", label: "Name", value: c.name }, { name: "description", label: "Description", value: c.description ?? "" }]} template="minmax(0,1.2fr) minmax(0,2fr)" button="Save" disabled={!canCatalog} />
              </Line>
            ))}
          </ListCard>

          <ListCard
            title="Brands"
            description="Optional. Used to filter and report by brand."
            headers={["Name"]}
            template="minmax(0,1fr)"
            empty="No brands yet."
            add={canCatalog ? <ListRow action={saveBrand} fields={[{ name: "name", label: "New brand" }]} template="minmax(0,1fr)" button="Add" primary /> : undefined}
          >
            {brands.map((b) => (
              <Line
                key={b.id}
                side={
                  <>
                    <span className="mr-auto text-xs text-slate-500 md:mr-0">
                      {b._count.products} product{b._count.products === 1 ? "" : "s"}
                    </span>
                    <StatusBadge status={b.status} />
                    {canCatalog && <StatusForm entity="brand" id={b.id} status={b.status} />}
                  </>
                }
              >
                <ListRow action={saveBrand} hidden={{ id: b.id }} fields={[{ name: "name", label: "Name", value: b.name }]} template="minmax(0,1fr)" button="Save" disabled={!canCatalog} />
              </Line>
            ))}
          </ListCard>

          <ListCard
            title="Units"
            description="Litres, bottles, cartons, drums. “Fractions” is for units that can be sold in parts, like litres."
            headers={["Name", "Symbol", "Fractions"]}
            template="minmax(0,1.4fr) minmax(0,1fr) minmax(0,0.9fr)"
            add={canCatalog ? <ListRow action={saveUnit} fields={[{ name: "name", label: "New unit" }, { name: "symbol", label: "Symbol" }, { name: "allowsDecimal", label: "Allow", kind: "checkbox" }]} template="minmax(0,1.4fr) minmax(0,1fr) minmax(0,0.9fr)" button="Add" primary /> : undefined}
          >
            {units.map((u) => (
              <Line
                key={u.id}
                side={
                  <>
                    <StatusBadge status={u.status} />
                    {canCatalog && <StatusForm entity="unit" id={u.id} status={u.status} blockedReason={u.status === "ACTIVE" && (baseUse.get(u.id) ?? 0) > 0 ? "Used by products" : undefined} />}
                  </>
                }
              >
                <ListRow action={saveUnit} hidden={{ id: u.id }} fields={[{ name: "name", label: "Name", value: u.name }, { name: "symbol", label: "Symbol", value: u.symbol }, { name: "allowsDecimal", label: "Allow", kind: "checkbox", value: u.allowsDecimal }]} template="minmax(0,1.4fr) minmax(0,1fr) minmax(0,0.9fr)" button="Save" disabled={!canCatalog} />
              </Line>
            ))}
          </ListCard>
        </div>
      )}

      {tab === "locations" && (
        <ListCard
          title="Stock locations"
          description="The warehouse and any shop that holds stock. The default one is used when none is chosen."
          headers={["Name", "Code", "Type", "Address", "Default"]}
          template="minmax(0,1.5fr) minmax(0,0.7fr) minmax(0,0.9fr) minmax(0,1.4fr) minmax(0,0.8fr)"
          add={canSettings ? <ListRow action={saveLocation} fields={[{ name: "name", label: "New location" }, { name: "code", label: "Code" }, { name: "type", label: "Type", kind: "select", value: "SHOP", options: TYPES }, { name: "address", label: "Address (optional)" }]} template="minmax(0,1.5fr) minmax(0,0.7fr) minmax(0,0.9fr) minmax(0,1.4fr) minmax(0,0.8fr)" button="Add" primary /> : undefined}
        >
          {locations.map((l) => (
            <Line
              key={l.id}
              side={
                <>
                  {l.isDefault && <span className="badge-blue mr-auto md:mr-0">Default</span>}
                  <StatusBadge status={l.status} />
                  {canSettings && <StatusForm entity="location" id={l.id} status={l.status} blockedReason={l.isDefault ? "Default location" : undefined} />}
                </>
              }
            >
              <ListRow
                action={saveLocation}
                hidden={{ id: l.id }}
                fields={[
                  { name: "name", label: "Name", value: l.name },
                  { name: "code", label: "Code", value: l.code },
                  { name: "type", label: "Type", kind: "select", value: l.type, options: TYPES },
                  { name: "address", label: "Address", value: l.address ?? "" },
                  ...(l.isDefault ? [] : [{ name: "isDefault", label: "Make default", kind: "checkbox" as const }]),
                ]}
                template="minmax(0,1.5fr) minmax(0,0.7fr) minmax(0,0.9fr) minmax(0,1.4fr) minmax(0,0.8fr)"
                button="Save"
                disabled={!canSettings}
              />
            </Line>
          ))}
        </ListCard>
      )}
    </>
  );
}
