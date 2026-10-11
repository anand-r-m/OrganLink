// OL-042: discard an ALLOCATED organ whose viability elapsed before departure; no dispatch after expiry.
// Needs a reset DISPOSABLE database. Guarded: skipped (nothing imported or connected) unless
// OL_DISPOSABLE_DB=1 and DATABASE_URL names a database other than `organlink`, because the fixtures
// backdate organs and must never touch the QA database.
import test from 'node:test'
import assert from 'node:assert/strict'

const target = process.env.DATABASE_URL ?? ''
const dbName = target.replace(/^[a-z]+:\/\/[^/]*\//, '').split('?')[0]
const allowed = process.env.OL_DISPOSABLE_DB === '1' && dbName !== '' && dbName !== 'organlink'
const skip = allowed ? false : 'OL-042: set OL_DISPOSABLE_DB=1 and a DATABASE_URL that is not organlink'
const { app } = allowed ? await import('../../server/index.js') : {}
const { pool } = allowed ? await import('../../server/db.js') : {}

let server, base, cookie, viabilityElapsedId
const clones = []

const call = (method, path, body) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const req = async (method, path, body) => {
  const res = await call(method, path, body)
  return { status: res.status, body: await res.json() }
}
const q = async (sql, params) => (await pool.query(sql, params)).rows

// Same fixture as transport.test.js: clone an AVAILABLE organ, offer it to a candidate at another
// hospital and accept, so the transport starts PENDING.
async function makeTransport() {
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
      const offer = await req('POST', '/api/offers', { organId: id, recipientId: c.recipientId, matchRunId: run.id })
      assert.equal(offer.status, 201, JSON.stringify(offer.body))
      assert.equal((await req('POST', `/api/offers/${offer.body.id}/send`)).status, 200)
      const acc = await req('POST', `/api/offers/${offer.body.id}/accept`, {})
      assert.equal(acc.status, 200, JSON.stringify(acc.body))
      assert.equal(acc.body.transport.status, 'PENDING')
      return { organId: id, transportId: acc.body.transport.id, offerId: offer.body.id }
    }
  }
  assert.fail('needs an organ with a qualified candidate at another hospital')
}

// Moves the organ's recovery time back past its viability window (the state the sweep never reaches).
const expire = (organId) =>
  pool.query(
    `UPDATE organ o SET recovered_at = now() - (ot.max_viability_hours + 1) * interval '1 hour'
     FROM organ_type ot WHERE ot.organ_type_id = o.organ_type_id AND o.organ_id = $1`,
    [organId],
  )
const organRow = async (id) => (await q('SELECT status, discard_reason_id FROM organ WHERE organ_id = $1', [id]))[0]
const transportRow = async (id) =>
  (await q('SELECT status, departed_at, arrived_at FROM transport_record WHERE transport_id = $1', [id]))[0]
const offerStatus = async (id) => (await q('SELECT status FROM organ_offer WHERE offer_id = $1', [id]))[0].status

