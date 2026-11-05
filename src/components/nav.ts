import {
  ArrowLeftRight,
  CalendarCheck,
  ClipboardCheck,
  Boxes,
  Landmark,
  LayoutDashboard,
  Package,
  PackageCheck,
  PackageOpen,
  Receipt,
  ReceiptText,
  Inbox,
  ScrollText,
  Shuffle,
  Settings,
  ShieldCheck,
  ShoppingCart,
  HandCoins,
  Truck,
  UserCog,
  Users,
  Wallet,
  ChartColumn,
  type LucideIcon,
} from "lucide-react";
import type { PermissionKey } from "@/lib/permissions";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** User needs ANY of these. Empty = every signed-in user. */
  permissions: PermissionKey[];
  /** false = module not built yet; hidden from the menu so there are no dead links. */
  ready: boolean;
};

export type NavGroup = { label: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, permissions: [], ready: true }],
  },
  {
    label: "Operations",
    items: [
      { label: "Sales / POS", href: "/pos", icon: ShoppingCart, permissions: ["sales.pos"], ready: true },
      { label: "Sales History", href: "/sales", icon: Receipt, permissions: ["sales.view_own", "sales.view_all"], ready: true },
      { label: "Customers", href: "/customers", icon: Users, permissions: ["customers.view"], ready: true },
      { label: "Credit Management", href: "/credit", icon: HandCoins, permissions: ["credit.view"], ready: true },
    ],
  },
  {
    label: "Inventory",
    items: [
      { label: "Products", href: "/products", icon: Package, permissions: ["products.view"], ready: true },
      { label: "Incoming Stock", href: "/shipments", icon: PackageOpen, permissions: ["shipments.manage", "shipments.receive"], ready: true },
      { label: "Stock Overview", href: "/inventory", icon: Boxes, permissions: ["inventory.view"], ready: true },
      { label: "Stock Receiving", href: "/inventory/receiving", icon: PackageCheck, permissions: ["inventory.receive", "inventory.movements", "purchasing.view"], ready: true },
      { label: "Stock Transfers", href: "/inventory/transfers", icon: Shuffle, permissions: ["inventory.transfer", "inventory.movements"], ready: true },
      { label: "Stock Movements", href: "/inventory/movements", icon: ArrowLeftRight, permissions: ["inventory.movements"], ready: true },
      { label: "Stock Adjustments", href: "/inventory/adjustments", icon: ClipboardCheck, permissions: ["inventory.adjust", "inventory.count", "inventory.report_damage", "inventory.movements"], ready: true },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Payments", href: "/payments", icon: Wallet, permissions: ["payments.view"], ready: true },
      { label: "Expenses", href: "/expenses", icon: ReceiptText, permissions: ["expenses.view"], ready: false },
      { label: "Supplier Accounts", href: "/suppliers", icon: Truck, permissions: ["suppliers.view", "suppliers.manage"], ready: true },
      { label: "Financial Overview", href: "/finance", icon: Landmark, permissions: ["finance.view"], ready: false },
    ],
  },
  {
    label: "Management",
    items: [
      { label: "Employees", href: "/employees", icon: UserCog, permissions: ["employees.view", "employees.manage"], ready: true },
      { label: "Approvals", href: "/approvals", icon: Inbox, permissions: ["returns.approve"], ready: true },
      { label: "Daily Closing", href: "/closing", icon: CalendarCheck, permissions: ["closing.submit", "closing.approve"], ready: false },
      { label: "Reports", href: "/reports", icon: ChartColumn, permissions: ["reports.view", "reports.financial"], ready: false },
      { label: "Audit Logs", href: "/audit", icon: ScrollText, permissions: ["audit.view"], ready: true },
      { label: "Roles & Permissions", href: "/settings/roles", icon: ShieldCheck, permissions: ["roles.manage"], ready: true },
      { label: "Settings", href: "/settings", icon: Settings, permissions: ["settings.view", "catalog.manage"], ready: true },
    ],
  },
];
