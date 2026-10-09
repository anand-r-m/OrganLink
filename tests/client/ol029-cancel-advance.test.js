// OL-029 / OL-035: cancelled offers show no actions (UI only; the server still accepts Advance from
// CANCELLED, API_CONTRACT A4). Also: endpoint/ID wiring of the row actions and the Send/Cancel guard.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { singleFlight } from '../../src/utils/singleFlight.js'
import { adaptOffer } from '../../src/api/adapters/offers.js'
import { cancelOffer, advanceOffer, declineOffer } from '../../src/api/offers.js'
import { UI_ADVANCE_FROM, canAdvanceInUi, getAllowedTransitions } from '../../src/utils/offerTransitions.js'

const apiOffer = (id, status, extra = {}) => ({ id, status, organId: 3, recipientId: 9, matchRunId: 5, ...extra })

function stubFetch(handler) {
  const calls = []
  const prev = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET' })
    const body = handler(String(url))
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body, text: async () => JSON.stringify(body) }
  }
  return { calls, restore: () => { globalThis.fetch = prev } }
}

test('single-flight: a second call while one is in flight is ignored', async () => {
  let runs = 0
  let release
  const gate = new Promise((r) => { release = r })
  const act = singleFlight(async () => { runs += 1; await gate })
  const first = act()
  await act()
  await act()
  release()
  await first
  assert.equal(runs, 1)
  await act()
  assert.equal(runs, 2, 'allowed again once the first finished')
})

test('single-flight: releases after a failure', async () => {
  const act = singleFlight(async () => { throw new Error('boom') })
  await assert.rejects(act(), /boom/)
  await assert.rejects(act(), /boom/)
})

test('decline -> advance -> cancel uses the right endpoint and offer id each time', async () => {
  const { calls, restore } = stubFetch((url) => {
    if (url.endsWith('/offers/35/decline')) return apiOffer(35, 'DECLINED')
    if (url.endsWith('/offers/35/advance')) return { offer: apiOffer(36, 'CREATED'), skipped: [] }
    if (url.endsWith('/offers/36/cancel')) return apiOffer(36, 'CANCELLED')
    throw new Error(`unexpected ${url}`)
  })
  try {
    const declined = await declineOffer({ dbId: 35 }, { reason: '2' }, true)
    assert.equal(declined.status, 'DECLINED')
    const { offer: created } = await advanceOffer(declined)
    assert.equal(created.dbId, 36)
    assert.equal(created.status, 'CREATED')
    const cancelled = await cancelOffer(created, true)
    assert.equal(cancelled.status, 'CANCELLED')
    assert.deepEqual(calls.map((c) => `${c.method} ${c.url.replace(/^.*\/api/, '')}`), [
      'POST /offers/35/decline', 'POST /offers/35/advance', 'POST /offers/36/cancel',
    ])
  } finally { restore() }
})

test('OL-035: a CANCELLED offer exposes no action controls, in live and mock mode', () => {
  assert.deepEqual(getAllowedTransitions('CANCELLED'), [], 'no Send/Accept/Decline/Cancel')
  for (const live of [true, false]) {
    assert.equal(canAdvanceInUi({ status: 'CANCELLED', matchRunId: 5 }, live), false, `no Advance (live=${live})`)
  }
  assert.ok(!UI_ADVANCE_FROM.includes('CANCELLED'))
})

test('OL-035: Advance to Next stays for DECLINED, EXPIRED and VOIDED (live: only with a match run)', () => {
  for (const status of ['DECLINED', 'EXPIRED', 'VOIDED']) {
    assert.equal(canAdvanceInUi({ status, matchRunId: 5 }, true), true)
    assert.equal(canAdvanceInUi({ status, matchRunId: null }, true), false, 'live needs a run')
    assert.equal(canAdvanceInUi({ status, matchRunId: null }, false), true, 'mock has no runs')
  }
  for (const status of ['CREATED', 'SENT', 'ACCEPTED', 'CANCELLED']) {
    assert.equal(canAdvanceInUi({ status, matchRunId: 5 }, true), false)
  }
})

test('page: send and cancel handlers are single-flight, and only Cancel Offer calls cancelOffer', () => {
  const src = readFileSync('src/pages/OfferWorkflowPage.jsx', 'utf8')
  assert.match(src, /const handleCancelOffer = \(offer\) =>\s+guardRowAction/)
  assert.match(src, /const handleSendOffer = \(offer\) =>\s+guardRowAction/)
  assert.equal((src.match(/cancelOffer\(/g) ?? []).length, 1)
  assert.match(src, /label: 'Advance to Next'[\s\S]{0,200}handleAdvanceToNext\(offer\)/)
})

test('advanceOffer posts to /offers/:id/advance for the given offer, never /cancel', async () => {
  const { calls, restore } = stubFetch((url) => {
    if (url.endsWith('/offers/36/advance')) return { offer: apiOffer(37, 'CREATED'), skipped: [] }
    throw new Error(`unexpected ${url}`)
  })
  try {
    await advanceOffer(adaptOffer(apiOffer(36, 'DECLINED')))
    assert.deepEqual(calls, [{ url: '/api/offers/36/advance', method: 'POST' }])
    assert.ok(!calls.some((c) => c.url.includes('/cancel')))
  } finally { restore() }
})

test('page wiring: each action label is bound to its own handler (no shared or crossed handlers)', () => {
  const src = readFileSync('src/pages/OfferWorkflowPage.jsx', 'utf8')
  const actions = src.slice(src.indexOf('function getRowActions'), src.indexOf('/* --- Table columns'))
  const bound = {}
  for (const m of actions.matchAll(/label: '([^']+)'[\s\S]*?onClick: ([^\n]+)/g)) bound[m[1]] = m[2]
  assert.match(bound['Advance to Next'], /handleAdvanceToNext\(offer\)/)
  assert.match(bound['Cancel Offer'], /handleCancelOffer\(offer\)/)
  assert.match(bound['Send Offer'], /handleSendOffer\(offer\)/)
  assert.doesNotMatch(bound['Advance to Next'], /[Cc]ancel/)
  // Cancel/Send/Accept/Decline come from getAllowedTransitions; Advance from canAdvanceInUi (OL-035).
  assert.match(actions, /transitions\.includes\('CANCELLED'\)[\s\S]{0,60}label: 'Cancel Offer'/)
  assert.match(actions, /canAdvanceInUi\(offer, USE_LIVE_API\)[\s\S]{0,120}label: 'Advance to Next'/)
})

test('Advance rejected 422 RULE_VIOLATION (organ discarded): the server message reaches the caller verbatim', async () => {
  const prev = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: false, status: 422, headers: new Headers(),
    json: async () => ({ error: { code: 'RULE_VIOLATION', message: 'Organ 3 is not available (status DISCARDED)', details: {} } }),
  })
  try {
    await assert.rejects(advanceOffer({ dbId: 36 }), (e) => e.status === 422 && e.code === 'RULE_VIOLATION' && e.message === 'Organ 3 is not available (status DISCARDED)')
  } finally { globalThis.fetch = prev }
})
