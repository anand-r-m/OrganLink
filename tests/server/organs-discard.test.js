// Needs DATABASE_URL pointing at a reset dev DB (db:reset: reference + demo seed).
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../server/index.js'
import { pool } from '../../server/db.js'

let server, base, cookie, donor, reasons, sample, offerOrganId, offerId
const organs = []
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString()

const call = (method, path, body, withCookie = true) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(withCookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const addOrgan = async ({ recoveredHoursAgo = 1, typeId = sample.organ_type_id } = {}) => {
  const { rows } = await pool.query(
    `INSERT INTO organ (donor_id, organ_type_id, recovering_hospital_id, recovered_at)
     VALUES ($1, $2, $3, $4) RETURNING organ_id`,
    [donor, typeId, sample.recovering_hospital_id, hoursAgo(recoveredHoursAgo)],
  )
  organs.push(rows[0].organ_id)
  return rows[0].organ_id
}
const dbOrgan = async (id) =>
  (await pool.query('SELECT status, discard_reason_id FROM organ WHERE organ_id = $1', [id])).rows[0]
const discard = (id, body) => call('POST', `/api/organs/${id}/discard`, body)

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
  reasons = Object.fromEntries(
    (await pool.query('SELECT code, discard_reason_id AS id FROM discard_reason')).rows.map((r) => [r.code, r.id]),
  )

  // Fixture donor + organ cloned from a seeded organ that has ranked candidates, so a real offer can
  // be created for it through the API. Seeded organs are never touched.
  const seeded = (await pool.query(`SELECT organ_id FROM organ WHERE status = 'AVAILABLE' ORDER BY organ_id`)).rows
  for (const s of seeded) {
    const o = (await pool.query('SELECT donor_id, organ_type_id, recovering_hospital_id FROM organ WHERE organ_id = $1', [s.organ_id])).rows[0]
    const d = (
      await pool.query(
        `INSERT INTO donor (name, date_of_birth, blood_group_id, hospital_id, donor_type, height_cm, weight_kg)
         SELECT 'OL-023 Test Donor', date_of_birth, blood_group_id, hospital_id, 'LIVING', height_cm, weight_kg
         FROM donor WHERE donor_id = $1 RETURNING donor_id`,
        [o.donor_id],
      )
    ).rows[0].donor_id
    await pool.query('INSERT INTO donor_hla (donor_id, allele_id) SELECT $2, allele_id FROM donor_hla WHERE donor_id = $1', [o.donor_id, d])
    const cand = (
      await pool.query(
        `INSERT INTO organ (donor_id, organ_type_id, recovering_hospital_id, recovered_at)
         VALUES ($1, $2, $3, $4) RETURNING organ_id`,
        [d, o.organ_type_id, o.recovering_hospital_id, hoursAgo(0.5)],
      )
    ).rows[0].organ_id
    const run = await (await call('POST', '/api/matching/runs', { organId: cand })).json()
    if (run.qualified?.length) {
      const r = await call('POST', '/api/offers', { organId: cand, recipientId: run.qualified[0].recipientId, matchRunId: run.id })
      if (r.status === 201) {
        donor = d
        sample = o
        offerOrganId = cand
        organs.push(cand)
        offerId = (await r.json()).id
        break
      }
    }
    // Not usable: discard this attempt's fixtures.
    await pool.query('DELETE FROM match_run WHERE organ_id = $1', [cand]).catch(() => {})
    await pool.query('DELETE FROM organ WHERE organ_id = $1', [cand]).catch(() => {})
    await pool.query('DELETE FROM donor_hla WHERE donor_id = $1', [d])
    await pool.query('DELETE FROM donor WHERE donor_id = $1', [d])
  }
  assert.ok(offerId, 'needs a seeded organ with a candidate to build an open-offer fixture')
})
test.after(async () => {
  // Remove only what this file created, in FK order (audit rows are append-only history).
  await pool.query('DELETE FROM organ_offer WHERE organ_id = ANY($1)', [organs])
  await pool.query('DELETE FROM match_run WHERE organ_id = ANY($1)', [organs])
  await pool.query('DELETE FROM organ WHERE organ_id = ANY($1)', [organs])
  if (donor) {
    await pool.query('DELETE FROM donor_hla WHERE donor_id = $1', [donor])
    await pool.query('DELETE FROM donor WHERE donor_id = $1', [donor])
  }
  server.close()
  await pool.end().catch(() => {})
})

test('requires a session', async () => {
  const res = await call('POST', '/api/organs/1/discard', { discardReasonId: 1 }, false)
  assert.equal(res.status, 401)
})

