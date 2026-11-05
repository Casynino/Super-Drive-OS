import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader, StatusBadge } from "@/components/ui";
import EntityForm from "@/components/EntityForm";
import { can, canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { getBusinessName, getCurrency } from "@/lib/settings";
import { saveBrand, saveBusinessName, saveCategory, saveLocation, saveUnit, setEntityStatus } from "./actions";

export const metadata = { title: "Settings" };

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

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="border-b border-line px-4 py-4 sm:px-5">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <p className="mt-0.5 text-sm text-slate-500">{description}</p>
      </div>
      <div className="divide-y divide-slate-100">{children}</div>
    </section>
  );
}

const Row = ({ children, dim }: { children: React.ReactNode; dim?: boolean }) => (
  <div className={`flex flex-wrap items-end justify-between gap-3 px-4 py-3 sm:px-5 ${dim ? "bg-slate-50/70" : ""}`}>{children}</div>
);

export default async function SettingsPage() {
  const user = await requireUser();
  if (!canAny(user, ["settings.view", "catalog.manage"])) redirect("/forbidden");
  const canCatalog = can(user, "catalog.manage");
  const canSettings = can(user, "settings.manage");

  const [categories, brands, units, locations, businessName, currency, activeBaseUse] = await Promise.all([
    db.category.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { products: true } } } }),
    db.brand.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { products: true } } } }),
    db.unit.findMany({ orderBy: { name: "asc" } }),
    db.location.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    getBusinessName(),
    getCurrency(),
    db.product.groupBy({ by: ["baseUnitId"], where: { status: "ACTIVE" }, _count: { _all: true } }),
  ]);
  const baseUse = new Map(activeBaseUse.map((r) => [r.baseUnitId, r._count._all]));

  return (
    <>
      <PageHeader
        title="Settings"
        description="Business details and the lists used when registering products and stock."
        actions={
          can(user, "roles.manage") && (
            <Link href="/settings/roles" className="btn-secondary">
              Roles &amp; permissions
            </Link>
          )
        }
      />

      <div className="space-y-6">
        <Section title="Business" description="Shown in the app header and on receipts.">
          <div className="px-4 py-4 sm:px-5">
            <EntityForm
              layout="inline"
              action={saveBusinessName}
              submitLabel="Save"
              disabled={!canSettings}
              fields={[{ name: "businessName", label: "Business name", value: businessName, required: true }]}
            />
            <p className="mt-3 text-sm text-slate-500">
              Currency: <span className="font-medium text-slate-700">{currency.code}</span> ({currency.symbol}). Fixed because every recorded amount depends on it.
            </p>
          </div>
        </Section>

        <Section title="Categories" description="Group your products, e.g. Engine Oil, Gear Oil, Grease, Filters.">
          {canCatalog && (
            <Row dim>
              <EntityForm
                layout="inline"
                action={saveCategory}
                submitLabel="Add category"
                fields={[
                  { name: "name", label: "New category", required: true, placeholder: "e.g. Engine Oil" },
                  { name: "description", label: "Description (optional)" },
                ]}
              />
            </Row>
          )}
          {categories.length === 0 && <p className="px-5 py-6 text-sm text-slate-500">No categories yet.</p>}
          {categories.map((c) => (
            <Row key={c.id}>
              {canCatalog ? (
                <EntityForm
                  layout="inline"
                  action={saveCategory}
                  submitLabel="Save"
                  submitClass="btn-secondary"
                  hidden={{ id: c.id }}
                  fields={[
                    { name: "name", label: "Name", value: c.name },
                    { name: "description", label: "Description", value: c.description ?? "" },
                  ]}
                />
              ) : (
                <span className="text-sm font-medium">{c.name}</span>
              )}
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500">{c._count.products} products</span>
                <StatusBadge status={c.status} />
                {canCatalog && <StatusForm entity="category" id={c.id} status={c.status} />}
              </div>
            </Row>
          ))}
        </Section>

        <Section title="Brands" description="Optional. Used to filter and report by brand.">
          {canCatalog && (
            <Row dim>
              <EntityForm layout="inline" action={saveBrand} submitLabel="Add brand" fields={[{ name: "name", label: "New brand", required: true, placeholder: "e.g. Castrol" }]} />
            </Row>
          )}
          {brands.length === 0 && <p className="px-5 py-6 text-sm text-slate-500">No brands yet.</p>}
          {brands.map((b) => (
            <Row key={b.id}>
              {canCatalog ? (
                <EntityForm layout="inline" action={saveBrand} submitLabel="Save" submitClass="btn-secondary" hidden={{ id: b.id }} fields={[{ name: "name", label: "Name", value: b.name }]} />
              ) : (
                <span className="text-sm font-medium">{b.name}</span>
              )}
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500">{b._count.products} products</span>
                <StatusBadge status={b.status} />
                {canCatalog && <StatusForm entity="brand" id={b.id} status={b.status} />}
              </div>
            </Row>
          ))}
        </Section>

        <Section title="Units of measurement" description="Litres, bottles, cartons, drums… “Allow fractions” is for units that can be sold in parts, like litres.">
          {canCatalog && (
            <Row dim>
              <EntityForm
                layout="inline"
                action={saveUnit}
                submitLabel="Add unit"
                fields={[
                  { name: "name", label: "New unit", required: true, placeholder: "e.g. Pail" },
                  { name: "symbol", label: "Symbol", required: true, placeholder: "e.g. pail" },
                  { name: "allowsDecimal", label: "Allow fractions", type: "checkbox" },
                ]}
              />
            </Row>
          )}
          {units.map((u) => (
            <Row key={u.id}>
              {canCatalog ? (
                <EntityForm
                  layout="inline"
                  action={saveUnit}
                  submitLabel="Save"
                  submitClass="btn-secondary"
                  hidden={{ id: u.id }}
                  fields={[
                    { name: "name", label: "Name", value: u.name },
                    { name: "symbol", label: "Symbol", value: u.symbol },
                    { name: "allowsDecimal", label: "Allow fractions", type: "checkbox", value: u.allowsDecimal },
                  ]}
                />
              ) : (
                <span className="text-sm font-medium">
                  {u.name} ({u.symbol})
                </span>
              )}
              <div className="flex items-center gap-3">
                <StatusBadge status={u.status} />
                {canCatalog && (
                  <StatusForm
                    entity="unit"
                    id={u.id}
                    status={u.status}
                    blockedReason={u.status === "ACTIVE" && (baseUse.get(u.id) ?? 0) > 0 ? "Used by active products" : undefined}
                  />
                )}
              </div>
            </Row>
          ))}
        </Section>

        <Section title="Stock locations" description="Warehouses and shops that hold stock. The default location is used when none is chosen.">
          {canSettings && (
            <Row dim>
              <EntityForm
                layout="inline"
                action={saveLocation}
                submitLabel="Add location"
                fields={[
                  { name: "name", label: "New location", required: true, placeholder: "e.g. Town Shop" },
                  { name: "code", label: "Code", required: true, placeholder: "TOWN" },
                  {
                    name: "type",
                    label: "Type",
                    type: "select",
                    value: "SHOP",
                    options: [
                      { value: "WAREHOUSE", label: "Warehouse" },
                      { value: "SHOP", label: "Shop" },
                      { value: "OTHER", label: "Other" },
                    ],
                  },
                  { name: "address", label: "Address (optional)" },
                ]}
              />
            </Row>
          )}
          {locations.map((l) => (
            <Row key={l.id}>
              {canSettings ? (
                <EntityForm
                  layout="inline"
                  action={saveLocation}
                  submitLabel="Save"
                  submitClass="btn-secondary"
                  hidden={{ id: l.id }}
                  fields={[
                    { name: "name", label: "Name", value: l.name },
                    { name: "code", label: "Code", value: l.code },
                    {
                      name: "type",
                      label: "Type",
                      type: "select",
                      value: l.type,
                      options: [
                        { value: "WAREHOUSE", label: "Warehouse" },
                        { value: "SHOP", label: "Shop" },
                        { value: "OTHER", label: "Other" },
                      ],
                    },
                    { name: "address", label: "Address", value: l.address ?? "" },
                    ...(l.isDefault ? [] : [{ name: "isDefault", label: "Make default", type: "checkbox" as const }]),
                  ]}
                />
              ) : (
                <span className="text-sm font-medium">{l.name}</span>
              )}
              <div className="flex items-center gap-3">
                {l.isDefault && <span className="badge-blue">Default</span>}
                <StatusBadge status={l.status} />
                {canSettings && <StatusForm entity="location" id={l.id} status={l.status} blockedReason={l.isDefault ? "Default location" : undefined} />}
              </div>
            </Row>
          ))}
        </Section>
      </div>
    </>
  );
}
