import {
  ArrowDownUp,
  ArrowLeftRight,
  Banknote,
  BadgeCheck,
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
  QrCode,
  Receipt,
  ReceiptText,
  ScanBarcode,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Truck,
  UserCog,
  Users,
  Wallet,
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
      { label: "Sales / POS", href: "/pos", icon: ShoppingCart, permissions: ["sales.pos"], ready: true },
      { label: "Customers", href: "/customers", icon: Users, permissions: ["customers.view"], ready: true },
      { label: "Sales History", href: "/sales", icon: Receipt, permissions: ["sales.view_own", "sales.view_all"], ready: true },
      { label: "Credit Management", href: "/credit", icon: HandCoins, permissions: ["credit.view"], ready: true },
      { label: "Resellers", href: "/resellers", icon: Handshake, permissions: ["resellers.view"], ready: true },
    ],
  },
  {
    label: "Stock",
    icon: Boxes,
    items: [
      { label: "Stock Overview", href: "/inventory", icon: Boxes, permissions: ["inventory.view"], ready: true },
      { label: "Incoming Stock", href: "/shipments", icon: Truck, permissions: ["shipments.manage", "shipments.receive"], ready: true, badge: "incoming" },
      { label: "Scan", href: "/scan", icon: ScanBarcode, permissions: ["inventory.view", "sales.pos"], ready: true },
      { label: "Items & Labels", href: "/items", icon: QrCode, permissions: ["inventory.view"], ready: true },
      { label: "Stock Receiving", href: "/inventory/receiving", icon: PackageCheck, permissions: ["inventory.receive", "inventory.movements", "purchasing.view"], ready: true },
      { label: "Products", href: "/products", icon: Package, permissions: ["products.view"], ready: true },
      { label: "Stock Transfers", href: "/inventory/transfers", icon: ArrowLeftRight, permissions: ["inventory.transfer", "inventory.movements"], ready: true },
      { label: "Stock Adjustments", href: "/inventory/adjustments", icon: ClipboardCheck, permissions: ["inventory.adjust", "inventory.count", "inventory.report_damage", "inventory.movements"], ready: true },
      { label: "Stock Movements", href: "/inventory/movements", icon: ArrowDownUp, permissions: ["inventory.movements"], ready: true },
    ],
  },
  {
    label: "Money",
    icon: Wallet,
    items: [
      { label: "Payments", href: "/payments", icon: Wallet, permissions: ["payments.view"], ready: true },
      { label: "Expenses", href: "/expenses", icon: ReceiptText, permissions: ["expenses.view", "expenses.create"], ready: true },
      { label: "Cash & Accounts", href: "/cash", icon: Landmark, permissions: ["cash.view"], ready: true },
      { label: "Bank Deposits", href: "/deposits", icon: Banknote, permissions: ["deposits.record", "cash.view"], ready: true },
      { label: "Daily Closing", href: "/closing", icon: CalendarCheck, permissions: ["closing.submit", "closing.approve"], ready: true },
      { label: "Supplier Accounts", href: "/suppliers", icon: Building2, permissions: ["suppliers.view", "suppliers.manage", "suppliers.pay"], ready: true },
    ],
  },
  {
    label: "Management",
    icon: Briefcase,
    items: [
      { label: "Approvals", href: "/approvals", icon: BadgeCheck, permissions: ["returns.approve", "expenses.approve", "closing.approve"], ready: true, badge: "approvals" },
      { label: "Reports", href: "/reports", icon: ChartColumn, permissions: ["reports.view", "reports.financial"], ready: true },
      { label: "Employees", href: "/employees", icon: UserCog, permissions: ["employees.view", "employees.manage"], ready: true },
      { label: "Audit Logs", href: "/audit", icon: ScrollText, permissions: ["audit.view"], ready: true },
      { label: "Roles & Permissions", href: "/settings/roles", icon: ShieldCheck, permissions: ["roles.manage"], ready: true },
      { label: "Settings", href: "/settings", icon: Settings, permissions: ["settings.view", "catalog.manage"], ready: true },
    ],
  },
];
