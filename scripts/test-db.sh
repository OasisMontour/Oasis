#!/usr/bin/env bash
# Runs the RLS/RPC tests against a throwaway Postgres.
# - If DATABASE_URL is set (CI), uses that database (must be empty).
# - Otherwise starts a temporary local cluster with the installed Postgres binaries.
set -euo pipefail
cd "$(dirname "$0")/.."

run() {
  psql "$1" -v ON_ERROR_STOP=1 -q -f supabase/tests/00_supabase_shim.sql
  for f in supabase/migrations/*.sql; do psql "$1" -v ON_ERROR_STOP=1 -q -f "$f"; done
  psql "$1" -v ON_ERROR_STOP=1 -f supabase/tests/10_rls_test.sql 2>&1 | grep -E 'ok -|FAIL|ERROR|PASSED' 
  return "${PIPESTATUS[0]}"
}

if [[ -n "${DATABASE_URL:-}" ]]; then run "$DATABASE_URL"; exit; fi

PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
[[ -x "$PGBIN/initdb" ]] || PGBIN="$(dirname "$(command -v initdb)")"
TMP="$(mktemp -d)"; PORT=55432
trap '"$PGBIN/pg_ctl" -D "$TMP/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
"$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" start -w >/dev/null
run "postgresql://postgres@/postgres?host=$TMP&port=$PORT"
