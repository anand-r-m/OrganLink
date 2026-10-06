#!/usr/bin/env node
// OL-030: concurrency proof (no double allocation).
//
//   Phase A: 10 parallel POST /api/offers for ONE organ, to 10 distinct eligible recipients.
//            The organ row is locked FOR UPDATE first, so the 9 losers queue behind the winner;
//            ux_offer_active then turns each of them into 409 ACTIVE_OFFER_EXISTS.
//   Phase B: 2 parallel POST /api/offers/:id/accept on the single SENT offer.
//            fn_offer_accepted allocates the organ and inserts one transport_record, so the loser
//            matches no SENT row and gets 409 INVALID_STATE_TRANSITION.
//
// Env: BASE_URL (default http://localhost:3001). KEEP_FIXTURES=1 or --keep skips cleanup.
// Starts server/index.js itself when nothing answers BASE_URL, and stops it on exit.
import 'dotenv/config'
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3001'
const KEEP = process.argv.includes('--keep') || process.env.KEEP_FIXTURES === '1'
const CREATES = 10
const ACCEPTS = 2

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const num = (v) => Number(v)

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const rows = async (text, params) => (await pool.query(text, params)).rows
const one = async (text, params) => (await rows(text, params))[0]

let server = null
let cookie = ''
const fixtures = { organId: null, recipientIds: [] }

const pass = (name, detail = '') => console.log(`PASS ${name}${detail ? `  (${detail})` : ''}`)
const warn = (msg) => console.error(`WARN ${msg}`)

// --- server lifecycle ---------------------------------------------------------
const healthy = async () => {
  try {
    const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

async function ensureServer() {
  if (await healthy()) return
  const port = new URL(BASE_URL).port || '3001'
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: port },
    stdio: 'ignore',
  })
  for (let i = 0; i < 60 && !(await healthy()); i++) await sleep(250)
  if (!(await healthy())) fail('server', `nothing answers ${BASE_URL} after starting server/index.js`)
}

// --- HTTP ---------------------------------------------------------------------
async function call(method, path, payload) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await res.text()
  let parsed = null
  try {
    parsed = text === '' ? null : JSON.parse(text)
  } catch {
    parsed = text
  }
  return { status: res.status, body: parsed, headers: res.headers }
}

const post = (path, payload) => call('POST', path, payload)
// Each request records its own wall-clock so we can see losers queueing behind the lock.
const timed = (path, payload) => {
  const t0 = performance.now()
  return post(path, payload).then((r) => ({ ...r, ms: performance.now() - t0 }))
}

const describe = (r) => `${r.status} ${JSON.stringify(r.body?.error ?? r.body ?? null).slice(0, 160)}`

// --- cleanup ------------------------------------------------------------------
async function cleanup() {
  // FK-safe order: transport_record -> organ_offer -> organ -> recipients (cascade).
  if (KEEP) {
    warn('KEEP set: leaving the probe fixtures in the database')
  } else {
    try {
      if (fixtures.organId !== null) {
        await rows('DELETE FROM transport_record WHERE organ_id = $1', [fixtures.organId])
        await rows('DELETE FROM organ_offer WHERE organ_id = $1', [fixtures.organId])
        await rows('DELETE FROM organ WHERE organ_id = $1', [fixtures.organId])
      }
      for (const id of fixtures.recipientIds) await rows('DELETE FROM recipient WHERE recipient_id = $1', [id])
    } catch (err) {
      warn(`cleanup failed (ignored): ${err.message}`)
    }
  }
  if (server) server.kill()
  await pool.end()
}

let exitCode = 0
function fail(name, detail) {
  console.error(`FAIL ${name}`)
  if (detail) console.error(`  ${detail}`)
  exitCode = 1
  throw new FailFast()
}
class FailFast extends Error {}

function check(ok, name, detail) {
  if (!ok) fail(name, detail)
  pass(name)
}

function finish() {
  process.exit(exitCode)
}

