// Needs DATABASE_URL pointing at a reachable Postgres (health-ok and number-parsing tests).
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../server/index.js'
import { pool, query } from '../../server/db.js'

let server, base
test.before(async () => {
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${server.address().port}`
})
test.after(async () => {
  server.close()
  await pool.end().catch(() => {})
})

test('pool returns INT8 and NUMERIC as JS numbers', async () => {
  const [row] = await query('SELECT 1::bigint AS big_val, 1.50::numeric AS num_val')
  assert.equal(typeof row.bigVal, 'number')
  assert.equal(row.bigVal, 1)
  assert.equal(row.numVal, 1.5)
})

test('GET /api/health returns 200 {status, db} when DB is up', async () => {
  const res = await fetch(`${base}/api/health`)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { status: 'ok', db: 'ok' })
})

test('GET /api/health returns 503 error envelope when DB is down', async () => {
  const orig = pool.query
  pool.query = async () => { throw new Error('connect ECONNREFUSED') }
  try {
    const res = await fetch(`${base}/api/health`)
    assert.equal(res.status, 503)
    assert.deepEqual(await res.json(), {
      error: { code: 'DB_UNAVAILABLE', message: 'Database unreachable', details: {} },
    })
  } finally {
    pool.query = orig
  }
})
