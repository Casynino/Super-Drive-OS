#!/usr/bin/env bash
# Runs the database integration tests against a THROWAWAY database (superdrive_test).
# It never touches superdrive_dev or production.
set -euo pipefail
cd "$(dirname "$0")/.."
export DATABASE_URL="postgresql://$(whoami)@localhost:5432/superdrive_test"
dropdb --if-exists superdrive_test
createdb superdrive_test
npx prisma migrate deploy >/dev/null
npx vitest run --config vitest.db.config.mts "$@"
