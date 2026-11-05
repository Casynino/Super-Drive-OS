# Super Drive Oil — Architecture & Roadmap (spec v2)

Written 2026-11-05 after the second specification ("Complete Business Management & POS System", Owner + Shop Attendant, resellers, daily cash closing, WhatsApp reports). It maps the new requirements onto what is already built. Decisions marked **[confirm]** wait for Nino's answer.

## 1. Existing architecture (built, committed, tested)
Next.js 16 · TypeScript · Prisma 7 · PostgreSQL (local `superdrive_dev`; Neon only when Nino says push) · Tailwind 4. 42 database tests + 23 unit tests.

| Area | State |
|---|---|
| Auth, DB sessions, lockout, forced password change, audit log (append-only) | Done |
| Roles/permissions editable in the UI, enforced server-side on every action | Done |
| Products, categories, brands, units, packaging (carton = 12 bottles) | Done (no images, no price history table) |
| Stock engine: atomic movements, immutable ledger, weighted-average cost, multi-location | Done |
| Receiving (direct), transfers, damage/increase/decrease/count, valuation, movement ledger | Done |
| POS (list style), cash / mobile / bank, part payment, credit with limits + manager exception, receipts (A4) | Done |
| Customers, credit limits, collections across invoices, advance credit, statements, credit dashboard | Done |

Everything above stays. The new spec **extends** it; only the items in section 2 change existing behaviour.

