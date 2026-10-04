# Lessons Learned

## OL-003

### Throwaway Postgres refused to start
- **Symptom:** `pg_ctl start` failed; `db:reset` got "connection refused" on 5433.
- **Root cause:** the log said `postmaster became multithreaded during startup` / `Set the LC_ALL environment variable to a valid locale`. The agent shell had no valid locale.
- **Fix:** export `LC_ALL=en_US.UTF-8` before `initdb`/`pg_ctl start`.
- **Prevent/detect:** when `pg_ctl` reports a failed start, read `<datadir>/log` first. Set `LC_ALL` in any scripted Postgres launch.

### No Postgres on the configured port
- **Symptom:** `.env` points at `localhost:5432`, but nothing was listening.
- **Root cause:** the earlier throwaway cluster (OL-002, port 5433) was gone; no persistent server is configured on this machine.
- **Fix:** new throwaway cluster in the session scratchpad on 5433, passed through the `DATABASE_URL` env var only (`.env` untouched), loaded with `npm run db:reset -- --yes`.
- **Prevent/detect:** document a "start local test DB" snippet in the README (OL-033).
