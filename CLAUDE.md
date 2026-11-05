# Super Drive Oil — Sales, Inventory & Distribution System

Business rules and the full spec come from Nino's original brief (modules, roles, credit/debt, stock ledger, daily closing, audit).
Global rules in `~/.claude/CLAUDE.md` apply: **never `git push` or deploy unless Nino says "push" in chat**; commit locally only.

## Stack (decided 2026-11-05)
Next.js 16 (App Router, Turbopack) · TypeScript · Prisma 7 (`prisma-client` generator → `src/generated/prisma`, `@prisma/adapter-pg`) · PostgreSQL · Tailwind v4 · Zod 4 · Vitest.
Local DB: `superdrive_dev` on local Postgres 16 (`DATABASE_URL` in `.env`, never committed). Neon is for production only, used when Nino says push.

## Commands
- `npm run dev` (port 3100 via `.claude/launch.json`) · `npm run build` · `npm run typecheck` · `npm test` (unit)
- `npm run test:db` — DB integration tests (stock engine, concurrency, deadlocks, duplicates) on a throwaway `superdrive_test` DB; never touches dev/prod. Run it after any change under `src/lib/inventory`.
- `npx prisma migrate dev` (schema changes) · `npm run db:seed` (idempotent bootstrap)
- The seed creates permissions, the 5 built-in roles, base units, one default location, core settings, and the first Super Admin from `ADMIN_*` in `.env` (only if no users exist). It creates **no** business data.

