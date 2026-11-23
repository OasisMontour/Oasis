#!/usr/bin/env bash
# Runs the RLS/RPC tests against a throwaway Postgres.
# - If DATABASE_URL is set (CI), uses that database (must be empty).
# - Otherwise starts a temporary local cluster with the installed Postgres binaries.
set -euo pipefail
cd "$(dirname "$0")/.."

# Supabase records migrations by their timestamp prefix, so two files with the same prefix means one of
# them is silently skipped by `supabase db push`. Parallel branches make this easy to do by accident.
dupes="$(ls supabase/migrations | cut -d_ -f1 | sort | uniq -d)"
if [[ -n "$dupes" ]]; then echo "FAIL: duplicate migration timestamps: $dupes" >&2; exit 1; fi

run() {
  psql "$1" -v ON_ERROR_STOP=1 -q -f supabase/tests/00_supabase_shim.sql
  for f in supabase/migrations/*.sql; do psql "$1" -v ON_ERROR_STOP=1 -q -f "$f"; done
  for f in supabase/tests/[1-9]*.sql; do
    psql "$1" -v ON_ERROR_STOP=1 -f "$f" 2>&1 | grep -E 'ok -|FAIL|ERROR|PASSED'
    [[ "${PIPESTATUS[0]}" == 0 ]] || return 1
  done
}

if [[ -n "${DATABASE_URL:-}" ]]; then run "$DATABASE_URL"; exit; fi

PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
[[ -x "$PGBIN/initdb" ]] || PGBIN="$(dirname "$(command -v initdb)")"
TMP="$(mktemp -d)"; PORT=55432
trap '"$PGBIN/pg_ctl" -D "$TMP/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
"$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" start -w >/dev/null
run "postgresql://postgres@/postgres?host=$TMP&port=$PORT"
