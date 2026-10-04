// OL-024: hospitals POST/PATCH, regions, organ types. Needs a reset dev DB.
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../server/index.js'
import { pool } from '../../server/db.js'

let server, base, cookie
let sr, srOriginal, srHospitalId
const hospitals = []
const regions = []
const organTypes = []
const donors = []
const organs = []
const runs = []

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
  sr = (await pool.query("SELECT * FROM region WHERE region_code = 'SR'")).rows[0]
  srOriginal = { ...sr }
  srHospitalId = (await pool.query('SELECT min(hospital_id) AS id FROM hospital WHERE region_id = $1', [sr.region_id])).rows[0].id
})

test.after(async () => {
  // Restore SR's seeded weights and any seeded organ type touched.
  await pool.query(
    `UPDATE region SET hla_weight=$2, urgency_weight=$3, distance_weight=$4, wait_weight=$5 WHERE region_id=$1`,
    [srOriginal.region_id, srOriginal.hla_weight, srOriginal.urgency_weight, srOriginal.distance_weight, srOriginal.wait_weight],
  )
  if (runs.length) {
    await pool.query('DELETE FROM match_result WHERE run_id = ANY($1)', [runs])
    await pool.query('DELETE FROM match_run WHERE run_id = ANY($1)', [runs])
  }
  if (organs.length) await pool.query('DELETE FROM organ WHERE organ_id = ANY($1)', [organs])
  if (donors.length) await pool.query('DELETE FROM donor WHERE donor_id = ANY($1)', [donors])
  if (hospitals.length) await pool.query('DELETE FROM hospital WHERE hospital_id = ANY($1)', [hospitals])
  if (regions.length) await pool.query('DELETE FROM region WHERE region_id = ANY($1)', [regions])
  if (organTypes.length) await pool.query('DELETE FROM organ_type WHERE organ_type_id = ANY($1)', [organTypes])
  server.close()
  await pool.end().catch(() => {})
})

