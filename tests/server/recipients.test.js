// OL-021: GET/POST/PATCH /api/recipients. Needs DATABASE_URL pointing at a reset dev DB.
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../server/index.js'
import { pool } from '../../server/db.js'

let server, base, cookie, bg, bgId, hospitalId, kidneyId, otherOrganId, urgency1a, urgency2, alleles

// Fixtures this file creates, deleted in FK order in test.after.
const recipients = []
const donors = []
const organs = []
const offers = []

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

  // Reference rows are looked up by name/type, never by seeded id (OL-006 lesson).
  const one = async (sql, params) => (await pool.query(sql, params)).rows[0]
  bg = (await one("SELECT blood_group_id FROM blood_group WHERE group_name = 'O+'")).blood_group_id
  bgId = Number(bg)
  hospitalId = (await one('SELECT min(hospital_id) AS id FROM hospital')).id
  kidneyId = (await one("SELECT organ_type_id FROM organ_type WHERE name = 'Kidney'")).organ_type_id
  otherOrganId = (await one("SELECT min(organ_type_id) AS id FROM organ_type WHERE organ_type_id <> $1", [kidneyId])).id
  urgency2 = (await one("SELECT urgency_id FROM urgency WHERE code = '2'")).urgency_id
  urgency1a = (await one("SELECT urgency_id FROM urgency WHERE code = '1A'")).urgency_id
  alleles = (await pool.query('SELECT allele_id, locus FROM hla_allele ORDER BY allele_id')).rows
})

test.after(async () => {
  if (offers.length) await pool.query('DELETE FROM organ_offer WHERE offer_id = ANY($1)', [offers])
  if (organs.length) await pool.query('DELETE FROM organ WHERE organ_id = ANY($1)', [organs])
  // waitlist_entry and recipient_hla cascade from recipient; donor_hla cascades from donor.
  if (recipients.length) await pool.query('DELETE FROM recipient WHERE recipient_id = ANY($1)', [recipients])
  if (donors.length) await pool.query('DELETE FROM donor WHERE donor_id = ANY($1)', [donors])
  server.close()
  await pool.end().catch(() => {})
})

