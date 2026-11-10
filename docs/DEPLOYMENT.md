# Super Drive Oil — going live checklist

Nothing here is done automatically. **Do not push or deploy until Nino says "push".** Local work uses `superdrive_dev`.

## 1. Environment variables (Vercel project settings — never commit them)
| Name | What it is |
|---|---|
| `DATABASE_URL` | The Neon **pooled** connection string (the host contains `-pooler`, with `?sslmode=require`). The running app uses this one. |
| `DIRECT_URL` | The Neon **direct** (unpooled) connection string. `prisma migrate deploy` and the seed use it when it is set. Set it on the machine that runs the migrations; the app does not need it. |
| `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Used **only once** by `npm run db:seed` to create the first Director (a real email address, password 12+ characters). Staff sign in with their EMAIL. Remove these after the first run. |
| `APP_URL` | The public address, no trailing slash (links inside WhatsApp reports). |
| `CRON_SECRET` | A long random value (16+ characters). Vercel sends it as `Authorization: Bearer …` to every `/api/cron/*` job (daily report, payment reminders, weekly and monthly reports). |
| `CALLMEBOT_API_KEY` | From callmebot.com after linking the owner's WhatsApp number. Optional; without it the WhatsApp report is off. |
| `WHATSAPP_CLOUD_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Only for automatic payment reminders (WhatsApp Business Cloud API). Optional; the reminders stay off without them. |

Region: put the Vercel functions in the same region as the Neon database (every page makes several queries; distance multiplies them). The camera scanner needs the site on **https** (Vercel gives that) and the browser's camera permission.

## 2. First deploy of the database
1. Create the Neon project/branch for production. **Never point a local command at it by accident**: check `DATABASE_URL` / `DIRECT_URL` first.
2. `npx prisma migrate deploy` (applies every migration, including the guards/triggers). Migrations added on 2026-11-08 that production does not have yet: `stock_problem`, `warehouse_can_add_products`, `warehouse_can_adjust_stock`, `stock_problem_from_returns`, `warehouse_can_edit_products`, `foreign_key_indexes` and `drop_redundant_stock_balance_index` (additive indexes), `staff_sign_in_with_email` (every account gets a unique lowercase email; accounts without one get `<username>@superdrive.local`, so an EMPTY production database is unaffected). **Added 2026-11-10 and NOT yet on production:** `order_drafts_and_carton_price` (a new `ShipmentDraft` table and a nullable `ShipmentItem.packSellingPrice` column; both additive, existing rows untouched). Apply it BEFORE the push that ships the new order form, or the Orders page fails to read drafts.
3. `npm run db:seed` (permissions, built-in roles, units, default location, cash accounts, starting expense categories, the first Director).
4. `npm run db:import-catalog` (the 11 products with pictures; **no prices, no stock**).
5. After any release that adds permissions, run `npm run db:seed` again so the built-in roles receive them (the owner's edits are never overwritten).

## 3. First-day setup (done by the owner, in this order)
1. Sign in with the email and password from the seed, change the password. Create the staff accounts (Roles → Add member: full name, EMAIL, role, temporary password; they change it at first sign-in). There is no public sign-up and no self-service password reset: the Director resets a forgotten password from the member's page.
2. Products: set selling prices (and wholesale prices). Upload the two missing pictures (Total 15W-40 1L, Castrol 5W-30 5L).
3. Settings → Business: name, phone, address (printed on receipts). Settings → Expenses and daily closing: the expense limit without approval and the allowed cash difference (both start at 0 = everything needs approval).
4. Stock: announce the first shipment (Incoming Stock) or have the attendant record opening stock (Stock Receiving → Opening stock).
5. Cash & Accounts → *Record an entry → Opening balance* for cash on hand, mobile money and the bank (once per account) **before the first closing**.
6. Settings → WhatsApp report: your number, time, switch on. The Vercel cron runs once a day at 17:00 UTC = 20:00 Tanzania time (`vercel.json`; Hobby plans allow one run a day). A different time needs a scheduler that calls the endpoint more often.

## 4. Backups and recovery
- Neon keeps point-in-time history (check the retention of your plan). Before any risky change, create a Neon branch as a snapshot.
- Posted records are never edited or deleted (database triggers). Mistakes are corrected with reversals, returns, adjustments and cash corrections, so history is always intact.

## 5. Safety rules that protect the data
- Money is `Decimal`, quantities `Decimal`; stock changes only through the stock engine; cash changes only through the cash ledger; both are append-only.
- Double clicks and retries are harmless (unique submission keys); simultaneous actions are serialised with row locks and tested.
- Permissions are enforced on the server for every action and page; the owner never inherits shop-floor jobs.
- Login: 5 wrong passwords lock the account for 15 minutes; sessions last 12 hours and are stored hashed.

## 6. Before the first real day
`npm run typecheck`, `npm test`, `npm run test:db`, `npm run build` must pass, and a production build (`next build`, then `next start`) was driven page by page at phone, tablet and desktop widths (see the final audit report in `docs/AUDIT-2026-11-08.md`). After the real deploy: sign in on the live address, open the Warehouse scanner on a phone (the camera must ask for permission), make one test sale and release it, and check the browser console and the Vercel logs.
