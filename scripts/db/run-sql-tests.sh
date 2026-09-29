#!/usr/bin/env bash
# Runs every supabase/tests/*.sql file against DATABASE_URL (defaults to the local stack).
# Each file rolls itself back. Fails on the first failed assertion.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
DB_URL="${DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:54322/postgres}"
export PGOPTIONS="-c client_min_messages=warning"
for file in supabase/tests/*.sql; do
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$file"
done
