// OL-030: the invariants scripts/concurrency.mjs proves, kept as a regression test.
// Needs DATABASE_URL pointing at a reset dev DB. Fixtures are built with direct SQL (the same
// pattern as offers-respond.test.js) so the only thing under test is the HTTP + DB layer.
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../server/index.js'
import { pool } from '../../server/db.js'

const CREATES = 10
const ACCEPTS = 2

let server, base, cookie, organId
const recipientIds = []

const q = async (sql, params) => (await pool.query(sql, params)).rows
const one = async (sql, params) => (await q(sql, params))[0]
const num = (v) => Number(v)

const post = async (path, body) => {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body ?? {}),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

// No awaits between the calls, so every request reaches the organ lock at the same time.
const parallelOffers = (count) =>
  Promise.all(recipientIds.slice(0, count).map((recipientId) => post('/api/offers', { organId, recipientId })))

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

  // O- is compatible with every recipient; donor 2 is the seeded O- donor at 75kg. Kidney's
  // 0.50-3.00 ratio band makes 75kg an exact 1.0 match, and its 30h viability window keeps the
  // sweep from expiring the fixture mid-test.
  const donor = await one(
    `SELECT d.donor_id, d.blood_group_id, d.hospital_id, d.weight_kg
       FROM donor d JOIN blood_group bg ON bg.blood_group_id = d.blood_group_id
      WHERE d.status = 'ACTIVE' AND bg.group_name = 'O-' ORDER BY d.donor_id LIMIT 1`,
  )
  assert.ok(donor, 'needs an ACTIVE O- donor in the seed')
  const organType = await one(`SELECT organ_type_id FROM organ_type WHERE name = 'Kidney'`)
  assert.ok(organType, 'needs the Kidney organ type in the seed')
  const urgency = await one('SELECT urgency_id FROM urgency ORDER BY urgency_id LIMIT 1')

  organId = num(
    (
      await one(
        `INSERT INTO organ (donor_id, organ_type_id, recovering_hospital_id, recovered_at)
         VALUES ($1, $2, $3, now()) RETURNING organ_id`,
        [num(donor.donor_id), num(organType.organ_type_id), num(donor.hospital_id)],
      )
    ).organ_id,
  )

  for (let i = 0; i < CREATES; i++) {
    const r = await one(
      `INSERT INTO recipient (name, date_of_birth, blood_group_id, hospital_id, status, height_cm, weight_kg)
       VALUES ($1, '1990-01-01', $2, $3, 'ACTIVE', 170, $4) RETURNING recipient_id`,
      [`OL-030 concurrent ${i + 1}`, num(donor.blood_group_id), num(donor.hospital_id), num(donor.weight_kg)],
    )
    recipientIds.push(num(r.recipient_id))
    await q(
      `INSERT INTO waitlist_entry (recipient_id, organ_type_id, urgency_id) VALUES ($1, $2, $3)`,
      [num(r.recipient_id), num(organType.organ_type_id), num(urgency.urgency_id)],
    )
  }
})

test.after(async () => {
  // FK-safe order: transport_record -> organ_offer -> organ -> recipients.
  await q('DELETE FROM transport_record WHERE organ_id = $1', [organId])
  await q('DELETE FROM organ_offer WHERE organ_id = $1', [organId])
  await q('DELETE FROM organ WHERE organ_id = $1', [organId])
  for (const id of recipientIds) await q('DELETE FROM recipient WHERE recipient_id = $1', [id])
  server.close()
  await pool.end()
})

// One test with ordered subtests: the accepts phase can only run against the offer the creates
// phase produced, and sharing one organ keeps the DB proof unambiguous.
test('parallel offers and accepts never double-allocate', async (t) => {
  let offerId

  await t.test('10 parallel creates yield one winner and nine ACTIVE_OFFER_EXISTS', async () => {
    const results = await parallelOffers(CREATES)
    const created = results.filter((r) => r.status === 201)
    const conflicts = results.filter((r) => r.status === 409)
    assert.equal(created.length, 1, `expected 1x201, got ${results.map((r) => r.status).join(',')}`)
    assert.equal(conflicts.length, CREATES - 1)
    for (const c of conflicts) {
      assert.equal(c.status, 409)
      assert.equal(c.body.error.code, 'ACTIVE_OFFER_EXISTS')
    }
    assert.equal(created[0].body.status, 'CREATED')
    offerId = created[0].body.id

    const [{ count }] = await q(
      `SELECT count(*) FROM organ_offer WHERE organ_id = $1 AND status IN ('CREATED','SENT','ACCEPTED')`,
      [organId],
    )
    assert.equal(num(count), 1, 'ux_offer_active must leave exactly one non-terminal offer')
  })

  await t.test('2 parallel accepts yield one winner, one 409 and one transport row', async () => {
    const sent = await post(`/api/offers/${offerId}/send`)
    assert.equal(sent.status, 200)
    assert.equal(sent.body.status, 'SENT')

    const results = await Promise.all(Array.from({ length: ACCEPTS }, () => post(`/api/offers/${offerId}/accept`)))
    const ok = results.filter((r) => r.status === 200)
    const conflicts = results.filter((r) => r.status === 409)
    assert.equal(ok.length, 1, `expected 1x200, got ${results.map((r) => r.status).join(',')}`)
    assert.equal(conflicts.length, ACCEPTS - 1)
    assert.equal(ok[0].body.status, 'ACCEPTED')

    const [{ count }] = await q('SELECT count(*) FROM transport_record WHERE organ_id = $1', [organId])
    assert.equal(num(count), 1, 'exactly one transport row proves no double allocation')
    const [organ] = await q('SELECT status FROM organ WHERE organ_id = $1', [organId])
    assert.equal(organ.status, 'ALLOCATED')
  })
})