import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { PageHeader, Stat } from "@/components/ui";
import { can } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
  const showStats = can(user, "dashboard.view");

  const [products, categories, employees, locations] = showStats
    ? await Promise.all([
        db.product.count({ where: { status: "ACTIVE" } }),
        db.category.count({ where: { status: "ACTIVE" } }),
        db.user.count({ where: { status: "ACTIVE" } }),
        db.location.count({ where: { status: "ACTIVE" } }),
      ])
    : [0, 0, 0, 0];

  const steps = [
    { done: categories > 0, label: "Add product categories", href: "/settings", show: can(user, "catalog.manage") },
    { done: products > 0, label: "Register your products and selling prices", href: "/products/new", show: can(user, "products.create") },
    { done: employees > 1, label: "Add your staff and choose their roles", href: "/employees/new", show: can(user, "employees.manage") },
  ].filter((s) => s.show);

  return (
    <>
      <PageHeader title={`Welcome, ${user.name.split(" ")[0]}`} description="Here is where your business stands today." />

      {showStats ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Stat label="Active products" value={products} />
          <Stat label="Categories" value={categories} />
          <Stat label="Active staff" value={employees} />
          <Stat label="Stock locations" value={locations} />
        </div>
      ) : (
        <div className="card card-pad text-sm text-slate-600">Use the menu to open the sections available to your role.</div>
      )}

      {showStats && steps.some((s) => !s.done) && (
        <div className="card card-pad mt-6 max-w-xl">
          <h2 className="text-base font-semibold text-slate-900">Getting started</h2>
          <ul className="mt-3 space-y-2.5">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center gap-2.5 text-sm">
                {s.done ? <CheckCircle2 size={18} className="text-emerald-600" /> : <Circle size={18} className="text-slate-300" />}
                {s.done ? (
                  <span className="text-slate-400 line-through">{s.label}</span>
                ) : (
                  <Link href={s.href} className="font-medium text-navy-700 hover:underline">
                    {s.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
