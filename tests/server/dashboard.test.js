// OL-027: GET /api/dashboard. Needs DATABASE_URL pointing at a reset dev DB.
// Fixtures are clones of an AVAILABLE organ; cleanup deletes them and restores waitlist rows.
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../server/index.js'
import { pool } from '../../server/db.js'

let server, base, cookie
const clones = []
const waitlistBackup = new Map()

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
const dash = async () => {
  const r = await req('GET', '/api/dashboard')
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body
}

// Clone an AVAILABLE organ (same donor/type/hospital) recovered `hoursLeft` before its type's expiry.
async function cloneOrgan(hoursLeft) {
  const [src] = await q(
    `SELECT o.donor_id, o.organ_type_id, o.recovering_hospital_id, ot.max_viability_hours AS maxh
     FROM organ o JOIN organ_type ot USING (organ_type_id)
     WHERE o.status = 'AVAILABLE' AND ot.max_viability_hours > $1 ORDER BY o.organ_id LIMIT 1`,
    [hoursLeft],
  )
  assert.ok(src, 'needs an AVAILABLE organ of a type with enough viability')
  const [{ organ_id }] = await q(
    `INSERT INTO organ (donor_id, organ_type_id, recovering_hospital_id, recovered_at)
     VALUES ($1, $2, $3, now() - make_interval(secs => ($4::numeric - $5::numeric) * 3600)) RETURNING organ_id`,
    [src.donor_id, src.organ_type_id, src.recovering_hospital_id, src.maxh, hoursLeft],
  )
  clones.push(organ_id)
  return { id: Number(organ_id), typeId: src.organ_type_id }
}

async function backupEntry(recipientId, typeId) {
  const key = `${recipientId}:${typeId}`
  if (waitlistBackup.has(key)) return
  waitlistBackup.set(key, (await q('SELECT * FROM waitlist_entry WHERE recipient_id = $1 AND organ_type_id = $2', [recipientId, typeId]))[0])
}

// Offer on a fresh clone (long viability left): candidate at another hospital when `other` is set.
async function makeSentOffer(other = false) {
  const organ = await cloneOrgan(20)
  const run = (await req('POST', '/api/matching/runs', { organId: organ.id })).body
  const origin = (await q('SELECT recovering_hospital_id AS h FROM organ WHERE organ_id = $1', [organ.id]))[0].h
  for (const c of run.qualified ?? []) {
    const [{ hospital_id }] = await q('SELECT hospital_id FROM recipient WHERE recipient_id = $1', [c.recipientId])
    if (other && hospital_id === origin) continue
    await backupEntry(c.recipientId, organ.typeId)
    const offer = await req('POST', '/api/offers', { organId: organ.id, recipientId: c.recipientId, matchRunId: run.id })
    assert.equal(offer.status, 201, JSON.stringify(offer.body))
    assert.equal((await req('POST', `/api/offers/${offer.body.id}/send`)).status, 200)
    return { organ, recipientId: c.recipientId, offerId: offer.body.id }
  }
  assert.fail('needs an organ with a qualified candidate')
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
})
test.after(async () => {
  if (clones.length) {
    await pool.query('DELETE FROM transplant_event WHERE offer_id IN (SELECT offer_id FROM organ_offer WHERE organ_id = ANY($1))', [clones])
    await pool.query('DELETE FROM transport_record WHERE organ_id = ANY($1)', [clones])
    await pool.query('DELETE FROM organ_offer WHERE organ_id = ANY($1)', [clones])
    await pool.query('DELETE FROM match_run WHERE organ_id = ANY($1)', [clones])
    await pool.query('DELETE FROM organ WHERE organ_id = ANY($1)', [clones])
  }
  for (const row of waitlistBackup.values()) {
    if (row) await pool.query('UPDATE waitlist_entry SET status = $3 WHERE recipient_id = $1 AND organ_type_id = $2', [row.recipient_id, row.organ_type_id, row.status])
  }
  server.close()
  await pool.end().catch(() => {})
})

test('requires a session', async () => {
  assert.equal((await call('GET', '/api/dashboard', undefined, false)).status, 401)
})

test('shape and types', async () => {
  const d = await dash()
  assert.deepEqual(Object.keys(d).sort(), ['allocationTrend', 'criticalAlerts', 'recentOffers', 'stats'])
  assert.deepEqual(Object.keys(d.stats).sort(), ['activeWaitlist', 'availableOrgans', 'pendingOffers', 'transplantsThisMonth'])
  for (const v of Object.values(d.stats)) assert.equal(typeof v, 'number')
  assert.ok(Array.isArray(d.criticalAlerts))
  for (const a of d.criticalAlerts) {
    assert.equal(typeof a.hoursRemaining, 'number')
    if (a.type === 'ORGAN_EXPIRING') assert.ok(a.severity === 'danger' && Number.isInteger(a.organId))
    else assert.ok(a.type === 'OFFER_AWAITING_RESPONSE' && a.severity === 'warning' && Number.isInteger(a.offerId))
  }
})

