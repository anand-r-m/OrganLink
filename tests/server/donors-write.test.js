// OL-020: POST /api/donors and PATCH /api/donors/:id. Needs DATABASE_URL pointing at a reset dev DB.
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../server/index.js'
import { pool } from '../../server/db.js'

let server, base, cookie, bg, hospitalId, alleles
const created = []

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
  bg = (await pool.query("SELECT blood_group_id FROM blood_group WHERE group_name = 'O+'")).rows[0].blood_group_id
  hospitalId = (await pool.query('SELECT min(hospital_id) AS id FROM hospital')).rows[0].id
  alleles = (await pool.query('SELECT allele_id, locus, allele_name FROM hla_allele ORDER BY allele_id')).rows
})
test.after(async () => {
  // Only the donors this file created (donor_hla cascades); audit rows stay as history.
  if (created.length) await pool.query('DELETE FROM donor WHERE donor_id = ANY($1)', [created])
  server.close()
  await pool.end().catch(() => {})
})

const send = (method, path, body, withCookie = true) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(withCookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
const living = (over = {}) => ({
  name: 'OL-020 Test Donor',
  dateOfBirth: '1988-02-14',
  bloodGroupId: bg,
  hospitalId,
  donorType: 'LIVING',
  heightCm: 170,
  weightKg: 70,
  ...over,
})
const create = async (over) => {
  const res = await send('POST', '/api/donors', living(over))
  const body = await res.json()
  if (res.status === 201) created.push(body.id)
  return { res, body }
}
const hlaRows = async (id) =>
  (await pool.query('SELECT allele_id FROM donor_hla WHERE donor_id = $1 ORDER BY allele_id', [id])).rows.map(
    (r) => Number(r.allele_id),
  )
const ids = (n, locus) => alleles.filter((a) => a.locus === locus).slice(0, n).map((a) => Number(a.allele_id))

test('requires a session', async () => {
  assert.equal((await send('POST', '/api/donors', living(), false)).status, 401)
  assert.equal((await send('PATCH', '/api/donors/1', {}, false)).status, 401)
})

test('create living donor (201) returns the GET shape with HLA, defaults status ACTIVE', async () => {
  const hla = [...ids(2, 'A'), ...ids(2, 'B'), ...ids(2, 'DRB1')]
  const { res, body } = await create({ hlaAlleleIds: hla })
  assert.equal(res.status, 201)
  assert.equal(body.donorType, 'LIVING')
  assert.equal(body.status, 'ACTIVE')
  assert.equal(body.deathDate, null)
  assert.equal(body.heightCm, 170)
  assert.deepEqual(body.organs, [])
  assert.equal(body.hla.length, 6)
  assert.deepEqual((await hlaRows(body.id)), [...hla].sort((a, b) => a - b))
  const got = await (await fetch(`${base}/api/donors/${body.id}`, { headers: { cookie } })).json()
  assert.deepEqual(got, body)
  const audit = await pool.query("SELECT action, user_id FROM audit_log WHERE table_name='donor' AND row_id=$1", [String(body.id)])
  assert.equal(audit.rows[0].action, 'INSERT')
  assert.ok(audit.rows[0].user_id)
})

test('deceased without a death date -> 400 CONSTRAINT_VIOLATION ck_donor_death_fields; nothing persisted', async () => {
  const before = (await pool.query("SELECT count(*)::int AS n FROM donor WHERE name = 'OL-020 Nodate'")).rows[0].n
  const res = await send('POST', '/api/donors', living({ name: 'OL-020 Nodate', donorType: 'DECEASED' }))
  const body = await res.json()
  assert.equal(res.status, 400)
  assert.equal(body.error.code, 'CONSTRAINT_VIOLATION')
  assert.equal(body.error.details.constraint, 'ck_donor_death_fields')
  assert.match(body.error.message, /death date/i)
  const after = (await pool.query("SELECT count(*)::int AS n FROM donor WHERE name = 'OL-020 Nodate'")).rows[0].n
  assert.equal(after, before)
})

test('living donor with a death cause is rejected by the DB check', async () => {
  const { res, body } = await create({ deathCause: 'Accident' })
  assert.equal(res.status, 400)
  assert.equal(body.error.code, 'CONSTRAINT_VIOLATION')
  assert.equal(body.error.details.constraint, 'ck_donor_death_fields')
})

test('deceased with date and cause is created; death before birth is rejected', async () => {
  const { res, body } = await create({
    donorType: 'DECEASED',
    deathDate: '2026-10-04T02:00:00+05:30',
    deathCause: 'Cerebral haemorrhage',
  })
  assert.equal(res.status, 201)
  assert.equal(body.donorType, 'DECEASED')
  assert.equal(body.deathCause, 'Cerebral haemorrhage')
  const early = await create({ donorType: 'DECEASED', deathDate: '1970-01-01T00:00:00Z' })
  assert.equal(early.res.status, 400)
  assert.equal(early.body.error.details.constraint, 'ck_donor_death_after_birth')
})

test('range checks and shape checks', async () => {
  const tall = await create({ heightCm: 999 })
  assert.equal(tall.res.status, 400)
  assert.equal(tall.body.error.code, 'CONSTRAINT_VIOLATION')
  const bad = await send('POST', '/api/donors', { name: '', donorType: 'ZOMBIE', hlaAlleleIds: ['x'] })
  const b = await bad.json()
  assert.equal(bad.status, 400)
  assert.equal(b.error.code, 'VALIDATION_ERROR')
  for (const f of ['name', 'dateOfBirth', 'bloodGroupId', 'hospitalId', 'donorType', 'heightCm', 'weightKg', 'hlaAlleleIds']) {
    assert.ok(b.error.details.fields.includes(f), f)
  }
  const nonObj = await send('POST', '/api/donors', [1])
  assert.equal(nonObj.status, 400)
})

test('unknown blood group, hospital or allele -> 400 REFERENCE_NOT_FOUND, and no donor is left behind', async () => {
  for (const over of [{ bloodGroupId: 999999 }, { hospitalId: 999999 }]) {
    const { res, body } = await create(over)
    assert.equal(res.status, 400)
    assert.equal(body.error.code, 'REFERENCE_NOT_FOUND')
  }
  const { res, body } = await create({ name: 'OL-020 Badallele', hlaAlleleIds: [999999] })
  assert.equal(res.status, 400)
  assert.equal(body.error.code, 'REFERENCE_NOT_FOUND')
  const n = (await pool.query("SELECT count(*)::int AS n FROM donor WHERE name = 'OL-020 Badallele'")).rows[0].n
  assert.equal(n, 0, 'transaction rolled back')
})

test('duplicate allele ids are de-duplicated, not a 500', async () => {
  const a = ids(1, 'A')[0]
  const { res, body } = await create({ hlaAlleleIds: [a, a, a] })
  assert.equal(res.status, 201)
  assert.deepEqual(await hlaRows(body.id), [a])
})

test('PATCH replaces the HLA set exactly and writes an UPDATE audit row', async () => {
  const { body: d } = await create({ hlaAlleleIds: [...ids(2, 'A'), ...ids(2, 'B')] })
  const next = [...ids(1, 'A'), ...ids(2, 'DRB1')]
  const res = await send('PATCH', `/api/donors/${d.id}`, { hlaAlleleIds: next })
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.deepEqual(await hlaRows(d.id), [...next].sort((a, b) => a - b))
  assert.deepEqual(body.hla.map((h) => h.id).sort((a, b) => a - b), [...next].sort((a, b) => a - b))
  const audit = await pool.query(
    "SELECT user_id FROM audit_log WHERE table_name='donor' AND row_id=$1 AND action='UPDATE'",
    [String(d.id)],
  )
  assert.ok(audit.rowCount >= 1)
  assert.ok(audit.rows[0].user_id)
  // Omitting hlaAlleleIds leaves the set alone; an empty array clears it.
  await send('PATCH', `/api/donors/${d.id}`, { weightKg: 71 })
  assert.deepEqual(await hlaRows(d.id), [...next].sort((a, b) => a - b))
  await send('PATCH', `/api/donors/${d.id}`, { hlaAlleleIds: [] })
  assert.deepEqual(await hlaRows(d.id), [])
})

test('PATCH status deactivates; type is unchanged; invalid values and unknown ids are rejected', async () => {
  const { body: d } = await create()
  const res = await send('PATCH', `/api/donors/${d.id}`, { status: 'INACTIVE' })
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.status, 'INACTIVE')
  assert.equal(body.donorType, 'LIVING')
  const bad = await send('PATCH', `/api/donors/${d.id}`, { status: 'GONE' })
  assert.equal(bad.status, 400)
  assert.equal((await bad.json()).error.code, 'VALIDATION_ERROR')
  const missing = await send('PATCH', '/api/donors/999999999', { status: 'INACTIVE' })
  assert.equal(missing.status, 404)
  assert.equal((await missing.json()).error.code, 'DONOR_NOT_FOUND')
  assert.equal((await send('PATCH', '/api/donors/abc', {})).status, 404)
})

test('PATCH to DECEASED without a date fails the CHECK and leaves the donor and its HLA intact', async () => {
  const hla = ids(2, 'A')
  const { body: d } = await create({ hlaAlleleIds: hla })
  const res = await send('PATCH', `/api/donors/${d.id}`, { donorType: 'DECEASED', hlaAlleleIds: [] })
  const body = await res.json()
  assert.equal(res.status, 400)
  assert.equal(body.error.details.constraint, 'ck_donor_death_fields')
  assert.deepEqual(await hlaRows(d.id), hla.sort((a, b) => a - b), 'HLA change rolled back with the failed update')
  const ok = await send('PATCH', `/api/donors/${d.id}`, {
    donorType: 'DECEASED',
    deathDate: '2026-10-04T02:00:00+05:30',
    deathCause: 'Trauma',
  })
  assert.equal(ok.status, 200)
  // DECEASED -> LIVING without clearing the death fields is rejected; clearing them works.
  const back = await send('PATCH', `/api/donors/${d.id}`, { donorType: 'LIVING' })
  assert.equal(back.status, 400)
  const cleared = await send('PATCH', `/api/donors/${d.id}`, { donorType: 'LIVING', deathDate: null, deathCause: null })
  assert.equal(cleared.status, 200)
})
