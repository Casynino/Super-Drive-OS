import {
  ArrowDownUp,
  ArrowLeftRight,
  Boxes,
  Briefcase,
  Building2,
  CalendarCheck,
  ChartColumn,
  ClipboardCheck,
  HandCoins,
  Handshake,
  House,
  Landmark,
  Package,
  PackageCheck,
  Receipt,
  ReceiptText,
  ScanBarcode,
  ScrollText,
  Settings,
  ShoppingCart,
  Truck,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { PermissionKey } from "@/lib/permissions";
import { LABELS_ENABLED } from "@/lib/features";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** User needs ANY of these. Empty = every signed-in user. */
  permissions: PermissionKey[];
  /** false = module not built yet; hidden from the menu so there are no dead links. */
  ready: boolean;
  /** other pages that belong to this item, so it stays lit while you are on them */
  also?: string[];
  /** hidden for people who have any of these: for them this screen lives inside another one (kept for roles that have no other way in) */
  hideIfAny?: PermissionKey[];
  /** a count shown beside the item (computed on the server for the signed-in person) */
  badge?: "approvals" | "incoming";
};

export type NavGroup = { label: string; icon?: LucideIcon; items: NavItem[] };

/**
 * The menu, ordered the way the work goes: what is done all day first, what is checked now and then last.
 * Inside each group the most-used screens come first. A group with no label is shown without a heading.
 */
export const NAV: NavGroup[] = [
  {
    label: "",
    items: [{ label: "Home", href: "/dashboard", icon: House, permissions: [], ready: true }],
  },
  {
    label: "Selling",
    icon: ShoppingCart,
    items: [
      { label: "POS", href: "/pos", icon: ShoppingCart, permissions: ["sales.pos"], ready: true },
      { label: "Sales", href: "/sales", icon: Receipt, permissions: ["sales.view_own", "sales.view_all"], ready: true },
      { label: "Credit", href: "/credit", icon: HandCoins, permissions: ["credit.view"], ready: true },
      { label: "Winga", href: "/resellers", icon: Handshake, permissions: ["resellers.view"], ready: true },
      { label: "Customers", href: "/customers", icon: Users, permissions: ["customers.view"], ready: true },
    ],
  },
  {
    label: "Stock",
    icon: Boxes,
    items: [
      { label: "Overview", href: "/inventory", icon: Boxes, permissions: ["inventory.view"], ready: true },
      { label: "Orders", href: "/shipments", icon: Truck, permissions: ["shipments.manage", "shipments.receive"], ready: true, badge: "incoming", also: ["/inventory/receiving"] },
      { label: "Scan", href: "/scan", icon: ScanBarcode, permissions: ["inventory.view", "sales.pos"], ready: LABELS_ENABLED },
      { label: "Deliveries", href: "/inventory/receiving", icon: PackageCheck, permissions: ["inventory.receive", "inventory.movements", "purchasing.view"], ready: true, hideIfAny: ["shipments.manage", "shipments.receive"] },
      { label: "Products", href: "/products", icon: Package, permissions: ["products.view"], ready: true, also: ["/items"] },
      { label: "Suppliers", href: "/suppliers", icon: Building2, permissions: ["suppliers.view", "suppliers.manage", "suppliers.pay"], ready: true },
      { label: "Transfers", href: "/inventory/transfers", icon: ArrowLeftRight, permissions: ["inventory.transfer", "inventory.movements"], ready: true },
      { label: "Movements", href: "/inventory/movements", icon: ArrowDownUp, permissions: ["inventory.movements"], ready: true },
      { label: "Adjustments", href: "/inventory/adjustments", icon: ClipboardCheck, permissions: ["inventory.adjust", "inventory.count", "inventory.report_damage", "inventory.movements"], ready: true },
    ],
  },
  {
    label: "Money",
    icon: Wallet,
    items: [
      { label: "Ledger", href: "/ledger", icon: ScrollText, permissions: ["cash.view"], ready: true },
      { label: "Income", href: "/payments", icon: Wallet, permissions: ["payments.view"], ready: true },
      { label: "Expenses", href: "/expenses", icon: ReceiptText, permissions: ["expenses.view", "expenses.create"], ready: true },
      { label: "Accounts", href: "/cash", icon: Landmark, permissions: ["cash.view"], ready: true },
      { label: "End of day", href: "/closing", icon: CalendarCheck, permissions: ["closing.submit", "closing.approve"], ready: true },
    ],
  },
  {
    label: "Management",
    icon: Briefcase,
    items: [
      { label: "Audit", href: "/audit", icon: ScrollText, permissions: ["audit.view"], ready: true },
      { label: "Roles", href: "/employees", icon: UserCog, permissions: ["employees.view", "employees.manage"], ready: true, also: ["/settings/roles"] },
      { label: "Reports", href: "/reports", icon: ChartColumn, permissions: ["reports.view", "reports.financial"], ready: true },
      { label: "Settings", href: "/settings", icon: Settings, permissions: ["settings.view", "catalog.manage"], ready: true },
    ],
  },
];
