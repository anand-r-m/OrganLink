#!/usr/bin/env bash
# Drop and recreate the local `organlink` database, then load schema and seeds.
# Connection: DATABASE_URL (e.g. postgresql://user:pass@host:5432/organlink);
# when unset, the local socket and default user are used.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_NAME="organlink"

if [[ -f "$ROOT/.env" && -z "${DATABASE_URL:-}" ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ROOT/.env" | head -1 | cut -d= -f2- || true)"
fi

if [[ -n "${DATABASE_URL:-}" ]]; then
  TARGET="$DATABASE_URL"
  # Admin connection: same server, maintenance database `postgres` (query string preserved).
  ADMIN="$(printf '%s' "$DATABASE_URL" | sed -E 's#^([a-z]+://[^/]+)/[^?]*#\1/postgres#')"
else
  TARGET="$DB_NAME"
  ADMIN="postgres"
fi

PSQL=(psql -v ON_ERROR_STOP=1 -X -q)

"${PSQL[@]}" -d "$ADMIN" -c "DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE)" -c "CREATE DATABASE $DB_NAME"

for f in 01_schema.sql 02_seed_reference.sql 03_seed_demo.sql; do
  if [[ -f "$ROOT/db/$f" ]]; then
    echo "loading db/$f"
    "${PSQL[@]}" -d "$TARGET" -f "$ROOT/db/$f" >/dev/null
  fi
done
echo "db:reset complete"
