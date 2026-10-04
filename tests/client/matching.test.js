// Matching API layer, adapters and console wiring: no DB or browser needed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getDefaultWeights, getLatestRun, runMatch } from '../../src/api/matching.js'
import { adaptMatchRun, runLabel } from '../../src/api/adapters/matching.js'
import { adaptMockOrgan } from '../../src/api/adapters/organs.js'
import { mockOrgans } from '../../src/data/mockOrgans.js'

const realFetch = globalThis.fetch
test.afterEach(() => {
  globalThis.fetch = realFetch
})

const apiRun = {
  id: 42, organId: 7, runAt: '2026-10-04T09:12:00.000Z', runBy: { id: 1, username: 'admin' },
  weights: { hla: 25, urgency: 35, distance: 20, wait: 20 },
  qualified: [{ recipientId: 118, recipientName: 'Priya Sharma', bloodGroup: 'A+', hospitalName: 'Apollo Chennai',
    rank: 1, matchScore: 81.25, hlaScore: 87.5, urgencyScore: 100, distanceScore: 62.1, waitScore: 66.08,
    distanceKm: 238.4, offerStatus: null }],
  excluded: [{ recipientId: 120, recipientName: 'R. Iyer', bloodGroup: 'B+', hospitalName: 'CMC Vellore',
    distanceKm: 110.2, exclusionCode: 'ABO_INCOMPATIBLE', exclusionDescription: 'Blood group incompatible with donor' }],
}

test('adaptMatchRun formats ids and maps candidates and exclusions', () => {
  const r = adaptMatchRun(apiRun)
  assert.equal(r.id, 'MR-0042')
  assert.equal(r.dbId, 42)
  assert.equal(r.qualified[0].recipient, 'R-0118')
  assert.equal(r.qualified[0].rank, 1)
  assert.equal(r.qualified[0].waitScore, 66.08)
  assert.equal(r.excluded[0].code, 'ABO_INCOMPATIBLE')
  assert.equal(r.excluded[0].description, 'Blood group incompatible with donor')
})

test('runLabel reads "Run #MR-NNNN at HH:MM"', () => {
  assert.match(runLabel(adaptMatchRun(apiRun), 'en-GB'), /^Run #MR-0042 at \d{2}:\d{2}$/)
})

test('live runMatch POSTs organId and all four weights', async () => {
  let call
  globalThis.fetch = async (url, init) => {
    call = { url, init }
    return { ok: true, status: 201, json: async () => apiRun }
  }
  const run = await runMatch({ dbId: 7 }, { hla: 25, urgency: 35, distance: 20, wait: 20 }, true)
  assert.equal(call.url, '/api/matching/runs')
  assert.equal(call.init.method, 'POST')
  assert.deepEqual(JSON.parse(call.init.body), { organId: 7, weights: { hla: 25, urgency: 35, distance: 20, wait: 20 } })
  assert.equal(run.id, 'MR-0042')
})

test('live getLatestRun loads newest run, or null when none', async () => {
  const urls = []
  globalThis.fetch = async (url) => {
    urls.push(url)
    const body = url === '/api/organs/7/runs' ? [{ id: 42 }, { id: 41 }] : apiRun
    return { ok: true, status: 200, json: async () => body }
  }
  assert.equal((await getLatestRun({ dbId: 7 }, true)).dbId, 42)
  assert.deepEqual(urls, ['/api/organs/7/runs', '/api/matching/runs/42'])
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [] })
  assert.equal(await getLatestRun({ dbId: 8 }, true), null)
})

test('live getDefaultWeights reads the organ defaultWeights', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ defaultWeights: { hla: 20, urgency: 40, distance: 25, wait: 15 } }) })
  assert.deepEqual(await getDefaultWeights({ dbId: 7 }, true), { hla: 20, urgency: 40, distance: 25, wait: 15 })
})

test('mock mode: re-run creates a new run, scores stay within 0..100 at max weights', async () => {
  const organ = adaptMockOrgan(mockOrgans.find((o) => o.organType === 'Kidney' && o.status === 'Available'))
  assert.equal(await getLatestRun(organ, false), null)
  const a = await runMatch(organ, { hla: 100, urgency: 100, distance: 100, wait: 100 }, false)
  const b = await runMatch(organ, { hla: 100, urgency: 100, distance: 100, wait: 100 }, false)
  assert.notEqual(a.dbId, b.dbId)
  assert.equal((await getLatestRun(organ, false)).dbId, b.dbId)
  assert.ok(b.qualified.length > 0)
  for (const q of b.qualified) assert.ok(q.matchScore >= 0 && q.matchScore <= 100)
  assert.deepEqual(b.qualified.map((q) => q.rank), b.qualified.map((_, i) => i + 1))
  for (const e of b.excluded) assert.ok(e.code && e.description)
})

test('console page: four sliders, run label, re-run button, excluded section, disabled organs', () => {
  const src = readFileSync(new URL('../../src/pages/MatchingConsolePage.jsx', import.meta.url), 'utf8')
  for (const key of ["key: 'hla'", "key: 'urgency'", "key: 'distance'", "key: 'wait'"]) assert.ok(src.includes(key), key)
  assert.ok(src.includes('Waiting Time Weight'))
  assert.ok(src.includes('Re-run Match'))
  assert.ok(src.includes('runLabel(run)'))
  assert.ok(src.includes('Candidates Excluded'))
  assert.ok(src.includes('disabled: !isMatchable(o)'))
  assert.ok(src.includes('getDefaultWeights') && src.includes('getLatestRun'))
})
