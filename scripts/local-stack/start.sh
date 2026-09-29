#!/usr/bin/env bash
# Starts a Supabase-compatible stack without Docker: PostgreSQL + the Supabase auth
# server (GoTrue) + PostgREST + a tiny gateway (gateway.mjs) on one origin. Use this when
# `supabase start` is not available (no Docker). With Docker, prefer `npx supabase start`.
#
# Requires:
#   - PostgreSQL 15+ server binaries (PG_BIN, default /usr/lib/postgresql/16/bin)
#   - LOCAL_STACK_BIN_DIR containing `gotrue` and `postgrest` executables
#     (see docs/development.md → "Local stack without Docker" for how to build/fetch them)
#   - GOTRUE_MIGRATIONS_DIR: the auth server's migrations/ directory from its source tree
#
# Idempotent: re-running applies only migrations not yet applied and restarts services.
set -euo pipefail
shopt -s nullglob

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STACK_DIR="${LOCAL_STACK_DIR:-/tmp/english-learning-stack}"
BIN_DIR="${LOCAL_STACK_BIN_DIR:?Set LOCAL_STACK_BIN_DIR to the directory holding gotrue and postgrest}"
GOTRUE_MIGRATIONS_DIR="${GOTRUE_MIGRATIONS_DIR:-$BIN_DIR/gotrue-src/migrations}"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
PG_PORT="${LOCAL_PG_PORT:-54322}"
AUTH_PORT=9999
REST_PORT=3001
GATEWAY_PORT="${LOCAL_GATEWAY_PORT:-54321}"
JWT_SECRET="local-development-jwt-secret-at-least-32-characters"
DATA_DIR="$STACK_DIR/pgdata"
LOG_DIR="$STACK_DIR/logs"
DB_URL="postgres://postgres:postgres@127.0.0.1:$PG_PORT/postgres"

mkdir -p "$STACK_DIR" "$LOG_DIR"

as_postgres() {
  if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi
}

if [ ! -d "$DATA_DIR" ]; then
  mkdir -p "$DATA_DIR"
  [ "$(id -u)" = "0" ] && chown -R postgres:postgres "$STACK_DIR"
  echo "$(printf 'postgres')" > "$STACK_DIR/pwfile"
  [ "$(id -u)" = "0" ] && chown postgres "$STACK_DIR/pwfile"
  as_postgres "$PG_BIN/initdb" -D "$DATA_DIR" -U postgres --pwfile="$STACK_DIR/pwfile" --auth=md5 >"$LOG_DIR/initdb.log"
fi
[ "$(id -u)" = "0" ] && chown -R postgres:postgres "$STACK_DIR"

if ! as_postgres "$PG_BIN/pg_ctl" -D "$DATA_DIR" status >/dev/null 2>&1; then
  as_postgres "$PG_BIN/pg_ctl" -D "$DATA_DIR" -l "$LOG_DIR/postgres.log" \
    -o "-p $PG_PORT -k /tmp -c listen_addresses=127.0.0.1" -w start >/dev/null
fi

export PGPASSWORD=postgres PGOPTIONS="-c client_min_messages=warning"
psql_run() { psql "$DB_URL" -v ON_ERROR_STOP=1 -q "$@"; }
psql_run -f "$APP_DIR/scripts/local-stack/bootstrap.sql"

stop_pid() {
  local file="$STACK_DIR/$1.pid"
  if [ -f "$file" ] && kill -0 "$(cat "$file")" 2>/dev/null; then kill "$(cat "$file")" || true; sleep 0.5; fi
  rm -f "$file"
}

wait_for() {
  local url="$1" name="$2"
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null "$url"; then return 0; fi
    sleep 0.5
  done
  echo "$name did not start; see $LOG_DIR" >&2
  exit 1
}

# Auth server. It creates and migrates the auth schema itself on boot.
stop_pid gotrue
(
  export GOTRUE_DB_DRIVER=postgres
  export DATABASE_URL="postgres://supabase_auth_admin:postgres@127.0.0.1:$PG_PORT/postgres"
  export GOTRUE_DB_MIGRATIONS_PATH="$GOTRUE_MIGRATIONS_DIR"
  export GOTRUE_API_HOST=127.0.0.1 PORT=$AUTH_PORT
  export API_EXTERNAL_URL="http://127.0.0.1:$GATEWAY_PORT/auth/v1"
  export GOTRUE_SITE_URL="${SITE_URL:-http://127.0.0.1:3000}"
  export GOTRUE_URI_ALLOW_LIST="http://127.0.0.1:3000/**,http://localhost:3000/**"
  export GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated
  export GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role
  export GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_DISABLE_SIGNUP=false
  export GOTRUE_RATE_LIMIT_EMAIL_SENT=1000 GOTRUE_LOG_LEVEL=warn
  nohup "$BIN_DIR/gotrue" >"$LOG_DIR/gotrue.log" 2>&1 &
  echo $! >"$STACK_DIR/gotrue.pid"
)
wait_for "http://127.0.0.1:$AUTH_PORT/health" "auth server"
psql_run -f "$APP_DIR/scripts/local-stack/post-auth.sql"

# App migrations, tracked so a re-run applies only new files.
psql_run -c "create schema if not exists local_stack; create table if not exists local_stack.applied_migrations (name text primary key, applied_at timestamptz not null default now());"
for file in "$APP_DIR"/supabase/migrations/*.sql; do
  name="$(basename "$file")"
  applied="$(psql "$DB_URL" -tAc "select 1 from local_stack.applied_migrations where name = '$name'")"
  if [ -z "$applied" ]; then
    echo "applying $name"
    psql_run --single-transaction -f "$file"
    psql_run -c "insert into local_stack.applied_migrations (name) values ('$name')"
  fi
done

# PostgREST
stop_pid postgrest
cat >"$STACK_DIR/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:postgres@127.0.0.1:$PG_PORT/postgres"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$JWT_SECRET"
server-host = "127.0.0.1"
server-port = $REST_PORT
CONF
nohup "$BIN_DIR/postgrest" "$STACK_DIR/postgrest.conf" >"$LOG_DIR/postgrest.log" 2>&1 &
echo $! >"$STACK_DIR/postgrest.pid"
wait_for "http://127.0.0.1:$REST_PORT/" "PostgREST"

# Gateway
stop_pid gateway
AUTH_URL="http://127.0.0.1:$AUTH_PORT" REST_URL="http://127.0.0.1:$REST_PORT" GATEWAY_PORT=$GATEWAY_PORT \
  nohup node "$APP_DIR/scripts/local-stack/gateway.mjs" >"$LOG_DIR/gateway.log" 2>&1 &
echo $! >"$STACK_DIR/gateway.pid"
wait_for "http://127.0.0.1:$GATEWAY_PORT/auth/v1/health" "gateway"

eval "$(node "$APP_DIR/scripts/local-stack/jwt.mjs" "$JWT_SECRET")"
cat >"$APP_DIR/.env.local" <<ENV
# Written by scripts/local-stack/start.sh — local development keys only.
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:$GATEWAY_PORT
NEXT_PUBLIC_SUPABASE_ANON_KEY=$LOCAL_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$LOCAL_SERVICE_ROLE_KEY
DATABASE_URL=$DB_URL
ENV
echo "Local stack ready: API http://127.0.0.1:$GATEWAY_PORT, DB $DB_URL (.env.local written)"