// --- fixtures -----------------------------------------------------------------
// The seeded DB tops out at 8 recipients who are eligible for any one donor/organ-type
// pair, so the probe reuses those and tops the set up through POST /api/recipients.
async function pickFixtures() {
  // Kidney: widest size band (0.50-3.00) plus 30h viability and a 6h response window, so the
  // sweep cannot expire anything mid-run.
  const organType = await one(
    `SELECT organ_type_id, min_weight_ratio, max_weight_ratio FROM organ_type WHERE name = 'Kidney'`,
  )
  check(Boolean(organType), 'lookup-organ-type', 'Kidney must be seeded')

  const donor = await one(
    `SELECT d.donor_id, d.blood_group_id, d.hospital_id, d.weight_kg
       FROM donor d JOIN blood_group bg ON bg.blood_group_id = d.blood_group_id
      WHERE d.status = 'ACTIVE' AND bg.group_name = 'O-'
      ORDER BY d.donor_id LIMIT 1`,
  )
  check(Boolean(donor), 'lookup-donor', 'an ACTIVE O- donor must be seeded')

  const urgency = await one('SELECT urgency_id FROM urgency ORDER BY urgency_id LIMIT 1')
  check(Boolean(urgency), 'lookup-urgency', 'at least one urgency must be seeded')

  // Seeded recipients who already satisfy fn_offer_compatibility for this donor/organ type.
  const seeded = await rows(
    `SELECT DISTINCT w.recipient_id
       FROM waitlist_entry w
       JOIN recipient r ON r.recipient_id = w.recipient_id AND r.status = 'ACTIVE'
      WHERE w.organ_type_id = $1 AND w.status = 'ACTIVE'
        AND EXISTS (SELECT 1 FROM blood_compatibility bc
                     WHERE bc.donor_bg_id = $2 AND bc.recipient_bg_id = r.blood_group_id AND bc.compatible)
        AND ($3::numeric / r.weight_kg) BETWEEN $4::numeric AND $5::numeric
      ORDER BY w.recipient_id LIMIT $6`,
    [
      num(organType.organ_type_id),
      num(donor.blood_group_id),
      num(donor.weight_kg),
      num(organType.min_weight_ratio),
      num(organType.max_weight_ratio),
      CREATES,
    ],
  )
  const reused = seeded.map((r) => num(r.recipient_id))

  // Top-ups reuse the donor's own blood group when the self-pair is compatible (it always is),
  // and a mid-band weight ratio so they qualify for any organ type.
  const bg = await one(
    `SELECT recipient_bg_id FROM blood_compatibility
      WHERE donor_bg_id = $1 AND compatible
      ORDER BY (recipient_bg_id = $1) DESC, recipient_bg_id LIMIT 1`,
    [num(donor.blood_group_id)],
  )
  check(Boolean(bg), 'lookup-compatible-blood-group', 'no compatible recipient blood group for the donor')
  const ratio = (num(organType.min_weight_ratio) + num(organType.max_weight_ratio)) / 2
  const weightKg = Number((num(donor.weight_kg) / ratio).toFixed(2))

  const created = []
  for (let i = 0; i < CREATES - reused.length; i++) {
    const res = await post('/api/recipients', {
      name: `OL-030 concurrency probe ${i + 1}`,
      dateOfBirth: '1990-01-01',
      bloodGroupId: num(bg.recipient_bg_id),
      hospitalId: num(donor.hospital_id),
      status: 'ACTIVE',
      heightCm: 170,
      weightKg,
      waitlist: [{ organTypeId: num(organType.organ_type_id), urgencyId: num(urgency.urgency_id) }],
    })
    check(res.status === 201, `create-recipient-${i + 1}`, describe(res))
    created.push(res.body.id)
  }
  fixtures.recipientIds = created

  const proc = await post(`/api/donors/${num(donor.donor_id)}/organs`, {
    organTypeId: num(organType.organ_type_id),
    recoveringHospitalId: num(donor.hospital_id),
    // Must be "now": ck_organ_not_future rejects a future recoveredAt.
    recoveredAt: new Date().toISOString(),
  })
  check(proc.status === 201, 'procure-organ', describe(proc))
  fixtures.organId = proc.body.id

  const recipientIds = [...reused, ...created]
  pass(
    'fixtures',
    `donor ${num(donor.donor_id)} (O-, ${num(donor.weight_kg)}kg), Kidney, organ ${fixtures.organId}, ` +
      `${reused.length} seeded + ${created.length} created recipients`,
  )
  return { donor, organType, recipientIds }
}

// --- phases -------------------------------------------------------------------
async function phaseA(recipientIds) {
  const t0 = performance.now()
  const results = await Promise.all(
    // No awaits between the calls, so all 10 hit the organ lock at once.
    recipientIds.map((recipientId) => timed('/api/offers', { organId: fixtures.organId, recipientId })),
  )
  const elapsed = performance.now() - t0

  const created = results.filter((r) => r.status === 201)
  const conflicts = results.filter((r) => r.status === 409)
  const wrongCode = conflicts.filter((r) => r.body?.error?.code !== 'ACTIVE_OFFER_EXISTS')
  const other = results.filter((r) => r.status !== 201 && r.status !== 409)

  check(
    created.length === 1 && conflicts.length === CREATES - 1 && wrongCode.length === 0 && other.length === 0,
    'phase-a-offers',
    `want 1x201 + ${CREATES - 1}x409 ACTIVE_OFFER_EXISTS; got ${results.map(describe).join(' | ')}`,
  )
  pass('phase-a-result', `${created.length} success, ${conflicts.length} conflicts`)

  check(created[0].body?.status === 'CREATED', 'phase-a-winner-status', describe(created[0]))

  const [{ count }] = await rows(
    `SELECT count(*) FROM organ_offer WHERE organ_id = $1 AND status IN ('CREATED','SENT','ACCEPTED')`,
    [fixtures.organId],
  )
  check(num(count) === 1, 'phase-a-db-single-offer', `organ_offer open+accepted count = ${count}, want 1`)

  return { offerId: created[0].body.id, elapsed, results }
}

