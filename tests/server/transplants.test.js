// OL-018: POST /api/transplants. Needs DATABASE_URL pointing at a reset dev DB.
// Each scenario clones an AVAILABLE organ; cleanup deletes the clones' rows and restores the
// recipients' waitlist entries that the transplant cascade changes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../server/index.js'
import { pool } from '../../server/db.js'

let server, base, cookie
const clones = []
const waitlistBackup = new Map() // `${recipient}:${type}` -> original row
const extraEntries = [] // [recipient, type] rows inserted by the tests

const call = (method, path, body, withCookie = true) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(withCookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const req = async (method, path, body) => {
  const res = await call(method, path, body)
  return { status: res.status, body: await res.json() }
}
const q = async (sql, params) => (await pool.query(sql, params)).rows

async function backupEntry(recipientId, typeId) {
  const key = `${recipientId}:${typeId}`
  if (waitlistBackup.has(key)) return
  const rows = await q('SELECT * FROM waitlist_entry WHERE recipient_id = $1 AND organ_type_id = $2', [recipientId, typeId])
  waitlistBackup.set(key, rows[0])
}

// Clones an AVAILABLE organ, offers it to a candidate at another hospital and accepts (transport PENDING).
async function makeAccepted() {
  const sources = await q(`SELECT organ_id FROM organ WHERE status = 'AVAILABLE' ORDER BY organ_id`)
  for (const s of sources) {
    const [{ organ_id: id }] = await q(
      `INSERT INTO organ (donor_id, organ_type_id, recovering_hospital_id, recovered_at)
       SELECT donor_id, organ_type_id, recovering_hospital_id, now() - interval '1 hour' FROM organ WHERE organ_id = $1
       RETURNING organ_id`,
      [s.organ_id],
    )
    clones.push(id)
    const run = (await req('POST', '/api/matching/runs', { organId: id })).body
    const origin = (await q('SELECT recovering_hospital_id AS h FROM organ WHERE organ_id = $1', [id]))[0].h
    for (const c of run.qualified ?? []) {
      const [{ hospital_id }] = await q('SELECT hospital_id FROM recipient WHERE recipient_id = $1', [c.recipientId])
      if (hospital_id === origin) continue
      const typeId = (await q('SELECT organ_type_id AS t FROM organ WHERE organ_id = $1', [id]))[0].t
      await backupEntry(c.recipientId, typeId)
      const offer = await req('POST', '/api/offers', { organId: id, recipientId: c.recipientId, matchRunId: run.id })
      assert.equal(offer.status, 201, JSON.stringify(offer.body))
      assert.equal((await req('POST', `/api/offers/${offer.body.id}/send`)).status, 200)
      const acc = await req('POST', `/api/offers/${offer.body.id}/accept`, {})
      assert.equal(acc.status, 200, JSON.stringify(acc.body))
      return { organId: id, typeId, recipientId: c.recipientId, offerId: offer.body.id, transportId: acc.body.transport.id }
    }
  }
  assert.fail('needs an organ with a qualified candidate at another hospital')
}

async function makeDelivered() {
  const t = await makeAccepted()
  assert.equal((await req('POST', `/api/transport/${t.transportId}/depart`)).status, 200)
  assert.equal((await req('POST', `/api/transport/${t.transportId}/deliver`)).status, 200)
  return t
}

const organ = async (id) =>
  (await q(
    `SELECT o.status, dr.code AS discard_code FROM organ o
     LEFT JOIN discard_reason dr ON dr.discard_reason_id = o.discard_reason_id WHERE o.organ_id = $1`,
    [id],
  ))[0]
const entries = async (recipientId) =>
  Object.fromEntries(
    (await q('SELECT organ_type_id, status FROM waitlist_entry WHERE recipient_id = $1', [recipientId])).map((r) => [r.organ_type_id, r.status]),
  )

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
  if (clones.length) {
    await pool.query(
      'DELETE FROM transplant_event WHERE offer_id IN (SELECT offer_id FROM organ_offer WHERE organ_id = ANY($1))',
      [clones],
    )
    await pool.query('DELETE FROM transport_record WHERE organ_id = ANY($1)', [clones])
    await pool.query('DELETE FROM organ_offer WHERE organ_id = ANY($1)', [clones])
    await pool.query('DELETE FROM match_run WHERE organ_id = ANY($1)', [clones])
    await pool.query('DELETE FROM organ WHERE organ_id = ANY($1)', [clones])
  }
  for (const [r, t] of extraEntries) await pool.query('DELETE FROM waitlist_entry WHERE recipient_id = $1 AND organ_type_id = $2', [r, t])
  for (const row of waitlistBackup.values()) {
    if (row) await pool.query('UPDATE waitlist_entry SET status = $3 WHERE recipient_id = $1 AND organ_type_id = $2', [row.recipient_id, row.organ_type_id, row.status])
  }
  server.close()
  await pool.end().catch(() => {})
})