test.before(async () => {
  if (!allowed) return
  const [{ db }] = await q('SELECT current_database() AS db')
  assert.notEqual(db, 'organlink', 'connected to the QA database; refusing')
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${server.address().port}`
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' }),
  })
  cookie = res.headers.get('set-cookie').split(';')[0]
  viabilityElapsedId = (await q(`SELECT discard_reason_id AS id FROM discard_reason WHERE code = 'VIABILITY_ELAPSED'`))[0].id
})
test.after(async () => {
  if (!allowed) return
  if (clones.length) {
    await pool.query('DELETE FROM transport_record WHERE organ_id = ANY($1)', [clones])
    await pool.query('DELETE FROM organ_offer WHERE organ_id = ANY($1)', [clones])
    await pool.query('DELETE FROM match_run WHERE organ_id = ANY($1)', [clones])
    await pool.query('DELETE FROM organ WHERE organ_id = ANY($1)', [clones])
  }
  server?.close()
  await pool.end().catch(() => {})
})

test('expired ALLOCATED organ with a PENDING transport: depart refused, discard fails the transport', { skip }, async () => {
  const t = await makeTransport()
  await expire(t.organId)

  const organ = await req('GET', `/api/organs/${t.organId}`)
  assert.equal(organ.body.status, 'ALLOCATED')
  assert.equal(organ.body.isExpired, true)
  assert.equal(organ.body.transportStatus, 'PENDING')

  const dep = await req('POST', `/api/transport/${t.transportId}/depart`)
  assert.equal(dep.status, 409)
  assert.equal(dep.body.error.code, 'INVALID_STATE_TRANSITION')
  assert.equal(dep.body.error.message, `Organ ${t.organId} viability window has elapsed; it cannot be dispatched`)
  assert.deepEqual(await transportRow(t.transportId), { status: 'PENDING', departed_at: null, arrived_at: null })

  const dis = await req('POST', `/api/organs/${t.organId}/discard`, { discardReasonId: viabilityElapsedId })
  assert.equal(dis.status, 200, JSON.stringify(dis.body))
  assert.equal(dis.body.status, 'DISCARDED')
  assert.equal(dis.body.discardReasonCode, 'VIABILITY_ELAPSED')
  assert.equal(dis.body.transportStatus, 'FAILED')
  assert.deepEqual(await organRow(t.organId), { status: 'DISCARDED', discard_reason_id: viabilityElapsedId })
  // The transport row is kept, only its status moves; the accepted offer is untouched.
  assert.deepEqual(await transportRow(t.transportId), { status: 'FAILED', departed_at: null, arrived_at: null })
  assert.equal(await offerStatus(t.offerId), 'ACCEPTED')

  // Not actionable afterwards: hidden from the transport list, depart is the usual 409.
  const list = await req('GET', '/api/transport')
  assert.ok(!list.body.some((r) => r.id === t.transportId))
  const again = await req('POST', `/api/transport/${t.transportId}/depart`)
  assert.equal(again.status, 409)
  assert.equal(again.body.error.details.currentStatus, 'FAILED')
})

test('viable ALLOCATED organ cannot be discarded and still departs normally', { skip }, async () => {
  const t = await makeTransport()
  const dis = await req('POST', `/api/organs/${t.organId}/discard`, { discardReasonId: viabilityElapsedId })
  assert.equal(dis.status, 409)
  assert.equal(dis.body.error.code, 'INVALID_STATE_TRANSITION')
  assert.match(dis.body.error.message, /viability elapsed before departure/)
  assert.deepEqual(await organRow(t.organId), { status: 'ALLOCATED', discard_reason_id: null })
  assert.equal((await transportRow(t.transportId)).status, 'PENDING')

  const dep = await req('POST', `/api/transport/${t.transportId}/depart`)
  assert.equal(dep.status, 200, JSON.stringify(dep.body))
  assert.equal(dep.body.status, 'IN_TRANSIT')
})

test('organ that expires IN_TRANSIT cannot be discarded and can still be delivered (OL-DEC-02)', { skip }, async () => {
  const t = await makeTransport()
  assert.equal((await req('POST', `/api/transport/${t.transportId}/depart`)).status, 200)
  await expire(t.organId)

  const dis = await req('POST', `/api/organs/${t.organId}/discard`, { discardReasonId: viabilityElapsedId })
  assert.equal(dis.status, 409)
  assert.equal(dis.body.error.code, 'INVALID_STATE_TRANSITION')
  assert.equal((await organRow(t.organId)).status, 'ALLOCATED')
  assert.equal((await transportRow(t.transportId)).status, 'IN_TRANSIT')

  const del = await req('POST', `/api/transport/${t.transportId}/deliver`)
  assert.equal(del.status, 200, JSON.stringify(del.body))
  assert.equal(del.body.status, 'DELIVERED')
})

test('an AVAILABLE organ has no transport status', { skip }, async () => {
  const [{ organ_id: id }] = await q(`SELECT organ_id FROM organ WHERE status = 'AVAILABLE' ORDER BY organ_id LIMIT 1`)
  const organ = await req('GET', `/api/organs/${id}`)
  assert.equal(organ.body.transportStatus, null)
})
