// OL-022: GET/POST/PATCH /api/waitlist. Needs DATABASE_URL pointing at a reset dev DB.
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../server/index.js'
import { pool } from '../../server/db.js'

let server, base, cookie, bgO, bgA, hospitalId, kidneyId, liverId, urgency1a, urgency1b, urgency2
const recipients = []

const one = async (sql, params) => (await pool.query(sql, params)).rows[0]

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
  bgO = Number((await one("SELECT blood_group_id FROM blood_group WHERE group_name = 'O-'")).blood_group_id)
  bgA = Number((await one("SELECT blood_group_id FROM blood_group WHERE group_name = 'AB-'")).blood_group_id)
  hospitalId = Number((await one('SELECT min(hospital_id) AS id FROM hospital')).id)
  kidneyId = Number((await one("SELECT organ_type_id FROM organ_type WHERE name = 'Kidney'")).organ_type_id)
  liverId = Number((await one("SELECT organ_type_id FROM organ_type WHERE name = 'Liver'")).organ_type_id)
  urgency2 = Number((await one("SELECT urgency_id FROM urgency WHERE code = '2'")).urgency_id)
  urgency1a = Number((await one("SELECT urgency_id FROM urgency WHERE code = '1A'")).urgency_id)
  urgency1b = Number((await one("SELECT urgency_id FROM urgency WHERE code = '1B'")).urgency_id)
})

test.after(async () => {
  if (recipients.length) await pool.query('DELETE FROM recipient WHERE recipient_id = ANY($1)', [recipients])
  server.close()
  await pool.end().catch(() => {})
})

const send = (method, path, body, withCookie = true) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(withCookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
const get = (path) => fetch(`${base}${path}`, { headers: { cookie } })

async function newRecipient(name, bloodGroupId = bgO) {
  const r = await one(
    `INSERT INTO recipient (name, date_of_birth, blood_group_id, hospital_id, height_cm, weight_kg)
     VALUES ($1, '1985-05-05', $2, $3, 170, 70) RETURNING recipient_id`,
    [name, bloodGroupId, hospitalId],
  )
  recipients.push(Number(r.recipient_id))
  return Number(r.recipient_id)
}
const addEntry = (recipientId, organTypeId, urgencyId, listedDate) =>
  pool.query(
    'INSERT INTO waitlist_entry (recipient_id, organ_type_id, urgency_id, listed_date) VALUES ($1,$2,$3,$4)',
    [recipientId, organTypeId, urgencyId, listedDate],
  )
const auditCount = async (action) =>
  (await one("SELECT count(*)::int AS n FROM audit_log WHERE table_name = 'waitlist_entry' AND action = $1", [action])).n

test('requires a session', async () => {
  assert.equal((await send('GET', '/api/waitlist', undefined, false)).status, 401)
  assert.equal((await send('POST', '/api/waitlist', {}, false)).status, 401)
  assert.equal((await send('PATCH', '/api/waitlist/1/1', {}, false)).status, 401)
})

test('priorityScore equals v_waitlist_scored and the list is sorted with a stable tie-break', async () => {
  const rid = await newRecipient('OL-022 Score')
  await addEntry(rid, kidneyId, urgency1a, '2024-01-10')
  await addEntry(rid, liverId, urgency2, '2023-01-10')
  const res = await get('/api/waitlist')
  assert.equal(res.status, 200)
  const rows = await res.json()
  const view = (await pool.query('SELECT recipient_id, organ_type_id, priority_score, urgency_score, wait_score FROM v_waitlist_scored')).rows
  assert.equal(rows.length, view.length)
  const key = (r) => `${r.recipient_id ?? r.recipientId}/${r.organ_type_id ?? r.organTypeId}`
  const viewByKey = new Map(view.map((v) => [key(v), v]))
  for (const r of rows) {
    const v = viewByKey.get(key(r))
    assert.ok(v, 'row exists in view')
    assert.equal(typeof r.priorityScore, 'number')
    assert.equal(r.priorityScore, Number(v.priority_score))
    assert.equal(r.urgencyScore, Number(v.urgency_score))
    assert.equal(r.waitScore, Number(v.wait_score))
  }
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i]
    assert.ok(a.priorityScore >= b.priorityScore, 'priority descending')
    if (a.priorityScore === b.priorityScore) {
      assert.ok(
        a.recipientId < b.recipientId || (a.recipientId === b.recipientId && a.organTypeId < b.organTypeId),
        'tie-break recipient_id, organ_type_id',
      )
    }
  }
  const mine = rows.filter((r) => r.recipientId === rid)
  assert.equal(mine.length, 2)
  for (const k of ['recipientName', 'bloodGroup', 'hospitalId', 'hospitalName', 'regionId', 'organType', 'urgencyCode', 'listedDate', 'status', 'waitMonths']) {
    assert.ok(k in mine[0], `has ${k}`)
  }
})

