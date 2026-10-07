#!/usr/bin/env bash
# Verify the submission dump end to end (OL-034).
#   1. (re)create a scratch database `organlink_check`
#   2. restore submission/organlink.sql into it with `psql -f`
#   3. assert the schema/seed invariants the app depends on
#   4. run the core-slice smoke script *against the restored database*
#   5. drop the scratch database again (unless --keep)
#
# This is the automated form of the backlog OL-034 DB acceptance test
# ("restoring the dump into an empty DB succeeds and the app runs against it").
#
# Usage: npm run verify:submission [-- --keep]
# Requires: pg_dump/psql (or set PGBIN), curl, jq, node/npm.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DUMP="${DUMP:-$ROOT/submission/organlink.sql}"
CHECK_DB="organlink_check"
SMOKE_PORT="${SMOKE_PORT:-3099}"

PGBIN="${PGBIN:-}"
if [[ -n "$PGBIN" ]]; then
  export PATH="$PGBIN:$PATH"
fi
command -v psql >/dev/null || { echo "verify-submission: psql is required on PATH (or set PGBIN)" >&2; exit 2; }
command -v pg_dump >/dev/null || { echo "verify-submission: pg_dump is required on PATH (or set PGBIN)" >&2; exit 2; }

KEEP=0
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    *) echo "verify-submission: unknown argument: $arg" >&2; exit 2 ;;
  esac
done

[[ -f "$DUMP" ]] || { echo "verify-submission: dump not found: $DUMP (run npm run dump first)" >&2; exit 1; }

if [[ -f "$ROOT/.env" && -z "${DATABASE_URL:-}" ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ROOT/.env" | head -1 | cut -d= -f2- || true)"
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "verify-submission: DATABASE_URL is required (set it or provide a .env)." >&2
  exit 1
fi

# Rebuild the URL with a different database name, preserving credentials/query string.
swap_db() { printf '%s' "$1" | sed -E "s#^([a-z]+://[^/]+)/[^?]*#\\1/$2#"; }
ADMIN="$(swap_db "$DATABASE_URL" postgres)"
CHECK_URL="$(swap_db "$DATABASE_URL" "$CHECK_DB")"

PSQL=(psql -v ON_ERROR_STOP=1 -X -q)
cleanup() {
  if [[ "$KEEP" != 1 ]]; then
    "${PSQL[@]}" -d "$ADMIN" -c "DROP DATABASE IF EXISTS $CHECK_DB WITH (FORCE)" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

assert_eq() {
  local label="$1" got="$2" want="$3"
  if [[ "$got" != "$want" ]]; then
    echo "FAIL $label: got '$got', want '$want'" >&2
    exit 1
  fi
  echo "PASS $label ($got)"
}

echo "restoring $DUMP into $CHECK_DB"
"${PSQL[@]}" -d "$ADMIN" -c "DROP DATABASE IF EXISTS $CHECK_DB WITH (FORCE)" -c "CREATE DATABASE $CHECK_DB" >/dev/null
"${PSQL[@]}" -d "$CHECK_URL" -f "$DUMP" >/dev/null

assert_eq "tables" "$("${PSQL[@]}" -d "$CHECK_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")" 24
assert_eq "views" "$("${PSQL[@]}" -d "$CHECK_URL" -tAc "SELECT count(*) FROM information_schema.views WHERE table_schema='public'")" 8
assert_eq "compatible blood pairs" "$("${PSQL[@]}" -d "$CHECK_URL" -tAc "SELECT count(*) FROM blood_compatibility WHERE compatible")" 27
assert_eq "admin user" "$("${PSQL[@]}" -d "$CHECK_URL" -tAc "SELECT username FROM app_user WHERE user_id=1")" "admin"
assert_eq "admin password matches 'admin'" \
  "$("${PSQL[@]}" -d "$CHECK_URL" -tAc "SELECT password_hash FROM app_user WHERE user_id=1" | \
     node -e "const b=require('bcryptjs');let h='';process.stdin.on('data',d=>h+=d).on('end',()=>process.stdout.write(String(b.compareSync('admin',h.trim()))))")" "true"
assert_eq "demo donors present" \
  "$("${PSQL[@]}" -d "$CHECK_URL" -tAc "SELECT (count(*) >= 10)::text FROM donor")" "true"
assert_eq "demo organs present" \
  "$("${PSQL[@]}" -d "$CHECK_URL" -tAc "SELECT (count(*) >= 3)::text FROM organ")" "true"

# End-to-end: run the OL-019 smoke suite against the restored database on a private port.
# `smoke-flow.sh` starts its own server bound to DATABASE_URL when nothing answers BASE_URL.
echo "running smoke against the restored DB (port $SMOKE_PORT)"
if ( DATABASE_URL="$CHECK_URL" BASE_URL="http://localhost:$SMOKE_PORT" bash "$ROOT/scripts/smoke-flow.sh" ); then
  echo "PASS smoke against restored DB"
else
  echo "FAIL smoke against restored DB" >&2
  exit 1
fi

echo "VERIFY SUBMISSION OK"