// Needs DATABASE_URL pointing at a reset dev DB (db:reset: reference + demo seed).
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../server/index.js'
import { pool } from '../../server/db.js'

let server, base, cookie, donor, kidney, heart
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
  // Own donor, so parallel test files that inspect seed donors never see these organs.
  ;[donor] = (
    await pool.query(
      `INSERT INTO donor (name, date_of_birth, blood_group_id, hospital_id, donor_type, height_cm, weight_kg)
       SELECT 'OL-012 Test Donor', '1990-01-01', blood_group_id, (SELECT min(hospital_id) FROM hospital),
              'LIVING', 170, 70
       FROM blood_group LIMIT 1 RETURNING donor_id, hospital_id`,
    )
  ).rows
  const types = (await pool.query('SELECT organ_type_id, name FROM organ_type')).rows
  kidney = types.find((t) => t.name === 'Kidney').organ_type_id
  heart = types.find((t) => t.name === 'Heart').organ_type_id
})
test.after(async () => {
  // Remove only what this file created (audit rows are append-only history; leave them).
  await pool.query('DELETE FROM organ WHERE donor_id = $1', [donor.donor_id])
  await pool.query('DELETE FROM donor WHERE donor_id = $1', [donor.donor_id])
  server.close()
  await pool.end().catch(() => {})
})

const post = (path, body, withCookie = true) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(withCookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString()
const procure = (donorId, over = {}) =>
  post(`/api/donors/${donorId}/organs`, {
    organTypeId: kidney,
    recoveringHospitalId: donor.hospital_id,
    recoveredAt: hoursAgo(1),
    ...over,
  })

test('requires a session', async () => {
  const res = await post(`/api/donors/${donor.donor_id}/organs`, {}, false)
  assert.equal(res.status, 401)
})

test('procuring a Kidney recovered 1 h ago creates an AVAILABLE organ with ~29 h remaining', async () => {
  const res = await procure(donor.donor_id)
  assert.equal(res.status, 201)
  const o = await res.json()
  assert.equal(o.status, 'AVAILABLE')
  assert.equal(o.organType, 'Kidney')
  assert.equal(o.donorId, donor.donor_id)
  assert.equal(o.recoveringHospitalId, donor.hospital_id)
  assert.equal(o.maxViabilityHours, 30)
  assert.ok(o.hoursRemaining > 28.9 && o.hoursRemaining < 29.1, `hoursRemaining ${o.hoursRemaining}`)
  assert.equal(o.isExpired, false)
  assert.equal(o.hasActiveOffer, false)
  assert.deepEqual(Object.keys(o.defaultWeights).sort(), ['distance', 'hla', 'urgency', 'wait'])
  assert.ok(Object.values(o.defaultWeights).every((w) => typeof w === 'number'))

  const { rows } = await pool.query('SELECT status FROM organ ORDER BY organ_id DESC LIMIT 1')
  assert.equal(rows[0].status, 'AVAILABLE')
})

test('writes an audit_log row for the organ, attributed to user 1', async () => {
  const res = await procure(donor.donor_id, { organTypeId: heart })
  assert.equal(res.status, 201)
  const o = await res.json()
  const { rows } = await pool.query(
    `SELECT action, user_id FROM audit_log WHERE table_name = 'organ' AND row_id = $1`, [o.id])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].action, 'INSERT')
  assert.equal(Number(rows[0].user_id), 1)
})

test('the new organ appears in the donor detail', async () => {
  const o = await (await procure(donor.donor_id)).json()
  const detail = await (await fetch(`${base}/api/donors/${donor.donor_id}`, { headers: { cookie } })).json()
  assert.ok(detail.organs.some((x) => x.id === o.id && x.status === 'AVAILABLE'))
})

test('a future recoveredAt returns 400 CONSTRAINT_VIOLATION (ck_organ_not_future) and inserts nothing', async () => {
  const count = async () =>
    (await pool.query('SELECT count(*)::int AS n FROM organ WHERE donor_id = $1', [donor.donor_id])).rows[0].n
  const before = await count()
  const res = await procure(donor.donor_id, { recoveredAt: new Date(Date.now() + 3600e3).toISOString() })
  assert.equal(res.status, 400)
  const { error } = await res.json()
  assert.equal(error.code, 'CONSTRAINT_VIOLATION')
  assert.equal(error.message, 'Recovery time cannot be in the future')
  assert.equal(error.details.constraint, 'ck_organ_not_future')
  assert.equal(await count(), before)
})

test('unknown donor is 404 DONOR_NOT_FOUND (also malformed id)', async () => {
  for (const id of ['99999', 'abc']) {
    const res = await procure(id)
    assert.equal(res.status, 404)
    assert.equal((await res.json()).error.code, 'DONOR_NOT_FOUND')
  }
})

test('unknown organ type or hospital is 400 REFERENCE_NOT_FOUND', async () => {
  for (const over of [{ organTypeId: 99999 }, { recoveringHospitalId: 99999 }]) {
    const res = await procure(donor.donor_id, over)
    assert.equal(res.status, 400)
    assert.equal((await res.json()).error.code, 'REFERENCE_NOT_FOUND')
  }
})

test('bad body shapes are 400 VALIDATION_ERROR with the offending fields', async () => {
  const cases = [
    [{ organTypeId: 'x' }, 'organTypeId'],
    [{ recoveringHospitalId: null }, 'recoveringHospitalId'],
    [{ recoveredAt: 'not a date' }, 'recoveredAt'],
    [{ recoveredAt: '2026-01-01T10:00:00' }, 'recoveredAt'], // no offset
    [{ recoveredAt: undefined }, 'recoveredAt'],
  ]
  for (const [over, field] of cases) {
    const res = await procure(donor.donor_id, over)
    assert.equal(res.status, 400, JSON.stringify(over))
    const { error } = await res.json()
    assert.equal(error.code, 'VALIDATION_ERROR')
    assert.deepEqual(error.details.fields, [field])
  }
})

test('offset timestamps are accepted (+05:30)', async () => {
  const past = new Date(Date.now() - 2 * 3600e3 + 5.5 * 3600e3).toISOString().replace('Z', '+05:30')
  const res = await procure(donor.donor_id, { recoveredAt: past })
  assert.equal(res.status, 201)
  const o = await res.json()
  assert.ok(o.hoursRemaining > 27.9 && o.hoursRemaining < 28.1)
})
