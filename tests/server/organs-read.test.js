// Needs DATABASE_URL pointing at a reset dev DB (db:reset: reference + demo seed).
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../server/index.js'
import { pool } from '../../server/db.js'

let server, base, cookie, testDonorId, kidneyId, freshKidneyId
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

  const d = await pool.query(
    `INSERT INTO donor (name, date_of_birth, blood_group_id, hospital_id, donor_type, height_cm, weight_kg)
     SELECT 'OL-013 Test Donor', '1990-01-01', blood_group_id, (SELECT min(hospital_id) FROM hospital),
            'LIVING', 170, 70
     FROM blood_group LIMIT 1 RETURNING donor_id`,
  )
  testDonorId = d.rows[0].donor_id
  const ins = (ago) =>
    pool.query(
      `INSERT INTO organ (donor_id, organ_type_id, recovering_hospital_id, recovered_at)
       VALUES ($1, (SELECT organ_type_id FROM organ_type WHERE name = 'Kidney'),
               (SELECT min(hospital_id) FROM hospital), now() - $2::interval) RETURNING organ_id`,
      [testDonorId, ago],
    )
  // Back-dated past the Kidney viability window (sweep must flip it) and a fresh one.
  kidneyId = (await ins('40 hours')).rows[0].organ_id
  freshKidneyId = (await ins('1 hour')).rows[0].organ_id
})
test.after(async () => {
  await pool.query('DELETE FROM organ WHERE donor_id = $1', [testDonorId])
  await pool.query('DELETE FROM donor WHERE donor_id = $1', [testDonorId])
  server.close()
  await pool.end().catch(() => {})
})

const get = (path, withCookie = true) =>
  fetch(`${base}${path}`, { headers: withCookie ? { cookie } : {} })
const list = async (qs = '') => (await get(`/api/organs${qs}`)).json()

test('organs endpoints require a session', async () => {
  for (const path of ['/api/organs', '/api/organs/1']) {
    const res = await get(path, false)
    assert.equal(res.status, 401)
    assert.equal((await res.json()).error.code, 'UNAUTHENTICATED')
  }
})

test('GET /api/organs lists every organ in the OrganSummary shape, newest recoveredAt first', async () => {
  const rows = await list()
  const { rows: [{ n }] } = await pool.query('SELECT count(*)::int AS n FROM organ')
  assert.equal(rows.length, n)
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    'activeOfferId', 'discardReasonCode', 'discardReasonId', 'donorBloodGroup', 'donorId', 'donorName',
    'expiresAt', 'hasActiveOffer', 'hoursRemaining', 'id', 'isExpired', 'maxViabilityHours', 'organType',
    'organTypeId', 'recoveredAt', 'recoveringHospitalId', 'recoveringHospitalName', 'regionCode',
    'status',
  ])
  const times = rows.map((r) => Date.parse(r.recoveredAt))
  assert.deepEqual(times, [...times].sort((a, b) => b - a))
})

test('sweep: a back-dated Kidney is listed as EXPIRED, not dropped', async () => {
  const row = (await list()).find((r) => r.id === kidneyId)
  assert.ok(row, 'expired organ stays in the list')
  assert.equal(row.status, 'EXPIRED')
  assert.equal(row.isExpired, true)
  assert.equal(row.hoursRemaining, 0)
  const { rows } = await pool.query('SELECT status FROM organ WHERE organ_id = $1', [kidneyId])
  assert.equal(rows[0].status, 'EXPIRED', 'the sweep persisted the status')
})

test('?available=true returns only AVAILABLE, non-expired organs', async () => {
  const rows = await list('?available=true')
  assert.ok(rows.length > 0)
  assert.ok(rows.every((r) => r.status === 'AVAILABLE' && r.isExpired === false))
  assert.ok(rows.some((r) => r.id === freshKidneyId))
  assert.ok(!rows.some((r) => r.id === kidneyId))
})

test('status and organTypeId filters narrow server-side', async () => {
  const expired = await list('?status=EXPIRED')
  assert.ok(expired.some((r) => r.id === kidneyId))
  assert.ok(expired.every((r) => r.status === 'EXPIRED'))
  const typeId = (await list()).find((r) => r.id === kidneyId).organTypeId
  const byType = await list(`?organTypeId=${typeId}`)
  assert.ok(byType.length > 0 && byType.every((r) => r.organTypeId === typeId))
  const none = await list(`?status=AVAILABLE&organTypeId=${typeId}&available=true`)
  assert.ok(none.every((r) => r.organTypeId === typeId && r.status === 'AVAILABLE'))
})

test('bad filter values give 400 VALIDATION_ERROR', async () => {
  for (const q of ['status=BOGUS', 'available=maybe', 'organTypeId=abc']) {
    const res = await get(`/api/organs?${q}`)
    assert.equal(res.status, 400, q)
    assert.equal((await res.json()).error.code, 'VALIDATION_ERROR')
  }
})

test('GET /api/organs/:id returns the organ with the region default weights', async () => {
  const res = await get(`/api/organs/${freshKidneyId}`)
  assert.equal(res.status, 200)
  const o = await res.json()
  assert.equal(o.id, freshKidneyId)
  assert.equal(o.donorId, testDonorId)
  assert.equal(o.status, 'AVAILABLE')
  assert.equal(o.hasActiveOffer, false)
  assert.deepEqual(Object.keys(o.defaultWeights), ['hla', 'urgency', 'distance', 'wait'])
  const { rows } = await pool.query(
    `SELECT r.hla_weight, r.urgency_weight, r.distance_weight, r.wait_weight
     FROM organ g JOIN hospital h ON h.hospital_id = g.recovering_hospital_id
     JOIN region r ON r.region_id = h.region_id WHERE g.organ_id = $1`,
    [freshKidneyId],
  )
  assert.deepEqual(o.defaultWeights, {
    hla: rows[0].hla_weight, urgency: rows[0].urgency_weight,
    distance: rows[0].distance_weight, wait: rows[0].wait_weight,
  })
})

test('GET /api/organs/:id sweeps: back-dating flips an AVAILABLE organ to EXPIRED', async () => {
  const id = freshKidneyId
  await pool.query(`UPDATE organ SET recovered_at = now() - interval '40 hours' WHERE organ_id = $1`, [id])
  const o = await (await get(`/api/organs/${id}`)).json()
  assert.equal(o.status, 'EXPIRED')
  assert.equal(o.isExpired, true)
})

test('unknown or malformed id gives 404 ORGAN_NOT_FOUND', async () => {
  for (const id of ['99999', 'abc', '99999999999999999999']) {
    const res = await get(`/api/organs/${id}`)
    assert.equal(res.status, 404, id)
    assert.equal((await res.json()).error.code, 'ORGAN_NOT_FOUND')
  }
})
