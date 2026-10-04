// Offers API layer, adapter and page wiring: no DB or browser needed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cancelOffer, createOffer, hasActiveMockOffer, listOffers, resetMockOffers, sendOffer } from '../../src/api/offers.js'
import { adaptOffer } from '../../src/api/adapters/offers.js'
import { listOrgans } from '../../src/api/organs.js'
import { getStatusVariant } from '../../src/utils/status.js'

const realFetch = globalThis.fetch
test.afterEach(() => {
  globalThis.fetch = realFetch
  resetMockOffers()
})

const apiOffer = {
  id: 12, organId: 7, organType: 'Heart', donorId: 42, recipientId: 118, recipientName: 'Priya Sharma',
  recipientHospitalName: 'Apollo Chennai', matchRunId: 42, rank: 1, status: 'SENT',
  createdAt: '2026-10-04T09:15:00.000Z', sentAt: '2026-10-04T09:16:00.000Z', respondedAt: null,
  responseWindowHours: 1, offerExpiresAt: '2026-10-04T10:16:00.000Z', declineReasonId: null,
  declineReasonCode: null, voidReason: null, notes: null, createdBy: 1, transport: null, transplant: null,
}

const mockFetch = (body, status = 200, calls = []) => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return { ok: status < 400, status, json: async () => body }
  }
  return calls
}

test('adaptOffer makes display ids and keeps UPPER status and deadline', () => {
  const o = adaptOffer(apiOffer)
  assert.equal(o.id, 'OF-0012')
  assert.equal(o.dbId, 12)
  assert.equal(o.organId, 'O-0007')
  assert.equal(o.donorId, 'D-0042')
  assert.equal(o.recipientId, 'R-0118')
  assert.equal(o.recipientDbId, 118)
  assert.equal(o.status, 'SENT')
  assert.equal(o.sentAt, apiOffer.sentAt)
  assert.equal(o.offerExpiresAt, apiOffer.offerExpiresAt)
  assert.equal(adaptOffer({ ...apiOffer, status: 'DECLINED', declineReasonCode: 'ORGAN_QUALITY' }).response, 'ORGAN_QUALITY')
  assert.equal(adaptOffer({ ...apiOffer, status: 'VOIDED', voidReason: 'Organ viability window elapsed' }).response, 'Organ viability window elapsed')
})

test('live listOffers passes the status filter and adapts rows', async () => {
  const calls = mockFetch([apiOffer])
  const rows = await listOffers({ status: 'CREATED,SENT' }, true)
  assert.equal(calls[0].url, '/api/offers?status=CREATED%2CSENT')
  assert.equal(rows[0].id, 'OF-0012')
})

test('live createOffer POSTs organId, recipientId and matchRunId', async () => {
  const calls = mockFetch({ ...apiOffer, status: 'CREATED' }, 201)
  const o = await createOffer({ organ: { dbId: 7 }, candidate: { recipientDbId: 118 }, run: { dbId: 42 } }, true)
  assert.equal(calls[0].url, '/api/offers')
  assert.equal(calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].init.body), { organId: 7, recipientId: 118, matchRunId: 42 })
  assert.equal(o.status, 'CREATED')
})

test('live send and cancel POST to the sub-paths', async () => {
  let calls = mockFetch(apiOffer)
  await sendOffer({ dbId: 12 }, true)
  assert.equal(calls[0].url, '/api/offers/12/send')
  assert.equal(calls[0].init.method, 'POST')
  calls = mockFetch({ ...apiOffer, status: 'CANCELLED' })
  assert.equal((await cancelOffer({ dbId: 12 }, true)).status, 'CANCELLED')
  assert.equal(calls[0].url, '/api/offers/12/cancel')
})

test('live 409 surfaces the server code and message', async () => {
  mockFetch({ error: { code: 'ACTIVE_OFFER_EXISTS', message: 'This organ already has an active offer', details: {} } }, 409)
  await assert.rejects(
    createOffer({ organ: { dbId: 7 }, candidate: { recipientDbId: 118 }, run: { dbId: 42 } }, true),
    (e) => e.status === 409 && e.code === 'ACTIVE_OFFER_EXISTS' && e.message === 'This organ already has an active offer',
  )
})

test('mock mode: create, one-active rule, send, cancel, then create again', async () => {
  const organ = { id: 'K-9999', organType: 'Kidney', donor: 'DNR-1' }
  const run = { dbId: 3 }
  const cand = (n) => ({ recipient: `RCP-${n}`, rank: n })
  assert.equal(hasActiveMockOffer('K-9999'), false)
  const o = await createOffer({ organ, candidate: cand(1), run }, false)
  assert.equal(o.status, 'CREATED')
  assert.equal(hasActiveMockOffer('K-9999'), true)
  assert.equal((await listOrgans({}, false)).find((x) => x.id === 'K-0912').hasActiveOffer, true) // seeded SENT offer
  await assert.rejects(createOffer({ organ, candidate: cand(2), run }, false), (e) => e.code === 'ACTIVE_OFFER_EXISTS')
  const sent = await sendOffer(o, false)
  assert.equal(sent.status, 'SENT')
  assert.ok(sent.sentAt)
  await assert.rejects(async () => sendOffer(sent, false), /Invalid offer transition/)
  assert.equal((await cancelOffer(sent, false)).status, 'CANCELLED')
  assert.equal(hasActiveMockOffer('K-9999'), false)
  assert.equal((await listOffers({ status: 'CANCELLED' }, false)).length, 1)
  assert.equal((await createOffer({ organ, candidate: cand(2), run }, false)).status, 'CREATED')
})

test('badge colours: CREATED blue, SENT amber, CANCELLED and VOIDED grey', () => {
  assert.equal(getStatusVariant('CREATED'), 'info')
  assert.equal(getStatusVariant('SENT'), 'warning')
  assert.equal(getStatusVariant('CANCELLED'), 'muted')
  assert.equal(getStatusVariant('VOIDED'), 'muted')
})

test('console wiring: Create Offer on every card, tooltip text, no navigation', () => {
  const src = readFileSync(new URL('../../src/pages/MatchingConsolePage.jsx', import.meta.url), 'utf8')
  assert.match(src, /This organ already has an active offer/)
  assert.match(src, /selectedOrgan\?\.hasActiveOffer/)
  assert.doesNotMatch(src, /rank === 1 \? \(\s*<Button/)
  assert.doesNotMatch(src, /navigate\(/)
})

test('offers page wiring: loads from the API layer, Send and Cancel use it', () => {
  const src = readFileSync(new URL('../../src/pages/OfferWorkflowPage.jsx', import.meta.url), 'utf8')
  assert.match(src, /listOffers\(\)/)
  assert.match(src, /await sendOffer\(offer\)/)
  assert.match(src, /await cancelOffer\(offer\)/)
  assert.match(src, /Response Deadline/)
  assert.doesNotMatch(src, /import \{ mockOffers \}/)
})
