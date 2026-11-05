# Super Drive Oil — Sales, Inventory & Distribution System

Business rules and the full spec come from Nino's original brief (modules, roles, credit/debt, stock ledger, daily closing, audit).
Global rules in `~/.claude/CLAUDE.md` apply: **never `git push` or deploy unless Nino says "push" in chat**; commit locally only.

## Stack (decided 2026-11-05)
Next.js 16 (App Router, Turbopack) · TypeScript · Prisma 7 (`prisma-client` generator → `src/generated/prisma`, `@prisma/adapter-pg`) · PostgreSQL · Tailwind v4 · Zod 4 · Vitest.
Local DB: `superdrive_dev` on local Postgres 16 (`DATABASE_URL` in `.env`, never committed). Neon is for production only, used when Nino says push.

## Commands
- `npm run dev` (port 3100 via `.claude/launch.json`) · `npm run build` · `npm run typecheck` · `npm test`
- `npx prisma migrate dev` (schema changes) · `npm run db:seed` (idempotent bootstrap)
- The seed creates permissions, the 5 built-in roles, base units, one default location, core settings, and the first Super Admin from `ADMIN_*` in `.env` (only if no users exist). It creates **no** business data.

## Architecture rules (keep)
- **Permissions**: registry in `src/lib/permissions.ts`; role→permission rows live in the DB and are editable at Settings → Roles. `isSuperAdmin` roles always pass. Every mutation is a server action wrapped in `guarded(permission, …)` (`src/lib/action.ts`); pages use `requirePagePermission`. Never rely on hidden UI.
- **Sessions**: DB-backed, cookie holds a random token, only its SHA-256 is stored; 12 h; deactivated users lose access immediately; 5 failed logins → 15 min lock.
- **Money** `Decimal(14,2)`, **quantities** `Decimal(14,3)`, unit factors `Decimal(14,4)`. Use `Prisma.Decimal`, never JS floats. Currency is TZS (0 decimals), stored in `Setting`, treated as fixed.
- **Stock is always in the product's base unit.** Packaging (carton = 12 bottles) lives in `ProductUnit.factor`; convert with `src/lib/units.ts` (rejects results that would need rounding). Base unit cannot change after creation. Product forms never set stock; stock changes only through stock movements (Phase 2+).
- **Multiple stock locations** are supported from the start (`Location`; one default, enforced by a partial unique index).
- **No hard deletes** of business records; deactivate (`status`) or reverse. `AuditLog` is append-only (DB trigger blocks UPDATE/DELETE/TRUNCATE). Write audit rows in the same transaction as the change (`writeAudit(tx, …)`).
- DB CHECK constraints (non-negative prices, factor > 0) are in the init migration SQL; keep new guards there too.
- Costing method for valuation/COGS: **weighted average** (planned, Phase 2).
- No sparkle/star icons anywhere. Brand colours: navy `#0E3D6E`, red `#ED1C24`, oil yellow `#FDC400`.
- Product photos in `PRODUCTS /` are reference images only; do not seed products from them.

## Roadmap status
- Phase 1 Foundation — **done** (auth, roles/permissions UI, employees, settings/catalog, locations, products + packaging units, audit viewer, app shell).
- Phase 2 Inventory · 3 Sales/POS · 4 Customers & debt · 5 Finance & closing · 6 Dashboard/reports/notifications · 7 QA — **not started**.
- Known gaps: product image upload (needs storage choice, e.g. Vercel Blob); login lockout and concurrency not yet covered by automated tests.
