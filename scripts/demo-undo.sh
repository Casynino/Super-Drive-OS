#!/usr/bin/env bash
# Takes the sample data out again by putting back the newest backup that npm run db:demo made (.backups/*-before-demo-*.dump).
# Local development database only. Everything done in that database AFTER the backup is lost, so it asks first.
# Use --yes to skip the question.
set -euo pipefail
cd "$(dirname "$0")/.."

URL="${DEMO_DATABASE_URL:-$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')}"
NAME="$(echo "${URL%%\?*}" | sed -E 's#^.*/##')"
ALLOWED="${DEMO_ALLOW_DB:-superdrive_dev}"
if ! echo "$URL" | grep -Eq '^postgres(ql)?://([^@/]*@)?(localhost|127\.0\.0\.1)'; then echo "Refusing: the database is not on this computer."; exit 1; fi
if [ "$NAME" != "superdrive_dev" ] && [ "$NAME" != "$ALLOWED" ]; then echo "Refusing: only superdrive_dev can be restored (found: $NAME)."; exit 1; fi

FILE="$(ls -1t .backups/${NAME}-before-demo-*.dump 2>/dev/null | head -1 || true)"
if [ -z "$FILE" ]; then echo "No backup found in .backups/ - nothing to restore."; exit 1; fi
echo "This puts the database '$NAME' back the way it was in: $FILE"
echo "Anything you entered after that backup (real or sample) is removed."
if [ "${1:-}" != "--yes" ]; then
  read -r -p "Type yes to continue: " ANSWER
  [ "$ANSWER" = "yes" ] || { echo "Cancelled."; exit 1; }
fi

PGURL="${URL%%\?*}"
BASE="${PGURL%/*}"
dropdb --force --if-exists --maintenance-db="$BASE/postgres" "$NAME"
createdb --maintenance-db="$BASE/postgres" "$NAME"
pg_restore --no-owner --no-privileges -d "$PGURL" "$FILE"
echo "Done: $NAME is back to the backup. Restart the dev server."
