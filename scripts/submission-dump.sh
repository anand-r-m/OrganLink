#!/usr/bin/env bash
# Produce the submission database dump (OL-034; 05_tdd.md §9).
#   submission/organlink.sql <- pg_dump of a freshly reset `organlink` database.
#
# Connection: DATABASE_URL (e.g. postgresql://user:pass@host:5432/organlink); when unset,
# loaded from .env and finally from the local socket / default user. The dump is a plain
# SQL file, restorable with `psql -f submission/organlink.sql` (see verify-submission.sh).
#
# By default the script runs `db-reset.sh --yes` first so the dump always reflects the
# schema plus both seeds and no task residue. Pass `--no-reset` to dump the current DB as
# is (e.g. after you have rehearsed the demo and want to capture that state).
#
# Usage: npm run dump [-- --no-reset]
# Requires: pg_dump and psql on PATH (or PGBIN set to the PostgreSQL bin directory).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_NAME="organlink"
OUT_DIR="$ROOT/submission"
OUT_FILE="$OUT_DIR/organlink.sql"

PGBIN="${PGBIN:-}"
if [[ -n "$PGBIN" ]]; then
  export PATH="$PGBIN:$PATH"
fi

RESET=1
for arg in "$@"; do
  case "$arg" in
    --no-reset) RESET=0 ;;
    --reset) RESET=1 ;;
    *) echo "submission-dump: unknown argument: $arg" >&2; exit 2 ;;
  esac
done

command -v pg_dump >/dev/null || { echo "submission-dump: pg_dump is required on PATH (or set PGBIN)" >&2; exit 2; }

if [[ -f "$ROOT/.env" && -z "${DATABASE_URL:-}" ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ROOT/.env" | head -1 | cut -d= -f2- || true)"
fi

if [[ -n "${DATABASE_URL:-}" ]]; then
  TARGET="$DATABASE_URL"
else
  TARGET="$DB_NAME"
fi

# Safety guard: only dump a database named `organlink`, never some other target.
if [[ -n "${DATABASE_URL:-}" ]]; then
  rest="${DATABASE_URL#*://}"
  authority="${rest%%/*}"
  path="${rest#"$authority"}"; path="${path#/}"
  TARGET_DB="${path%%\?*}"
else
  TARGET_DB="$DB_NAME"
fi
if [[ "$TARGET_DB" != "$DB_NAME" ]]; then
  echo "submission-dump: refusing: database is '$TARGET_DB', expected '$DB_NAME'." >&2
  exit 1
fi

if [[ "$RESET" == 1 ]]; then
  bash "$ROOT/scripts/db-reset.sh" --yes
fi

mkdir -p "$OUT_DIR"
echo "dumping $TARGET_DB -> $OUT_FILE"
pg_dump "$TARGET" > "$OUT_FILE"

# Sanity checks so a truncated/empty dump cannot be mistaken for the submission artifact.
tables="$(grep -c '^CREATE TABLE ' "$OUT_FILE" || true)"
views="$(grep -c '^CREATE VIEW ' "$OUT_FILE" || true)"
rows="$(wc -c < "$OUT_FILE" | tr -d ' ')"
if [[ "$tables" != 24 || "$views" != 8 ]]; then
  echo "submission-dump: unexpected object counts (tables=$tables views=$views, want 24/8)" >&2
  exit 1
fi
if [[ "$rows" -lt 50000 ]]; then
  echo "submission-dump: dump suspiciously small ($rows bytes)" >&2
  exit 1
fi

echo "submission-dump: wrote $OUT_FILE ($rows bytes, $tables tables, $views views)"
echo "SUBMISSION DUMP OK"