// OL-026: GET /api/reports/*. Each endpoint equals SELECT * FROM <view> through toCamel.
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../server/index.js'
import { pool } from '../../server/db.js'
import { toCamel } from '../../server/util/case.js'

let server, base, cookie, donor, organId, offerId, sample
const get = (path, withCookie = true) =>
  fetch(`${base}${path}`, { headers: withCookie ? { cookie } : {} })
const view = async (sql) => (await pool.query(sql)).rows.map(toCamel)
const viaJson = (x) => JSON.parse(JSON.stringify(x))
const isNumOrNull = (v) => v === null || typeof v === 'number'

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

  // Fixtures: a donor + DISCARDED organ (feeds utilization/compliance) and a DECLINED offer on a
  // second organ (feeds decline-reasons). Cloned from a seeded organ; seeded rows are untouched.
  sample = (await pool.query(`SELECT donor_id, organ_type_id, recovering_hospital_id FROM organ ORDER BY organ_id LIMIT 1`)).rows[0]
  donor = (
    await pool.query(
      `INSERT INTO donor (name, date_of_birth, blood_group_id, hospital_id, donor_type, height_cm, weight_kg)
       SELECT 'OL-026 Test Donor', date_of_birth, blood_group_id, hospital_id, 'LIVING', height_cm, weight_kg
       FROM donor WHERE donor_id = $1 RETURNING donor_id`,
      [sample.donor_id],
    )
  ).rows[0].donor_id
  organId = (
    await pool.query(
      `INSERT INTO organ (donor_id, organ_type_id, recovering_hospital_id, recovered_at)
       VALUES ($1, $2, $3, now() - interval '1 hour') RETURNING organ_id`,
      [donor, sample.organ_type_id, sample.recovering_hospital_id],
    )
  ).rows[0].organ_id
  const reason = (await pool.query(`SELECT discard_reason_id AS id FROM discard_reason ORDER BY 1 LIMIT 1`)).rows[0].id
  const candidates = (
    await pool.query(
      `SELECT recipient_id FROM waitlist_entry WHERE organ_type_id = $1 AND status = 'ACTIVE' ORDER BY recipient_id`,
      [sample.organ_type_id],
    )
  ).rows
  const decline = (await pool.query(`SELECT decline_reason_id AS id FROM decline_reason ORDER BY 1 LIMIT 1`)).rows[0].id
  // The offer trigger checks compatibility, so try active candidates until one is accepted.
  for (const c of candidates) {
    try {
      offerId = (
        await pool.query(
          `INSERT INTO organ_offer (organ_id, recipient_id, status, sent_at, responded_at, decline_reason_id)
           VALUES ($1, $2, 'DECLINED', now(), now(), $3) RETURNING offer_id`,
          [organId, c.recipient_id, decline],
        )
      ).rows[0].offer_id
      break
    } catch {
      // not compatible; next
    }
  }
  assert.ok(offerId, 'needs a compatible waitlisted recipient for the declined-offer fixture')
  await pool.query(`UPDATE organ SET status = 'DISCARDED', discard_reason_id = $2 WHERE organ_id = $1`, [organId, reason])
})

test.after(async () => {
  if (offerId) await pool.query('DELETE FROM organ_offer WHERE offer_id = $1', [offerId])
  if (organId) await pool.query('DELETE FROM organ WHERE organ_id = $1', [organId])
  if (donor) await pool.query('DELETE FROM donor WHERE donor_id = $1', [donor])
  server.close()
  await pool.end().catch(() => {})
})

test('every report endpoint needs a session', async () => {
  for (const p of ['waiting-times', 'utilization', 'decline-reasons', 'fairness', 'compliance']) {
    assert.equal((await get(`/api/reports/${p}`, false)).status, 401, p)
  }
})

test('waiting-times equals v_waiting_time_distribution', async () => {
  const res = await get('/api/reports/waiting-times')
  assert.equal(res.status, 200)
  const body = await res.json()
  const expected = await view('SELECT * FROM v_waiting_time_distribution ORDER BY organ_type, bucket')
  assert.ok(expected.length > 0, 'seed has active waitlist entries')
  assert.deepEqual(body, viaJson(expected))
  for (const r of body) {
    assert.deepEqual(Object.keys(r).sort(), ['bucket', 'organType', 'recipients'])
    assert.equal(typeof r.bucket, 'number')
    assert.equal(typeof r.recipients, 'number')
    assert.ok(r.bucket >= 0 && r.bucket <= 13)
  }
})

