// Needs DATABASE_URL pointing at a reset dev DB (db:reset: reference + demo seed).
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../server/index.js'
import { pool } from '../../server/db.js'

let server, base, cookie, organId, expiredOrganId, testDonorId
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
  organId = (await pool.query(`SELECT min(organ_id) AS id FROM organ WHERE status = 'AVAILABLE'`)).rows[0].id

  testDonorId = (
    await pool.query(
      `INSERT INTO donor (name, date_of_birth, blood_group_id, hospital_id, donor_type, height_cm, weight_kg)
       SELECT 'OL-014 Test Donor', '1990-01-01', blood_group_id, (SELECT min(hospital_id) FROM hospital),
              'LIVING', 170, 70 FROM blood_group LIMIT 1 RETURNING donor_id`,
    )
  ).rows[0].donor_id
  expiredOrganId = (
    await pool.query(
      `INSERT INTO organ (donor_id, organ_type_id, recovering_hospital_id, recovered_at)
       VALUES ($1, (SELECT organ_type_id FROM organ_type WHERE name = 'Kidney'),
               (SELECT min(hospital_id) FROM hospital), now() - interval '40 hours') RETURNING organ_id`,
      [testDonorId],
    )
  ).rows[0].organ_id
})
test.after(async () => {
  await pool.query(
    'DELETE FROM match_run WHERE organ_id = $1',
    [expiredOrganId],
  )
  await pool.query('DELETE FROM organ WHERE donor_id = $1', [testDonorId])
  await pool.query('DELETE FROM donor WHERE donor_id = $1', [testDonorId])
  server.close()
  await pool.end().catch(() => {})
})