const send = (method, path, body, withCookie = true) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(withCookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const json = async (method, path, body) => {
  const r = await send(method, path, body)
  return { status: r.status, body: await r.json() }
}
const num = (v) => Number(v)
const uniq = () => `OL024-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

/* ---------------- Hospitals ---------------- */

test('hospitals: POST creates (201, shape), PATCH edits, suspend sets SUSPENDED', async () => {
  const name = uniq()
  const created = await json('POST', '/api/hospitals', {
    name, address: '1 Test Road', phone: '000', latitude: 12.5, longitude: 77.5, regionId: num(sr.region_id),
  })
  assert.equal(created.status, 201)
  hospitals.push(created.body.id)
  assert.deepEqual(Object.keys(created.body).sort(), [
    'address', 'id', 'latitude', 'longitude', 'name', 'phone', 'regionCode', 'regionId', 'regionName', 'status',
  ])
  assert.equal(created.body.status, 'ACTIVE')
  assert.equal(created.body.regionCode, 'SR')

  const edited = await json('PATCH', `/api/hospitals/${created.body.id}`, { name: `${name}-b`, phone: '111' })
  assert.equal(edited.status, 200)
  assert.equal(edited.body.name, `${name}-b`)
  assert.equal(edited.body.address, '1 Test Road')

  const susp = await json('PATCH', `/api/hospitals/${created.body.id}`, { status: 'SUSPENDED' })
  assert.equal(susp.status, 200)
  assert.equal(susp.body.status, 'SUSPENDED')
  const row = (await pool.query('SELECT status FROM hospital WHERE hospital_id = $1', [created.body.id])).rows[0]
  assert.equal(row.status, 'SUSPENDED')
  const back = await json('PATCH', `/api/hospitals/${created.body.id}`, { status: 'ACTIVE' })
  assert.equal(back.body.status, 'ACTIVE')
})

test('hospitals: bad latitude 400 CONSTRAINT_VIOLATION, unknown region 400 REFERENCE_NOT_FOUND, 404', async () => {
  const base = { name: uniq(), latitude: 10, longitude: 10, regionId: num(sr.region_id) }
  const bad = await json('POST', '/api/hospitals', { ...base, latitude: 95 })
  assert.equal(bad.status, 400)
  assert.equal(bad.body.error.code, 'CONSTRAINT_VIOLATION')
  const ref = await json('POST', '/api/hospitals', { ...base, regionId: 999999 })
  assert.equal(ref.status, 400)
  assert.equal(ref.body.error.code, 'REFERENCE_NOT_FOUND')
  const nf = await json('PATCH', '/api/hospitals/999999', { name: 'x' })
  assert.equal(nf.status, 404)
  assert.equal(nf.body.error.code, 'HOSPITAL_NOT_FOUND')
  const type = await json('POST', '/api/hospitals', { ...base, latitude: 'abc' })
  assert.equal(type.status, 400)
  assert.equal(type.body.error.code, 'VALIDATION_ERROR')
})

test('hospitals: requires a session', async () => {
  assert.equal((await send('POST', '/api/hospitals', {}, false)).status, 401)
})

/* ---------------- Regions ---------------- */

test('regions: GET shape and hospitalCount matches SQL', async () => {
  const { status, body } = await json('GET', '/api/regions')
  assert.equal(status, 200)
  const r = body.find((x) => x.code === 'SR')
  assert.deepEqual(Object.keys(r).sort(), ['code', 'hospitalCount', 'id', 'name', 'weights'])
  assert.deepEqual(Object.keys(r.weights).sort(), ['distance', 'hla', 'urgency', 'wait'])
  const cnt = (await pool.query('SELECT count(*)::int AS c FROM hospital WHERE region_id = $1', [sr.region_id])).rows[0].c
  assert.equal(r.hospitalCount, cnt)
})

test('regions: PATCH SR weights persists and drives the next default match run', async () => {
  const w = { hla: 11, urgency: 22, distance: 33, wait: 44 }
  const res = await json('PATCH', `/api/regions/${sr.region_id}`, { weights: w })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.weights, w)
  const row = (await pool.query('SELECT * FROM region WHERE region_id = $1', [sr.region_id])).rows[0]
  assert.deepEqual(
    [row.hla_weight, row.urgency_weight, row.distance_weight, row.wait_weight].map(Number),
    [11, 22, 33, 44],
  )
  assert.equal(row.region_name, sr.region_name)

  // Fixture: an AVAILABLE kidney recovered at an SR hospital.
  const donorId = (
    await pool.query(
      `INSERT INTO donor (name, date_of_birth, blood_group_id, hospital_id, donor_type, height_cm, weight_kg)
       SELECT 'OL-024 Donor', '1990-01-01', (SELECT min(blood_group_id) FROM blood_group), $1, 'LIVING', 170, 70
       RETURNING donor_id`,
      [srHospitalId],
    )
  ).rows[0].donor_id
  donors.push(donorId)
  const organId = (
    await pool.query(
      `INSERT INTO organ (donor_id, organ_type_id, recovering_hospital_id, recovered_at)
       VALUES ($1, (SELECT organ_type_id FROM organ_type WHERE name = 'Kidney'), $2, now() - interval '1 hour')
       RETURNING organ_id`,
      [donorId, srHospitalId],
    )
  ).rows[0].organ_id
  organs.push(organId)

  const detail = await json('GET', `/api/organs/${organId}`)
  assert.equal(detail.status, 200)
  assert.deepEqual(detail.body.defaultWeights, w)

  const run = await json('POST', '/api/matching/runs', { organId })
  assert.equal(run.status, 201)
  const mr = (await pool.query('SELECT * FROM match_run WHERE organ_id = $1', [organId])).rows
  assert.equal(mr.length, 1)
  runs.push(mr[0].run_id)
  assert.deepEqual(
    [mr[0].hla_weight, mr[0].urgency_weight, mr[0].distance_weight, mr[0].wait_weight].map(Number),
    [11, 22, 33, 44],
  )
})

test('regions: partial weights change only the supplied keys', async () => {
  const before = (await json('GET', '/api/regions')).body.find((x) => x.code === 'SR').weights
  const res = await json('PATCH', `/api/regions/${sr.region_id}`, { weights: { wait: 5 } })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.weights, { ...before, wait: 5 })
})

test('regions: all zeros 400 ck_region_weights_nonzero and row unchanged; negative 400', async () => {
  const before = (await pool.query('SELECT * FROM region WHERE region_id = $1', [sr.region_id])).rows[0]
  const zero = await json('PATCH', `/api/regions/${sr.region_id}`, {
    weights: { hla: 0, urgency: 0, distance: 0, wait: 0 },
  })
  assert.equal(zero.status, 400)
  assert.equal(zero.body.error.code, 'CONSTRAINT_VIOLATION')
  assert.equal(zero.body.error.details.constraint, 'ck_region_weights_nonzero')
  const after = (await pool.query('SELECT * FROM region WHERE region_id = $1', [sr.region_id])).rows[0]
  assert.deepEqual(after, before)
  const neg = await json('PATCH', `/api/regions/${sr.region_id}`, { weights: { hla: -1 } })
  assert.equal(neg.status, 400)
  assert.equal(neg.body.error.code, 'CONSTRAINT_VIOLATION')
  const bad = await json('PATCH', `/api/regions/${sr.region_id}`, { weights: { hla: 'x' } })
  assert.equal(bad.status, 400)
  assert.equal(bad.body.error.code, 'VALIDATION_ERROR')
})

test('regions: POST applies defaults (201); duplicate code 409; 404', async () => {
  const code = `T${Date.now() % 100000}`
  const created = await json('POST', '/api/regions', { code, name: 'OL-024 Test Region' })
  assert.equal(created.status, 201)
  regions.push(created.body.id)
  assert.deepEqual(created.body.weights, { hla: 25, urgency: 35, distance: 20, wait: 20 })
  assert.equal(created.body.hospitalCount, 0)
  const partial = await json('POST', '/api/regions', { code: `${code}b`, name: 'P', weights: { hla: 50 } })
  assert.equal(partial.status, 201)
  regions.push(partial.body.id)
  assert.deepEqual(partial.body.weights, { hla: 50, urgency: 35, distance: 20, wait: 20 })

  const dup = await json('POST', '/api/regions', { code, name: 'Dup' })
  assert.equal(dup.status, 409)
  assert.equal(dup.body.error.code, 'DUPLICATE')
  const renamed = await json('PATCH', `/api/regions/${created.body.id}`, { name: 'Renamed' })
  assert.equal(renamed.body.name, 'Renamed')
  const nf = await json('PATCH', '/api/regions/999999', { name: 'x' })
  assert.equal(nf.status, 404)
  assert.equal(nf.body.error.code, 'REGION_NOT_FOUND')
})

/* ---------------- Organ types ---------------- */

test('organ types: GET includes Kidney 30 / 6 / 0.5 / 3.0', async () => {
  const { status, body } = await json('GET', '/api/organ-types')
  assert.equal(status, 200)
  const k = body.find((t) => t.name === 'Kidney')
  assert.equal(k.maxViabilityHours, 30)
  assert.equal(k.responseWindowHours, 6)
  assert.equal(k.minWeightRatio, 0.5)
  assert.equal(k.maxWeightRatio, 3)
  assert.deepEqual(Object.keys(k).sort(), [
    'id', 'maxViabilityHours', 'maxWeightRatio', 'minWeightRatio', 'name', 'priorityWeight', 'responseWindowHours',
  ])
})

test('organ types: POST 201, PATCH, ratio order 400, duplicate 409, 404', async () => {
  const name = uniq()
  const created = await json('POST', '/api/organ-types', {
    name, maxViabilityHours: 10, responseWindowHours: 2, minWeightRatio: 0.8, maxWeightRatio: 1.5,
  })
  assert.equal(created.status, 201)
  organTypes.push(created.body.id)
  assert.equal(created.body.priorityWeight, 1)
  const patched = await json('PATCH', `/api/organ-types/${created.body.id}`, { maxViabilityHours: 12 })
  assert.equal(patched.status, 200)
  assert.equal(patched.body.maxViabilityHours, 12)
  assert.equal(patched.body.name, name)

  const order = await json('PATCH', `/api/organ-types/${created.body.id}`, { maxWeightRatio: 0.5 })
  assert.equal(order.status, 400)
  assert.equal(order.body.error.code, 'CONSTRAINT_VIOLATION')
  assert.equal(order.body.error.details.constraint, 'ck_organ_type_ratio_order')
  const pos = await json('PATCH', `/api/organ-types/${created.body.id}`, { maxViabilityHours: 0 })
  assert.equal(pos.status, 400)
  assert.equal(pos.body.error.code, 'CONSTRAINT_VIOLATION')

  const dup = await json('POST', '/api/organ-types', {
    name, maxViabilityHours: 10, responseWindowHours: 2, minWeightRatio: 0.8, maxWeightRatio: 1.5,
  })
  assert.equal(dup.status, 409)
  assert.equal(dup.body.error.code, 'DUPLICATE')
  const nf = await json('PATCH', '/api/organ-types/999999', { name: 'x' })
  assert.equal(nf.status, 404)
  assert.equal(nf.body.error.code, 'ORGAN_TYPE_NOT_FOUND')
})

test('lookups organTypes shares the same shape as /api/organ-types', async () => {
  const lk = (await json('GET', '/api/lookups')).body.organTypes
  const ot = (await json('GET', '/api/organ-types')).body.filter((t) => lk.some((x) => x.id === t.id))
  assert.deepEqual(ot, lk)
})