test('AVAILABLE organ -> 200 DISCARDED with the reason, Organ shape, DB and audit row', async () => {
  const id = await addOrgan()
  const audit = async () =>
    Number((await pool.query(`SELECT count(*) FROM audit_log WHERE table_name = 'organ' AND row_id = $1 AND action = 'UPDATE'`, [String(id)])).rows[0].count)
  const before = await audit()
  const res = await discard(id, { discardReasonId: reasons.QUALITY_ASSESSMENT })
  assert.equal(res.status, 200)
  const o = await res.json()
  assert.equal(o.id, id)
  assert.equal(o.status, 'DISCARDED')
  assert.equal(o.discardReasonId, reasons.QUALITY_ASSESSMENT)
  assert.equal(o.discardReasonCode, 'QUALITY_ASSESSMENT')
  assert.equal(o.hasActiveOffer, false)
  assert.deepEqual(Object.keys(o.defaultWeights).sort(), ['distance', 'hla', 'urgency', 'wait'])
  const db = await dbOrgan(id)
  assert.equal(db.status, 'DISCARDED')
  assert.equal(db.discard_reason_id, reasons.QUALITY_ASSESSMENT)
  assert.equal((await audit()) - before, 1)
  const row = (
    await pool.query(
      `SELECT user_id FROM audit_log WHERE table_name = 'organ' AND row_id = $1 AND action = 'UPDATE' ORDER BY changed_at DESC LIMIT 1`,
      [String(id)],
    )
  ).rows[0]
  assert.equal(row.user_id, 1)
})

test('EXPIRED organ (swept) + VIABILITY_ELAPSED -> 200 DISCARDED', async () => {
  const id = await addOrgan({ recoveredHoursAgo: 500 })
  // Not yet swept: the discard sweeps first, so the organ is EXPIRED when the check runs.
  const res = await discard(id, { discardReasonId: reasons.VIABILITY_ELAPSED })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).status, 'DISCARDED')
  const db = await dbOrgan(id)
  assert.equal(db.status, 'DISCARDED')
  assert.equal(db.discard_reason_id, reasons.VIABILITY_ELAPSED)
})

test('already-EXPIRED organ is discardable too', async () => {
  const id = await addOrgan({ recoveredHoursAgo: 500 })
  await pool.query('SELECT expire_stale_offers()')
  assert.equal((await dbOrgan(id)).status, 'EXPIRED')
  const res = await discard(id, { discardReasonId: reasons.VIABILITY_ELAPSED })
  assert.equal(res.status, 200)
  assert.equal((await dbOrgan(id)).discard_reason_id, reasons.VIABILITY_ELAPSED)
})

test('open CREATED offer -> 409 ACTIVE_OFFER_EXISTS, organ unchanged; allowed after cancel', async () => {
  let res = await discard(offerOrganId, { discardReasonId: reasons.NO_SUITABLE_RECIPIENT })
  assert.equal(res.status, 409)
  const err = (await res.json()).error
  assert.equal(err.code, 'ACTIVE_OFFER_EXISTS')
  assert.equal(err.details.offerId, offerId)
  const db = await dbOrgan(offerOrganId)
  assert.equal(db.status, 'AVAILABLE')
  assert.equal(db.discard_reason_id, null)

  assert.equal((await call('POST', `/api/offers/${offerId}/cancel`)).status, 200)
  res = await discard(offerOrganId, { discardReasonId: reasons.NO_SUITABLE_RECIPIENT })
  assert.equal(res.status, 200)
  assert.equal((await dbOrgan(offerOrganId)).status, 'DISCARDED')
})

test('TRANSPLANTED and ALLOCATED organs -> 409 INVALID_STATE_TRANSITION with details', async () => {
  for (const status of ['TRANSPLANTED', 'ALLOCATED']) {
    const id = await addOrgan()
    await pool.query('UPDATE organ SET status = $2 WHERE organ_id = $1', [id, status])
    const res = await discard(id, { discardReasonId: reasons.ALL_DECLINED })
    assert.equal(res.status, 409, status)
    const err = (await res.json()).error
    assert.equal(err.code, 'INVALID_STATE_TRANSITION')
    assert.equal(err.details.currentStatus, status)
    assert.equal((await dbOrgan(id)).status, status)
  }
})

test('DISCARDED organ -> 409 INVALID_STATE_TRANSITION', async () => {
  const id = await addOrgan()
  assert.equal((await discard(id, { discardReasonId: reasons.ALL_DECLINED })).status, 200)
  const res = await discard(id, { discardReasonId: reasons.TRANSPORT_FAILURE })
  assert.equal(res.status, 409)
  const err = (await res.json()).error
  assert.equal(err.code, 'INVALID_STATE_TRANSITION')
  assert.equal(err.details.currentStatus, 'DISCARDED')
  assert.equal((await dbOrgan(id)).discard_reason_id, reasons.ALL_DECLINED)
})

test('validation: missing or non-integer discardReasonId -> 400; unknown reason id; unknown organ -> 404', async () => {
  const id = await addOrgan()
  for (const body of [{}, { discardReasonId: 'x' }, { discardReasonId: 1.5 }, { discardReasonId: null }, { discardReasonId: '2' }]) {
    const res = await discard(id, body)
    assert.equal(res.status, 400, JSON.stringify(body))
    const err = (await res.json()).error
    assert.equal(err.code, 'VALIDATION_ERROR')
    assert.deepEqual(err.details.fields, ['discardReasonId'])
  }
  const bad = await discard(id, { discardReasonId: 999999 })
  assert.equal(bad.status, 400)
  assert.equal((await bad.json()).error.code, 'REFERENCE_NOT_FOUND')
  assert.equal((await dbOrgan(id)).status, 'AVAILABLE')

  for (const p of ['999999999', 'abc']) {
    const res = await discard(p, { discardReasonId: reasons.ALL_DECLINED })
    assert.equal(res.status, 404, p)
    assert.equal((await res.json()).error.code, 'ORGAN_NOT_FOUND')
  }
})
