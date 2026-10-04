// OL-016: accept, decline, advance. Needs DATABASE_URL pointing at a reset dev DB.
// Each scenario works on its own cloned organ so that no seeded organ is left ALLOCATED or EXPIRED.
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../server/index.js'
import { pool } from '../../server/db.js'

let server, base, cookie, reasons
const clones = []

const call = (method, path, body, withCookie = true) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(withCookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const post = async (path, body) => {
  const res = await call('POST', path, body)
  return { status: res.status, body: await res.json() }
}
const q = async (sql, params) => (await pool.query(sql, params)).rows

// Clones an AVAILABLE organ and runs the matcher; returns the clone once it has `min` qualified candidates.
async function makeOrgan(min, recoveredAgo = '1 hour') {
  const sources = await q(`SELECT organ_id FROM organ WHERE status = 'AVAILABLE' ORDER BY organ_id`)
  for (const s of sources) {
    const [{ organ_id: id }] = await q(
      `INSERT INTO organ (donor_id, organ_type_id, recovering_hospital_id, recovered_at)
       SELECT donor_id, organ_type_id, recovering_hospital_id, now() - $2::interval FROM organ WHERE organ_id = $1
       RETURNING organ_id`,
      [s.organ_id, recoveredAgo],
    )
    clones.push(id)
    const run = await (await call('POST', '/api/matching/runs', { organId: id })).json()
    if (run.qualified.length >= min) return { id, run, c: run.qualified }
  }
  assert.fail(`needs an organ with ${min} qualified candidates`)
}

const organStatus = async (id) => (await q('SELECT status FROM organ WHERE organ_id = $1', [id]))[0].status
const offerStatus = async (id) => (await q('SELECT status FROM organ_offer WHERE offer_id = $1', [id]))[0].status
const openCount = async (id) =>
  Number((await q(`SELECT count(*) FROM organ_offer WHERE organ_id = $1 AND status IN ('CREATED','SENT')`, [id]))[0].count)
const createOffer = async (o, cand) => {
  const r = await post('/api/offers', { organId: o.id, recipientId: cand.recipientId, matchRunId: o.run.id })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  return r.body
}

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
  reasons = (await (await call('GET', '/api/lookups')).json()).declineReasons
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

test('accept, decline and advance require a session', async () => {
  for (const a of ['accept', 'decline', 'advance']) {
    assert.equal((await call('POST', `/api/offers/1/${a}`, {}, false)).status, 401, a)
  }
})

test('unknown offers return 404 OFFER_NOT_FOUND', async () => {
  for (const [a, body] of [['accept', {}], ['decline', { declineReasonId: reasons[0].id }], ['advance', {}]]) {
    for (const id of ['999999', 'abc']) {
      const r = await post(`/api/offers/${id}/${a}`, body)
      assert.equal(r.status, 404, `${a} ${id}`)
      assert.equal(r.body.error.code, 'OFFER_NOT_FOUND')
    }
  }
})

test('decline -> re-offer blocked -> advance (skips a prior decliner) -> send -> accept, with DB checks', async () => {
  const o = await makeOrgan(4)
  const [c1, c2, c3] = o.c
  const organ = await q('SELECT recovering_hospital_id FROM organ WHERE organ_id = $1', [o.id])

  const first = await createOffer(o, c1)
  assert.equal(await openCount(o.id), 1)

  // CREATED offers can be neither accepted, declined nor advanced.
  for (const [a, body] of [['accept', {}], ['decline', { declineReasonId: reasons[0].id }], ['advance', {}]]) {
    const r = await post(`/api/offers/${first.id}/${a}`, body)
    assert.equal(r.status, 409, a)
    assert.equal(r.body.error.code, 'INVALID_STATE_TRANSITION')
    assert.equal(r.body.error.details.currentStatus, 'CREATED')
  }
  assert.equal((await post(`/api/offers/${first.id}/send`)).status, 200)

  // Decline needs a coded reason that exists.
  let r = await post(`/api/offers/${first.id}/decline`, {})
  assert.equal(r.status, 400)
  assert.equal(r.body.error.code, 'VALIDATION_ERROR')
  r = await post(`/api/offers/${first.id}/decline`, { declineReasonId: 'x' })
  assert.equal(r.status, 400)
  r = await post(`/api/offers/${first.id}/decline`, { declineReasonId: 999999 })
  assert.equal(r.status, 400)
  assert.equal(r.body.error.code, 'REFERENCE_NOT_FOUND')
  assert.equal(await offerStatus(first.id), 'SENT')

  // Decline with ORGAN_QUALITY.
  const quality = reasons.find((x) => x.code === 'ORGAN_QUALITY')
  r = await post(`/api/offers/${first.id}/decline`, { declineReasonId: quality.id, notes: 'Biopsy showed fibrosis' })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.status, 'DECLINED')
  assert.equal(r.body.declineReasonId, quality.id)
  assert.equal(r.body.declineReasonCode, 'ORGAN_QUALITY')
  assert.equal(r.body.notes, 'Biopsy showed fibrosis')
  assert.ok(r.body.respondedAt)
  const [row] = await q('SELECT status, decline_reason_id, responded_at FROM organ_offer WHERE offer_id = $1', [first.id])
  assert.equal(row.status, 'DECLINED')
  assert.equal(row.decline_reason_id, quality.id)
  assert.ok(row.responded_at)
  assert.equal(await organStatus(o.id), 'AVAILABLE')
  assert.equal(await openCount(o.id), 0)

  // Declining twice is a state error, and the decliner can't be re-offered.
  r = await post(`/api/offers/${first.id}/decline`, { declineReasonId: quality.id })
  assert.equal(r.status, 409)
  assert.equal(r.body.error.details.currentStatus, 'DECLINED')
  r = await post('/api/offers', { organId: o.id, recipientId: c1.recipientId, matchRunId: o.run.id })
  assert.equal(r.status, 409)
  assert.equal(r.body.error.code, 'RECIPIENT_ALREADY_DECLINED')

  // Rank 2 already declined this organ earlier (test backdoor), so Advance must skip it.
  await pool.query(
    `INSERT INTO organ_offer (organ_id, recipient_id, run_id, status, sent_at, responded_at, decline_reason_id)
     VALUES ($1, $2, $3, 'DECLINED', now(), now(), $4)`,
    [o.id, c2.recipientId, o.run.id, quality.id],
  )
  r = await post(`/api/offers/${first.id}/advance`)
  assert.equal(r.status, 201, JSON.stringify(r.body))
  assert.equal(r.body.offer.status, 'CREATED')
  assert.equal(r.body.offer.recipientId, c3.recipientId)
  assert.equal(r.body.offer.rank, c3.rank)
  assert.equal(r.body.offer.matchRunId, o.run.id)
  assert.equal(r.body.skipped.length, 1)
  assert.deepEqual(
    { rank: r.body.skipped[0].rank, recipientId: r.body.skipped[0].recipientId, reasonCode: r.body.skipped[0].reasonCode },
    { rank: c2.rank, recipientId: c2.recipientId, reasonCode: 'RECIPIENT_ALREADY_DECLINED' },
  )
  assert.ok(r.body.skipped[0].recipientName)
  assert.ok(r.body.skipped[0].reason)
  assert.equal(await openCount(o.id), 1)
  const next = r.body.offer

  // Advancing again while an offer is open is refused.
  r = await post(`/api/offers/${first.id}/advance`)
  assert.equal(r.status, 409)
  assert.equal(r.body.error.code, 'ACTIVE_OFFER_EXISTS')
  assert.equal(await openCount(o.id), 1)

  // Send, then accept.
  assert.equal((await post(`/api/offers/${next.id}/send`)).status, 200)
  assert.equal(await organStatus(o.id), 'AVAILABLE')
  r = await post(`/api/offers/${next.id}/accept`, { notes: 'Team ready' })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(r.body.status, 'ACCEPTED')
  assert.ok(r.body.respondedAt)
  assert.equal(r.body.notes, 'Team ready')
  assert.equal(await organStatus(o.id), 'ALLOCATED')
  const [tr] = await q(
    `SELECT t.transport_id, t.status, t.origin_hospital_id, t.destination_hospital_id
       FROM transport_record t WHERE t.organ_id = $1`,
    [o.id],
  )
  assert.ok(tr, 'transport record exists')
  const same = tr.origin_hospital_id === tr.destination_hospital_id
  assert.equal(tr.origin_hospital_id, organ[0].recovering_hospital_id)
  assert.equal(tr.status, same ? 'DELIVERED' : 'PENDING')
  assert.deepEqual(r.body.transport, { id: tr.transport_id, status: tr.status })
  assert.equal(await openCount(o.id), 0)
  const apiOrgan = await (await call('GET', `/api/organs/${o.id}`)).json()
  assert.equal(apiOrgan.status, 'ALLOCATED')

  // Accepted offers are final.
  r = await post(`/api/offers/${next.id}/accept`)
  assert.equal(r.status, 409)
  assert.equal(r.body.error.details.currentStatus, 'ACCEPTED')
  r = await post(`/api/offers/${next.id}/decline`, { declineReasonId: quality.id })
  assert.equal(r.status, 409)
  r = await post(`/api/offers/${next.id}/advance`)
  assert.equal(r.status, 409)
  assert.equal((await q('SELECT count(*) FROM transport_record WHERE organ_id = $1', [o.id]))[0].count, 1)
})