test('filters: organ, bloodGroup, urgency, status; invalid enums are 400', async () => {
  const rid = await newRecipient('OL-022 Filters', bgA)
  await addEntry(rid, kidneyId, urgency1b, '2024-03-03')
  await addEntry(rid, liverId, urgency1b, '2024-03-03')
  await pool.query("UPDATE waitlist_entry SET status = 'SUSPENDED' WHERE recipient_id = $1 AND organ_type_id = $2", [rid, liverId])

  const q = async (qs) => (await (await get(`/api/waitlist?${qs}`)).json()).filter((r) => r.recipientId === rid)
  const all = await q('bloodGroup=AB-')
  assert.equal(all.length, 2)
  assert.deepEqual((await q(`organ=${kidneyId}`)).map((r) => r.organTypeId), [kidneyId])
  assert.equal((await q('bloodGroup=AB-&urgency=1B')).length, 2)
  assert.equal((await q('urgency=1A&bloodGroup=AB-')).length, 0)
  assert.deepEqual((await q('status=SUSPENDED&bloodGroup=AB-')).map((r) => r.organTypeId), [liverId])
  assert.equal((await q('status=ACTIVE&bloodGroup=AB-')).length, 1)
  // Every returned row honours the filter.
  const bg = await (await get('/api/waitlist?bloodGroup=AB-')).json()
  assert.ok(bg.length >= 2 && bg.every((r) => r.bloodGroup === 'AB-'))
  assert.deepEqual(await (await get('/api/waitlist?bloodGroup=ZZ')).json(), [])

  for (const qs of ['urgency=3', 'status=DONE', 'organ=abc']) {
    const res = await get(`/api/waitlist?${qs}`)
    assert.equal(res.status, 400, qs)
    const body = await res.json()
    assert.equal(body.error.code, 'VALIDATION_ERROR')
    assert.ok(body.error.details.fields.length)
  }
})

test('POST -> PATCH urgency raises the score -> duplicate POST', async () => {
  const rid = await newRecipient('OL-022 Flow')
  const insBefore = await auditCount('INSERT')
  const updBefore = await auditCount('UPDATE')

  const res = await send('POST', '/api/waitlist', { recipientId: rid, organTypeId: kidneyId, urgencyId: urgency2, listedDate: '2024-06-01' })
  assert.equal(res.status, 201)
  const entry = await res.json()
  assert.equal(entry.recipientId, rid)
  assert.equal(entry.urgencyCode, '2')
  assert.equal(entry.listedDate, '2024-06-01')
  assert.equal(entry.status, 'ACTIVE')
  const v = await one('SELECT priority_score FROM v_waitlist_scored WHERE recipient_id = $1 AND organ_type_id = $2', [rid, kidneyId])
  assert.ok(Math.abs(entry.priorityScore - Number(v.priority_score)) < 0.5, 'close to the view (clock moves)')
  assert.equal((await auditCount('INSERT')) - insBefore, 1)

  const patched = await send('PATCH', `/api/waitlist/${rid}/${kidneyId}`, { urgencyId: urgency1a })
  assert.equal(patched.status, 200)
  const after = await patched.json()
  assert.equal(after.urgencyCode, '1A')
  assert.ok(after.priorityScore > entry.priorityScore, 'urgency 2 -> 1A strictly raises the score')
  assert.equal((await auditCount('UPDATE')) - updBefore, 1)
  const audit = await one(
    "SELECT row_id, user_id FROM audit_log WHERE table_name = 'waitlist_entry' AND action = 'UPDATE' ORDER BY audit_id DESC LIMIT 1",
  )
  assert.equal(audit.row_id, 'composite')
  assert.notEqual(audit.user_id, null, 'audit row carries the session user')

  const st = await send('PATCH', `/api/waitlist/${rid}/${kidneyId}`, { status: 'SUSPENDED', listedDate: '2024-05-01' })
  assert.equal(st.status, 200)
  const s = await st.json()
  assert.equal(s.status, 'SUSPENDED')
  assert.equal(s.listedDate, '2024-05-01')

  const dup = await send('POST', '/api/waitlist', { recipientId: rid, organTypeId: kidneyId, urgencyId: urgency2 })
  assert.equal(dup.status, 409)
  assert.equal((await dup.json()).error.code, 'DUPLICATE')
})