test('POST /api/transplants requires a session', async () => {
  assert.equal((await call('POST', '/api/transplants', { offerId: 1, outcome: 'SUCCESS' }, false)).status, 401)
})

test('validation errors and unknown offers', async () => {
  const bad = [
    {},
    { offerId: 'x', outcome: 'SUCCESS' },
    { offerId: 1, outcome: 'GREAT' },
    { offerId: 1, outcome: 'SUCCESS', transplantAt: 'not a date' },
    { offerId: 1, outcome: 'SUCCESS', hospitalId: 'h' },
    { offerId: 1, outcome: 'SUCCESS', notes: 5 },
  ]
  for (const body of bad) {
    const r = await req('POST', '/api/transplants', body)
    assert.equal(r.status, 400, JSON.stringify(body))
    assert.equal(r.body.error.code, 'VALIDATION_ERROR')
  }
  const r = await req('POST', '/api/transplants', { offerId: 999999999, outcome: 'SUCCESS' })
  assert.equal(r.status, 404)
  assert.equal(r.body.error.code, 'OFFER_NOT_FOUND')
})

test('before delivery: 422 RULE_VIOLATION and nothing changes', async () => {
  const t = await makeAccepted()
  for (const step of ['pending', 'in_transit']) {
    if (step === 'in_transit') await req('POST', `/api/transport/${t.transportId}/depart`)
    const r = await req('POST', '/api/transplants', { offerId: t.offerId, outcome: 'SUCCESS' })
    assert.equal(r.status, 422, step)
    assert.equal(r.body.error.code, 'RULE_VIOLATION')
    assert.match(r.body.error.message, /has not been delivered/)
  }
  assert.equal((await q('SELECT 1 FROM transplant_event WHERE offer_id = $1', [t.offerId])).length, 0)
  assert.equal((await organ(t.organId)).status, 'ALLOCATED')
  assert.equal((await entries(t.recipientId))[t.typeId], 'ACTIVE')
})

test('an offer that is not accepted gets 422 RULE_VIOLATION', async () => {
  const [src] = await q(`SELECT organ_id FROM organ WHERE status = 'AVAILABLE' ORDER BY organ_id LIMIT 1`)
  const [{ organ_id: id }] = await q(
    `INSERT INTO organ (donor_id, organ_type_id, recovering_hospital_id, recovered_at)
     SELECT donor_id, organ_type_id, recovering_hospital_id, now() - interval '1 hour' FROM organ WHERE organ_id = $1
     RETURNING organ_id`,
    [src.organ_id],
  )
  clones.push(id)
  const run = (await req('POST', '/api/matching/runs', { organId: id })).body
  const offer = await req('POST', '/api/offers', { organId: id, recipientId: run.qualified[0].recipientId, matchRunId: run.id })
  assert.equal(offer.status, 201, JSON.stringify(offer.body))
  const r = await req('POST', '/api/transplants', { offerId: offer.body.id, outcome: 'SUCCESS' })
  assert.equal(r.status, 422)
  assert.equal(r.body.error.code, 'RULE_VIOLATION')
  assert.match(r.body.error.message, /is not accepted/)
})