const call = (method, path, body, withCookie = true) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(withCookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const runCount = async (id) =>
  Number((await pool.query('SELECT count(*) FROM match_run WHERE organ_id = $1', [id])).rows[0].count)

test('matching endpoints require a session', async () => {
  for (const [m, p, b] of [
    ['POST', '/api/matching/runs', { organId }],
    ['GET', '/api/matching/runs/1'],
    ['GET', `/api/organs/${organId}/runs`],
  ]) {
    const res = await call(m, p, b, false)
    assert.equal(res.status, 401, p)
  }
})

test('POST without weights uses regional defaults, saves a run by user 1, ranks match the DB', async () => {
  const before = await runCount(organId)
  const res = await call('POST', '/api/matching/runs', { organId })
  assert.equal(res.status, 201)
  const run = await res.json()
  assert.equal(await runCount(organId), before + 1)

  const reg = (
    await pool.query(
      `SELECT r.* FROM organ o JOIN hospital h ON h.hospital_id = o.recovering_hospital_id
       JOIN region r ON r.region_id = h.region_id WHERE o.organ_id = $1`,
      [organId],
    )
  ).rows[0]
  assert.deepEqual(run.weights, {
    hla: Number(reg.hla_weight),
    urgency: Number(reg.urgency_weight),
    distance: Number(reg.distance_weight),
    wait: Number(reg.wait_weight),
  })
  assert.equal(run.organId, organId)
  assert.equal(run.runBy.id, 1)
  assert.equal(run.runBy.username, 'admin')
  assert.equal((await pool.query('SELECT run_by FROM match_run WHERE run_id = $1', [run.id])).rows[0].run_by, 1)

  const db = (
    await pool.query(
      `SELECT recipient_id, rank, match_score FROM match_result WHERE run_id = $1 AND qualified ORDER BY rank, recipient_id`,
      [run.id],
    )
  ).rows
  assert.ok(run.qualified.length > 0)
  assert.deepEqual(
    run.qualified.map((q) => [q.recipientId, q.rank, q.matchScore]),
    db.map((d) => [d.recipient_id, d.rank, Number(d.match_score)]),
  )
  const q = run.qualified[0]
  for (const k of ['recipientName', 'bloodGroup', 'hospitalName', 'hlaScore', 'urgencyScore', 'distanceScore', 'waitScore', 'distanceKm']) {
    assert.ok(k in q, k)
  }
  assert.ok('offerStatus' in q)
  const excludedDb = Number(
    (await pool.query('SELECT count(*) FROM match_result WHERE run_id = $1 AND NOT qualified', [run.id])).rows[0].count,
  )
  assert.equal(run.excluded.length, excludedDb)
  for (const e of run.excluded) {
    assert.match(e.exclusionCode, /^[A-Z_]+$/)
    assert.ok(e.exclusionDescription)
  }
})

test('re-run creates a new run id and the old run stays retrievable', async () => {
  const a = await (await call('POST', '/api/matching/runs', { organId })).json()
  const b = await (await call('POST', '/api/matching/runs', { organId, weights: { wait: 90 } })).json()
  assert.notEqual(a.id, b.id)
  assert.ok(b.id > a.id)
  assert.equal(b.weights.wait, 90)
  const old = await call('GET', `/api/matching/runs/${a.id}`)
  assert.equal(old.status, 200)
  assert.deepEqual(await old.json(), a)
})

test('GET /api/organs/:id/runs lists newest first with counts', async () => {
  const res = await call('GET', `/api/organs/${organId}/runs`)
  assert.equal(res.status, 200)
  const runs = await res.json()
  assert.equal(runs.length, await runCount(organId))
  for (let i = 1; i < runs.length; i++) assert.ok(runs[i - 1].id > runs[i].id)
  const latest = await (await call('GET', `/api/matching/runs/${runs[0].id}`)).json()
  assert.equal(runs[0].qualifiedCount, latest.qualified.length)
  assert.equal(runs[0].excludedCount, latest.excluded.length)
  assert.deepEqual(runs[0].runBy, { id: 1, username: 'admin' })
  assert.deepEqual(Object.keys(runs[0].weights).sort(), ['distance', 'hla', 'urgency', 'wait'])
})

test('all four sliders at maximum keep every score within 0..100', async () => {
  const res = await call('POST', '/api/matching/runs', {
    organId,
    weights: { hla: 100, urgency: 100, distance: 100, wait: 100 },
  })
  assert.equal(res.status, 201)
  const run = await res.json()
  for (const q of run.qualified) {
    for (const k of ['matchScore', 'hlaScore', 'urgencyScore', 'distanceScore', 'waitScore']) {
      assert.ok(q[k] >= 0 && q[k] <= 100, `${k}=${q[k]}`)
    }
  }
})

test('excluded candidates carry known codes and descriptions', async () => {
  const heart = (await pool.query(`SELECT organ_id FROM organ o JOIN organ_type t USING (organ_type_id) WHERE t.name='Heart' AND status='AVAILABLE' LIMIT 1`)).rows[0]
  const run = await (await call('POST', '/api/matching/runs', { organId: heart.organ_id })).json()
  const codes = new Set(run.excluded.map((e) => e.exclusionCode))
  const known = new Set(['ABO_INCOMPATIBLE', 'RECIPIENT_INACTIVE', 'ALREADY_OFFERED', 'SIZE_MISMATCH', 'VIABILITY_UNREACHABLE'])
  assert.ok(codes.size > 0, 'expected at least one excluded candidate')
  for (const c of codes) assert.ok(known.has(c), c)
  assert.ok(run.excluded.every((e) => e.exclusionDescription.length > 0))
})

test('expired organ: 201 with zero qualified, VIABILITY_UNREACHABLE present', async () => {
  const res = await call('POST', '/api/matching/runs', { organId: expiredOrganId })
  assert.equal(res.status, 201)
  const run = await res.json()
  assert.equal(run.qualified.length, 0)
  assert.ok(run.excluded.length > 0)
  const viab = run.excluded.filter((e) => e.exclusionCode === 'VIABILITY_UNREACHABLE')
  assert.ok(viab.length > 0)
  assert.ok(run.excluded.every((e) => ['VIABILITY_UNREACHABLE', 'ABO_INCOMPATIBLE', 'RECIPIENT_INACTIVE', 'ALREADY_OFFERED', 'SIZE_MISMATCH'].includes(e.exclusionCode)))
})

test('validation and not-found errors', async () => {
  const bad = async (body, status, code) => {
    const res = await call('POST', '/api/matching/runs', body)
    assert.equal(res.status, status, JSON.stringify(body))
    assert.equal((await res.json()).error.code, code)
  }
  await bad({}, 400, 'VALIDATION_ERROR')
  await bad({ organId: 'x' }, 400, 'VALIDATION_ERROR')
  await bad({ organId, weights: { hla: -1 } }, 400, 'VALIDATION_ERROR')
  await bad({ organId, weights: { hla: '5' } }, 400, 'VALIDATION_ERROR')
  await bad({ organId, weights: { hla: 100000 } }, 400, 'VALIDATION_ERROR')
  await bad({ organId, weights: { hla: 0, urgency: 0, distance: 0, wait: 0 } }, 400, 'VALIDATION_ERROR')
  await bad({ organId: 999999 }, 404, 'ORGAN_NOT_FOUND')
  const r1 = await call('GET', '/api/matching/runs/999999')
  assert.equal(r1.status, 404)
  assert.equal((await r1.json()).error.code, 'MATCH_RUN_NOT_FOUND')
  assert.equal((await call('GET', '/api/matching/runs/abc')).status, 404)
  const r2 = await call('GET', '/api/organs/999999/runs')
  assert.equal(r2.status, 404)
  assert.equal((await r2.json()).error.code, 'ORGAN_NOT_FOUND')
})

test('rejected request does not create a run', async () => {
  const before = await runCount(organId)
  await call('POST', '/api/matching/runs', { organId, weights: { hla: 0, urgency: 0, distance: 0, wait: 0 } })
  assert.equal(await runCount(organId), before)
})
