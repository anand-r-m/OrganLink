// OL-017: transport list, depart, deliver. Needs DATABASE_URL pointing at a reset dev DB.
// Each scenario works on its own cloned organ so no seeded organ is left ALLOCATED.
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../server/index.js'
import { pool } from '../../server/db.js'

let server, base, cookie
const clones = []

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

// Clones an AVAILABLE organ, offers it to a candidate at a DIFFERENT hospital and accepts.
// Returns { organId, transportId }.
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

const row = async (id) =>
  (await q('SELECT status, departed_at, arrived_at FROM transport_record WHERE transport_id = $1', [id]))[0]

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
    await pool.query('DELETE FROM transport_record WHERE organ_id = ANY($1)', [clones])
    await pool.query('DELETE FROM organ_offer WHERE organ_id = ANY($1)', [clones])
    await pool.query('DELETE FROM match_run WHERE organ_id = ANY($1)', [clones])
    await pool.query('DELETE FROM organ WHERE organ_id = ANY($1)', [clones])
  }
  server.close()
  await pool.end().catch(() => {})
})

test('transport endpoints require a session', async () => {
  assert.equal((await call('GET', '/api/transport', undefined, false)).status, 401)
  for (const a of ['depart', 'deliver']) {
    assert.equal((await call('POST', `/api/transport/1/${a}`, {}, false)).status, 401, a)
  }
})

test('unknown transports return 404 TRANSPORT_NOT_FOUND', async () => {
  for (const a of ['depart', 'deliver']) {
    for (const id of ['999999999', 'abc']) {
      const r = await req('POST', `/api/transport/${id}/${a}`, {})
      assert.equal(r.status, 404, `${a} ${id}`)
      assert.equal(r.body.error.code, 'TRANSPORT_NOT_FOUND')
    }
  }
})

test('GET /api/transport returns the contract shape with the new PENDING row', async () => {
  const t = await makeTransport()
  const r = await req('GET', '/api/transport')
  assert.equal(r.status, 200)
  const item = r.body.find((x) => x.id === t.transportId)
  assert.ok(item, 'new transport listed')
  assert.equal(item.status, 'PENDING')
  assert.equal(item.organId, t.organId)
  assert.equal(item.offerId, t.offerId)
  assert.equal(item.departedAt, null)
  assert.equal(item.arrivedAt, null)
  for (const end of [item.origin, item.destination]) {
    assert.equal(typeof end.name, 'string')
    assert.equal(typeof end.latitude, 'number')
    assert.equal(typeof end.longitude, 'number')
  }
  assert.notEqual(item.origin.id, item.destination.id)
  assert.equal(typeof item.recipientName, 'string')
  assert.ok(item.organExpiresAt && typeof item.organHoursRemaining === 'number')
  // Active transports lead the list.
  const firstInactive = r.body.findIndex((x) => !['PENDING', 'IN_TRANSIT'].includes(x.status))
  if (firstInactive >= 0) assert.ok(r.body.slice(firstInactive).every((x) => !['PENDING', 'IN_TRANSIT'].includes(x.status)))
})

test('GET /api/transport filters by status and rejects unknown values', async () => {
  const t = await makeTransport()
  const pending = await req('GET', '/api/transport?status=PENDING')
  assert.ok(pending.body.every((x) => x.status === 'PENDING') && pending.body.some((x) => x.id === t.transportId))
  const multi = await req('GET', '/api/transport?status=PENDING,IN_TRANSIT')
  assert.ok(multi.body.every((x) => ['PENDING', 'IN_TRANSIT'].includes(x.status)))
  const bad = await req('GET', '/api/transport?status=NOPE')
  assert.equal(bad.status, 400)
  assert.equal(bad.body.error.code, 'VALIDATION_ERROR')
})

test('depart -> depart (409) -> deliver -> deliver (409) sets timestamps in order', async () => {
  const t = await makeTransport()
  const base = `/api/transport/${t.transportId}`

  // Skipping depart is rejected and changes nothing.
  const skip = await req('POST', `${base}/deliver`)
  assert.equal(skip.status, 409)
  assert.equal(skip.body.error.code, 'INVALID_STATE_TRANSITION')
  assert.equal(skip.body.error.details.currentStatus, 'PENDING')
  assert.deepEqual(await row(t.transportId), { status: 'PENDING', departed_at: null, arrived_at: null })

  const dep = await req('POST', `${base}/depart`)
  assert.equal(dep.status, 200, JSON.stringify(dep.body))
  assert.equal(dep.body.status, 'IN_TRANSIT')
  assert.ok(dep.body.departedAt)
  assert.equal(dep.body.arrivedAt, null)
  const r1 = await row(t.transportId)
  assert.equal(r1.status, 'IN_TRANSIT')
  assert.ok(r1.departed_at && r1.arrived_at === null)

  const again = await req('POST', `${base}/depart`)
  assert.equal(again.status, 409)
  assert.equal(again.body.error.code, 'INVALID_STATE_TRANSITION')
  assert.equal(again.body.error.details.currentStatus, 'IN_TRANSIT')
  assert.equal((await row(t.transportId)).departed_at.getTime(), r1.departed_at.getTime())

  const del = await req('POST', `${base}/deliver`)
  assert.equal(del.status, 200, JSON.stringify(del.body))
  assert.equal(del.body.status, 'DELIVERED')
  assert.ok(del.body.arrivedAt && del.body.departedAt)
  const r2 = await row(t.transportId)
  assert.equal(r2.status, 'DELIVERED')
  assert.ok(r2.arrived_at >= r2.departed_at)

  for (const a of ['deliver', 'depart']) {
    const r = await req('POST', `${base}/${a}`)
    assert.equal(r.status, 409, a)
    assert.equal(r.body.error.code, 'INVALID_STATE_TRANSITION')
  }
  // The offer response embeds the delivered transport status (read-through check).
  const offer = await req('GET', `/api/offers/${t.offerId}`)
  assert.deepEqual(offer.body.transport, { id: t.transportId, status: 'DELIVERED' })
})

test('depart does not change the organ (stays ALLOCATED)', async () => {
  const t = await makeTransport()
  await req('POST', `/api/transport/${t.transportId}/depart`)
  assert.equal((await q('SELECT status FROM organ WHERE organ_id = $1', [t.organId]))[0].status, 'ALLOCATED')
})
