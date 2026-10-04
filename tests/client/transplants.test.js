// Record Transplant: API layer, adapter additions and the page's disabled rule.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { recordTransplant } from '../../src/api/transplants.js'
import { resetMockOffers } from '../../src/api/offers.js'
import { adaptOffer, canRecordTransplant, TRANSPLANT_DISABLED_TIP } from '../../src/api/adapters/offers.js'
import { getStatusVariant } from '../../src/utils/status.js'

const realFetch = globalThis.fetch
test.afterEach(() => {
  globalThis.fetch = realFetch
  resetMockOffers()
})

const apiOffer = (over = {}) => ({
  id: 12, organId: 7, organType: 'Heart', donorId: 42, recipientId: 118, recipientName: 'Priya Sharma',
  status: 'ACCEPTED', createdAt: '2026-10-04T09:15:00.000Z', sentAt: null, respondedAt: null, offerExpiresAt: null,
  declineReasonCode: null, voidReason: null, notes: null, matchRunId: 42, rank: 1,
  transport: { id: 3, status: 'DELIVERED' }, transplant: null, ...over,
})

test('adaptOffer carries transport and the adapted transplant', () => {
  const row = adaptOffer(apiOffer({ transplant: { id: 5, offerId: 12, hospitalId: 2, hospitalName: 'Apollo', transplantAt: '2026-10-04T13:00:00.000Z', outcome: 'SUCCESS', notes: null } }))
  assert.deepEqual(row.transport, { id: 3, status: 'DELIVERED' })
  assert.equal(row.transplant.outcome, 'SUCCESS')
  assert.equal(row.transplant.hospitalName, 'Apollo')
  assert.equal(adaptOffer(apiOffer({ transport: null, transplant: null })).transplant, null)
})

test('canRecordTransplant needs ACCEPTED, DELIVERED transport and no transplant yet', () => {
  assert.equal(canRecordTransplant(adaptOffer(apiOffer())), true)
  for (const status of ['PENDING', 'IN_TRANSIT', 'FAILED']) {
    assert.equal(canRecordTransplant(adaptOffer(apiOffer({ transport: { id: 3, status } }))), false, status)
  }
  assert.equal(canRecordTransplant(adaptOffer(apiOffer({ transport: null }))), false)
  assert.equal(canRecordTransplant(adaptOffer(apiOffer({ status: 'DECLINED' }))), false)
  assert.equal(canRecordTransplant(adaptOffer(apiOffer({ transplant: { id: 1, outcome: 'FAILED' } }))), false)
  assert.equal(TRANSPLANT_DISABLED_TIP, 'Organ has not been delivered yet')
})

test('live recordTransplant posts the contract body and adapts the response', async () => {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init.method, body: JSON.parse(init.body) })
    return { ok: true, status: 201, json: async () => ({ id: 5, offerId: 12, hospitalId: 2, hospitalName: 'Apollo', transplantAt: '2026-10-04T13:00:00.000Z', outcome: 'FAILED', notes: 'x' }) }
  }
  const t = await recordTransplant(adaptOffer(apiOffer()), { outcome: 'FAILED', transplantAt: '2026-10-04T13:00:00.000Z', notes: 'x' }, true)
  assert.deepEqual(calls, [{ url: '/api/transplants', method: 'POST', body: { offerId: 12, outcome: 'FAILED', transplantAt: '2026-10-04T13:00:00.000Z', notes: 'x' } }])
  assert.equal(t.outcome, 'FAILED')
  assert.equal(t.hospitalName, 'Apollo')
})

test('live recordTransplant surfaces 422 and 409 as ApiError', async () => {
  for (const [status, code] of [[422, 'RULE_VIOLATION'], [409, 'TRANSPLANT_ALREADY_RECORDED']]) {
    globalThis.fetch = async () => ({ ok: false, status, json: async () => ({ error: { code, message: 'm', details: {} } }) })
    await assert.rejects(recordTransplant(adaptOffer(apiOffer()), { outcome: 'SUCCESS' }, true), (e) => e.status === status && e.code === code)
  }
})

test('mock recordTransplant mirrors the delivery rule', async () => {
  await assert.rejects(recordTransplant(adaptOffer(apiOffer({ transport: { id: 3, status: 'PENDING' } })), { outcome: 'SUCCESS' }, false), (e) => e.status === 422 && e.code === 'RULE_VIOLATION')
  const t = await recordTransplant(adaptOffer(apiOffer()), { outcome: 'SUCCESS', notes: '' }, false)
  assert.equal(t.outcome, 'SUCCESS')
  assert.equal(t.notes, null)
})

test('SUCCESS outcome renders green', () => {
  assert.equal(getStatusVariant('SUCCESS'), 'success')
  assert.equal(getStatusVariant('FAILED'), 'danger')
})

test('page wires the Record Transplant action, disabled tooltip and modal', () => {
  const src = readFileSync(new URL('../../src/pages/OfferWorkflowPage.jsx', import.meta.url), 'utf8')
  for (const needle of ["label: 'Record Transplant'", 'disabled: !ready', 'TRANSPLANT_DISABLED_TIP', 'title="Record Transplant"', "header: 'Transplant'"]) {
    assert.ok(src.includes(needle), needle)
  }
})
