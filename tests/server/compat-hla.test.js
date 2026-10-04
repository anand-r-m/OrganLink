// OL-025: blood compatibility matrix + HLA alleles. Needs a reset dev DB.
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../server/index.js'
import { pool } from '../../server/db.js'

let server, base, cookie
const donors = []
const organs = []
const recipients = []
const runs = []
const alleles = []
let restorePair = null

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
  if (restorePair) {
    await pool.query(
      'UPDATE blood_compatibility SET compatible = $3 WHERE donor_bg_id = $1 AND recipient_bg_id = $2',
      [restorePair.d, restorePair.r, restorePair.value],
    )
  }
  if (runs.length) {
    await pool.query('DELETE FROM match_result WHERE run_id = ANY($1)', [runs])
    await pool.query('DELETE FROM match_run WHERE run_id = ANY($1)', [runs])
  }
  if (organs.length) await pool.query('DELETE FROM organ WHERE organ_id = ANY($1)', [organs])
  if (donors.length) await pool.query('DELETE FROM donor WHERE donor_id = ANY($1)', [donors])
  if (recipients.length) await pool.query('DELETE FROM recipient WHERE recipient_id = ANY($1)', [recipients])
  if (alleles.length) await pool.query('DELETE FROM hla_allele WHERE allele_id = ANY($1)', [alleles])
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
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}
const bg = async (name) =>
  Number((await pool.query('SELECT blood_group_id AS id FROM blood_group WHERE group_name = $1', [name])).rows[0].id)

test('requires a session', async () => {
  for (const [m, p] of [['GET', '/api/blood-compatibility'], ['PATCH', '/api/blood-compatibility'], ['GET', '/api/hla-alleles'], ['POST', '/api/hla-alleles'], ['DELETE', '/api/hla-alleles/1']]) {
    assert.equal((await send(m, p, undefined, false)).status, 401, `${m} ${p}`)
  }
})

test('GET blood-compatibility: 8 groups, 64 pairs, compatible count matches the DB', async () => {
  const { status, body } = await json('GET', '/api/blood-compatibility')
  assert.equal(status, 200)
  assert.equal(body.bloodGroups.length, 8)
  assert.equal(body.pairs.length, 64)
  assert.deepEqual(Object.keys(body.pairs[0]).sort(), [
    'compatible', 'donorBloodGroupId', 'donorGroup', 'recipientBloodGroupId', 'recipientGroup',
  ])
  const dbCount = Number((await pool.query('SELECT count(*) AS n FROM blood_compatibility WHERE compatible')).rows[0].n)
  assert.equal(body.pairs.filter((p) => p.compatible).length, dbCount)
  // After a reset the seed has 27 compatible pairs; other tests restore what they touch.
  assert.equal(dbCount, 27)
})

test('PATCH blood-compatibility: toggles, persists, restores; errors', async () => {
  const d = await bg('A+')
  const r = await bg('B+')
  const before = (await pool.query('SELECT compatible FROM blood_compatibility WHERE donor_bg_id=$1 AND recipient_bg_id=$2', [d, r])).rows[0].compatible
  restorePair = { d, r, value: before }
  const res = await json('PATCH', '/api/blood-compatibility', { donorBloodGroupId: d, recipientBloodGroupId: r, compatible: !before })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, {
    donorBloodGroupId: d, donorGroup: 'A+', recipientBloodGroupId: r, recipientGroup: 'B+', compatible: !before,
  })
  const after = (await pool.query('SELECT compatible FROM blood_compatibility WHERE donor_bg_id=$1 AND recipient_bg_id=$2', [d, r])).rows[0].compatible
  assert.equal(after, !before)
  const back = await json('PATCH', '/api/blood-compatibility', { donorBloodGroupId: d, recipientBloodGroupId: r, compatible: before })
  assert.equal(back.body.compatible, before)

  const nf = await json('PATCH', '/api/blood-compatibility', { donorBloodGroupId: 999999, recipientBloodGroupId: r, compatible: true })
  assert.equal(nf.status, 404)
  assert.equal(nf.body.error.code, 'BLOOD_COMPATIBILITY_NOT_FOUND')
  for (const bad of [{}, { donorBloodGroupId: d, recipientBloodGroupId: r }, { donorBloodGroupId: 'x', recipientBloodGroupId: r, compatible: true }, { donorBloodGroupId: d, recipientBloodGroupId: r, compatible: 'yes' }]) {
    const e = await json('PATCH', '/api/blood-compatibility', bad)
    assert.equal(e.status, 400)
    assert.equal(e.body.error.code, 'VALIDATION_ERROR')
  }
})

