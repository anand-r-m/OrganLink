// OL-022: waitlist adapters, priority breakdown, API module (both modes) and page wiring.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  formatWaitMonths, formatScore, priorityBreakdown, adaptWaitlistRow, adaptWaitlistRows,
  mockWaitlistRows, filterWaitlistRows, recipientStub, entryPatchBody, listingFormToBody,
  validateListingForm, EDITABLE_STATUSES, WAITLIST_STATUSES,
} from '../../src/api/adapters/waitlist.js'
import { adaptMockRecipient } from '../../src/api/adapters/recipients.js'
import { listWaitlist, addWaitlistEntry, updateWaitlistEntry } from '../../src/api/waitlist.js'
import { mockRecipients } from '../../src/data/mockRecipients.js'

const realFetch = globalThis.fetch
test.afterEach(() => {
  globalThis.fetch = realFetch
})
const stub = (payload, status = 200) => {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined })
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
  }
  return calls
}

const apiEntry = {
  recipientId: 118, recipientName: 'Priya Sharma', bloodGroup: 'A+', hospitalId: 2, hospitalName: 'Apollo Chennai',
  regionId: 1, organTypeId: 3, organType: 'Kidney', urgencyId: 1, urgencyCode: '1A', listedDate: '2025-01-10',
  status: 'ACTIVE', waitMonths: 14.4, urgencyScore: 100, waitScore: 66.12, priorityScore: 84.32,
}

test('formatWaitMonths: months under two years, years after, dash when unknown', () => {
  assert.equal(formatWaitMonths(14.4), '14 months')
  assert.equal(formatWaitMonths(1.2), '1 month')
  assert.equal(formatWaitMonths(0.3), '< 1 month')
  assert.equal(formatWaitMonths(30), '2.5 years')
  assert.equal(formatWaitMonths(null), '—')
  assert.equal(formatScore(84.3), '84.30')
  assert.equal(formatScore(undefined), '—')
})

test('priorityBreakdown returns exactly urgency and waiting time, no HLA or distance', () => {
  const row = adaptWaitlistRow(apiEntry)
  const items = priorityBreakdown(row)
  assert.equal(items.length, 2)
  assert.deepEqual(items.map((i) => i.key), ['urgency', 'waiting'])
  assert.deepEqual(items[0], { key: 'urgency', label: 'Urgency', detail: '1A', score: 100 })
  assert.equal(items[1].score, 66.12)
  assert.equal(items[1].detail, '14 months')
  const text = JSON.stringify(items).toLowerCase()
  for (const banned of ['hla', 'distance', 'size', 'match']) assert.ok(!text.includes(banned), banned)
})

test('adaptWaitlistRow: one table row per entry with display id and unrounded score', () => {
  const [row] = adaptWaitlistRows([apiEntry])
  assert.equal(row.id, 'R-0118')
  assert.equal(row.recipientDbId, 118)
  assert.equal(row.organType, 'Kidney')
  assert.equal(row.urgency, '1A')
  assert.equal(row.hospital, 'Apollo Chennai')
  assert.equal(row.priorityScore, 84.32)
  assert.equal(row.waitTime, '14 months')
  assert.equal(recipientStub(row).dbId, 118)
  assert.equal(recipientStub(row).hasDetail, false)
})

test('mock rows: one per entry, filters by organ, blood group, urgency and entry status', () => {
  const rows = mockWaitlistRows(mockRecipients.map(adaptMockRecipient))
  assert.equal(rows.length, mockRecipients.length)
  assert.equal(priorityBreakdown(rows[0]).length, 2)
  assert.equal(rows[0].urgencyScore, 100)
  const sample = rows[0]
  assert.ok(filterWaitlistRows(rows, { organ: sample.organType }).every((r) => r.organType === sample.organType))
  assert.ok(filterWaitlistRows(rows, { bloodGroup: sample.bloodGroup }).every((r) => r.bloodGroup === sample.bloodGroup))
  assert.ok(filterWaitlistRows(rows, { urgency: '1A' }).every((r) => r.urgency === '1A'))
  assert.equal(filterWaitlistRows(rows, { status: 'REMOVED' }).length, 0)
  assert.equal(filterWaitlistRows(rows, { status: 'ACTIVE' }).length, rows.length)
  assert.equal(filterWaitlistRows(rows, {}).length, rows.length)
})

