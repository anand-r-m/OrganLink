#!/usr/bin/env bash
# Drop and recreate the local `organlink` database, then load schema and seeds.
# Connection: DATABASE_URL (e.g. postgresql://user:pass@host:5432/organlink);
# when unset, the local socket and default user are used.
# Safety: refuses non-local hosts (unless ALLOW_NONLOCAL_RESET=1) and any database
# name other than `organlink`. Asks for "y" on a TTY; pass --yes to skip (CI, scripts).
# Usage: npm run db:reset [-- --yes]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_NAME="organlink"

ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    *) echo "db-reset: unknown argument: $arg" >&2; exit 2 ;;
  esac
done

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

# Resolve host and database name of the target, for the safety guard.
if [[ -n "${DATABASE_URL:-}" ]]; then
  rest="${DATABASE_URL#*://}"
  authority="${rest%%/*}"
  path="${rest#"$authority"}"; path="${path#/}"
  TARGET_DB="${path%%\?*}"
  query=""; [[ "$path" == *\?* ]] && query="${path#*\?}"
  hostport="${authority##*@}"
  if [[ "$hostport" == \[* ]]; then
    TARGET_HOST="${hostport#\[}"; TARGET_HOST="${TARGET_HOST%%\]*}"
  else
    TARGET_HOST="${hostport%%:*}"
  fi
  # A ?host=... query parameter overrides the authority (e.g. a socket directory).
  if [[ "$query" =~ (^|&)host=([^&]*) ]]; then TARGET_HOST="${BASH_REMATCH[2]}"; fi
else
  TARGET_DB="$DB_NAME"
  TARGET_HOST="${PGHOST:-}"
fi

if [[ "$TARGET_DB" != "$DB_NAME" ]]; then
  echo "db-reset: refusing: target database is '$TARGET_DB', only '$DB_NAME' may be reset." >&2
  exit 1
fi

case "$TARGET_HOST" in
  ""|localhost|127.0.0.1|::1|/*) ;;
  *)
    if [[ "${ALLOW_NONLOCAL_RESET:-}" != "1" ]]; then
      echo "db-reset: refusing: host '$TARGET_HOST' is not local. Set ALLOW_NONLOCAL_RESET=1 to override." >&2
      exit 1
    fi
    ;;
esac

echo "Resetting ${TARGET_HOST:-local socket}/$DB_NAME"

if [[ "$ASSUME_YES" -ne 1 ]]; then
  if [[ -t 0 ]]; then
    read -r -p "This DROPS and recreates '$DB_NAME'. Continue? [y/N] " reply
    [[ "$reply" == "y" ]] || { echo "db-reset: aborted." >&2; exit 1; }
  else
    echo "db-reset: non-interactive run requires --yes." >&2
    exit 1
  fi
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
