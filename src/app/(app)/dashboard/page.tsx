import Link from "next/link";
import { CheckCircle2, Circle, ShoppingCart } from "lucide-react";
import { PageHeader, Stat } from "@/components/ui";
import { can } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getCurrency } from "@/lib/settings";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
  const showStats = can(user, "dashboard.view");
  const viewAllSales = can(user, "sales.view_all");
  const seesSales = viewAllSales || can(user, "sales.view_own");

  // "Today" in the business time zone (UTC+3, no daylight saving)
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date());
  const [todaySales, currency] = await Promise.all([
    seesSales
      ? db.sale.aggregate({
          where: { status: "COMPLETED", createdAt: { gte: new Date(`${today}T00:00:00+03:00`), lte: new Date(`${today}T23:59:59.999+03:00`) }, ...(viewAllSales ? {} : { salespersonId: user.id }) },
          _sum: { total: true, amountPaid: true },
          _count: true,
        })
      : null,
    getCurrency(),
  ]);

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
      <PageHeader
        title={`Welcome, ${user.name.split(" ")[0]}`}
        description="Here is where your business stands today."
        actions={
          can(user, "sales.pos") && (
            <Link href="/pos" className="btn-primary">
              <ShoppingCart size={16} /> Open POS
            </Link>
          )
        }
      />

      {todaySales && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Stat label={viewAllSales ? "Sales today" : "Your sales today"} value={formatMoney(todaySales._sum.total ?? 0, currency)} hint={`${todaySales._count} sale${todaySales._count === 1 ? "" : "s"}`} />
          <Stat label="Collected on those sales" value={formatMoney(todaySales._sum.amountPaid ?? 0, currency)} hint="Paid at the time of sale" />
        </div>
      )}

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