test('AC2: toggling a pair changes ABO exclusion on the next match run', async () => {
  const d = await bg('A+')
  const r = await bg('B+')
  const orig = (await pool.query('SELECT compatible FROM blood_compatibility WHERE donor_bg_id=$1 AND recipient_bg_id=$2', [d, r])).rows[0].compatible
  restorePair = { d, r, value: orig }
  const hospitalId = (await pool.query('SELECT min(hospital_id) AS id FROM hospital')).rows[0].id
  const donorId = (await pool.query(
    `INSERT INTO donor (name, date_of_birth, blood_group_id, hospital_id, donor_type, height_cm, weight_kg)
     VALUES ('OL-025 Donor', '1990-01-01', $1, $2, 'LIVING', 170, 70) RETURNING donor_id`, [d, hospitalId])).rows[0].donor_id
  donors.push(donorId)
  const organTypeId = (await pool.query("SELECT organ_type_id FROM organ_type WHERE name = 'Kidney'")).rows[0].organ_type_id
  const organId = (await pool.query(
    `INSERT INTO organ (donor_id, organ_type_id, recovering_hospital_id, recovered_at)
     VALUES ($1, $2, $3, now() - interval '1 hour') RETURNING organ_id`, [donorId, organTypeId, hospitalId])).rows[0].organ_id
  organs.push(organId)
  const recipientId = Number((await pool.query(
    `INSERT INTO recipient (name, date_of_birth, blood_group_id, hospital_id, height_cm, weight_kg)
     VALUES ('OL-025 Recipient', '1985-05-05', $1, $2, 170, 70) RETURNING recipient_id`, [r, hospitalId])).rows[0].recipient_id)
  recipients.push(recipientId)
  await pool.query(
    `INSERT INTO waitlist_entry (recipient_id, organ_type_id, urgency_id) VALUES ($1, $2, (SELECT min(urgency_id) FROM urgency))`,
    [recipientId, organTypeId])

  const abo = async () => {
    const run = await json('POST', '/api/matching/runs', { organId })
    assert.equal(run.status, 201)
    runs.push(run.body.id)
    const ex = run.body.excluded.find((e) => Number(e.recipientId ?? e.recipient?.id) === recipientId)
    return { excludedAbo: ex?.exclusionCode === 'ABO_INCOMPATIBLE', ex, run: run.body }
  }
  const set = (compatible) => json('PATCH', '/api/blood-compatibility', { donorBloodGroupId: d, recipientBloodGroupId: r, compatible })

  assert.equal((await set(false)).status, 200)
  const off = await abo()
  assert.equal(off.excludedAbo, true, 'incompatible pair must exclude the recipient')
  assert.equal((await set(true)).status, 200)
  const on = await abo()
  assert.equal(on.excludedAbo, false, 'compatible pair must not exclude with ABO_INCOMPATIBLE')
  assert.ok(on.run.qualified.some((q) => Number(q.recipientId ?? q.recipient?.id) === recipientId))
})

test('HLA: GET all and by locus; bad locus 400', async () => {
  const all = await json('GET', '/api/hla-alleles')
  assert.equal(all.status, 200)
  assert.deepEqual(Object.keys(all.body[0]).sort(), ['alleleName', 'id', 'locus'])
  const drb1 = await json('GET', '/api/hla-alleles?locus=DRB1')
  assert.equal(drb1.status, 200)
  assert.ok(drb1.body.length > 0 && drb1.body.every((a) => a.locus === 'DRB1'))
  const bad = await json('GET', '/api/hla-alleles?locus=DR')
  assert.equal(bad.status, 400)
  assert.equal(bad.body.error.code, 'VALIDATION_ERROR')
})

test('HLA: POST 201, duplicate 409, bad locus 400, DELETE 204 then 404', async () => {
  const created = await json('POST', '/api/hla-alleles', { locus: 'DRB1', alleleName: 'DRB1*99:98' })
  assert.equal(created.status, 201)
  assert.equal(created.body.locus, 'DRB1')
  assert.equal(created.body.alleleName, 'DRB1*99:98')
  alleles.push(created.body.id)

  const dup = await json('POST', '/api/hla-alleles', { locus: 'DRB1', alleleName: 'DRB1*99:98' })
  assert.equal(dup.status, 409)
  assert.equal(dup.body.error.code, 'DUPLICATE')

  const badLocus = await json('POST', '/api/hla-alleles', { locus: 'DR', alleleName: 'DR*01' })
  assert.equal(badLocus.status, 400)
  assert.equal(badLocus.body.error.code, 'CONSTRAINT_VIOLATION')
  const missing = await json('POST', '/api/hla-alleles', { locus: 'A' })
  assert.equal(missing.status, 400)
  assert.equal(missing.body.error.code, 'VALIDATION_ERROR')

  const del = await send('DELETE', `/api/hla-alleles/${created.body.id}`)
  assert.equal(del.status, 204)
  assert.equal((await pool.query('SELECT 1 FROM hla_allele WHERE allele_id = $1', [created.body.id])).rowCount, 0)
  const again = await json('DELETE', `/api/hla-alleles/${created.body.id}`)
  assert.equal(again.status, 404)
  assert.equal(again.body.error.code, 'HLA_ALLELE_NOT_FOUND')
  assert.equal((await json('DELETE', '/api/hla-alleles/abc')).status, 404)
})

test('HLA: deleting an allele used by a donor or recipient returns 409 REFERENCE_IN_USE', async () => {
  const hospitalId = (await pool.query('SELECT min(hospital_id) AS id FROM hospital')).rows[0].id
  const alleleId = (await pool.query("SELECT allele_id FROM hla_allele WHERE allele_name = 'A*02:01'")).rows[0].allele_id
  const donorId = (await pool.query(
    `INSERT INTO donor (name, date_of_birth, blood_group_id, hospital_id, donor_type, height_cm, weight_kg)
     VALUES ('OL-025 HLA Donor', '1990-01-01', (SELECT min(blood_group_id) FROM blood_group), $1, 'LIVING', 170, 70) RETURNING donor_id`, [hospitalId])).rows[0].donor_id
  donors.push(donorId)
  await pool.query('INSERT INTO donor_hla (donor_id, allele_id) VALUES ($1, $2)', [donorId, alleleId])
  const res = await json('DELETE', `/api/hla-alleles/${alleleId}`)
  assert.equal(res.status, 409)
  assert.equal(res.body.error.code, 'REFERENCE_IN_USE')
  assert.equal((await pool.query('SELECT 1 FROM hla_allele WHERE allele_id = $1', [alleleId])).rowCount, 1)
})