test('utilization equals v_organ_utilization (incl. the discarded fixture organ)', async () => {
  const body = await (await get('/api/reports/utilization')).json()
  const expected = await view('SELECT * FROM v_organ_utilization ORDER BY region_name, organ_type')
  assert.deepEqual(body, viaJson(expected))
  assert.ok(body.length > 0)
  for (const r of body) {
    assert.deepEqual(Object.keys(r).sort(), ['discarded', 'expired', 'organType', 'regionName', 'totalRecovered', 'transplanted', 'utilizationPct'])
    for (const k of ['transplanted', 'expired', 'discarded', 'totalRecovered']) assert.equal(typeof r[k], 'number', k)
    assert.ok(isNumOrNull(r.utilizationPct))
  }
  assert.ok(body.some((r) => r.discarded >= 1), 'fixture discarded organ is counted')
})

test('decline-reasons equals v_decline_reasons (incl. the declined fixture offer)', async () => {
  const body = await (await get('/api/reports/decline-reasons')).json()
  const expected = await view('SELECT * FROM v_decline_reasons ORDER BY occurrences DESC, code')
  assert.deepEqual(body, viaJson(expected))
  assert.ok(body.length >= 1)
  for (const r of body) {
    assert.deepEqual(Object.keys(r).sort(), ['code', 'description', 'occurrences', 'pct'])
    assert.equal(typeof r.occurrences, 'number')
    assert.equal(typeof r.pct, 'number')
  }
})

test('fairness equals v_allocation_fairness; types are numbers or null', async () => {
  const body = await (await get('/api/reports/fairness')).json()
  const expected = await view('SELECT * FROM v_allocation_fairness ORDER BY region_name')
  assert.deepEqual(body, viaJson(expected))
  assert.ok(body.length > 0)
  for (const r of body) {
    assert.deepEqual(
      Object.keys(r).sort(),
      ['allocationRatePct', 'medianWaitDays', 'regionName', 'retentionPct', 'transplantsCompleted', 'waitlistSize'],
    )
    assert.equal(typeof r.waitlistSize, 'number')
    assert.equal(typeof r.transplantsCompleted, 'number')
    for (const k of ['allocationRatePct', 'medianWaitDays', 'retentionPct']) assert.ok(isNumOrNull(r[k]), k)
    if (r.transplantsCompleted === 0) {
      assert.equal(r.medianWaitDays, null)
      assert.equal(r.retentionPct, null)
    }
  }
})

test('compliance is a single object equal to v_compliance_summary', async () => {
  const body = await (await get('/api/reports/compliance')).json()
  assert.ok(!Array.isArray(body))
  const [expected] = await view('SELECT * FROM v_compliance_summary')
  assert.deepEqual(body, viaJson(expected))
  assert.deepEqual(Object.keys(body).sort(), ['discarded', 'expiredUnallocated', 'placementRatePct', 'totalOrgans', 'transplanted'])
  for (const k of ['transplanted', 'expiredUnallocated', 'discarded', 'totalOrgans']) assert.equal(typeof body[k], 'number', k)
  assert.ok(isNumOrNull(body.placementRatePct))
  assert.ok(body.discarded >= 1 && body.totalOrgans >= 1)
})

test('view row counts: each list endpoint returns exactly as many rows as its view; compliance has one', async () => {
  const views = {
    'waiting-times': 'v_waiting_time_distribution',
    utilization: 'v_organ_utilization',
    'decline-reasons': 'v_decline_reasons',
    fairness: 'v_allocation_fairness',
  }
  for (const [path, v] of Object.entries(views)) {
    const body = await (await get(`/api/reports/${path}`)).json()
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${v}`)
    assert.equal(body.length, rows[0].n, v)
  }
  // The v1 seed waitlists recipients, so the waiting-time view is never empty.
  assert.ok((await pool.query('SELECT count(*)::int AS n FROM v_waiting_time_distribution')).rows[0].n > 0)
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM v_compliance_summary')).rows[0].n, 1)
  // one fairness row per region
  const f = (await pool.query('SELECT (SELECT count(*) FROM v_allocation_fairness)::int AS a, (SELECT count(*) FROM region)::int AS b')).rows[0]
  assert.equal(f.a, f.b)
})