test('SUCCESS after delivery: 201, organ TRANSPLANTED, only this organ type closes, repeat is 409', async () => {
  const t = await makeDelivered()
  // Give the recipient a second, unrelated listing that must stay ACTIVE (BR-14).
  const [other] = await q('SELECT organ_type_id FROM organ_type WHERE organ_type_id <> $1 ORDER BY organ_type_id LIMIT 1', [t.typeId])
  const [{ urgency_id }] = await q('SELECT urgency_id FROM waitlist_entry WHERE recipient_id = $1 AND organ_type_id = $2', [t.recipientId, t.typeId])
  const had = await q('SELECT 1 FROM waitlist_entry WHERE recipient_id = $1 AND organ_type_id = $2', [t.recipientId, other.organ_type_id])
  if (had.length === 0) {
    await q('INSERT INTO waitlist_entry (recipient_id, organ_type_id, urgency_id) VALUES ($1, $2, $3)', [t.recipientId, other.organ_type_id, urgency_id])
    extraEntries.push([t.recipientId, other.organ_type_id])
  } else {
    await backupEntry(t.recipientId, other.organ_type_id)
    await q(`UPDATE waitlist_entry SET status = 'ACTIVE' WHERE recipient_id = $1 AND organ_type_id = $2`, [t.recipientId, other.organ_type_id])
  }

  const dest = (await q('SELECT destination_hospital_id AS h FROM transport_record WHERE transport_id = $1', [t.transportId]))[0].h
  const at = '2026-10-04T18:30:00+05:30'
  const r = await req('POST', '/api/transplants', { offerId: t.offerId, outcome: 'SUCCESS', transplantAt: at, notes: ' Uneventful ' })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  assert.equal(r.body.offerId, t.offerId)
  assert.equal(r.body.outcome, 'SUCCESS')
  assert.equal(r.body.hospitalId, dest, 'defaults to transport destination (A3)')
  assert.equal(typeof r.body.hospitalName, 'string')
  assert.equal(r.body.notes, 'Uneventful')
  assert.equal(new Date(r.body.transplantAt).getTime(), new Date(at).getTime())

  assert.equal((await organ(t.organId)).status, 'TRANSPLANTED')
  const e = await entries(t.recipientId)
  assert.equal(e[t.typeId], 'TRANSPLANTED')
  assert.equal(e[other.organ_type_id], 'ACTIVE')

  const again = await req('POST', '/api/transplants', { offerId: t.offerId, outcome: 'SUCCESS' })
  assert.equal(again.status, 409)
  assert.equal(again.body.error.code, 'TRANSPLANT_ALREADY_RECORDED')
  assert.equal((await q('SELECT 1 FROM transplant_event WHERE offer_id = $1', [t.offerId])).length, 1)

  // The offers read embeds the transplant.
  const one = await req('GET', `/api/offers/${t.offerId}`)
  assert.equal(one.body.transplant.id, r.body.id)
  assert.equal(one.body.transplant.outcome, 'SUCCESS')
  const list = await req('GET', '/api/offers?status=ACCEPTED')
  assert.equal(list.body.find((o) => o.id === t.offerId).transplant.id, r.body.id)
})

for (const outcome of ['FAILED', 'ORGAN_NOT_USED']) {
  test(`${outcome}: organ DISCARDED (TRANSPLANT_FAILED) and the entry REMOVED`, async () => {
    const t = await makeDelivered()
    const [{ h }] = await q('SELECT hospital_id AS h FROM hospital ORDER BY hospital_id DESC LIMIT 1')
    const r = await req('POST', '/api/transplants', { offerId: t.offerId, outcome, hospitalId: h })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.equal(r.body.outcome, outcome)
    assert.equal(r.body.hospitalId, h, 'explicit hospitalId wins')
    assert.equal(r.body.notes, null)
    assert.deepEqual(await organ(t.organId), { status: 'DISCARDED', discard_code: 'TRANSPLANT_FAILED' })
    assert.equal((await entries(t.recipientId))[t.typeId], 'REMOVED')
  })
}

test('an unknown hospitalId is rejected without recording', async () => {
  const t = await makeDelivered()
  const r = await req('POST', '/api/transplants', { offerId: t.offerId, outcome: 'SUCCESS', hospitalId: 999999999 })
  assert.equal(r.status, 400)
  assert.equal(r.body.error.code, 'REFERENCE_NOT_FOUND')
  assert.equal((await organ(t.organId)).status, 'ALLOCATED')
  assert.equal((await q('SELECT 1 FROM transplant_event WHERE offer_id = $1', [t.offerId])).length, 0)
})
