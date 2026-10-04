# OrganLink

Academic DBMS project. Specs: docs/context/.
Approved work plan: docs/implementation/.

## Architecture
- Existing React/Vite/Mantine frontend must be preserved.
- Backend: Node/Express with node-postgres.
- PostgreSQL owns business invariants.
- No ORM, no second database.
- Frontend has a mock/live switch; live calls go to /api/*.

## Workflow
- Implement one approved task at a time.
- Do not change shared API contracts without approval.
- Add tests for every new behavior.
- Stop after each task; do not auto-start the next.

## Safety
- Never run destructive SQL without explicit approval of the target DB.
- Database resets are only for a dedicated local development DB.
- Never commit secrets or real patient data.
- Never suggest a ‘next task’ that is not already an entry in BACKLOG.md. If new work is discovered, add it to BACKLOG.md first, then reference its ID.