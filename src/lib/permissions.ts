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
  { key: "inventory.valuation", module: "Inventory", label: "See inventory value" },
  { key: "inventory.receive", module: "Inventory", label: "Receive stock" },
  { key: "inventory.transfer", module: "Inventory", label: "Transfer stock between locations" },
  { key: "inventory.count", module: "Inventory", label: "Conduct stock counts" },
  { key: "inventory.report_damage", module: "Inventory", label: "Report damaged or missing stock" },
  { key: "inventory.adjust", module: "Inventory", label: "Adjust stock quantities" },

  // Purchasing & suppliers
  { key: "purchasing.view", module: "Purchasing", label: "View purchase orders" },
  { key: "purchasing.create", module: "Purchasing", label: "Create purchase orders" },
  { key: "suppliers.view", module: "Suppliers", label: "View suppliers and balances" },
  { key: "suppliers.manage", module: "Suppliers", label: "Add and edit suppliers" },
  { key: "suppliers.pay", module: "Suppliers", label: "Record supplier payments" },

  // Returns
  { key: "returns.create", module: "Returns", label: "Record returns and exchanges" },
  { key: "returns.approve", module: "Returns", label: "Approve returns and refunds" },

  // Finance
  { key: "expenses.view", module: "Finance", label: "View expenses" },
  { key: "expenses.create", module: "Finance", label: "Record expenses" },
  { key: "finance.view", module: "Finance", label: "View financial overview" },
  { key: "finance.reconcile", module: "Finance", label: "Reconcile cash and payment methods" },

  // Daily closing
  { key: "closing.submit", module: "Daily Closing", label: "Submit daily closing" },
  { key: "closing.approve", module: "Daily Closing", label: "Approve daily closing" },

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

export const PERMISSION_KEYS: readonly string[] = PERMISSIONS.map((p) => p.key);

export type DefaultRole = {
  key: string;
  name: string;
  description: string;
  isSuperAdmin?: boolean;
  permissions: PermissionKey[];
};

export const DEFAULT_ROLES: DefaultRole[] = [
  {
    key: "SUPER_ADMIN",
    name: "Super Admin / Owner",
    description: "Full access to the entire system.",
    isSuperAdmin: true,
    permissions: [], // implicit: a super admin role always has every permission
  },
  {
    key: "MANAGER",
    name: "Manager",
    description: "Supervises daily operations, reviews credit sales and approves operational transactions.",
    permissions: [
      "dashboard.view",
      "sales.pos",
      "sales.view_all",
      "sales.credit",
      "sales.discount",
      "customers.view",
      "customers.create",
      "customers.edit",
      "credit.view",
      "credit.approve_exception",
      "payments.view",
      "payments.record",
      "products.view",
      "inventory.view",
      "purchasing.view",
      "suppliers.view",
      "returns.create",
      "returns.approve",
      "expenses.view",
      "closing.submit",
      "closing.approve",
      "reports.view",
      "employees.view",
    ],
  },
  {
    key: "SALESPERSON",
    name: "Salesperson",
    description: "Records daily sales. Credit sales and recording payments must be enabled by the owner.",
    permissions: [
      "sales.pos",
      "sales.view_own",
      "customers.view",
      "customers.create",
      "products.view",
      "inventory.view",
      "returns.create",
      "closing.submit",
    ],
  },
  {
    key: "STOREKEEPER",
    name: "Storekeeper / Inventory Officer",
    description: "Receives stock, records transfers, counts and damaged stock.",
    permissions: [
      "products.view",
      "inventory.view",
      "inventory.receive",
      "inventory.transfer",
      "inventory.count",
      "inventory.report_damage",
      "purchasing.view",
    ],
  },
  {
    key: "ACCOUNTANT",
    name: "Accountant / Finance Officer",
    description: "Financial reconciliation, payments and financial reports.",
    permissions: [
      "dashboard.view",
      "dashboard.financials",
      "sales.view_all",
      "customers.view",
      "credit.view",
      "payments.view",
      "payments.record",
      "products.view",
      "products.cost",
      "inventory.view",
      "inventory.valuation",
      "purchasing.view",
      "suppliers.view",
      "suppliers.pay",
      "expenses.view",
      "expenses.create",
      "finance.view",
      "finance.reconcile",
      "reports.view",
      "reports.financial",
    ],
  },
];