## Architecture rules (keep)
- **Permissions**: registry in `src/lib/permissions.ts`; role→permission rows live in the DB and are editable at Settings → Roles. `isSuperAdmin` roles always pass. Every mutation is a server action wrapped in `guarded(permission, …)` (`src/lib/action.ts`); pages use `requirePagePermission`. Never rely on hidden UI.
- **Sessions**: DB-backed, cookie holds a random token, only its SHA-256 is stored; 12 h; deactivated users lose access immediately; 5 failed logins → 15 min lock.
- **Money** `Decimal(14,2)`, **quantities** `Decimal(14,3)`, unit factors `Decimal(14,4)`. Use `Prisma.Decimal`, never JS floats. Currency is TZS (0 decimals), stored in `Setting`, treated as fixed.
- **Stock is always in the product's base unit.** Packaging (carton = 12 bottles) lives in `ProductUnit.factor`; convert with `src/lib/units.ts` (rejects results that would need rounding). Base unit cannot change after creation. Product forms never set stock; stock changes only through stock movements (Phase 2+).
- **Stock engine** (`src/lib/inventory/engine.ts`): EVERY quantity change goes through `moveStock()` inside a `db.$transaction` — it atomically updates `StockBalance` (`UPDATE … WHERE quantity+delta >= 0`, so concurrent sales cannot oversell) and appends the `StockMovement` ledger row (signed qty, previous/new, unit cost, reference, user). Never update `StockBalance` or `Product.avgCost` any other way. Negative stock is **not** supported (DB CHECK); allowing it later means dropping that CHECK and adding a setting.
- Posted stock documents (`StockReceipt`, `StockTransfer`, `StockAdjustment` + items) and `StockMovement` are immutable (DB triggers). Fix mistakes with a new adjustment, never an edit. Documents carry a unique `submissionKey` (blocks double submits) and numbers from `nextDocumentNo` (GRN/TRF/ADJ-YYYY-000001; reuse for sales/payments).
- Lock order matters: sort lines by productId; `lockProducts` before reading/writing `avgCost`; transfers lock the two balance rows in locationId order. **Phase 3 sales** must call `moveStock(type SOLD)` and snapshot `Product.avgCost` as COGS under a product row lock (`FOR SHARE`/`FOR UPDATE`) so a concurrent receipt can't skew it.
- Costing = **weighted average per product across all locations** (`Product.avgCost`, 4 dp), updated only by receipts and stock-increasing adjustments. Receiving cost needs `products.cost`; without it stock is received at the product's `purchasePrice` (must be > 0). Damaged stock is removed from sellable stock as a `DAMAGED` movement valued at average cost.
- Permissions added in Phase 2: `inventory.movements` (view ledger/documents). A permission that is new in `permissions.ts` is auto-granted by the seed to built-in roles that list it (existing owner edits untouched).
- **Sales** (`src/lib/sales/post-sale.ts`, Phase 3): one transaction posts invoice + lines + stock (`SOLD` movements) + payment + allocation. Lock order: `INV` counter → customer row → products `FOR SHARE` → stock balances → `PAY` counter. Phase 4 payment collection must take the **customer row lock before anything else** and allocate through `PaymentAllocation`, updating `Sale.amountPaid`/`paymentStatus` in the same transaction (DB CHECKs reject an inconsistent status).
- **Money model**: a `Sale` is the invoice (revenue recognised once). Cash received is a `Payment` linked by `PaymentAllocation`; collecting on a credit invoice later must NEVER create a new sale. What a customer owes is always calculated (`customerOutstanding`), never stored. Payment *type* (full/part/credit) is separate from payment *method* (cash/mobile money/bank). Zero-total sales are not allowed (a zero amount never counts as paid).
- Prices: the server recomputes list prices from the DB (`listPrice`: unit override → base × factor; wholesale/distributor customers get wholesale price, falling back to retail). Browser only sends "what and how many". Charging below list needs `sales.discount`; above list is refused. Credit sales need `sales.credit`, a customer, and a credit limit > 0; going over the limit needs `credit.approve_exception` + a reason (audited as `credit.exception_approved`). Sales are never deleted or edited (DB trigger); cancellations/returns/refunds are a later phase.
- Salespeople without `sales.view_all` only ever see their own sales (other people's invoices return 404). Cost/profit on a sale is shown only with `dashboard.financials`.
- **Multiple stock locations** are supported from the start (`Location`; one default, enforced by a partial unique index).
- **No hard deletes** of business records; deactivate (`status`) or reverse. `AuditLog` is append-only (DB trigger blocks UPDATE/DELETE/TRUNCATE). Write audit rows in the same transaction as the change (`writeAudit(tx, …)`).
- DB CHECK constraints (non-negative prices, factor > 0) are in the init migration SQL; keep new guards there too.
- No sparkle/star icons anywhere. Brand colours: navy `#0E3D6E`, red `#ED1C24`, oil yellow `#FDC400`.
- Product photos in `PRODUCTS /` are reference images only; do not seed products from them.

## Roadmap status
- Phase 1 Foundation — **done** (auth, roles/permissions UI, employees, settings/catalog, locations, products + packaging units, audit viewer, app shell).
- Phase 2 Inventory — **done**: stock overview/valuation, receiving (supplier delivery or opening stock, packaging units), transfers, damage/increase/decrease/count adjustments, movement ledger, basic Suppliers (name/contact only).
- Phase 3 Sales — **done**: POS (search/scan, packaging units, wholesale prices, discounts, cash/mobile/bank, part payment, credit with limits + manager exceptions), sales history, printable receipt/invoice, customers (list/add/edit/credit limit, quick-add in POS), business profile (name/phone/address/credit period).
- Phase 4 Customers & debt (collections, allocation across invoices, advance credit, statements, overdue) · 5 Finance & closing (supplier payments/purchase orders, daily closing) · 6 Dashboard/reports/notifications · 7 QA — **not started**.
- Known gaps: sale cancellation / returns / refunds (a wrong sale can't be undone yet); the `INV` counter serialises sales (fine for a shop, revisit in QA if tills get busy); product image upload (needs storage choice, e.g. Vercel Blob); login lockout not covered by automated tests; purchase orders and supplier payables are Phase 5; receipts can't be reversed yet (correct with an adjustment); low-stock notifications are Phase 6 (overview page shows low/out of stock now).
