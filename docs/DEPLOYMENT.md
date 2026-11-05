# Super Drive Oil — going live checklist

Nothing here is done automatically. **Do not push or deploy until Nino says "push".** Local work uses `superdrive_dev`.

## 1. Environment variables (Vercel project settings — never commit them)
| Name | What it is |
|---|---|
| `DATABASE_URL` | The Neon **pooled** connection string (production database). |
| `ADMIN_NAME`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Used **only once** by `npm run db:seed` to create the owner (password 12+ characters). Remove after the first run. |
| `CALLMEBOT_API_KEY` | From callmebot.com after linking the owner's WhatsApp number. Optional; without it the WhatsApp report is off. |
| `CRON_SECRET` | A long random value (16+ characters). Vercel sends it as `Authorization: Bearer …` to `/api/cron/daily-report`. |

## 2. First deploy of the database
1. Create the Neon project/branch for production. **Never point a local command at it by accident**: check `DATABASE_URL` first.
2. `npx prisma migrate deploy` (applies every migration, including the guards/triggers).
3. `npm run db:seed` (permissions, built-in roles, units, default location *Main Store*, cash accounts, starting expense categories, the owner account).
4. `npm run db:import-catalog` (the 11 products with pictures; **no prices, no stock**).
5. After any release that adds permissions, run `npm run db:seed` again so the built-in roles receive them (the owner's edits are never overwritten).

## 3. First-day setup (done by the owner, in this order)
1. Sign in, change the password. Create the shop attendant account(s) (Employees → role *Shop Attendant*).
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
`npm test`, `npm run test:db`, `npm run typecheck`, `npm run build` must all pass (they did at the last commit).
