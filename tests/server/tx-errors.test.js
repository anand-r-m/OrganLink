// Needs DATABASE_URL pointing at a freshly reset dev DB (npm run db:reset).
// Test routes live in this file's own Express app, so nothing test-only ships in server/index.js.
import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { pool, query, withTx } from '../../server/db.js'
import { ApiError, errorHandler, translatePgError } from '../../server/errors.js'

const TAG = `ol003-${process.pid}`
const ids = {}
let server, base

const one = async (sql, params) => (await query(sql, params))[0]

async function makeRecipient(c, name, group, height, weight) {
  const r = await c.query(
    `INSERT INTO recipient(name,date_of_birth,blood_group_id,hospital_id,status,height_cm,weight_kg)
     VALUES ($1,'1985-01-01',(SELECT blood_group_id FROM blood_group WHERE group_name=$2),$3,'ACTIVE',$4,$5)
     RETURNING recipient_id`,
    [`${TAG} ${name}`, group, ids.hospital, height, weight],
  )
  const id = r.rows[0].recipient_id
  await c.query(
    `INSERT INTO waitlist_entry(recipient_id,organ_type_id,urgency_id,listed_date,status)
     VALUES ($1,1,(SELECT urgency_id FROM urgency WHERE code='2'),CURRENT_DATE-100,'ACTIVE')`,
    [id],
  )
  return id
}

test.before(async () => {
  await withTx(1, async (c) => {
    const h = await c.query(
      `INSERT INTO hospital(name,address,phone,latitude,longitude,region_id,status)
       VALUES ($1,'x','1',9.9,76.2,(SELECT region_id FROM region WHERE region_code='SR'),'ACTIVE')
       RETURNING hospital_id`,
      [`${TAG} hospital`],
    )
    ids.hospital = h.rows[0].hospital_id
    const d = await c.query(
      `INSERT INTO donor(name,date_of_birth,blood_group_id,hospital_id,donor_type,status,height_cm,weight_kg,death_date,death_cause)
       VALUES ($1,'1980-01-01',(SELECT blood_group_id FROM blood_group WHERE group_name='A-'),$2,
               'DECEASED','ACTIVE',175,70,now()-interval '2 hours','RTA') RETURNING donor_id`,
      [`${TAG} donor`, ids.hospital],
    )
    ids.donor = d.rows[0].donor_id
    const o = await c.query(
      `INSERT INTO organ(donor_id,organ_type_id,recovering_hospital_id,recovered_at,status)
       VALUES ($1,1,$2,now()-interval '30 minutes','AVAILABLE') RETURNING organ_id`,
      [ids.donor, ids.hospital],
    )
    ids.organ = o.rows[0].organ_id
    ids.compatible1 = await makeRecipient(c, 'compat 1', 'A+', 170, 68)
    ids.compatible2 = await makeRecipient(c, 'compat 2', 'A+', 168, 66)
    ids.incompatible = await makeRecipient(c, 'abo', 'B+', 170, 70)
  })

  const app = express()
  app.use(express.json())
  const offer = (recipientId) => (c) =>
    c.query(`INSERT INTO organ_offer(organ_id,recipient_id,status) VALUES ($1,$2,'CREATED')`, [
      ids.organ,
      recipientId,
    ])
  app.post('/api/__test/offer/:recipient', async (req, res, next) => {
    try {
      await withTx(1, offer(Number(req.params.recipient)))
      res.status(201).json({ ok: true })
    } catch (e) {
      next(e)
    }
  })
  app.get('/api/__test/boom', (_req, _res, next) =>
    next(new Error('secret internal detail at /srv/app/secret.js')),
  )
  app.get('/api/__test/badint', async (_req, _res, next) => {
    try {
      await withTx(1, (c) => c.query(`SELECT 'abc'::int`))
    } catch (e) {
      next(e)
    }
  })
  app.use(errorHandler)

  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${server.address().port}`
})

test.after(async () => {
  server?.close()
  try {
    await withTx(1, async (c) => {
      await c.query('DELETE FROM organ_offer WHERE organ_id=$1', [ids.organ])
      await c.query('DELETE FROM organ WHERE organ_id=$1', [ids.organ])
      await c.query('DELETE FROM donor WHERE donor_id=$1', [ids.donor])
      await c.query('DELETE FROM waitlist_entry WHERE recipient_id = ANY($1)', [
        [ids.compatible1, ids.compatible2, ids.incompatible],
      ])
      await c.query('DELETE FROM recipient WHERE name LIKE $1', [`${TAG}%`])
      await c.query('DELETE FROM hospital WHERE hospital_id=$1', [ids.hospital])
    })
  } catch (e) {
    console.error('cleanup failed:', e.message)
  }
  await pool.end().catch(() => {})
})

const post = (path) => fetch(`${base}${path}`, { method: 'POST' })

test('write through withTx(1, …) stamps audit_log.user_id = 1', async () => {
  const res = await post(`/api/__test/offer/${ids.compatible1}`)
  assert.equal(res.status, 201)
  const row = await one('SELECT user_id, table_name FROM audit_log ORDER BY audit_id DESC LIMIT 1')
  assert.equal(row.userId, 1)
  assert.equal(row.tableName, 'organ_offer')
})

test('second CREATED offer on the same organ returns 409 ACTIVE_OFFER_EXISTS', async () => {
  const res = await post(`/api/__test/offer/${ids.compatible2}`)
  assert.equal(res.status, 409)
  assert.deepEqual(await res.json(), {
    error: { code: 'ACTIVE_OFFER_EXISTS', message: 'This organ already has an active offer', details: {} },
  })
})

test('failed transaction rolls back (only one active offer persists)', async () => {
  const row = await one(
    `SELECT count(*)::int AS n FROM organ_offer WHERE organ_id=$1 AND status IN ('CREATED','SENT')`,
    [ids.organ],
  )
  assert.equal(row.n, 1)
})

test('ABO-incompatible offer returns 422 RULE_VIOLATION with trigger message verbatim', async () => {
  // Free the organ's single active slot so the compatibility trigger is the failing rule.
  await withTx(1, (c) => c.query(`UPDATE organ_offer SET status='CANCELLED' WHERE organ_id=$1`, [ids.organ]))
  const res = await post(`/api/__test/offer/${ids.incompatible}`)
  assert.equal(res.status, 422)
  const body = await res.json()
  assert.equal(body.error.code, 'RULE_VIOLATION')
  assert.equal(body.error.message, `Blood group incompatible for offer on organ ${ids.organ}`)
  assert.deepEqual(body.error.details, {})
})

test('set_config is transaction-local: user id does not leak to the next transaction', async () => {
  await withTx(1, () => {})
  const c = await pool.connect()
  try {
    const { rows } = await c.query(`SELECT current_setting('app.user_id', true) AS v`)
    assert.ok(!rows[0].v) // '' or null on a pooled client
  } finally {
    c.release()
  }
})

test('withTx releases the client on error', async () => {
  await assert.rejects(withTx(1, () => Promise.reject(new Error('x'))), /x/)
  assert.equal(pool.totalCount - pool.idleCount, 0)
})

test('sweep option runs expire_stale_offers() before the transaction', async () => {
  const calls = []
  const orig = pool.query
  pool.query = (...a) => (calls.push(String(a[0])), orig.apply(pool, a))
  try {
    await withTx(1, () => {}, { sweep: true })
    await withTx(1, () => {})
  } finally {
    pool.query = orig
  }
  assert.equal(calls.filter((s) => /expire_stale_offers/.test(s)).length, 1)
})

test('unknown error returns 500 INTERNAL without leaking the stack', async () => {
  const origErr = console.error
  console.error = () => {}
  let res, text
  try {
    res = await fetch(`${base}/api/__test/boom`)
    text = await res.text()
  } finally {
    console.error = origErr
  }
  assert.equal(res.status, 500)
  assert.deepEqual(JSON.parse(text), {
    error: { code: 'INTERNAL', message: 'Unexpected server error', details: {} },
  })
  assert.ok(!/secret|\.js|at /.test(text))
})

test('bad input syntax (22P02) returns 400 VALIDATION_ERROR', async () => {
  const res = await fetch(`${base}/api/__test/badint`)
  assert.equal(res.status, 400)
  assert.equal((await res.json()).error.code, 'VALIDATION_ERROR')
})

test('malformed JSON body returns 400 VALIDATION_ERROR envelope', async () => {
  const res = await fetch(`${base}/api/__test/offer/1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{bad',
  })
  assert.equal(res.status, 400)
  assert.equal((await res.json()).error.code, 'VALIDATION_ERROR')
})

