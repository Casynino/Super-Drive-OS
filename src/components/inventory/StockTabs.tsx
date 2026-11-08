import Link from "next/link";
import { can, canAny } from "@/lib/auth/can";
import { cn } from "@/lib/utils";

type Holder = Parameters<typeof canAny>[0];
export type StockTab = "products" | "transfers" | "movements" | "adjustments";

/**
 * The stock pages as tabs at the top of the Products page (Nino 2026-11-08: "transfers, movements and adjustments belong inside the product page, up there,
 * not in the side menu"). Each page keeps its own address; this strip is on all four. A tab only shows when the person may open that page.
 */
export default function StockTabs({ active, user }: { active: StockTab; user: Holder }) {
  const tabs: { key: StockTab; label: string; href: string; show: boolean }[] = [
    { key: "products", label: "Products", href: "/products", show: can(user, "products.view") },
    { key: "transfers", label: "Transfers", href: "/inventory/transfers", show: canAny(user, ["inventory.transfer", "inventory.movements"]) },
    { key: "movements", label: "Movements", href: "/inventory/movements", show: can(user, "inventory.movements") },
    { key: "adjustments", label: "Adjustments", href: "/inventory/adjustments", show: canAny(user, ["inventory.adjust", "inventory.count", "inventory.report_damage", "inventory.movements"]) },
  ];
  const shown = tabs.filter((t) => t.show);
  if (shown.length < 2) return null;
  return (
    <nav className="-mt-3 mb-4 flex gap-1.5 overflow-x-auto pb-1" aria-label="Stock pages">
      {shown.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={cn("shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition", t.key === active ? "border-navy-700 bg-navy-700 text-white" : "border-line bg-white text-slate-600 hover:border-navy-200 hover:text-slate-900")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
