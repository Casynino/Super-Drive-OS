import {
  Boxes,
  Briefcase,
  Building2,
  CalendarCheck,
  ChartColumn,
  ClipboardCheck,
  HandCoins,
  Handshake,
  History,
  House,
  Landmark,
  LayoutDashboard,
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
  Warehouse,
  ScanLine,
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
  /** shown ONLY to people who have any of these (the same screen listed under another group for everyone else) */
  onlyIf?: PermissionKey[];
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
    items: [
      // the shop attendant's home IS the POS (Home is hidden for them, see (app)/layout.tsx); the overview of the day is its own page
      { label: "Home", href: "/dashboard", icon: House, permissions: [], ready: true, also: ["/warehouse"] },
      // the warehouse attendant scans pickup notes all day: Scan sits right under Home (Nino 2026-11-08)
      { label: "Scan", href: "/warehouse/scan", icon: ScanLine, permissions: ["warehouse.operate"], ready: true },
      { label: "POS", href: "/pos", icon: ShoppingCart, permissions: ["sales.pos"], ready: true },
      { label: "Today", href: "/overview", icon: LayoutDashboard, permissions: ["sales.pos"], hideIfAny: ["dashboard.view"], ready: true },
    ],
  },
  {
    label: "Selling",
    icon: ShoppingCart,
    items: [
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
      { label: "Overview", href: "/inventory", icon: Boxes, permissions: ["inventory.view"], ready: true, hideIfAny: ["warehouse.operate"] },
      { label: "Orders", href: "/shipments", icon: Truck, permissions: ["shipments.manage", "shipments.receive"], ready: true, badge: "incoming", also: ["/inventory/receiving"], hideIfAny: ["warehouse.operate"] },
      { label: "Scan", href: "/scan", icon: ScanBarcode, permissions: ["inventory.view", "sales.pos"], ready: LABELS_ENABLED },
      { label: "Deliveries", href: "/inventory/receiving", icon: PackageCheck, permissions: ["inventory.receive", "inventory.movements", "purchasing.view"], ready: true, hideIfAny: ["shipments.manage", "shipments.receive"] },
      // Transfers, Movements and Adjustments are tabs at the top of the Products page (Nino 2026-11-08), so Products stays lit on them
      { label: "Products", href: "/products", icon: Package, permissions: ["products.view"], ready: true, also: ["/items", "/inventory/transfers", "/inventory/movements", "/inventory/adjustments"], hideIfAny: ["warehouse.operate"] },
      { label: "Suppliers", href: "/suppliers", icon: Building2, permissions: ["suppliers.view", "suppliers.manage", "suppliers.pay"], ready: true },
    ],
  },
  {
    label: "Warehouse",
    icon: Warehouse,
    items: [
      // Nino 2026-11-08: Stock first, then Issues, then Pickups above Receiving, then the rest
      { label: "Overview", href: "/warehouse/overview", icon: Warehouse, permissions: ["warehouse.view"], ready: true },
      { label: "Stock", href: "/warehouse/stock", icon: Boxes, permissions: ["warehouse.operate", "warehouse.view"], ready: true },
      { label: "Issues", href: "/warehouse/discrepancies", icon: ScrollText, permissions: ["warehouse.operate", "warehouse.view"], ready: true },
      { label: "Pickups", href: "/warehouse/orders", icon: ClipboardCheck, permissions: ["warehouse.operate", "warehouse.view"], ready: true },
      // the warehouse person has everything under Warehouse: Products (everyone else finds it under Stock), then Receiving goes down (Nino 2026-11-08)
      { label: "Products", href: "/products", icon: Package, permissions: ["products.view"], ready: true, onlyIf: ["warehouse.operate"], also: ["/items", "/inventory/transfers", "/inventory/movements", "/inventory/adjustments"] },
      { label: "Receiving", href: "/shipments", icon: Truck, permissions: ["shipments.receive"], ready: true, badge: "incoming", hideIfAny: ["shipments.manage"], also: ["/inventory/receiving"] },
      { label: "Collected", href: "/warehouse/history", icon: PackageCheck, permissions: ["warehouse.operate", "warehouse.view"], ready: true },
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
      { label: "Closing", href: "/closing", icon: CalendarCheck, permissions: ["closing.submit", "closing.approve"], ready: true },
      { label: "Deposit history", href: "/closing/history", icon: History, permissions: ["closing.submit"], ready: true },
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
