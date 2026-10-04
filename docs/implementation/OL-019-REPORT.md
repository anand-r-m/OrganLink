# OL-019 Report — Core slice smoke script

## Files changed
- `scripts/smoke-flow.sh` (new)
- `package.json` (added `"smoke": "bash scripts/smoke-flow.sh"`)
- `docs/implementation/LESSONS_LEARNED.md` (OL-019 section)
- `docs/implementation/OL-019-REPORT.md` (this file)

## Behavior implemented
`scripts/smoke-flow.sh` drives the API with curl and jq, using a cookie jar and `BASE_URL` (default `http://localhost:3001`). If nothing answers at `BASE_URL`, it starts `server/index.js` itself and stops it on exit. For each step it asserts the HTTP status and the resulting entity status, prints `PASS <step>`, and exits 1 with `FAIL <step>` plus the last response on the first mismatch.

Steps: health, login, procure (picks a donor/organ-type pair whose top two candidates are at other hospitals), match, create offer 1, **negative: second active offer (409 ACTIVE_OFFER_EXISTS)**, send, decline (organ back to AVAILABLE), advance, send, accept (organ ALLOCATED, transport PENDING), **negative: transplant before delivery (422 RULE_VIOLATION)**, depart, deliver, record transplant (organ TRANSPLANTED, offer carries the transplant).

## Tests and validations run
| Check | Result |
|---|---|
| `npm run db:reset -- --yes && npm run smoke` | all 20 PASS lines, `SMOKE OK`, about 1 s for the smoke run (limit 30 s) |
| Re-run of `npm run smoke` without a reset | passes |
| Auto-start of the server on port 3055 with no server running | passes; no process left listening |
| Deliberately wrong expectation (copy of the script) | prints `FAIL offer-decline` with the response; I did not capture the exit code (pipe), but `fail` calls `exit 1` |
| `npm run lint` | no new warnings; existing warnings are in other files |

I did not re-run the server or client suites, because no server or client code changed. The DB was reset after validation.

## Failures encountered
None.

## Remaining risks / follow-ups
- The script needs `jq` and `curl`, and a DB seeded by `db:reset` (admin/admin user, demo donors). OL-031's extra seed block must keep it passing; OL-031 already lists this as an acceptance criterion.
- The script does not clean up. It changes seeded data (one waitlist entry becomes TRANSPLANTED), so reset before a demo.
- The "declined recipient stays declined" rule (BR-10) is not asserted. It is not in the ticket.

## Acceptance criteria
- `npm run db:reset && npm run smoke` passes end to end in under 30 s: **satisfied** (run with `-- --yes` because the reset prompts on a TTY).
- One `PASS step-name` line per step: **satisfied**
- Negative cases, second active offer (409) and transplant before delivery (422): **satisfied**

## Manual interactive checks
None. This task adds no user-visible UI interaction; it adds a CLI script. Its verification status is "Automated test coverage".