async function phaseB(offerId) {
  const sent = await post(`/api/offers/${offerId}/send`)
  check(sent.status === 200 && sent.body?.status === 'SENT', 'phase-b-send', describe(sent))

  const t0 = performance.now()
  const results = await Promise.all(
    Array.from({ length: ACCEPTS }, () => timed(`/api/offers/${offerId}/accept`, { notes: 'concurrency proof' })),
  )
  const elapsed = performance.now() - t0

  const ok = results.filter((r) => r.status === 200)
  const conflicts = results.filter((r) => r.status === 409)
  check(
    ok.length === 1 && conflicts.length === ACCEPTS - 1,
    'phase-b-accepts',
    `want 1x200 + ${ACCEPTS - 1}x409; got ${results.map(describe).join(' | ')}`,
  )
  check(ok[0].body?.status === 'ACCEPTED', 'phase-b-winner-status', describe(ok[0]))

  const [{ count }] = await rows('SELECT count(*) FROM transport_record WHERE organ_id = $1', [fixtures.organId])
  check(num(count) === 1, 'phase-b-db-single-transport', `transport_record count = ${count}, want 1`)

  const organ = await one('SELECT status FROM organ WHERE organ_id = $1', [fixtures.organId])
  check(organ?.status === 'ALLOCATED', 'phase-b-organ-allocated', `organ status = ${organ?.status}`)

  return { elapsed, results }
}

// A14: expire_stale_offers() has no SKIP LOCKED, and withTx(..., { sweep: true }) runs it on the
// pool before opening the transaction, so every parallel request first sweeps in its own
// connection. Report the measured spread instead of hiding it.
function reportContention(phaseAData, phaseBDData) {
  const spread = (results) => {
    const times = results.map((r) => r.ms).sort((a, b) => a - b)
    return { min: times[0], max: times[times.length - 1], median: times[Math.floor(times.length / 2)] }
  }
  const a = spread(phaseAData.results)
  const b = spread(phaseBDData.results)
  const verdict = (s, label) =>
    `  ${label}: wall ${Math.round(s.elapsed)}ms, per-request min ${Math.round(s.min)}ms / median ${Math.round(s.median)}ms / max ${Math.round(s.max)}ms`
  // A spread well beyond the fastest request means the losers waited on a lock rather than
  // failing outright, which is the FOR UPDATE queue behaving as designed.
  const serialized = a.max > 3 * a.min || b.max > 3 * b.min
  console.log('A14 sweep contention (expire_stale_offers has no SKIP LOCKED):')
  console.log(verdict({ ...a, elapsed: phaseAData.elapsed }, `creates x${CREATES}`))
  console.log(verdict({ ...b, elapsed: phaseBDData.elapsed }, `accepts x${ACCEPTS}`))
  console.log(
    serialized
      ? 'A14 observed: losers queued behind FOR UPDATE / the sweeping UPDATEs. No deadlock, no timeout.'
      : 'A14 not observed at demo scale: every parallel request returned within 3x of the fastest.',
  )
}

// --- main ---------------------------------------------------------------------
try {
  await ensureServer()
  const login = await post('/api/auth/login', { username: 'admin', password: 'admin' })
  check(login.status === 200, 'login', describe(login))
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  const { donor, organType, recipientIds } = await pickFixtures()
  check(recipientIds.length === CREATES, 'ten-eligible-recipients', `have ${recipientIds.length}`)

  const phaseAData = await phaseA(recipientIds)
  const phaseBDData = await phaseB(phaseAData.offerId)
  reportContention(phaseAData, phaseBDData)
  console.log(`CONCURRENCY OK  donor ${num(donor.donor_id)}, organ ${num(organType.organ_type_id)}: 1 success, ${CREATES - 1} conflicts, 1 accept, 1 transport`)
} catch (err) {
  if (!(err instanceof FailFast)) {
    exitCode = 1
    console.error(`FAIL ${err.message}`)
  }
} finally {
  await cleanup()
}
finish()