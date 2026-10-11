// OL-036: tied candidates get distinct, deterministic ranks.
// Needs DATABASE_URL pointing at a reset dev DB (db:reset). Fixtures are created through SQL and
// removed in test.after, so the database is left as it was found (audit_log rows stay by design).
//
// Ordering rule under test: match_score DESC, wait_score DESC, listed_date ASC, recipient_id ASC.
// The recipient_id key exists for reproducibility only; it is not a clinical fairness claim.
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../server/index.js'
import { pool } from '../../server/db.js'

let server, base, cookie
let donorId, organId
const recipientIds = []
const ids = {} // fixture name -> recipient_id

async function addRecipient(name, listedDate, urgencyCode) {
  const { rows } = await pool.query(
    `INSERT INTO recipient (name, date_of_birth, blood_group_id, hospital_id, status, height_cm, weight_kg)
     VALUES ($1, '1980-01-01', (SELECT blood_group_id FROM blood_group WHERE group_name = 'B+'),
             (SELECT min(hospital_id) FROM hospital), 'ACTIVE', 175, 70) RETURNING recipient_id`,
    [name],
  )
  const id = rows[0].recipient_id
  recipientIds.push(id)
  await pool.query(
    `INSERT INTO waitlist_entry (recipient_id, organ_type_id, urgency_id, listed_date, status)
     VALUES ($1, (SELECT organ_type_id FROM organ_type WHERE name = 'Kidney'),
             (SELECT urgency_id FROM urgency WHERE code = $3), $2::date, 'ACTIVE')`,
    [id, listedDate, urgencyCode],
  )
  return id
}

test.before(async () => {
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${server.address().port}`
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' }),
  })
  cookie = res.headers.get('set-cookie').split(';')[0]

  // A deceased B+ donor and a fresh Kidney, so no seed organ or run is touched.
  donorId = (
    await pool.query(
      `INSERT INTO donor (name, date_of_birth, blood_group_id, hospital_id, donor_type, height_cm, weight_kg,
                          death_date, death_cause)
       VALUES ('OL-036 Tie Donor', '1985-01-01', (SELECT blood_group_id FROM blood_group WHERE group_name = 'B+'),
               (SELECT min(hospital_id) FROM hospital), 'DECEASED', 175, 70, now() - interval '3 hours', 'test')
       RETURNING donor_id`,
    )
  ).rows[0].donor_id
  organId = (
    await pool.query(
      `INSERT INTO organ (donor_id, organ_type_id, recovering_hospital_id, recovered_at)
       VALUES ($1, (SELECT organ_type_id FROM organ_type WHERE name = 'Kidney'),
               (SELECT min(hospital_id) FROM hospital), now() - interval '1 hour') RETURNING organ_id`,
      [donorId],
    )
  ).rows[0].organ_id

  // Group 1: identical in every scoring input, same listing date -> full tie, id decides.
  ids.tieA = await addRecipient('OL-036 Tie A', '2024-01-15', '1B')
  ids.tieB = await addRecipient('OL-036 Tie B', '2024-01-15', '1B')
  // Group 2: both have waited more than 60 months, so wait_score saturates at 100 for both and the
  // scores tie even though the listing dates differ. The LOWER id listed LATER, so the listing date
  // (not the id) must decide.
  ids.lateLowId = await addRecipient('OL-036 Listed 2021 (lower id)', '2021-01-01', '1A')
  ids.earlyHighId = await addRecipient('OL-036 Listed 2019 (higher id)', '2019-01-01', '1A')
})

test.after(async () => {
  await pool.query('DELETE FROM match_run WHERE organ_id = $1', [organId]) // cascades match_result
  await pool.query('DELETE FROM organ WHERE organ_id = $1', [organId])
  await pool.query('DELETE FROM donor WHERE donor_id = $1', [donorId])
  await pool.query('DELETE FROM recipient WHERE recipient_id = ANY($1)', [recipientIds])
  server.close()
  await pool.end().catch(() => {})
})

const runMatch = async () => {
  const res = await fetch(`${base}/api/matching/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ organId }),
  })
  return { status: res.status, body: await res.json() }
}
const byId = (run, id) => run.qualified.find((q) => q.recipientId === id)

test('fixtures really tie on match_score and wait_score (the test is meaningful)', async () => {
  const { status, body } = await runMatch()
  assert.equal(status, 201, JSON.stringify(body))
  const [a, b] = [byId(body, ids.tieA), byId(body, ids.tieB)]
  assert.ok(a && b, 'both full-tie fixtures are qualified')
  assert.equal(a.matchScore, b.matchScore)
  assert.equal(a.waitScore, b.waitScore)
  const [early, late] = [byId(body, ids.earlyHighId), byId(body, ids.lateLowId)]
  assert.ok(early && late, 'both listing-date fixtures are qualified')
  assert.equal(early.matchScore, late.matchScore)
  assert.equal(early.waitScore, late.waitScore)
  assert.equal(early.waitScore, 100)
})

test('tied candidates get distinct ranks, consecutive and without gaps', async () => {
  const { status, body } = await runMatch()
  assert.equal(status, 201, JSON.stringify(body))
  const ranks = body.qualified.map((q) => q.rank)
  assert.equal(new Set(ranks).size, ranks.length, 'every qualified rank is unique')
  assert.deepEqual(ranks, ranks.map((_, i) => i + 1), 'ranks run 1..N in order')
  const db = await pool.query(
    'SELECT rank FROM match_result WHERE run_id = $1 AND qualified ORDER BY rank',
    [body.id],
  )
  assert.deepEqual(db.rows.map((r) => r.rank), ranks)
})

test('full tie on score and listing date: the lower recipient_id ranks first', async () => {
  const { body } = await runMatch()
  const [a, b] = [byId(body, ids.tieA), byId(body, ids.tieB)]
  assert.ok(ids.tieA < ids.tieB)
  assert.equal(b.rank, a.rank + 1)
})

test('score tie with different listing dates: the earlier listing date ranks first, even with a higher id', async () => {
  const { body } = await runMatch()
  const [early, late] = [byId(body, ids.earlyHighId), byId(body, ids.lateLowId)]
  assert.ok(ids.earlyHighId > ids.lateLowId)
  assert.equal(late.rank, early.rank + 1)
})

test('repeat runs preserve the relative order of the tied candidates', async () => {
  const order = (run) =>
    [ids.tieA, ids.tieB, ids.lateLowId, ids.earlyHighId]
      .map((id) => ({ id, rank: byId(run, id).rank }))
      .sort((x, y) => x.rank - y.rank)
      .map((x) => x.id)
  const first = await runMatch()
  const second = await runMatch()
  const third = await runMatch()
  assert.equal(first.status, 201)
  assert.notEqual(first.body.id, second.body.id, 'each re-run is a new run (BR-6)')
  assert.deepEqual(order(second.body), order(first.body))
  assert.deepEqual(order(third.body), order(first.body))
})
