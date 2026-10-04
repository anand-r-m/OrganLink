// Needs DATABASE_URL pointing at a reset dev DB (reference seed + admin/admin from db:reset).
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../server/index.js'
import { pool } from '../../server/db.js'

let server, base, cookie, hospitalId
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
  // The reference seed has no hospitals (the demo seed is OL-006), so create one for the test.
  const { rows } = await pool.query(
    `INSERT INTO hospital (name, address, phone, latitude, longitude, region_id, status)
     VALUES ('OL-005 Test Hospital', 'Test Road', '000', 13.0604, 80.2496,
             (SELECT region_id FROM region WHERE region_code = 'SR'), 'ACTIVE')
     RETURNING hospital_id`,
  )
  hospitalId = rows[0].hospital_id
})
test.after(async () => {
  await pool.query('DELETE FROM hospital WHERE hospital_id = $1', [hospitalId])
  server.close()
  await pool.end().catch(() => {})
})

const get = (path, withCookie = true) =>
  fetch(`${base}${path}`, { headers: withCookie ? { cookie } : {} })

test('hospitals and lookups require a session (401 UNAUTHENTICATED)', async () => {
  for (const path of ['/api/hospitals', '/api/lookups']) {
    const res = await get(path, false)
    assert.equal(res.status, 401)
    assert.equal((await res.json()).error.code, 'UNAUTHENTICATED')
  }
})

test('GET /api/lookups returns every reference list with the seeded counts', async () => {
  const res = await get('/api/lookups')
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.bloodGroups.length, 8)
  assert.equal(body.urgencies.length, 3)
  assert.equal(body.declineReasons.length, 6)
  assert.equal(body.discardReasons.length, 6)
  assert.equal(body.exclusionReasons.length, 5)
  assert.equal(body.organTypes.length, 5)
  assert.ok(body.hlaAlleles.length > 0)
  assert.deepEqual(Object.keys(body.bloodGroups[0]).sort(), ['id', 'name'])
  assert.ok(body.declineReasons.some((r) => r.code === 'ORGAN_QUALITY'))
  const urgency = body.urgencies.find((u) => u.code === '1A')
  assert.equal(typeof urgency.scoreValue, 'number')
  const kidney = body.organTypes.find((o) => o.name === 'Kidney')
  assert.equal(kidney.maxViabilityHours, 30)
  assert.equal(kidney.responseWindowHours, 6)
  assert.equal(kidney.minWeightRatio, 0.5)
  assert.equal(kidney.maxWeightRatio, 3)
})

test('GET /api/hospitals returns schema-shaped camelCase rows with numeric coordinates', async () => {
  const res = await get('/api/hospitals')
  assert.equal(res.status, 200)
  const rows = await res.json()
  assert.ok(Array.isArray(rows))
  const h = rows.find((r) => r.id === hospitalId)
  assert.ok(h, 'inserted hospital is listed')
  assert.deepEqual(Object.keys(h).sort(), [
    'address', 'id', 'latitude', 'longitude', 'name', 'phone',
    'regionCode', 'regionId', 'regionName', 'status',
  ])
  assert.equal(h.regionCode, 'SR')
  assert.equal(h.latitude, 13.0604)
  assert.equal(typeof h.regionId, 'number')
})

test('GET /api/hospitals filters by regionId and status; bad values give 400', async () => {
  const sr = (await (await get('/api/hospitals')).json()).find((r) => r.id === hospitalId)
  const inRegion = await (await get(`/api/hospitals?regionId=${sr.regionId}`)).json()
  assert.ok(inRegion.every((r) => r.regionId === sr.regionId))
  assert.ok(inRegion.some((r) => r.id === hospitalId))
  const suspended = await (await get('/api/hospitals?status=SUSPENDED')).json()
  assert.ok(!suspended.some((r) => r.id === hospitalId))
  for (const q of ['regionId=abc', 'status=BOGUS']) {
    const res = await get(`/api/hospitals?${q}`)
    assert.equal(res.status, 400)
    assert.equal((await res.json()).error.code, 'VALIDATION_ERROR')
  }
})