const send = (method, path, body, withCookie = true) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(withCookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
const get = (path, withCookie = true) =>
  fetch(`${base}${path}`, { headers: withCookie ? { cookie } : {} })

const payload = (over = {}) => ({
  name: 'OL-021 Recipient',
  dateOfBirth: '1988-02-14',
  bloodGroupId: Number(bg),
  hospitalId,
  heightCm: 165,
  weightKg: 68,
  ...over,
})
const createRecipient = async (over) => {
  const res = await send('POST', '/api/recipients', payload(over))
  const body = await res.json()
  if (res.status === 201) recipients.push(body.id)
  return { res, body }
}
const alleleIds = (n, locus) =>
  alleles.filter((a) => a.locus === locus).slice(0, n).map((a) => Number(a.allele_id))
const hlaRows = async (id) =>
  (await pool.query('SELECT allele_id FROM recipient_hla WHERE recipient_id = $1 ORDER BY allele_id', [id]))
    .rows.map((r) => Number(r.allele_id))

test('every recipients endpoint requires a session', async () => {
  assert.equal((await send('GET', '/api/recipients', undefined, false)).status, 401)
  assert.equal((await get('/api/recipients/1', false)).status, 401)
  assert.equal((await send('POST', '/api/recipients', payload(), false)).status, 401)
  assert.equal((await send('PATCH', '/api/recipients/1', {}, false)).status, 401)
})

test('POST creates the recipient, its HLA set and its waitlist entries in one transaction', async () => {
  const hla = [...alleleIds(2, 'A'), ...alleleIds(2, 'B'), ...alleleIds(2, 'DRB1')]
  const wlBefore = (
    await pool.query("SELECT count(*)::int AS n FROM audit_log WHERE table_name = 'waitlist_entry' AND action = 'INSERT'")
  ).rows[0].n
  const { res, body } = await createRecipient({
    name: 'OL-021 Create',
    hlaAlleleIds: hla,
    waitlist: [
      { organTypeId: kidneyId, urgencyId: urgency1a },
      { organTypeId: otherOrganId, urgencyId: urgency2 },
    ],
  })
  assert.equal(res.status, 201)
  assert.equal(body.name, 'OL-021 Create')
  assert.equal(body.status, 'ACTIVE', 'status defaults to ACTIVE')
  assert.equal(body.dateOfBirth, '1988-02-14')
  assert.equal(body.bloodGroup, 'O+')
  assert.equal(body.waitlistCount, 2)
  assert.equal(body.hasOpenOffer, false)
  assert.deepEqual((await hlaRows(body.id)), [...hla].sort((a, b) => a - b))

  // The 201 body is the same shape GET /:id returns.
  const got = await (await get(`/api/recipients/${body.id}`)).json()
  // wait_months derives from now(), so it differs between calls; everything else must match.
  const stable = (r) => ({ ...r, waitlist: r.waitlist.map(({ waitMonths: _m, ...e }) => e) })
  assert.deepEqual(stable(got), stable(body))
  assert.ok(got.waitlist.every((e) => typeof e.waitMonths === 'number'))
  assert.equal(got.hla.length, 6)

  // The drawer shows every waitlist entry, each with the view's scores.
  assert.equal(got.waitlist.length, 2)
  for (const e of got.waitlist) {
    assert.equal(e.recipientId, body.id)
    assert.equal(e.recipientName, 'OL-021 Create')
    assert.ok(typeof e.priorityScore === 'number')
    assert.ok(typeof e.waitScore === 'number')
    assert.ok(typeof e.urgencyScore === 'number')
    assert.match(e.listedDate, /^\d{4}-\d{2}-\d{2}$/)
  }
  // urgency 1A outranks 1B on the same listing date, so it sorts first.
  assert.equal(got.waitlist[0].urgencyCode, '1A')
  assert.ok(got.waitlist[0].priorityScore > got.waitlist[1].priorityScore)

  // Audit rows exist for the recipient and for each waitlist entry.
  const audit = await pool.query(
    "SELECT action, user_id FROM audit_log WHERE table_name = 'recipient' AND row_id = $1 ORDER BY changed_at",
    [String(body.id)],
  )
  assert.equal(audit.rows[0].action, 'INSERT')
  assert.ok(audit.rows[0].user_id, 'audit row is attributed to the session user')
  // waitlist_entry audit rows use the row_id 'composite', so assert a before/after delta instead.
  const wlAudit = await pool.query(
    "SELECT count(*)::int AS n FROM audit_log WHERE table_name = 'waitlist_entry' AND action = 'INSERT'",
  )
  assert.equal(wlAudit.rows[0].n - wlBefore, 2)
})

test('a future listedDate is rejected by the DB and nothing is persisted', async () => {
  const before = await pool.query("SELECT count(*)::int AS n FROM recipient WHERE name = 'OL-021 Future'")
  const { res, body } = await createRecipient({
    name: 'OL-021 Future',
    waitlist: [{ organTypeId: kidneyId, urgencyId: urgency1a, listedDate: '2099-01-01' }],
  })
  assert.equal(res.status, 400)
  assert.equal(body.error.code, 'CONSTRAINT_VIOLATION')
  assert.equal(body.error.details.constraint, 'ck_waitlist_not_future')
  const after = await pool.query("SELECT count(*)::int AS n FROM recipient WHERE name = 'OL-021 Future'")
  assert.equal(after.rows[0].n, before.rows[0].n, 'the recipient insert rolled back with the entry')
})

test('a repeated organ type in one POST is 409 DUPLICATE and rolls the recipient back', async () => {
  const before = await pool.query("SELECT count(*)::int AS n FROM recipient WHERE name = 'OL-021 Dup'")
  const { res, body } = await createRecipient({
    name: 'OL-021 Dup',
    waitlist: [
      { organTypeId: kidneyId, urgencyId: urgency1a },
      { organTypeId: kidneyId, urgencyId: urgency2 },
    ],
  })
  assert.equal(res.status, 409)
  assert.equal(body.error.code, 'DUPLICATE')
  const after = await pool.query("SELECT count(*)::int AS n FROM recipient WHERE name = 'OL-021 Dup'")
  assert.equal(after.rows[0].n, before.rows[0].n)
})

test('unknown references are 400 REFERENCE_NOT_FOUND and bad shapes are 400 VALIDATION_ERROR', async () => {
  const badBg = await send('POST', '/api/recipients', payload({ bloodGroupId: 999999 }))
  assert.equal(badBg.status, 400)
  assert.equal((await badBg.json()).error.code, 'REFERENCE_NOT_FOUND')

  const badHospital = await send('POST', '/api/recipients', payload({ hospitalId: 999999 }))
  assert.equal(badHospital.status, 400)
  assert.equal((await badHospital.json()).error.code, 'REFERENCE_NOT_FOUND')

  const badOrganType = await send(
    'POST',
    '/api/recipients',
    payload({ waitlist: [{ organTypeId: 999999, urgencyId: urgency1a }] }),
  )
  assert.equal(badOrganType.status, 400)
  assert.equal((await badOrganType.json()).error.code, 'REFERENCE_NOT_FOUND')

  assert.equal((await send('POST', '/api/recipients', payload({ heightCm: 'tall' }))).status, 400)
  assert.equal((await send('POST', '/api/recipients', payload({ status: 'NOPE' }))).status, 400)
  const missing = await send('POST', '/api/recipients', { name: 'x' })
  assert.equal(missing.status, 400)
  assert.deepEqual((await missing.json()).error.details.fields, [
    'dateOfBirth',
    'bloodGroupId',
    'hospitalId',
    'heightCm',
    'weightKg',
  ])
})

test('GET /:id reports 404 RECIPIENT_NOT_FOUND for unknown and unusable ids', async () => {
  for (const id of ['99999999', 'abc', '0']) {
    const res = await get(`/api/recipients/${id}`)
    assert.equal(res.status, 404, `id ${id}`)
    assert.equal((await res.json()).error.code, 'RECIPIENT_NOT_FOUND')
  }
})

test('PATCH updates fields, replaces the HLA set and writes an audit row', async () => {
  const { body: made } = await createRecipient({
    name: 'OL-021 Patch',
    hlaAlleleIds: [...alleleIds(2, 'A'), ...alleleIds(2, 'B')],
  })
  const replacement = [...alleleIds(1, 'A'), ...alleleIds(1, 'DRB1')]

  const res = await send('PATCH', `/api/recipients/${made.id}`, {
    name: 'OL-021 Patched',
    status: 'INACTIVE',
    hlaAlleleIds: replacement,
  })
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.name, 'OL-021 Patched')
  assert.equal(body.status, 'INACTIVE')
  assert.deepEqual((await hlaRows(made.id)), [...replacement].sort((a, b) => a - b))
  assert.equal(body.hla.length, 2)

  const audit = await pool.query(
    "SELECT action FROM audit_log WHERE table_name = 'recipient' AND row_id = $1 AND action = 'UPDATE'",
    [String(made.id)],
  )
  assert.ok(audit.rows.length >= 1, 'the recipient audit trigger recorded the edit')
})