## 2. Gaps and changes to existing features
1. **Roles**: Owner = Super Admin (exists). "Shop Attendant" replaces the Salesperson role (same key, new name + wider defaults, section 4). Attendants never see costs, profit, valuation or supplier prices (already true for costs/valuation; extend to every new screen).
2. **Receiving becomes two-step**: Owner creates an expected `Shipment` (supplier, products, quantities, costs). Attendant confirms what physically arrived (multiple sessions, damaged, missing, unexpected). Stock increases only on confirmation. Today's direct receipt stays for the Owner (opening stock, quick receipts) and becomes the "confirmation" record.
3. **Discounts** (decided: **no limit, no approval**): anyone with the discount permission may discount any amount, but a reason is mandatory. Stored per sale: original price, charged price, reason, who gave it. (An owner-set limit can be added later without changing the data.)
4. **POS**: product cards with images and category filters, simple cart, one-click checkout. Price is never typed; only quantity (and the discount flow above).
5. **Product images** and **price history** (new tables). A price change never alters past sales (already true: sale lines snapshot prices).
6. **Reversals**: cancel / return a completed sale with an authorised reversal (stock back, money refunded or credited). Required before go-live; the spec lists it in several places.
7. **Receipts**: 80 mm thermal layout, logo, reprint marked "COPY", PDF.
8. **Attendant dashboard** (big actions, today's numbers, shop OPEN / CLOSED / AWAITING CLOSING) and **Owner dashboard** (clickable metrics, charts, drill-down). Dashboards read real records only.

## 3. Database additions (all new tables follow the existing rules: Decimal money, no hard deletes, immutable posted records, submission keys, audit)
- **Images/price**: `ProductImage` (productId, mime, bytes or url, sizes), `ProductPriceHistory` (productId, field, old, new, changedBy, at).
- **Shipments**: `Shipment` (no, supplierId, status EXPECTED/PARTIAL/COMPLETE/CANCELLED, locationId), `ShipmentItem` (expectedQty, unit cost), `ShipmentReceiving` (a confirmation session) + items (receivedQty, damagedQty, note). Confirmation writes the existing `StockReceipt` + stock movements. Discrepancy over a configurable threshold creates an `ApprovalRequest`.
- **Approvals & notifications**: `ApprovalRequest` (type, status PENDING/APPROVED/REJECTED/USED/EXPIRED, payload JSON, requestedBy, decidedBy, reason, expiresAt), `Notification` (userId, type, title, link, readAt).
- **Reversals**: `SaleReversal` (saleId, type CANCEL/RETURN, items, reason, approvedBy) + reversing stock movements + refund/credit records. The original sale is never edited.
- **Resellers**: `Reseller` (profile), reseller **custody location** (a `Location` of type RESELLER, so the existing stock engine tracks custody), `ResellerIssue` + items (price snapshot), `ResellerSalesReport` + items, `ResellerReturn`. See section 7.
- **Cash**: `CashAccount` (CASH / MOBILE_MONEY / BANK per branch), `CashTransaction` (append-only ledger, signed, typed, references the source record, `businessDate`, `closingId`), `Expense` + `ExpenseCategory` (+ limits, approval), `BankDeposit` (reference, slip image), `DailyClosing`.
- **Reports**: `WhatsAppReport` (businessDate, kind, part n/m, status, attempts, error, sentAt; unique per date+kind+part).
- **Branches**: `Location` already supports shops/warehouses; add `Branch` only when a second shop exists. Every new table carries `locationId`/`branchId` from the start so expansion needs no rewrite.

## 4. Role and permission matrix (defaults; the Owner can edit every cell in Settings → Roles)
| Capability | Owner | Shop Attendant | Manager | Accountant |
|---|---|---|---|---|
| Products, prices, images, costs | all | view name/image/**selling price**/qty only | view | view cost |
| Create shipment (expected stock) | yes | no | no | no |
| Confirm / receive shipment | yes | **yes** (no costs shown) | yes | no |
| POS sale, walk-in default, cash/mobile/bank | yes | **yes** | yes | no |
| Discount | any (reason required) | any (reason required) | any (reason required) | no |
| Credit sale, credit-limit exception | yes | credit if enabled; exception no | exception yes | no |
| Issue stock to reseller, record reseller sales/returns | yes | **yes** | yes | view |
| Record customer / reseller payments | yes | **yes** | yes | yes |
| Record expense | yes | **yes** (limit, above = approval) | yes | yes |
| Daily closing, bank deposit | review/approve | **submit** | approve | view |
| Cancel / return a sale | yes | request only | approve | no |
| Profit, valuation, supplier prices, analytics, audit, users | yes | **never** | limited | financial only |

All of it is enforced in server actions and queries, not just hidden in screens (existing pattern: `guarded()` + per-query field filtering).

## 5. Inventory flow
`Owner: Shipment(expected)` → `Attendant: ShipmentReceiving(confirm actual)` → discrepancy? → (major) `ApprovalRequest` → `StockReceipt` + `moveStock(RECEIVED)` → Owner notified. Shop sale: `moveStock(SOLD)`. Reseller issue: transfer shop → reseller custody location (`TRANSFER_OUT/IN`). Reseller sold: `SOLD` at the custody location. Reseller return: transfer back. Damaged: `DAMAGED` movement. "Available shop stock" = non-reseller locations; **total business stock** = all locations incl. custody, shown separately so the Owner sees where every unit is. All movements keep the existing engine guarantees (atomic, no negative stock, immutable ledger, reference + user).

## 6. Sales and payment flow
Cart → server recomputes prices → discount within limit? else `ApprovalRequest` (cart fingerprint, single use, expires) → one transaction: invoice + lines + stock + payment + allocation + **cash ledger entry** (account by method). Credit sale: invoice only, no cash entry. Collections: payment + allocation + cash entry; never new revenue. Reversal: new records, never edits. (Sale/payment/allocation core already built and tested.)

## 7. Reseller / consignment (proposed accounting)
- **Issue** = custody transfer. Not a sale, not cash, not a receivable. Records price snapshot and expected value.
- **Sold report** (attendant records what the reseller sold) = the agreed sale. It creates a normal invoice (channel RESELLER, customer = the reseller's account) deducting stock from the custody location. Revenue and receivable are recognised here, once.
- **Collection** = existing payment + allocation against those invoices (partial, multiple). No new revenue.
- **Return / damaged** = custody → shop transfer, or `DAMAGED` movement; price differences need Owner approval.
- **Outright credit sale** to a reseller stays a normal credit invoice (separate arrangement, as the spec requires).
- Reseller dashboard numbers all derive from these records: received, expected value, reported sold, returned, remaining (= custody stock), collected, outstanding (= invoiced − collected), last settlement, overdue (settlement period setting). **Decided:** revenue is recognised when the sold report is recorded, not when stock is issued.

## 8. Daily cash reconciliation
Per `CashAccount`: `Expected closing = opening + cash sales + collections + reseller collections − cash expenses − withdrawals − deposits`. Every term is a `CashTransaction` row written in the same DB transaction as its source, with a unique (type, reference) so nothing is counted twice. Mobile money and bank are separate accounts, never mixed with physical cash. Credit sales create no cash row.
Closing: attendant counts cash → system shows expected → difference stored → submit **locks** the closing and stamps `closingId` on every included transaction (a transaction can belong to only one closing). Bank deposit moves value cash → bank (transfer, not income); partial deposits allowed; the remainder is carried forward as the next day's opening cash. Corrections after locking = authorised adjustment records, history preserved. A discrepancy above the threshold needs Owner approval.

## 9. CallMeBot (WhatsApp) reporting
- Sender: server-side only. API key in an environment variable (never in the browser or database); owner's number and send time in Settings.
- Scheduler: a protected endpoint (`/api/cron/daily-report`, secret header) triggered by a scheduler at 20:00 Africa/Dar_es_Salaam (17:00 UTC). If the closing is submitted: summary message, then the detailed report split into numbered parts (`PART 1/3`). If not: an exception message "daily closing pending". Figures only from real records.
- Reliability: each message is a `WhatsAppReport` row (unique per date + kind + part → no duplicates), sent in order with spacing, bounded retries, status/error logged. Manual "send now" for the Owner.
- Limits to plan for: CallMeBot is rate-limited and messages are short; long reports are sent as several parts over a few minutes, so the job must be able to resume (drains pending parts on each run). Exact-time cron needs a scheduler that supports it (**[confirm]** hosting plan at Phase 9; Vercel Hobby cron is once a day with hour-level precision).
- One-time setup by the Owner: activate CallMeBot for his WhatsApp number to get his API key.

## 10. Design direction
Adopt the reference layouts: soft rounded cards with icon tiles and trend chips, donut and area charts, POS as a product-card grid with category pills and a live cart, receipt preview. Keep Super Drive Oil's identity (navy `#0E3D6E`, red `#ED1C24`, oil yellow `#FDC400`) rather than the references' purple/teal. Attendant screens: large touch targets, minimal text, no accounting words.

## 10b. Separation of duties (decided 2026-11-05, Nino)
The owner and the shop attendant do **different jobs from different screens**; both sign in on the same page with their own accounts.
- **Owner (Super Admin)** holds every *management* permission but **not** the shop-floor jobs: no POS, no recording payments, no receiving/counting stock, no expenses, no daily closing, no return requests (`SHOP_FLOOR_PERMISSIONS` in `src/lib/permissions.ts`; `can()` enforces it on the server). The owner can still *grant* those permissions to staff (`canGrant`). Owner's work: buy stock and announce shipments, add products and pictures, set prices, manage staff and settings, watch dashboards, approve/reject, investigate problems.
- **Shop Attendant** gets the shop-floor permissions and **never** costs, profit, valuation, other people's sales, approvals, staff or settings. Dashboard = big action buttons + own day.
- Dashboards: owner = KPI tiles (change vs previous period, click-through), sales trend, sales by category, best sellers, staff performance, "needs attention", debtors; shop = quick actions, own sales/money today, stock to watch.

### Shipments / receiving document (next to build; the "Target Express" flow)
1. **Owner** creates an *incoming shipment*: supplier, reference/tracking, expected date, lines (existing product, or **new product created right there** with category, brand, packaging and picture), expected quantity, landed cost (TZS). Nothing changes in stock.
2. **Attendant** sees it under "Incoming stock". When it arrives they open the **receiving document**: per line *expected / received good / damaged*, *missing* is calculated, plus a note; they can add an unexpected item. It is a **draft they can edit** until they confirm; partial deliveries are separate sessions.
3. **Confirm** locks the session: good quantity enters stock (cost from the owner's line, hidden from the attendant), damaged is written off, missing is recorded.
4. Any damaged / missing / unexpected line sends the shipment to the owner as **"needs investigation"** (notification + report). The owner records the outcome (supplier claim, accept loss, recount). A clean receipt just completes.
Direct receiving (opening stock) goes through the same document so the owner never touches stock himself.

## 11. Roadmap (re-sequenced; recommendation in bold)
Done: foundation, inventory, POS/sales, customers & credit (spec v2 phases 1–4).
- **5. Alignment — done:** product images, price history, POS product cards, discount reason, catalogue import, sale return/cancel with owner approval + refunds, notifications bell, Shop Attendant role, separation of duties, owner and shop dashboards.
- **5b. Shipments / receiving document** (see 10b) — **next**, ahead of cash and closing because it is the owner's main daily job.
- **6. Cash & closing**: cash accounts + ledger (hooked into payments), expenses (limits/approval), bank deposits, daily closing + carry-forward. *Recommended before resellers* so reseller money lands in the cash ledger from day one.
- **7. Shipments**: owner-created expected shipments and attendant confirmation.
- **8. Resellers / consignment** (section 7).
- **9. Dashboards & analytics**: owner (drill-down, trends, insights, forecasts labelled as estimates), attendant dashboard.
- **10. CallMeBot reporting**.
- **11. Receipts (80 mm / PDF / reprint) and UI polish**.
- **12. Security, load/concurrency testing, production readiness** (backups, Neon migration plan, rate limits).
After each phase: typecheck, unit + database tests, browser check, local commit. Nothing is pushed until Nino says so.
