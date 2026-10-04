// Needs DATABASE_URL pointing at a reset dev DB (db:reset: reference + demo seed).
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../server/index.js'
import { pool } from '../../server/db.js'

let server, base, cookie, organId, run, rank1, rank2
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
  // An available organ with no offers and at least two ranked candidates.
  const organs = (await pool.query(`SELECT organ_id FROM organ WHERE status = 'AVAILABLE' ORDER BY organ_id`)).rows
  for (const o of organs) {
    const open = await pool.query(`SELECT 1 FROM organ_offer WHERE organ_id = $1 AND status IN ('CREATED','SENT')`, [o.organ_id])
    if (open.rowCount) continue
    const r = await (await call('POST', '/api/matching/runs', { organId: o.organ_id })).json()
    const declined = (await pool.query(`SELECT recipient_id FROM organ_offer WHERE organ_id = $1 AND status = 'DECLINED'`, [o.organ_id])).rows.map((x) => x.recipient_id)
    const ok = r.qualified.filter((q) => !declined.includes(q.recipientId))
    if (ok.length >= 2) {
      organId = o.organ_id
      run = r
      ;[rank1, rank2] = ok
      break
    }
  }
  assert.ok(organId, 'needs an available organ with two candidates')
})
test.after(async () => {
  if (created.length) {
    await pool.query('DELETE FROM organ_offer WHERE offer_id = ANY($1)', [created])
  }
  server.close()
  await pool.end().catch(() => {})
})

