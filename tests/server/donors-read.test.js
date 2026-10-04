// Needs DATABASE_URL pointing at a reset dev DB (db:reset: reference + demo seed).
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../server/index.js'
import { pool } from '../../server/db.js'

let server, base, cookie, testDonorId
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
})
test.after(async () => {
  if (testDonorId) {
    await pool.query('DELETE FROM organ WHERE donor_id = $1', [testDonorId])
    await pool.query('DELETE FROM donor WHERE donor_id = $1', [testDonorId])
  }
  server.close()
  await pool.end().catch(() => {})
})

const get = (path, withCookie = true) =>
  fetch(`${base}${path}`, { headers: withCookie ? { cookie } : {} })
const list = async (qs = '') => (await get(`/api/donors${qs}`)).json()

test('donors endpoints require a session', async () => {
  for (const path of ['/api/donors', '/api/donors/1']) {
    const res = await get(path, false)
    assert.equal(res.status, 401)
    assert.equal((await res.json()).error.code, 'UNAUTHENTICATED')
  }
})

test('GET /api/donors lists the seed donors in the contract shape (no organs, with organCount)', async () => {
  const rows = await list()
  assert.equal(rows.length, 10)
  const d = rows[0]
  assert.deepEqual(Object.keys(d).sort(), [
    'bloodGroup', 'bloodGroupId', 'dateOfBirth', 'deathCause', 'deathDate', 'donorType', 'heightCm',
    'hospitalId', 'hospitalName', 'id', 'name', 'organCount', 'regionCode', 'status', 'weightKg',
  ])
  assert.match(d.dateOfBirth, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(typeof d.heightCm, 'number')
  assert.equal(typeof d.organCount, 'number')
  assert.ok(rows.some((r) => r.organCount > 0), 'seed donors with organs report organCount')
})

test('filters narrow server-side: type, status, hospital', async () => {
  const deceased = await list('?type=DECEASED')
  assert.equal(deceased.length, 6)
  assert.ok(deceased.every((r) => r.donorType === 'DECEASED'))
  assert.equal((await list('?type=LIVING')).length, 4)
  assert.equal((await list('?status=INACTIVE')).length, 0)
  assert.equal((await list('?status=ACTIVE')).length, 10)
  const hospitalId = (await list())[0].hospitalId
  const byHospital = await list(`?hospital=${hospitalId}`)
  assert.ok(byHospital.length >= 1 && byHospital.every((r) => r.hospitalId === hospitalId))
  const combined = await list(`?type=LIVING&hospital=${hospitalId}`)
  assert.ok(combined.every((r) => r.donorType === 'LIVING' && r.hospitalId === hospitalId))
})

test('bad filter values give 400 VALIDATION_ERROR', async () => {
  for (const q of ['type=BOGUS', 'status=BOGUS', 'hospital=abc']) {
    const res = await get(`/api/donors?${q}`)
    assert.equal(res.status, 400, q)
    assert.equal((await res.json()).error.code, 'VALIDATION_ERROR')
  }
})

test('GET /api/donors/:id returns donor + 6 HLA alleles grouped A,B,DRB1 + organs', async () => {
  const withOrgans = (await list()).find((r) => r.organCount > 0)
  const res = await get(`/api/donors/${withOrgans.id}`)
  assert.equal(res.status, 200)
  const d = await res.json()
  assert.equal(d.id, withOrgans.id)
  assert.equal(d.hla.length, 6)
  assert.deepEqual(d.hla.map((a) => a.locus), ['A', 'A', 'B', 'B', 'DRB1', 'DRB1'])
  assert.deepEqual(Object.keys(d.hla[0]).sort(), ['alleleName', 'id', 'locus'])
  assert.equal(d.organs.length, withOrgans.organCount)
  const o = d.organs[0]
  assert.equal(o.donorId, d.id)
  assert.equal(o.status, 'AVAILABLE')
  assert.equal(o.isExpired, false)
  assert.ok(o.hoursRemaining > 0 && o.hoursRemaining <= o.maxViabilityHours)
  assert.equal(o.hasActiveOffer, false)
  assert.equal(o.activeOfferId, null)
  assert.ok(o.expiresAt && o.organType && o.recoveringHospitalName)
  assert.ok(!('defaultWeights' in o))
})

test('a donor without organs has organs: []', async () => {
  const none = (await list()).find((r) => r.organCount === 0)
  const d = await (await get(`/api/donors/${none.id}`)).json()
  assert.deepEqual(d.organs, [])
  assert.equal(d.hla.length, 6)
})

test('GET /api/donors/:id sweeps: a back-dated AVAILABLE organ is returned as EXPIRED', async () => {
  const { rows } = await pool.query(
    `INSERT INTO donor (name, date_of_birth, blood_group_id, hospital_id, donor_type, height_cm, weight_kg)
     SELECT 'OL-011 Test Donor', '1990-01-01', blood_group_id, (SELECT min(hospital_id) FROM hospital),
            'LIVING', 170, 70
     FROM blood_group LIMIT 1 RETURNING donor_id`,
  )
  testDonorId = rows[0].donor_id
  await pool.query(
    `INSERT INTO organ (donor_id, organ_type_id, recovering_hospital_id, recovered_at)
     VALUES ($1, (SELECT organ_type_id FROM organ_type WHERE name = 'Kidney'),
             (SELECT min(hospital_id) FROM hospital), now() - interval '40 hours')`,
    [testDonorId],
  )
  const d = await (await get(`/api/donors/${testDonorId}`)).json()
  assert.equal(d.organs.length, 1)
  assert.equal(d.organs[0].status, 'EXPIRED')
  assert.equal(d.organs[0].isExpired, true)
  assert.equal(d.organs[0].hoursRemaining, 0)
})

test('unknown or malformed id gives 404 DONOR_NOT_FOUND', async () => {
  for (const id of ['99999', 'abc', '99999999999999999999']) {
    const res = await get(`/api/donors/${id}`)
    assert.equal(res.status, 404, id)
    assert.equal((await res.json()).error.code, 'DONOR_NOT_FOUND')
  }
})