test('each stat equals an independent SQL count', async () => {
  const d = await dash()
  const [c] = await q(`
    SELECT (SELECT COUNT(*) FROM organ o JOIN organ_type ot USING (organ_type_id)
              WHERE o.status = 'AVAILABLE' AND now() <= o.recovered_at + ot.max_viability_hours * interval '1 hour')::int AS a,
           (SELECT COUNT(*) FROM waitlist_entry WHERE status = 'ACTIVE')::int AS w,
           (SELECT COUNT(*) FROM organ_offer WHERE status = 'CREATED')::int + (SELECT COUNT(*) FROM organ_offer WHERE status = 'SENT')::int AS p,
           (SELECT COUNT(*) FROM transplant_event WHERE outcome = 'SUCCESS'
              AND to_char(transplant_at, 'YYYY-MM') = to_char(now(), 'YYYY-MM'))::int AS t`)
  assert.deepEqual(d.stats, { availableOrgans: c.a, activeWaitlist: c.w, pendingOffers: c.p, transplantsThisMonth: c.t })
  const list = await req('GET', '/api/organs?available=true')
  assert.equal(list.body.length, d.stats.availableOrgans)
})

test('organ with ~1 h left is a red alert; organ with 3 h left is not', async () => {
  const urgent = await cloneOrgan(1)
  const calm = await cloneOrgan(3)
  const d = await dash()
  const hit = d.criticalAlerts.find((a) => a.type === 'ORGAN_EXPIRING' && a.organId === urgent.id)
  assert.ok(hit, 'urgent organ must be listed')
  assert.equal(hit.severity, 'danger')
  assert.ok(Math.abs(hit.hoursRemaining - 1) < 0.05, `hoursRemaining ${hit.hoursRemaining}`)
  assert.ok(!d.criticalAlerts.some((a) => a.organId === calm.id))
  const hours = d.criticalAlerts.filter((a) => a.type === 'ORGAN_EXPIRING').map((a) => a.hoursRemaining)
  assert.deepEqual(hours, [...hours].sort((x, y) => x - y))
})

test('SENT offer near the end of its response window is a warning alert', async () => {
  const o = await makeSentOffer()
  let d = await dash()
  assert.ok(!d.criticalAlerts.some((a) => a.offerId === o.offerId), 'fresh offer is not an alert')
  await pool.query(
    `UPDATE organ_offer SET created_at = created_at - interval '1 minute' - make_interval(secs => (
         (SELECT response_window_hours FROM v_offer WHERE offer_id = $1) - 0.4) * 3600),
       sent_at = now() - make_interval(secs => ((SELECT response_window_hours FROM v_offer WHERE offer_id = $1) - 0.4) * 3600)
     WHERE offer_id = $1`,
    [o.offerId],
  )
  d = await dash()
  const hit = d.criticalAlerts.find((a) => a.type === 'OFFER_AWAITING_RESPONSE' && a.offerId === o.offerId)
  assert.ok(hit)
  assert.equal(hit.severity, 'warning')
  assert.ok(Math.abs(hit.hoursRemaining - 0.4) < 0.05, `hoursRemaining ${hit.hoursRemaining}`)
})

test('recentOffers: at most 5, newest first, Offer shape', async () => {
  const o = await makeSentOffer()
  const d = await dash()
  assert.ok(d.recentOffers.length <= 5 && d.recentOffers.length >= 1)
  assert.equal(d.recentOffers[0].id, o.offerId)
  const times = d.recentOffers.map((x) => Date.parse(x.createdAt))
  assert.deepEqual(times, [...times].sort((a, b) => b - a))
  const full = (await req('GET', `/api/offers?organId=${o.organ.id}`)).body[0]
  assert.deepEqual(d.recentOffers[0], full)
})

test('trend: 12 consecutive zero-filled months ending now; a SUCCESS transplant this month is counted', async () => {
  const before = await dash()
  const t = await makeSentOffer(true)
  assert.equal((await req('POST', `/api/offers/${t.offerId}/accept`, {})).status, 200)
  const tr = (await q('SELECT transport_id FROM transport_record WHERE organ_id = $1', [t.organ.id]))[0]
  assert.equal((await req('POST', `/api/transport/${tr.transport_id}/depart`)).status, 200)
  assert.equal((await req('POST', `/api/transport/${tr.transport_id}/deliver`)).status, 200)
  assert.equal((await req('POST', '/api/transplants', { offerId: t.offerId, outcome: 'SUCCESS' })).status, 201)
  const d = await dash()
  assert.equal(d.allocationTrend.length, 12)
  const [{ now_month }] = await q(`SELECT to_char(now(), 'YYYY-MM') AS now_month`)
  assert.equal(d.allocationTrend[11].month, now_month)
  const expected = await q(`SELECT to_char(date_trunc('month', now()) - make_interval(months => 11 - g), 'YYYY-MM') AS m FROM generate_series(0, 11) g`)
  assert.deepEqual(d.allocationTrend.map((x) => x.month), expected.map((x) => x.m))
  for (const p of d.allocationTrend) assert.ok(Number.isInteger(p.transplants) && p.transplants >= 0)
  const [{ n }] = await q(`SELECT COUNT(*)::int AS n FROM transplant_event WHERE outcome = 'SUCCESS' AND to_char(transplant_at, 'YYYY-MM') = $1`, [now_month])
  assert.equal(d.allocationTrend[11].transplants, n)
  assert.equal(d.allocationTrend[11].transplants, before.allocationTrend[11].transplants + 1)
  assert.equal(d.stats.transplantsThisMonth, before.stats.transplantsThisMonth + 1)
  // a month with no transplants is present as 0
  const empty = await q(`SELECT 1 FROM generate_series(0, 10) g WHERE NOT EXISTS (
    SELECT 1 FROM transplant_event WHERE outcome='SUCCESS' AND to_char(transplant_at,'YYYY-MM') = to_char(date_trunc('month', now()) - make_interval(months => g), 'YYYY-MM'))`)
  if (empty.length > 0) assert.ok(d.allocationTrend.some((p) => p.transplants === 0))
})
