// OL-026: Reports adapters, API module (both modes) and page wiring.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  bucketLabel, adaptWaitingTimes, adaptUtilization, adaptDeclineReasons, adaptFairness,
  adaptCompliance, formatPct, formatDays,
} from '../../src/api/adapters/reports.js'
import { getWaitingTimes, getUtilization, getDeclineReasons, getFairness, getCompliance } from '../../src/api/reports.js'

const realFetch = globalThis.fetch
test.afterEach(() => {
  globalThis.fetch = realFetch
})
const stub = (payload) => {
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return calls
}
const noNaN = (o) => Object.values(o).every((v) => !(typeof v === 'number' && Number.isNaN(v)))

test('bucket labels: 1 -> 0–5 mo, 12 -> 55–60 mo, 13 -> 60+ mo, 0 -> future-dated', () => {
  assert.equal(bucketLabel(1), '0–5 mo')
  assert.equal(bucketLabel(2), '5–10 mo')
  assert.equal(bucketLabel(12), '55–60 mo')
  assert.equal(bucketLabel(13), '60+ mo')
  assert.equal(bucketLabel(0), 'Future-dated')
})

test('waiting times: stacked by organ type, zero-filled 13 buckets; empty -> empty', () => {
  assert.deepEqual(adaptWaitingTimes([]), { data: [], organTypes: [] })
  assert.deepEqual(adaptWaitingTimes(undefined), { data: [], organTypes: [] })
  const { data, organTypes } = adaptWaitingTimes([
    { organType: 'Kidney', bucket: 3, recipients: 14 },
    { organType: 'Heart', bucket: 3, recipients: 2 },
    { organType: 'Kidney', bucket: 13, recipients: 1 },
  ])
  assert.deepEqual(organTypes, ['Heart', 'Kidney'])
  assert.equal(data.length, 13)
  assert.equal(data[2].label, '10–15 mo')
  assert.deepEqual([data[2].Kidney, data[2].Heart, data[2].total], [14, 2, 16])
  assert.equal(data[12].label, '60+ mo')
  assert.equal(data[12].Kidney, 1)
  assert.equal(data[0].total, 0)
  const withFuture = adaptWaitingTimes([{ organType: 'Liver', bucket: 0, recipients: 1 }]).data
  assert.equal(withFuture.length, 14)
  assert.equal(withFuture[0].label, 'Future-dated')
  assert.equal(withFuture[0].Liver, 1)
})

test('utilization: grouped by region across organ types; empty and zero totals are safe', () => {
  assert.deepEqual(adaptUtilization([]), [])
  assert.deepEqual(adaptUtilization(null), [])
  const out = adaptUtilization([
    { regionName: 'B', organType: 'Kidney', transplanted: 1, expired: 1, discarded: 0, totalRecovered: 2, utilizationPct: 50 },
    { regionName: 'A', organType: 'Kidney', transplanted: 3, expired: 0, discarded: 1, totalRecovered: 4, utilizationPct: 75 },
    { regionName: 'A', organType: 'Liver', transplanted: 1, expired: 0, discarded: 0, totalRecovered: 1, utilizationPct: 100 },
    { regionName: 'C', organType: 'Heart', transplanted: 0, expired: 0, discarded: 0, totalRecovered: 0, utilizationPct: null },
  ])
  assert.deepEqual(out.map((r) => r.region), ['A', 'B', 'C'])
  assert.deepEqual([out[0].transplanted, out[0].discarded, out[0].total, out[0].utilizationPct], [4, 1, 5, 80])
  assert.equal(out[2].utilizationPct, null)
  out.forEach((r) => assert.ok(noNaN(r)))
})

test('decline reasons: description becomes the label; empty -> []', () => {
  assert.deepEqual(adaptDeclineReasons([]), [])
  assert.deepEqual(adaptDeclineReasons(undefined), [])
  assert.deepEqual(adaptDeclineReasons([{ code: 'ORGAN_QUALITY', description: 'Organ quality', occurrences: 31, pct: 33.7 }]), [
    { code: 'ORGAN_QUALITY', reason: 'Organ quality', count: 31, pct: 33.7 },
  ])
})

