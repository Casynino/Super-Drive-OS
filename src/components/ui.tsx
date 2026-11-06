import Link from "next/link";
import BackLink from "@/components/BackLink";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6">
      {back && (
        <BackLink href={back.href} className="mb-2 inline-block py-1 text-sm text-slate-500 hover:text-navy-700">
          ← {back.label}
        </BackLink>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-sm text-slate-500">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon && <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-navy-50 text-navy-600">{icon}</div>}
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: "ACTIVE" | "INACTIVE" }) {
  return <span className={status === "ACTIVE" ? "badge-green" : "badge-gray"}>{status === "ACTIVE" ? "Active" : "Inactive"}</span>;
}

export function Alert({ kind = "error", children }: { kind?: "error" | "success" | "info"; children: React.ReactNode }) {
  const styles = {
    error: "border-red-200 bg-brand-red-soft text-brand-red-dark",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    info: "border-navy-100 bg-navy-50 text-navy-800",
  } as const;
  return (
    <div role={kind === "error" ? "alert" : "status"} className={cn("rounded-lg border px-3.5 py-2.5 text-sm", styles[kind])}>
      {children}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="card card-pad">
      <p className="text-[13px] font-medium text-slate-500">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function DetailGrid({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((i) => (
        <div key={i.label}>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{i.label}</dt>
          <dd className="mt-1 text-sm text-slate-900">{i.value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
