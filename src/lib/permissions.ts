// Single source of truth for every permission in the system.
// The seed script syncs this list into the Permission table (idempotent).
// Which role has which permission is stored in the database and is editable by the Super Admin
// (Settings → Roles & Permissions). DEFAULT_ROLES below is only used to create the built-in roles
// the first time; it never overwrites changes the owner has made later.

export const PERMISSIONS = [
  // Dashboard
  { key: "dashboard.view", module: "Dashboard", label: "View dashboard" },
  { key: "dashboard.financials", module: "Dashboard", label: "See profit, cost and financial figures" },

  // Sales
  { key: "sales.pos", module: "Sales", label: "Use the POS and record sales" },
  { key: "sales.view_own", module: "Sales", label: "View own sales history" },
  { key: "sales.view_all", module: "Sales", label: "View all employees' sales" },
  { key: "sales.credit", module: "Sales", label: "Record credit sales" },
  { key: "sales.discount", module: "Sales", label: "Give discounts" },
  { key: "sales.cancel", module: "Sales", label: "Cancel / reverse a completed sale" },

  // Customers & credit
  { key: "customers.view", module: "Customers", label: "View customers" },
  { key: "customers.create", module: "Customers", label: "Register customers" },
  { key: "customers.edit", module: "Customers", label: "Edit customers" },
  { key: "customers.deactivate", module: "Customers", label: "Deactivate customers" },
  { key: "credit.view", module: "Credit", label: "View credit accounts and debts" },
  { key: "credit.set_limit", module: "Credit", label: "Set customer credit limits" },
  { key: "credit.approve_exception", module: "Credit", label: "Approve sales above a credit limit" },

  // Payments
  { key: "payments.view", module: "Payments", label: "View payments" },
  { key: "payments.record", module: "Payments", label: "Record customer payments" },

  // Products
  { key: "products.view", module: "Products", label: "View products" },
  { key: "products.create", module: "Products", label: "Add products" },
  { key: "products.edit", module: "Products", label: "Edit product details" },
  { key: "products.price", module: "Products", label: "Change selling prices" },
  { key: "products.cost", module: "Products", label: "See and change purchase prices" },
  { key: "products.deactivate", module: "Products", label: "Deactivate products" },
  { key: "catalog.manage", module: "Products", label: "Manage categories, brands and units" },

  // Inventory
  { key: "inventory.view", module: "Inventory", label: "View stock levels" },
  { key: "inventory.valuation", module: "Inventory", label: "See inventory value and stock costs" },
  { key: "inventory.movements", module: "Inventory", label: "View stock movement history and stock documents" },
  { key: "inventory.receive", module: "Inventory", label: "Receive stock" },
  { key: "inventory.transfer", module: "Inventory", label: "Transfer stock between locations" },
  { key: "inventory.count", module: "Inventory", label: "Conduct stock counts" },
  { key: "inventory.report_damage", module: "Inventory", label: "Report damaged or missing stock" },
  { key: "inventory.adjust", module: "Inventory", label: "Adjust stock quantities" },

  // Incoming stock (shipments)
  { key: "shipments.manage", module: "Shipments", label: "Announce incoming shipments and investigate problems" },
  { key: "shipments.receive", module: "Shipments", label: "Count and confirm incoming shipments" },

  // Store Warehouse
  { key: "warehouse.view", module: "Warehouse", label: "See the Store Warehouse overview, collections, history and who did what" },
  { key: "warehouse.operate", module: "Warehouse", label: "Prepare orders, scan pickup notes and release goods" },

  // Purchasing & suppliers
  { key: "purchasing.view", module: "Purchasing", label: "View purchase orders" },
  { key: "purchasing.create", module: "Purchasing", label: "Create purchase orders" },
  { key: "suppliers.view", module: "Suppliers", label: "View suppliers and balances" },
  { key: "suppliers.manage", module: "Suppliers", label: "Add and edit suppliers" },
  { key: "suppliers.pay", module: "Suppliers", label: "Record supplier payments" },

  // Resellers / consignment
  { key: "resellers.view", module: "Winga", label: "View winga and their stock accounts" },
  { key: "resellers.manage", module: "Winga", label: "Register, edit and deactivate winga" },
  { key: "resellers.operate", module: "Winga", label: "Issue stock to winga, record what they sold and what they return" },

  // Returns
  { key: "returns.create", module: "Returns", label: "Record returns and exchanges" },
  { key: "returns.approve", module: "Returns", label: "Approve returns and refunds" },

  // Finance
  { key: "expenses.view", module: "Finance", label: "View expenses" },
  { key: "expenses.create", module: "Finance", label: "Record expenses" },
  { key: "expenses.approve", module: "Finance", label: "Approve, reject and reverse expenses" },
  { key: "finance.view", module: "Finance", label: "View financial overview" },
  { key: "finance.reconcile", module: "Finance", label: "Reconcile cash and payment methods" },
  { key: "cash.view", module: "Finance", label: "View cash, mobile money and bank balances and the cash ledger" },
  { key: "cash.adjust", module: "Finance", label: "Set opening balances, record cash withdrawals and cash corrections" },

  // Daily closing
  { key: "closing.submit", module: "Daily Closing", label: "Submit daily closing" },
  { key: "closing.approve", module: "Daily Closing", label: "See every day's closing and its report" },
  { key: "deposits.record", module: "Daily Closing", label: "Record bank deposits" },

  // Reports & management
  { key: "reports.view", module: "Reports", label: "View operational reports" },
  { key: "reports.financial", module: "Reports", label: "View financial reports" },
  { key: "employees.view", module: "Management", label: "View employees" },
  { key: "employees.manage", module: "Management", label: "Add, edit and deactivate employees" },
  { key: "roles.manage", module: "Management", label: "Edit roles and permissions" },
  { key: "audit.view", module: "Management", label: "View audit logs" },
  { key: "settings.view", module: "Management", label: "View settings" },
  { key: "settings.manage", module: "Management", label: "Change system settings" },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

/**
 * SEPARATION OF DUTIES. These are the shop's day-to-day jobs: selling, taking payments, receiving stock,
 * recording expenses, requesting returns, closing the day. They belong to the Shop Attendant (and to a Manager
 * if the owner chooses). The business owner does NOT get them automatically, even as Super Admin: his job is to
 * buy stock, set prices, watch the numbers, approve and manage people. A Super Admin only holds one of these
 * if it is explicitly granted to his role.
 */
export const SHOP_FLOOR_PERMISSIONS: ReadonlySet<string> = new Set<PermissionKey>([
  "sales.pos",
  "sales.discount",
  "sales.credit",
  "payments.record",
  "inventory.receive",
  "shipments.receive",
  "inventory.report_damage",
  "inventory.count",
  "expenses.create",
  "returns.create",
  "closing.submit",
  "deposits.record",
  "resellers.operate",
  "warehouse.operate",
]);

export const PERMISSION_KEYS: readonly string[] = PERMISSIONS.map((p) => p.key);

export type DefaultRole = {
  key: string;
  name: string;
  description: string;
  isSuperAdmin?: boolean;
  permissions: PermissionKey[];
};

/** The three roles in the order they are listed on screen: Admin on top, then the warehouse, then the shop. */
export const POSITION_RANK = ["SUPER_ADMIN", "WAREHOUSE", "SALESPERSON"] as const;
export const byPositionRank = (a: { key: string }, b: { key: string }) => POSITION_RANK.indexOf(a.key as never) - POSITION_RANK.indexOf(b.key as never);

export const DEFAULT_ROLES: DefaultRole[] = [
  {
    key: "SUPER_ADMIN",
    name: "Admin",
    description: "The boss. Full access to the entire system, watches the warehouse and the shop and tracks everything people do.",
    isSuperAdmin: true,
    permissions: [], // implicit: a super admin role always has every permission
  },
  {
    key: "WAREHOUSE",
    name: "Warehouse Attendant",
    description: "Looks after the Store Warehouse: receives and counts goods from China, prepares orders, scans pickup notes and releases goods. Never sees prices, costs or money.",
    permissions: [
      "products.view",
      "inventory.view",
      "inventory.movements",
      "shipments.receive",
      "inventory.count",
      "inventory.report_damage",
      "warehouse.operate",
    ],
  },
  {
    key: "SALESPERSON",
    name: "Shop Attendant",
    description: "Sells at the POS: takes payments, records credit sales and expenses, and closes the day. Collects goods from the warehouse with the pickup note. Never receives stock and never sees costs, profit or business-wide finances.",
    permissions: [
      "sales.pos",
      "sales.view_own",
      "sales.discount",
      "sales.credit",
      "customers.view",
      "customers.create",
      "credit.view",
      "payments.record",
      "products.view",
      "inventory.view",
      "returns.create",
      "expenses.create",
      "closing.submit",
      "deposits.record",
      "resellers.view",
      "resellers.operate",
    ],
  },
];