test('fairness: three metrics per region, null stays null and formats as an em dash', () => {
  assert.deepEqual(adaptFairness([]), [])
  const [a, b] = adaptFairness([
    { regionName: 'Northern Region', waitlistSize: 40, transplantsCompleted: 11, allocationRatePct: 27.5, medianWaitDays: 212.5, retentionPct: 81.82 },
    { regionName: 'Western Region', waitlistSize: 5, transplantsCompleted: 0, allocationRatePct: 0, medianWaitDays: null, retentionPct: null },
  ])
  assert.equal(a.shortRegion, 'Northern')
  assert.equal(a.medianWaitDays, 212.5)
  assert.equal(b.medianWaitDays, null)
  assert.equal(b.retentionPct, null)
  assert.equal(b.allocationRatePct, 0)
  assert.equal(formatPct(b.retentionPct), '—')
  assert.equal(formatDays(b.medianWaitDays), '—')
  assert.equal(formatPct(27.5), '27.5%')
  assert.equal(formatDays(212.5), '212.5 d')
  assert.ok(noNaN(b))
})

test('compliance headline: placementRatePct; null rate and missing input are safe', () => {
  const c = adaptCompliance({ transplanted: 98, expiredUnallocated: 4, discarded: 2, totalOrgans: 104, placementRatePct: 94.23 })
  assert.equal(c.placementRatePct, 94.23)
  assert.equal(c.placementRateLabel, '94.23%')
  assert.equal(c.totalOrgans, 104)
  const none = adaptCompliance({ transplanted: 0, expiredUnallocated: 0, discarded: 0, totalOrgans: 0, placementRatePct: null })
  assert.equal(none.placementRateLabel, '—')
  for (const bad of [null, undefined, []]) {
    const e = adaptCompliance(bad)
    assert.equal(e.placementRateLabel, '—')
    assert.equal(e.totalOrgans, 0)
  }
})

test('API module, live: calls the five /api/reports endpoints and returns the payload', async () => {
  const cases = [
    [getWaitingTimes, 'waiting-times', [{ organType: 'Kidney', bucket: 3, recipients: 14 }]],
    [getUtilization, 'utilization', []],
    [getDeclineReasons, 'decline-reasons', []],
    [getFairness, 'fairness', []],
    [getCompliance, 'compliance', { totalOrgans: 0, placementRatePct: null }],
  ]
  for (const [fn, path, payload] of cases) {
    const calls = stub(payload)
    assert.deepEqual(await fn(true), payload)
    assert.deepEqual(calls, [`/api/reports/${path}`])
  }
})

test('API module, mock: no fetch; rows are in the API shapes and chart-able', async () => {
  globalThis.fetch = async () => {
    throw new Error('mock mode must not fetch')
  }
  const w = await getWaitingTimes(false)
  assert.ok(w.every((r) => r.organType && Number.isInteger(r.bucket) && typeof r.recipients === 'number'))
  assert.equal(adaptWaitingTimes(w).data.length, 13)
  const u = await getUtilization(false)
  assert.ok(u.every((r) => r.regionName && r.totalRecovered === r.transplanted + r.expired + r.discarded))
  assert.ok(adaptUtilization(u).length > 0)
  const d = await getDeclineReasons(false)
  assert.ok(adaptDeclineReasons(d).length > 0)
  const f = await getFairness(false)
  assert.ok(f.some((r) => r.medianWaitDays === null), 'mock includes a null-metric region')
  assert.ok(adaptFairness(f).length > 0)
  const c = await getCompliance(false)
  assert.equal(adaptCompliance(c).placementRateLabel, '94.23%')
})

test('page source: charts bound to the API, fairness is not actual-vs-expected, headline uses placementRatePct', () => {
  const src = readFileSync(new URL('../../src/pages/ReportsPage.jsx', import.meta.url), 'utf8')
  assert.ok(!/\bWAITING_TIME\b/.test(src) && !/\bORGAN_UTILIZATION\b/.test(src))
  // The remaining inline constants are for the PDF export only, never a chart's data.
  assert.ok(!/data=\{(DECLINE_REASONS|ALLOCATION_FAIRNESS)\}/.test(src))
  assert.ok(!/Expected allocation|dataKey="expected"|Actual allocation/.test(src))
  for (const fn of ['getWaitingTimes', 'getUtilization', 'getDeclineReasons', 'getFairness', 'getCompliance']) {
    assert.ok(src.includes(fn), fn)
  }
  assert.ok(src.includes('compliance.placementRateLabel'))
  assert.ok(src.includes('showApiError'))
  assert.ok(src.includes('allocationRatePct') && src.includes('medianWaitDays') && src.includes('retentionPct'))
  assert.ok(!src.includes('94.2%'))
  assert.ok(src.includes('Export Audit Report') && src.includes('generateAuditReportPdf'))
  const adapter = readFileSync(new URL('../../src/api/adapters/reports.js', import.meta.url), 'utf8')
  assert.ok(adapter.includes('placementRatePct'))
})