test('advance: no run, exhausted ranks (422), and a cancelled source', async () => {
  const o = await makeOrgan(2)
  const last = o.c[o.c.length - 1]

  // An offer without a run can't be advanced.
  let r = await post('/api/offers', { organId: o.id, recipientId: o.c[0].recipientId })
  assert.equal(r.status, 201)
  const noRun = r.body
  await post(`/api/offers/${noRun.id}/cancel`)
  r = await post(`/api/offers/${noRun.id}/advance`)
  assert.equal(r.status, 409)
  assert.equal(r.body.error.code, 'INVALID_STATE_TRANSITION')

  // A cancelled source with a run advances to the next rank.
  const cancelled = await createOffer(o, o.c[0])
  await post(`/api/offers/${cancelled.id}/cancel`)
  r = await post(`/api/offers/${cancelled.id}/advance`)
  assert.equal(r.status, 201)
  assert.equal(r.body.offer.recipientId, o.c[1].recipientId)
  assert.deepEqual(r.body.skipped, [])
  await post(`/api/offers/${r.body.offer.id}/cancel`)

  // The last rank declines, so nothing is left.
  const lastOffer = await createOffer(o, last)
  await post(`/api/offers/${lastOffer.id}/send`)
  r = await post(`/api/offers/${lastOffer.id}/decline`, { declineReasonId: reasons[0].id })
  assert.equal(r.status, 200)
  r = await post(`/api/offers/${lastOffer.id}/advance`)
  assert.equal(r.status, 422)
  assert.equal(r.body.error.code, 'NO_ELIGIBLE_CANDIDATE')
  assert.deepEqual(r.body.error.details.skipped, [])
  assert.equal(await openCount(o.id), 0)
})

test('accepting after the organ expired returns 409 VOIDED (the sweep ran first)', async () => {
  const o = await makeOrgan(1)
  const offer = await createOffer(o, o.c[0])
  await post(`/api/offers/${offer.id}/send`)
  await pool.query(`UPDATE organ SET recovered_at = now() - interval '1000 hours' WHERE organ_id = $1`, [o.id])
  const r = await post(`/api/offers/${offer.id}/accept`)
  assert.equal(r.status, 409)
  assert.equal(r.body.error.code, 'INVALID_STATE_TRANSITION')
  assert.equal(r.body.error.details.currentStatus, 'VOIDED')
  assert.equal(r.body.error.details.voidReason, 'Organ viability window elapsed')
  assert.equal(await offerStatus(offer.id), 'VOIDED')
  assert.equal(await organStatus(o.id), 'EXPIRED')
  assert.equal((await q('SELECT count(*) FROM transport_record WHERE organ_id = $1', [o.id]))[0].count, 0)
})
