# OL-039 — Offers: an offer's match run must belong to the same organ (composite FK) — Report

Status: **complete** on the disposable cluster (localhost:5433). The live QA database was not
touched (read-only check after the work: no OL-039 constraint, unchanged counts). Nothing
committed or pushed. No browser was used.

## 1. Defect

`match_run.run_id → organ_id`, so every offer made from a run must be for that run's organ. The
API checked this on create and Advance copied both values, but the database only had
`FOREIGN KEY (run_id) REFERENCES match_run(run_id)`. Before the change, a direct INSERT of an offer
for organ A with organ B's run was accepted (new test: `mismatched run/organ insert must fail` →
`actual: null`).

## 2. Change (`db/01_schema.sql`; `docs/context/` untouched)

- `match_run`: `CONSTRAINT ux_match_run_run_organ UNIQUE (run_id, organ_id)` (redundant with the
  PK; the FK needs an exact unique target).
- `organ_offer`: `run_id BIGINT` (no inline FK) plus
  `CONSTRAINT fk_offer_run_same_organ FOREIGN KEY (run_id, organ_id) REFERENCES match_run (run_id, organ_id) ON DELETE RESTRICT`.
- Default MATCH SIMPLE: offers with `run_id` NULL are valid and unchecked.
- ON UPDATE NO ACTION (default): an offer cannot be moved onto another organ's run.
- Behaviour change: deleting a run that an offer references is refused (23001); previously the
  offer's `run_id` became NULL. No API path deletes runs (BR-6).
- No API change: the API still answers 400 `VALIDATION_ERROR` for a mismatched run before the
  database is reached; a non-existent run still maps to 400 `REFERENCE_NOT_FOUND`.

## 3. Upgrade (`db/upgrades/OL-039.sql`)

One transaction: refuses if any offer references another organ's run; adds the unique key if
missing; drops any single-column FK on `organ_offer(run_id)`; adds the composite FK if missing.
Never edits rows. Results on the disposable cluster:

| Check | Result |
|---|---|
| Pre-OL-039 DB (HEAD + OL-036/037, full seed) → upgrade | exit 0; constraints as expected; re-run exit 0; 24-table count/checksum manifest identical before and after |
| Upgraded schema vs fresh install (`pg_dump -s`) | identical |
| HEAD install (as the live DB) → OL-036_OL-037 → OL-039 (+ re-run) | exit 0; manifest identical; schema identical to fresh |
| HEAD install with one planted mismatched offer → OL-039 | exit 3, "OL-039 upgrade refused: 1 offer(s) …"; no constraint added; old FK kept; data unchanged |

## 4. Tests (fresh reset of the disposable DB)

| Command | Result |
|---|---|
| `node --test tests/server/offer-run-organ.test.js` | before: 1/3 pass; after: **3/3 pass** |
| `npm run test:server` | **197/197 pass**, exit 0 |
| `npm run db:rules` | 14/14 PASS, exit 0 |
| `npm run smoke` (BASE_URL :3098) | 20 PASS, `SMOKE OK`, exit 0 |
| `npm run concurrency` (BASE_URL :3098) | 1 success / 9 conflicts / 1 accept / 1 transport, exit 0 |
| `tests/09_verification_fixed.sql` (schema + reference only) | sections 1–10 pass (5 PASS notices); exit 3 at the known, pre-existing section-11 setup failure; output identical to the run before OL-039 |
| `test:client` / `test:docs` / `lint` | 169/169, 10/10, exit 0 |

`offer-run-organ.test.js` covers: the declared constraint (RESTRICT, MATCH SIMPLE, parent key,
old FK gone); every stored offer is on its own organ's run (seed and history); matching pair
accepted; mismatched pair rejected (23503, `fk_offer_run_same_organ`); moving an offer to another
organ's run rejected; NULL run accepted; deleting a referenced run refused (23001) with the offer
unchanged; an unreferenced run still deletes and cascades its results.

## 5. Notes

- The historical seed block loads with `session_replication_role = replica`, which also disables
  FK checking, so a successful reset does not prove compliance. The post-load provenance query
  (30 offers, 30 with a run, 0 mismatched, 0 dangling) and the test above do.
- After the full suite the disposable DB holds 6 extra runs on seeded organ 1, made by
  `matching.test.js`, which by design deletes only its own fixture organ's runs. No offer
  references them, so RESTRICT is not involved; this predates OL-039.