const call = (method, path, body, withCookie = true) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(withCookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const dbOffer = async (id) =>
  (await pool.query('SELECT status, sent_at, run_id, created_by FROM organ_offer WHERE offer_id = $1', [id])).rows[0]
const openCount = async () =>
  Number((await pool.query(`SELECT count(*) FROM organ_offer WHERE organ_id = $1 AND status IN ('CREATED','SENT')`, [organId])).rows[0].count)

test('offer endpoints require a session', async () => {
  for (const [m, p] of [
    ['GET', '/api/offers'],
    ['GET', '/api/offers/1'],
    ['POST', '/api/offers'],
    ['POST', '/api/offers/1/send'],
    ['POST', '/api/offers/1/cancel'],
  ]) {
    assert.equal((await call(m, p, undefined, false)).status, 401, p)
  }
})

test('validation and not-found errors', async () => {
  for (const body of [{}, { organId: 'x', recipientId: 1 }, { organId, recipientId: 1.5 }, { organId, recipientId: 1, matchRunId: 'a' }]) {
    const res = await call('POST', '/api/offers', body)
    assert.equal(res.status, 400)
    assert.equal((await res.json()).error.code, 'VALIDATION_ERROR')
  }
  let res = await call('POST', '/api/offers', { organId: 999999, recipientId: rank1.recipientId })
  assert.equal(res.status, 400)
  assert.equal((await res.json()).error.code, 'REFERENCE_NOT_FOUND')
  // The recipient-status trigger fires before the FK check, so this is a rule violation.
  res = await call('POST', '/api/offers', { organId, recipientId: 999999 })
  assert.equal(res.status, 422)
  assert.equal((await res.json()).error.code, 'RULE_VIOLATION')
  for (const p of ['/api/offers/999999', '/api/offers/abc']) {
    res = await call('GET', p)
    assert.equal(res.status, 404)
    assert.equal((await res.json()).error.code, 'OFFER_NOT_FOUND')
  }
  for (const a of ['send', 'cancel']) {
    res = await call('POST', `/api/offers/999999/${a}`)
    assert.equal(res.status, 404, a)
  }
  assert.equal((await call('GET', '/api/offers?status=BOGUS')).status, 400)
  assert.equal((await call('GET', '/api/offers?organId=x')).status, 400)
  assert.equal(await openCount(), 0)
})

test('a run belonging to a different organ is rejected', async () => {
  const other = (await pool.query('SELECT run_id FROM match_run WHERE organ_id <> $1 LIMIT 1', [organId])).rows[0]
  if (!other) return
  const res = await call('POST', '/api/offers', { organId, recipientId: rank1.recipientId, matchRunId: other.run_id })
  assert.equal(res.status, 400)
  assert.equal(await openCount(), 0)
})

test('create -> create again (409) -> send -> send again (409) -> cancel -> create again', async () => {
  // create for rank 1
  let res = await call('POST', '/api/offers', { organId, recipientId: rank1.recipientId, matchRunId: run.id })
  assert.equal(res.status, 201)
  const offer = await res.json()
  created.push(offer.id)
  assert.equal(offer.status, 'CREATED')
  assert.equal(offer.organId, organId)
  assert.equal(offer.recipientId, rank1.recipientId)
  assert.equal(offer.matchRunId, run.id)
  assert.equal(offer.rank, rank1.rank)
  assert.equal(offer.sentAt, null)
  assert.equal(offer.offerExpiresAt, null)
  assert.equal(offer.createdBy, 1)
  assert.equal(offer.transport, null)
  assert.equal(offer.transplant, null)
  for (const k of ['organType', 'donorId', 'recipientName', 'recipientHospitalName', 'responseWindowHours', 'createdAt']) {
    assert.ok(offer[k] !== undefined && offer[k] !== null, k)
  }
  let db = await dbOffer(offer.id)
  assert.equal(db.status, 'CREATED')
  assert.equal(db.sent_at, null)
  assert.equal(db.run_id, run.id)
  assert.equal(db.created_by, 1)

  // second create on the same organ
  res = await call('POST', '/api/offers', { organId, recipientId: rank2.recipientId, matchRunId: run.id })
  assert.equal(res.status, 409)
  assert.equal((await res.json()).error.code, 'ACTIVE_OFFER_EXISTS')
  assert.equal(await openCount(), 1)

  // organ shows the active offer
  const organ = await (await call('GET', `/api/organs/${organId}`)).json()
  assert.equal(organ.hasActiveOffer, true)
  assert.equal(organ.activeOfferId, offer.id)

  // send
  res = await call('POST', `/api/offers/${offer.id}/send`)
  assert.equal(res.status, 200)
  const sent = await res.json()
  assert.equal(sent.status, 'SENT')
  assert.ok(sent.sentAt)
  const hours = (new Date(sent.offerExpiresAt) - new Date(sent.sentAt)) / 3600000
  assert.equal(hours, sent.responseWindowHours)
  db = await dbOffer(offer.id)
  assert.equal(db.status, 'SENT')
  assert.ok(db.sent_at)

  // send again
  res = await call('POST', `/api/offers/${offer.id}/send`)
  assert.equal(res.status, 409)
  let err = (await res.json()).error
  assert.equal(err.code, 'INVALID_STATE_TRANSITION')
  assert.equal(err.details.currentStatus, 'SENT')
  assert.equal(err.details.requiredStatus, 'CREATED')
  assert.equal((await dbOffer(offer.id)).status, 'SENT')

  // list filter and detail
  const list = await (await call('GET', `/api/offers?status=CREATED,SENT&organId=${organId}`)).json()
  assert.deepEqual(list.map((o) => o.id), [offer.id])
  const detail = await (await call('GET', `/api/offers/${offer.id}`)).json()
  assert.deepEqual(detail, sent)

  // cancel a SENT offer
  res = await call('POST', `/api/offers/${offer.id}/cancel`)
  assert.equal(res.status, 200)
  assert.equal((await res.json()).status, 'CANCELLED')
  assert.equal((await dbOffer(offer.id)).status, 'CANCELLED')
  assert.equal(await openCount(), 0)

  // cancel / send a CANCELLED offer
  res = await call('POST', `/api/offers/${offer.id}/cancel`)
  assert.equal(res.status, 409)
  assert.equal((await res.json()).error.code, 'INVALID_STATE_TRANSITION')
  res = await call('POST', `/api/offers/${offer.id}/send`)
  assert.equal(res.status, 409)

  // a new offer can now be created, even for the same recipient (cancel does not block, U9)
  res = await call('POST', '/api/offers', { organId, recipientId: rank1.recipientId, matchRunId: run.id })
  assert.equal(res.status, 201)
  const again = await res.json()
  created.push(again.id)
  assert.equal(again.status, 'CREATED')

  // cancel a CREATED offer
  res = await call('POST', `/api/offers/${again.id}/cancel`)
  assert.equal(res.status, 200)
  assert.equal((await dbOffer(again.id)).status, 'CANCELLED')
  assert.equal(await openCount(), 0)

  // list is newest first and includes the cancelled ones
  const all = await (await call('GET', `/api/offers?status=CANCELLED&organId=${organId}`)).json()
  assert.deepEqual(all.map((o) => o.id), [again.id, offer.id])
})

test('create without a run, and rule violations come back as 422 RULE_VIOLATION', async () => {
  let res = await call('POST', '/api/offers', { organId, recipientId: rank1.recipientId })
  assert.equal(res.status, 201)
  const o = await res.json()
  created.push(o.id)
  assert.equal(o.matchRunId, null)
  assert.equal(o.rank, null)
  await call('POST', `/api/offers/${o.id}/cancel`)

  // an excluded (incompatible) candidate is rejected by the DB triggers
  const ex = run.excluded[0]
  if (ex) {
    res = await call('POST', '/api/offers', { organId, recipientId: ex.recipientId, matchRunId: run.id })
    assert.equal(res.status, 422)
    assert.equal((await res.json()).error.code, 'RULE_VIOLATION')
    assert.equal(await openCount(), 0)
  }
})

test('an offer that has aged past one hour as CREATED is cancelled by the sweep before send', async () => {
  const res = await call('POST', '/api/offers', { organId, recipientId: rank2.recipientId, matchRunId: run.id })
  const o = await res.json()
  created.push(o.id)
  // Back-date creation (a test-only backdoor, as the contract's expiry cases do in psql).
  await pool.query(`UPDATE organ_offer SET created_at = now() - interval '2 hours' WHERE offer_id = $1`, [o.id])
  const send = await call('POST', `/api/offers/${o.id}/send`)
  assert.equal(send.status, 409)
  assert.equal((await send.json()).error.details.currentStatus, 'CANCELLED')
  assert.equal(await openCount(), 0)
})