test('PATCH rejects waitlist, which the contract excludes from its field subset', async () => {
  const { body: made } = await createRecipient({ name: 'OL-021 NoWaitPatch' })
  const res = await send('PATCH', `/api/recipients/${made.id}`, { waitlist: [] })
  assert.equal(res.status, 400)
  assert.equal((await res.json()).error.code, 'VALIDATION_ERROR')
})

test('a PATCH with no scalar fields still records an audit row', async () => {
  const { body: made } = await createRecipient({ name: 'OL-021 NoopPatch' })
  const res = await send('PATCH', `/api/recipients/${made.id}`, {})
  assert.equal(res.status, 200)
  const audit = await pool.query(
    "SELECT count(*)::int AS n FROM audit_log WHERE table_name = 'recipient' AND row_id = $1 AND action = 'UPDATE'",
    [String(made.id)],
  )
  assert.ok(audit.rows[0].n >= 1)
})

test('the four filters are applied server-side', async () => {
  // A recipient waitlisted only for Kidney at 1A, in a known blood group.
  const { body: mine } = await createRecipient({
    name: 'OL-021 Filtered',
    bloodGroupId: bgId,
    waitlist: [{ organTypeId: kidneyId, urgencyId: urgency1a }],
  })
  // A second recipient waitlisted for a different organ type at 1B.
  const { body: other } = await createRecipient({
    name: 'OL-021 Other',
    bloodGroupId: bgId,
    waitlist: [{ organTypeId: otherOrganId, urgencyId: urgency2 }],
  })
  const ids = async (qs) => (await (await get(`/api/recipients${qs}`)).json()).map((r) => r.id)

  const byOrgan = await ids(`?organ=${kidneyId}`)
  assert.ok(byOrgan.includes(mine.id), 'kidney listing matches the kidney filter')
  assert.ok(!byOrgan.includes(other.id), 'a liver listing does not match the kidney filter')

  const byUrgency = await ids('?urgency=1A')
  assert.ok(byUrgency.includes(mine.id))
  assert.ok(!byUrgency.includes(other.id), 'a 1B entry does not match urgency=1A')

  // The '+' must arrive as %2B, otherwise it decodes to a space and matches nothing.
  const rows = await (await get('/api/recipients?bloodGroup=O%2B')).json()
  assert.ok(rows.some((r) => r.id === mine.id), 'the O+ recipient is in the O+ filter')
  assert.ok(rows.length > 0)
  assert.ok(rows.every((r) => r.bloodGroup === 'O+'), 'only O+ rows come back')

  const byStatus = await ids('?status=INACTIVE')
  assert.ok(!byStatus.includes(mine.id), 'a fresh recipient is ACTIVE, not INACTIVE')
  await send('PATCH', `/api/recipients/${mine.id}`, { status: 'INACTIVE' })
  assert.ok((await ids('?status=INACTIVE')).includes(mine.id))
  assert.ok(!(await ids('?status=ACTIVE')).includes(mine.id))

  // List rows carry waitlistCount and the HLA set, and omit the nested waitlist.
  const listRow = (await (await get('/api/recipients?bloodGroup=O%2B')).json()).find((r) => r.id === mine.id)
  assert.equal(listRow.waitlistCount, 1)
  assert.ok(Array.isArray(listRow.hla))
  assert.equal(listRow.waitlist, undefined, 'list items omit the nested waitlist')
})

