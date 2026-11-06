#!/usr/bin/env bash
# Puts SAMPLE DATA into the local development database so every screen can be seen with data in it.
# 1. checks the database is the local superdrive_dev one and holds no business records yet
# 2. saves a full backup in .backups/   (npm run db:demo-undo puts it back)
# 3. plays ~70 days of a small oil shop through the real engines (scripts/demo-data.ts)
# Never run this against production. It refuses anything but local superdrive_dev.
set -euo pipefail
cd "$(dirname "$0")/.."

URL="${DEMO_DATABASE_URL:-$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')}"
NAME="$(echo "${URL%%\?*}" | sed -E 's#^.*/##')"
ALLOWED="${DEMO_ALLOW_DB:-superdrive_dev}"
if ! echo "$URL" | grep -Eq '^postgres(ql)?://([^@/]*@)?(localhost|127\.0\.0\.1)'; then echo "Refusing: the database is not on this computer."; exit 1; fi
if [ "$NAME" != "superdrive_dev" ] && [ "$NAME" != "$ALLOWED" ]; then echo "Refusing: sample data only goes into superdrive_dev (found: $NAME)."; exit 1; fi

PGURL="${URL%%\?*}"
BUSY="$(psql "$PGURL" -Atc "select (select count(*) from \"Sale\") + (select count(*) from \"StockReceipt\") + (select count(*) from \"Shipment\")")"
if [ "$BUSY" != "0" ]; then echo "Refusing: $NAME already has sales, receipts or purchase orders ($BUSY). Run npm run db:demo-undo first if this is old sample data."; exit 1; fi

mkdir -p .backups
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE=".backups/${NAME}-before-demo-${STAMP}.dump"
pg_dump -Fc "$PGURL" -f "$FILE"
echo "Backup saved: $FILE"

export DATABASE_URL="$URL"
npx prisma migrate deploy >/dev/null
DEMO_ALLOW_DB="$NAME" npx tsx scripts/demo-data.ts
echo
echo "Sample data is in. Restart the dev server if it was running. To remove it again: npm run db:demo-undo"
