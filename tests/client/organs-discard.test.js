// Organ discard: pure helpers, API module (both modes) and OrgansPage wiring. No DB or browser.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { discardOrgan, listOrgans, resetMockOrgans } from '../../src/api/organs.js'
import { canDiscard, defaultDiscardReasonId, discardReasonOptions } from '../../src/api/adapters/organs.js'
import { getStatusVariant } from '../../src/utils/status.js'
import { mockOrgans } from '../../src/data/mockOrgans.js'

const realFetch = globalThis.fetch
test.afterEach(() => {
  globalThis.fetch = realFetch
  resetMockOrgans()
})

const reasons = [
  { id: 1, code: 'NO_SUITABLE_RECIPIENT', description: 'No compatible recipient identified' },
  { id: 3, code: 'VIABILITY_ELAPSED', description: 'Viability window elapsed before placement' },
]

test('canDiscard is true only for AVAILABLE and EXPIRED', () => {
  assert.equal(canDiscard({ status: 'AVAILABLE' }), true)
  assert.equal(canDiscard({ status: 'EXPIRED' }), true)
  for (const s of ['ALLOCATED', 'TRANSPLANTED', 'DISCARDED']) assert.equal(canDiscard({ status: s }), false, s)
  assert.equal(canDiscard(null), false)
})

test('reason options carry code + description; EXPIRED pre-selects VIABILITY_ELAPSED', () => {
  const opts = discardReasonOptions(reasons)
  assert.deepEqual(opts[1], { value: '3', label: 'VIABILITY_ELAPSED - Viability window elapsed before placement' })
  assert.equal(defaultDiscardReasonId({ status: 'EXPIRED' }, reasons), '3')
  assert.equal(defaultDiscardReasonId({ status: 'AVAILABLE' }, reasons), null)
  assert.equal(defaultDiscardReasonId({ status: 'EXPIRED' }, []), null)
})

test('DISCARDED badge is grey (muted)', () => {
  assert.equal(getStatusVariant('DISCARDED'), 'muted')
})

test('live discardOrgan POSTs the reason id and adapts the Organ', async () => {
  let call
  globalThis.fetch = async (url, init) => {
    call = { url: String(url), init }
    return new Response(
      JSON.stringify({
        id: 7, donorId: 42, donorName: 'X', donorBloodGroup: 'A+', organType: 'Kidney', recoveringHospitalName: 'H',
        regionCode: 'NR', recoveredAt: '2026-10-04T08:00:00.000Z', maxViabilityHours: 30, expiresAt: null,
        hoursRemaining: 0, isExpired: true, status: 'DISCARDED', hasActiveOffer: false, activeOfferId: null,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
  const row = await discardOrgan({ id: 'O-0007', dbId: 7, status: 'EXPIRED' }, '3', true)
  assert.match(call.url, /\/api\/organs\/7\/discard$/)
  assert.equal(call.init.method, 'POST')
  assert.deepEqual(JSON.parse(call.init.body), { discardReasonId: 3 })
  assert.equal(row.id, 'O-0007')
  assert.equal(row.status, 'DISCARDED')
})

test('live discardOrgan surfaces the server error code and message', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { code: 'ACTIVE_OFFER_EXISTS', message: 'cancel it first', details: { offerId: 4 } } }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    })
  await assert.rejects(discardOrgan({ dbId: 7, status: 'AVAILABLE' }, '1', true), (e) => e.code === 'ACTIVE_OFFER_EXISTS' && /cancel/.test(e.message))
})

test('mock discardOrgan turns a row DISCARDED in the list and refuses terminal organs', async () => {
  const before = await listOrgans({}, false)
  const target = before.find((o) => canDiscard(o) && !o.hasActiveOffer)
  assert.ok(target, 'mock data has a discardable organ')
  const out = await discardOrgan(target, '1', false)
  assert.equal(out.status, 'DISCARDED')
  const after = await listOrgans({}, false)
  assert.equal(after.find((o) => o.id === target.id).status, 'DISCARDED')
  assert.equal(after.length, mockOrgans.length)
  await assert.rejects(discardOrgan(out, '1', false), (e) => e.code === 'INVALID_STATE_TRANSITION')
})

test('OrgansPage wiring: Discard action, modal, lookups, tooltip, refresh', () => {
  const src = readFileSync(new URL('../../src/pages/OrgansPage.jsx', import.meta.url), 'utf8')
  assert.match(src, /discardOrgan\(/)
  assert.match(src, /canDiscard\(o\)/)
  assert.match(src, /<FormModal/)
  assert.match(src, /getLookups\(\)/)
  assert.match(src, /discardReasonOptions\(reasons\)/)
  assert.match(src, /defaultDiscardReasonId\(/)
  assert.match(src, /DISCARD_BLOCKED_TOOLTIP/)
  assert.match(src, /disabled=\{blocked\}/)
  assert.match(src, /setReloadKey/)
  assert.match(src, /header: 'Actions'/)
  assert.match(src, /submitError/)
})