test('deactivating a recipient voids their open offer on the next sweeping request', async () => {
  // Own donor, recipient and organ, so no seeded row is consumed.
  const donorRes = await send('POST', '/api/donors', {
    name: 'OL-021 Sweep Donor',
    dateOfBirth: '1970-01-01',
    bloodGroupId: bgId,
    hospitalId,
    donorType: 'LIVING',
    heightCm: 175,
    weightKg: 70,
  })
  assert.equal(donorRes.status, 201)
  const donor = await donorRes.json()
  donors.push(donor.id)

  // Same blood group as the donor, and the same weight, so the size ratio is exactly 1.0.
  const recRes = await createRecipient({
    name: 'OL-021 Sweep Recipient',
    bloodGroupId: bgId,
    weightKg: 70,
    waitlist: [{ organTypeId: kidneyId, urgencyId: urgency1a }],
  })
  assert.equal(recRes.res.status, 201)
  const recipient = recRes.body

  const organRes = await send('POST', `/api/donors/${donor.id}/organs`, {
    organTypeId: kidneyId,
    recoveringHospitalId: hospitalId,
    recoveredAt: new Date().toISOString(),
  })
  assert.equal(organRes.status, 201)
  const organ = await organRes.json()
  organs.push(organ.id)

  const offerRes = await send('POST', '/api/offers', { organId: organ.id, recipientId: recipient.id })
  assert.equal(offerRes.status, 201, `offer create failed: ${JSON.stringify(await offerRes.clone().text())}`)
  const offer = await offerRes.json()
  offers.push(offer.id)
  assert.equal(offer.status, 'CREATED', 'the offer starts open')
  assert.equal((await (await get(`/api/recipients/${recipient.id}`)).json()).hasOpenOffer, true)

  // The recipients endpoints must not sweep (contract: Sweep = no).
  const beforeSweep = await pool.query('SELECT status FROM organ_offer WHERE offer_id = $1', [offer.id])
  assert.equal(beforeSweep.rows[0].status, 'CREATED', 'GET/PATCH /api/recipients did not void the offer')

  const patchRes = await send('PATCH', `/api/recipients/${recipient.id}`, { status: 'INACTIVE' })
  assert.equal(patchRes.status, 200)
  const stillOpen = await pool.query('SELECT status FROM organ_offer WHERE offer_id = $1', [offer.id])
  assert.equal(stillOpen.rows[0].status, 'CREATED', 'the PATCH itself does not sweep')

  // GET /api/offers is a sweeping endpoint (contract #24).
  await get('/api/offers')
  const after = await pool.query('SELECT status, void_reason FROM organ_offer WHERE offer_id = $1', [offer.id])
  assert.equal(after.rows[0].status, 'VOIDED')
  assert.equal(after.rows[0].void_reason, 'Recipient no longer active')
})

test('bad filter enums are 400 VALIDATION_ERROR naming the field', async () => {
  for (const [qs, field] of [['urgency=3', 'urgency'], ['urgency=1a', 'urgency'], ['status=NOPE', 'status'], ['organ=abc', 'organ']]) {
    const res = await get(`/api/recipients?${qs}`)
    assert.equal(res.status, 400, qs)
    const body = await res.json()
    assert.equal(body.error.code, 'VALIDATION_ERROR')
    assert.deepEqual(body.error.details.fields, [field])
  }
})