test('POST validation, future date and unknown references', async () => {
  const rid = await newRecipient('OL-022 Post errors')
  const future = await send('POST', '/api/waitlist', { recipientId: rid, organTypeId: kidneyId, urgencyId: urgency2, listedDate: '2999-01-01' })
  assert.equal(future.status, 400)
  const fb = await future.json()
  assert.equal(fb.error.code, 'CONSTRAINT_VIOLATION')
  assert.equal(fb.error.details.constraint, 'ck_waitlist_not_future')

  const noRef = await send('POST', '/api/waitlist', { recipientId: 999999999, organTypeId: kidneyId, urgencyId: urgency2 })
  assert.equal(noRef.status, 400)
  assert.equal((await noRef.json()).error.code, 'REFERENCE_NOT_FOUND')

  for (const body of [{}, { recipientId: rid, organTypeId: kidneyId }, { recipientId: rid, organTypeId: kidneyId, urgencyId: urgency2, listedDate: 'yesterday' }]) {
    const res = await send('POST', '/api/waitlist', body)
    assert.equal(res.status, 400)
    assert.equal((await res.json()).error.code, 'VALIDATION_ERROR')
  }
  const def = await send('POST', '/api/waitlist', { recipientId: rid, organTypeId: liverId, urgencyId: urgency1b })
  assert.equal(def.status, 201)
  const today = (await one("SELECT to_char(CURRENT_DATE,'YYYY-MM-DD') AS d")).d
  assert.equal((await def.json()).listedDate, today, 'listedDate defaults to today')
})

test('PATCH errors: TRANSPLANTED, unknown entry, future date, bad shape', async () => {
  const rid = await newRecipient('OL-022 Patch errors')
  await addEntry(rid, kidneyId, urgency2, '2024-01-01')
  const path = `/api/waitlist/${rid}/${kidneyId}`

  const tx = await send('PATCH', path, { status: 'TRANSPLANTED' })
  assert.equal(tx.status, 400)
  const tb = await tx.json()
  assert.equal(tb.error.code, 'VALIDATION_ERROR')
  assert.deepEqual(tb.error.details.fields, ['status'])

  const missing = await send('PATCH', `/api/waitlist/${rid}/${liverId}`, { status: 'REMOVED' })
  assert.equal(missing.status, 404)
  assert.equal((await missing.json()).error.code, 'WAITLIST_ENTRY_NOT_FOUND')
  assert.equal((await send('PATCH', '/api/waitlist/abc/1', {})).status, 404)

  const fut = await send('PATCH', path, { listedDate: '2999-01-01' })
  assert.equal(fut.status, 400)
  const fb = await fut.json()
  assert.equal(fb.error.code, 'CONSTRAINT_VIOLATION')
  assert.equal(fb.error.details.constraint, 'ck_waitlist_not_future')

  assert.equal((await send('PATCH', path, { urgencyId: 'high' })).status, 400)
  assert.equal((await send('PATCH', path, { urgencyId: 999999999 })).status, 400)
  const row = await one('SELECT status FROM waitlist_entry WHERE recipient_id = $1 AND organ_type_id = $2', [rid, kidneyId])
  assert.equal(row.status, 'ACTIVE', 'failed patches change nothing')
})