test('entryPatchBody sends only changed fields; listing form maps to the POST body', () => {
  const entry = { urgencyId: 3, status: 'ACTIVE' }
  assert.deepEqual(entryPatchBody(entry, { urgencyId: '3', status: 'ACTIVE' }), {})
  assert.deepEqual(entryPatchBody(entry, { urgencyId: '1', status: 'ACTIVE' }), { urgencyId: 1 })
  assert.deepEqual(entryPatchBody(entry, { urgencyId: '3', status: 'SUSPENDED' }), { status: 'SUSPENDED' })
  assert.ok(!EDITABLE_STATUSES.includes('TRANSPLANTED'))
  assert.ok(WAITLIST_STATUSES.includes('TRANSPLANTED'))
  assert.deepEqual(listingFormToBody(118, { organTypeId: '5', urgencyId: '2', listedDate: null }), {
    recipientId: 118, organTypeId: 5, urgencyId: 2,
  })
  assert.equal(listingFormToBody(118, { organTypeId: '5', urgencyId: '2', listedDate: new Date(2026, 9, 4) }).listedDate, '2026-10-04')
  assert.deepEqual(Object.keys(validateListingForm({})), ['organTypeId', 'urgencyId'])
  assert.deepEqual(validateListingForm({ organTypeId: '1', urgencyId: '2' }), {})
})

test('API module, live: GET with filters, POST, PATCH', async () => {
  let calls = stub([apiEntry])
  const rows = await listWaitlist({ organ: '3', bloodGroup: 'A+', urgency: '1A', status: 'ACTIVE' }, true)
  assert.equal(rows[0].id, 'R-0118')
  assert.equal(calls[0].method, 'GET')
  assert.ok(calls[0].url.startsWith('/api/waitlist?'))
  for (const q of ['organ=3', 'bloodGroup=A%2B', 'urgency=1A', 'status=ACTIVE']) assert.ok(calls[0].url.includes(q), q)

  calls = stub(apiEntry, 201)
  await addWaitlistEntry({ recipientId: 118, organTypeId: 3, urgencyId: 1 }, true)
  assert.equal(calls[0].url, '/api/waitlist')
  assert.equal(calls[0].method, 'POST')
  assert.deepEqual(calls[0].body, { recipientId: 118, organTypeId: 3, urgencyId: 1 })

  calls = stub(apiEntry)
  await updateWaitlistEntry(118, 3, { urgencyId: 1 }, true)
  assert.equal(calls[0].url, '/api/waitlist/118/3')
  assert.equal(calls[0].method, 'PATCH')
})

test('API module, mock: list sorted by priority, writes refuse without live mode', async () => {
  const calls = stub([])
  const rows = await listWaitlist({}, false)
  assert.equal(calls.length, 0)
  assert.equal(rows.length, mockRecipients.length)
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].priorityScore >= rows[i].priorityScore)
  assert.equal((await listWaitlist({ urgency: '1A' }, false)).every((r) => r.urgency === '1A'), true)
  await assert.rejects(() => addWaitlistEntry({}, false), /live mode/)
  await assert.rejects(() => updateWaitlistEntry(1, 1, {}, false), /live mode/)
})

test('page wiring: waitlist view, tooltip helper, PATCH/POST actions, no HLA or distance in tooltip', () => {
  const page = readFileSync(new URL('../../src/pages/RecipientWaitlistPage.jsx', import.meta.url), 'utf8')
  assert.match(page, /listWaitlist\(filters\)/)
  assert.match(page, /SegmentedControl/)
  assert.match(page, /priorityBreakdown\(entry\)/)
  assert.match(page, /updateWaitlistEntry\(/)
  assert.match(page, /addWaitlistEntry\(/)
  assert.match(page, /TRANSPLANTED/)
  assert.doesNotMatch(page, /Policy Bonus|Urgency Weight|Wait Time Weight/)
  const tooltip = page.slice(page.indexOf('function PriorityScore'), page.indexOf('function WaitlistEntryEditor'))
  assert.doesNotMatch(tooltip, /hla|distance|match score/i)
  for (const f of ['organ', 'bloodGroup', 'urgency', 'status']) assert.match(page, new RegExp(`filters\\.${f}`))
})