test('translatePgError maps the contract table', () => {
  const t = (code, extra = {}) => translatePgError({ code, message: 'm', ...extra })
  const cases = [
    [t('23505', { constraint: 'ux_offer_no_reoffer' }), 409, 'RECIPIENT_ALREADY_DECLINED'],
    [t('23505', { constraint: 'transplant_event_offer_id_key' }), 409, 'TRANSPLANT_ALREADY_RECORDED'],
    [t('23505', { constraint: 'some_key' }), 409, 'DUPLICATE'],
    [t('23503', { constraint: 'fk_x', message: 'insert violates ... is not present in table' }), 400, 'REFERENCE_NOT_FOUND'],
    [t('23503', { constraint: 'fk_x', message: 'delete violates ... is still referenced from table' }), 409, 'REFERENCE_IN_USE'],
    [t('23514', { constraint: 'ck_organ_not_future' }), 400, 'CONSTRAINT_VIOLATION'],
    [t('23502', { column: 'name' }), 400, 'VALIDATION_ERROR'],
    [t('40001'), 409, 'CONFLICT_RETRY'],
    [t('40P01'), 409, 'CONFLICT_RETRY'],
    [t('P0001', { message: 'rule text' }), 422, 'RULE_VIOLATION'],
    [t('XX000'), 500, 'INTERNAL'],
    [translatePgError(new Error('plain')), 500, 'INTERNAL'],
  ]
  for (const [e, status, code] of cases) {
    assert.equal(e.status, status, code)
    assert.equal(e.code, code)
  }
  assert.equal(t('23514', { constraint: 'ck_organ_not_future' }).message, 'Recovery time cannot be in the future')
  assert.equal(t('23514', { constraint: 'ck_new' }).message, 'Value violates constraint ck_new')
  assert.equal(t('P0001', { message: 'rule text' }).message, 'rule text')
  const own = new ApiError(404, 'DONOR_NOT_FOUND', 'Donor 1 not found')
  assert.equal(translatePgError(own), own)
})
