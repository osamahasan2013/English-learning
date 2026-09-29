#!/usr/bin/env bash
# Stops the services started by start.sh. Data is kept; delete LOCAL_STACK_DIR to reset.
set -uo pipefail
STACK_DIR="${LOCAL_STACK_DIR:-/tmp/english-learning-stack}"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
for name in gateway postgrest gotrue; do
  file="$STACK_DIR/$name.pid"
  [ -f "$file" ] && kill "$(cat "$file")" 2>/dev/null
  rm -f "$file"
done
if [ "$(id -u)" = "0" ]; then
  runuser -u postgres -- "$PG_BIN/pg_ctl" -D "$STACK_DIR/pgdata" stop -m fast 2>/dev/null
else
  "$PG_BIN/pg_ctl" -D "$STACK_DIR/pgdata" stop -m fast 2>/dev/null
fi
echo "Local stack stopped."
