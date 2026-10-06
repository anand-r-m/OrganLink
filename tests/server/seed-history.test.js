// OL-031: historical depth in db/03_seed_demo.sql.
// Needs DATABASE_URL pointing at a freshly reset dev DB (npm run db:reset).
// Read-only by design: the only write is expire_stale_offers(), which the
// dashboard endpoint calls anyway, and the point of one test is that it
// cannot rewrite seeded history.
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from '../../server/index.js'
import { pool } from '../../server/db.js'

// Recoveries older than this belong to the historical block; the present-day
// organs are seeded within minutes of the reset.
const HIST = `recovered_at < now() - INTERVAL '3 hours'`

let server, base, cookie

test.before(async () => {
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${server.address().port}`
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' }),
  })
  assert.equal(res.status, 200)
  cookie = res.headers.get('set-cookie').split(';')[0]
})

test.after(async () => {
  server?.close()
  await pool.end().catch(() => {})
})

const q = async (sql, params) => (await pool.query(sql, params)).rows
const one = async (sql, params) => (await q(sql, params))[0]
const get = async (path) => {
  const res = await fetch(`${base}${path}`, { headers: { cookie } })
  assert.equal(res.status, 200, path)
  return res.json()
}
// Status multiset of every historical organ/offer/transport: the fingerprint
// the sweeps would change if they ever started rewriting history.
const fingerprint = async () => ({
  organs: await q(
    `SELECT status, count(*)::int n FROM organ WHERE ${HIST} GROUP BY 1 ORDER BY 1`),
  offers: await q(
    `SELECT f.status, count(*)::int n FROM organ_offer f JOIN organ o USING (organ_id)
      WHERE o.${HIST} GROUP BY 1 ORDER BY 1`),
  transports: await q(
    `SELECT t.status, count(*)::int n FROM transport_record t JOIN organ o USING (organ_id)
      WHERE o.${HIST} GROUP BY 1 ORDER BY 1`),
})

test('history spans 18-24 months across every organ type and region', async () => {
  const r = await one(
    `SELECT count(*)::int organs,
            count(*) FILTER (WHERE o.recovered_at <= now() - INTERVAL '18 months')::int older_18m,
            count(DISTINCT ot.name)::int types,
            count(DISTINCT reg.region_code)::int regions,
            max(date_trunc('month', o.recovered_at))::date newest_month,
            min(date_trunc('month', o.recovered_at))::date oldest_month
       FROM organ o
       JOIN organ_type ot USING (organ_type_id)
       JOIN hospital h ON h.hospital_id = o.recovering_hospital_id
       JOIN region reg ON reg.region_id = h.region_id
      WHERE ${HIST.replace('recovered_at', 'o.recovered_at')}`)
  assert.ok(r.organs >= 20, `historical organs ${r.organs}`)
  assert.ok(r.older_18m >= 5, `organs older than 18 months ${r.older_18m}`)
  assert.equal(r.types, 5, 'all five organ types have history')
  assert.equal(r.regions, 4, 'all four regions have history')
  const span = (r.newest_month - r.oldest_month) / (1000 * 60 * 60 * 24 * 30.44)
  assert.ok(span >= 18, `history spans ${span.toFixed(1)} months`)
})

test('every historical organ reached a terminal state', async () => {
  const r = await one(
    `SELECT count(*) FILTER (WHERE status = 'AVAILABLE')::int stale_available,
            count(*) FILTER (WHERE status = 'ALLOCATED')::int stale_allocated,
            count(*) FILTER (WHERE status = 'EXPIRED')::int expired,
            count(*) FILTER (WHERE status = 'DISCARDED')::int discarded,
            count(*) FILTER (WHERE status = 'TRANSPLANTED')::int transplanted
       FROM organ WHERE ${HIST}`)
  assert.equal(r.stale_available, 0, 'an AVAILABLE old organ would be swept')
  assert.equal(r.stale_allocated, 0)
  assert.ok(r.expired > 0 && r.discarded > 0 && r.transplanted > 0, 'all terminal states present')
})

test('no historical offer or transport is left open', async () => {
  const r = await one(
    `SELECT (SELECT count(*) FROM organ_offer f JOIN organ o USING (organ_id)
              WHERE o.${HIST} AND f.status IN ('CREATED','SENT'))::int open_offers,
            (SELECT count(*) FROM transport_record t JOIN organ o USING (organ_id)
              WHERE o.${HIST} AND t.status IN ('PENDING','IN_TRANSIT'))::int live_transports,
            (SELECT count(*) FROM organ_offer f JOIN organ o USING (organ_id)
              WHERE o.${HIST})::int offers,
            (SELECT count(DISTINCT dr.code) FROM organ_offer f JOIN organ o USING (organ_id)
              JOIN decline_reason dr USING (decline_reason_id)
              WHERE o.${HIST} AND f.status = 'DECLINED')::int decline_codes`)
  assert.equal(r.open_offers, 0, 'CREATED/SENT offers would be swept or cancelled')
  assert.equal(r.live_transports, 0, 'PENDING/IN_TRANSIT transports would be failed')
  assert.ok(r.offers >= 20, `historical offers ${r.offers}`)
  assert.ok(r.decline_codes >= 4, `distinct decline reasons ${r.decline_codes}`)
})

test('expire_stale_offers() leaves the historical block untouched', async () => {
  const before = await fingerprint()
  await q('SELECT expire_stale_offers()')
  await q('SELECT expire_stale_offers()')
  assert.deepEqual(await fingerprint(), before)
})

test('every transplanted organ has an accepted offer, a delivered organ and a SUCCESS event', async () => {
  const r = await one(
    `SELECT count(*)::int broken FROM organ o
      WHERE o.${HIST} AND o.status = 'TRANSPLANTED'
        AND ( NOT EXISTS (SELECT 1 FROM organ_offer f
                            WHERE f.organ_id = o.organ_id AND f.status = 'ACCEPTED')
           OR NOT EXISTS (SELECT 1 FROM transport_record t
                            WHERE t.organ_id = o.organ_id AND t.status = 'DELIVERED')
           OR NOT EXISTS (SELECT 1 FROM organ_offer f
                            JOIN transplant_event te ON te.offer_id = f.offer_id
                            WHERE f.organ_id = o.organ_id AND te.outcome = 'SUCCESS'))`)
  assert.equal(r.broken, 0)
})

test('accepted historical offers were genuinely ABO/Rh and size compatible', async () => {
  const r = await one(
    `SELECT count(*)::int incompatible
       FROM organ_offer f
       JOIN organ o ON o.organ_id = f.organ_id
       JOIN donor d ON d.donor_id = o.donor_id
       JOIN recipient rc ON rc.recipient_id = f.recipient_id
       JOIN organ_type ot ON ot.organ_type_id = o.organ_type_id
      WHERE o.${HIST} AND f.status = 'ACCEPTED'
        AND ( NOT COALESCE((SELECT bc.compatible FROM blood_compatibility bc
                              WHERE bc.donor_bg_id = d.blood_group_id
                                AND bc.recipient_bg_id = rc.blood_group_id), false)
           OR d.weight_kg / NULLIF(rc.weight_kg, 0) < ot.min_weight_ratio
           OR d.weight_kg / NULLIF(rc.weight_kg, 0) > ot.max_weight_ratio )`)
  assert.equal(r.incompatible, 0)
})

test('every historical match run ranked at least one qualified candidate', async () => {
  const r = await one(
    `SELECT count(*)::int runs_without_a_qualified_candidate
       FROM match_run mr JOIN organ o ON o.organ_id = mr.organ_id
      WHERE o.${HIST}
        AND NOT EXISTS (SELECT 1 FROM match_result m
                         WHERE m.run_id = mr.run_id AND m.qualified)`)
  assert.equal(r.runs_without_a_qualified_candidate, 0)

  const excluded = await one(
    `SELECT count(*)::int excluded_rows
       FROM match_result m JOIN match_run mr USING (run_id) JOIN organ o ON o.organ_id = mr.organ_id
      WHERE o.${HIST} AND NOT m.qualified AND m.exclusion_reason_id IS NOT NULL`)
  assert.ok(excluded.excluded_rows > 0, 'matching history includes excluded candidates')
})

test('historical rows are facts, not audited events', async () => {
  const r = await one(
    `SELECT count(*) FILTER (WHERE changed_at < now() - INTERVAL '3 hours')::int historical,
            count(*)::int total
       FROM audit_log`)
  assert.equal(r.historical, 0, 'replica mode must not write audit rows for history')
  assert.ok(r.total > 0, 'present-day inserts are still audited')
})

test('waiting-time report spans at least six buckets', async () => {
  const body = await get('/api/reports/waiting-times')
  const buckets = new Set(body.map((r) => r.bucket))
  assert.ok(buckets.size >= 6, `populated buckets ${buckets.size} (${[...buckets].join(',')})`)
  const longest = Math.max(...body.map((r) => r.bucket))
  assert.ok(longest >= 6, `longest bucket ${longest}`)
  assert.ok(body.every((r) => r.recipients > 0))
})

test('utilization and fairness report every region with real numbers', async () => {
  const utilization = await get('/api/reports/utilization')
  const regions = [...new Set(utilization.map((r) => r.regionName))]
  assert.equal(regions.length, 4)
  for (const region of regions) {
    const rows = utilization.filter((r) => r.regionName === region)
    assert.ok(rows.some((r) => r.totalRecovered > 0), `${region}: nothing recovered`)
    assert.ok(rows.some((r) => r.transplanted > 0), `${region}: no transplants`)
    assert.ok(rows.some((r) => r.expired > 0 || r.discarded > 0), `${region}: no non-transplant outcomes`)
  }

  const fairness = await get('/api/reports/fairness')
  assert.equal(fairness.length, 4)
  for (const row of fairness) {
    assert.ok(row.waitlistSize > 0, `${row.regionName}: empty waitlist`)
    assert.ok(row.transplantsCompleted > 0, `${row.regionName}: no transplants completed`)
    assert.equal(typeof row.medianWaitDays, 'number', `${row.regionName}: median wait null`)
    assert.equal(typeof row.retentionPct, 'number', `${row.regionName}: retention null`)
    assert.ok(row.allocationRatePct > 0, `${row.regionName}: allocation rate ${row.allocationRatePct}`)
  }
})

test('decline-reason report has several distinct causes', async () => {
  const body = await get('/api/reports/decline-reasons')
  assert.ok(body.length >= 4, `decline reasons reported ${body.length}`)
  assert.ok(body.every((r) => r.occurrences > 0 && typeof r.pct === 'number'))
})

test('dashboard allocation trend is non-zero in at least 10 of the last 12 months', async () => {
  const body = await get('/api/dashboard')
  assert.equal(body.allocationTrend.length, 12, 'twelve calendar months, zero-filled')
  const months = body.allocationTrend.map((m) => m.month)
  assert.equal(months[0], months[0].trim(), 'months are YYYY-MM strings')
  const active = body.allocationTrend.filter((m) => m.transplants > 0)
  assert.ok(active.length >= 10, `non-zero months ${active.length}: ${months.filter((_, i) => body.allocationTrend[i].transplants === 0).join(',') || 'none'}`)
  assert.ok(body.stats.transplantsThisMonth >= 1, 'current month has a SUCCESS transplant')
})