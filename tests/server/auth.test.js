// Needs DATABASE_URL pointing at a reset dev DB (admin/admin seeded by db:reset).
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../server/index.js'
import { requireAuth } from '../../server/middleware/requireAuth.js'
import { pool } from '../../server/db.js'

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

const post = (path, body, cookie) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
const get = (path, cookie) => fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} })
const cookieOf = (res) => res.headers.get('set-cookie')?.split(';')[0]

test('requireAuth sets req.user.id from the session', () => {
  let nextArg = 'unset'
  const req = { session: { userId: 7 } }
  requireAuth(req, {}, (a) => { nextArg = a })
  assert.equal(nextArg, undefined)
  assert.deepEqual(req.user, { id: 7 })
})

test('login admin/admin returns user and httpOnly connect.sid cookie', async () => {
  const res = await post('/api/auth/login', { username: 'admin', password: 'admin' })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { user: { id: 1, username: 'admin', role: 'ADMIN' } })
  const raw = res.headers.get('set-cookie')
  assert.match(raw, /^connect\.sid=/)
  assert.match(raw, /HttpOnly/i)
  assert.match(raw, /SameSite=Lax/i)
})

test('wrong password and unknown user return 401 INVALID_CREDENTIALS', async () => {
  for (const body of [
    { username: 'admin', password: 'nope' },
    { username: 'ghost', password: 'admin' },
  ]) {
    const res = await post('/api/auth/login', body)
    assert.equal(res.status, 401)
    assert.deepEqual(await res.json(), {
      error: { code: 'INVALID_CREDENTIALS', message: 'Username or password is incorrect', details: {} },
    })
    assert.equal(res.headers.get('set-cookie'), null)
  }
})

test('login with missing fields returns 400 VALIDATION_ERROR', async () => {
  for (const body of [undefined, {}, { username: 'admin' }, { username: 'admin', password: 5 }]) {
    const res = await post('/api/auth/login', body)
    assert.equal(res.status, 400)
    assert.equal((await res.json()).error.code, 'VALIDATION_ERROR')
  }
})

test('inactive user cannot log in', async () => {
  await pool.query("UPDATE app_user SET status='INACTIVE' WHERE username='admin'")
  try {
    const res = await post('/api/auth/login', { username: 'admin', password: 'admin' })
    assert.equal(res.status, 401)
    assert.equal((await res.json()).error.code, 'INVALID_CREDENTIALS')
  } finally {
    await pool.query("UPDATE app_user SET status='ACTIVE' WHERE username='admin'")
  }
})

test('/me without cookie is 401 UNAUTHENTICATED', async () => {
  const res = await get('/api/auth/me')
  assert.equal(res.status, 401)
  assert.deepEqual(await res.json(), {
    error: { code: 'UNAUTHENTICATED', message: 'Login required', details: {} },
  })
})

test('login -> me -> logout -> me lifecycle', async () => {
  const login = await post('/api/auth/login', { username: 'admin', password: 'admin' })
  const cookie = cookieOf(login)

  const me = await get('/api/auth/me', cookie)
  assert.equal(me.status, 200)
  assert.deepEqual(await me.json(), { user: { id: 1, username: 'admin', role: 'ADMIN' } })

  const out = await post('/api/auth/logout', undefined, cookie)
  assert.equal(out.status, 204)

  const after = await get('/api/auth/me', cookie)
  assert.equal(after.status, 401)
  assert.equal((await after.json()).error.code, 'UNAUTHENTICATED')
})

test('logout without a session is 401', async () => {
  const res = await post('/api/auth/logout')
  assert.equal(res.status, 401)
})

test('health stays public; other /api routes need a session', async () => {
  assert.equal((await get('/api/health')).status, 200)
  const res = await get('/api/hospitals')
  assert.equal(res.status, 401)
  assert.equal((await res.json()).error.code, 'UNAUTHENTICATED')
})
