// OL-021: recipient adapters, form helpers, API module (both modes, stubbed fetch) and page wiring.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { adaptRecipient, adaptMockRecipient, filterRecipients } from '../../src/api/adapters/recipients.js'
import {
  emptyRecipientForm, addWaitlistRow, removeWaitlistRow, setWaitlistRow, recipientToForm,
  validateRecipientForm, formToRecipientBody, serverErrorToForm, formToMockRecipient,
} from '../../src/api/adapters/recipientForm.js'
import { listRecipients, getRecipient, createRecipient, updateRecipient } from '../../src/api/recipients.js'
import { mockRecipients } from '../../src/data/mockRecipients.js'
import { ApiError } from '../../src/api/client.js'

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

const apiRecipient = {
  id: 118, name: 'Priya Sharma', dateOfBirth: '1990-06-02', bloodGroupId: 4, bloodGroup: 'A+',
  hospitalId: 2, hospitalName: 'Apollo Chennai', regionCode: 'SR', status: 'ACTIVE',
  heightCm: 162, weightKg: 58, waitlistCount: 2, hasOpenOffer: true,
  hla: [{ id: 2, locus: 'A', alleleName: 'A*02:01' }, { id: 9, locus: 'B', alleleName: 'B*44:02' }],
  waitlist: [
    { organTypeId: 4, organType: 'Kidney', urgencyId: 1, urgencyCode: '1A', listedDate: '2025-08-01', status: 'ACTIVE', waitMonths: 14.123, priorityScore: 84.3201 },
    { organTypeId: 2, organType: 'Liver', urgencyId: 2, urgencyCode: '1B', listedDate: '2026-01-01', status: 'SUSPENDED', waitMonths: 9, priorityScore: 51 },
  ],
}

const valid = () => ({
  ...emptyRecipientForm(),
  name: 'Neha Kulkarni',
  dob: new Date(1979, 8, 30),
  bloodGroup: '1',
  hospital: '4',
  height: 158,
  weight: 55,
  hla: { A: ['1'], B: ['7', '8'], DRB1: [] },
  waitlist: [{ organType: '3', urgency: '1', listedDate: new Date(2026, 0, 10) }],
})
const NOW = new Date(2026, 9, 4).getTime()

test('adaptRecipient: display id, every waitlist entry, HLA by locus, open offer', () => {
  const r = adaptRecipient(apiRecipient)
  assert.equal(r.id, 'R-0118')
  assert.equal(r.dbId, 118)
  assert.equal(r.hasOpenOffer, true)
  assert.equal(r.waitlist.length, 2)
  assert.equal(r.waitlist[0].priorityScore, 84.3201, 'priority score is not rounded')
  assert.equal(r.waitlist[1].status, 'SUSPENDED')
  assert.equal(r.organsLabel, 'Kidney, Liver')
  assert.deepEqual(r.hlaByLocus.A, ['A*02:01'])
  assert.deepEqual(r.hlaIdsByLocus.B, [9])
  assert.equal(r.hasDetail, true)
  assert.equal(r.urgency, null)
})

test('adaptRecipient: list items have a count but no waitlist detail', () => {
  const { waitlist: _w, ...listItem } = apiRecipient
  const r = adaptRecipient(listItem)
  assert.equal(r.waitlistCount, 2)
  assert.equal(r.organsLabel, '2')
  assert.equal(r.hasDetail, false)
  assert.deepEqual(r.waitlist, [])
})

test('adaptMockRecipient keeps the mock columns and builds the single-entry drawer data', () => {
  const rows = mockRecipients.map(adaptMockRecipient)
  assert.equal(rows.length, mockRecipients.length)
  const m = rows[0]
  assert.equal(m.id, mockRecipients[0].id)
  assert.equal(m.urgency, mockRecipients[0].urgency)
  assert.equal(m.priorityScore, mockRecipients[0].priorityScore)
  assert.equal(m.waitlist.length, 1)
  assert.equal(m.waitlist[0].organType, mockRecipients[0].organNeeded)
  assert.equal(m.waitlist[0].priorityScore, mockRecipients[0].priorityScore)
  assert.ok(['ACTIVE', 'INACTIVE', 'TRANSPLANTED', 'DECEASED'].includes(m.status))
})

test('validateRecipientForm: valid form passes; required fields flagged; waitlist rules', () => {
  assert.deepEqual(validateRecipientForm(valid(), 'create', NOW), {})
  const e = validateRecipientForm(emptyRecipientForm(), 'create', NOW)
  for (const k of ['name', 'dob', 'bloodGroup', 'hospital', 'height', 'weight', 'waitlist']) assert.ok(e[k], k)
  assert.ok(validateRecipientForm({ ...valid(), dob: new Date(2030, 0, 1) }, 'create', NOW).dob)
  assert.ok(validateRecipientForm({ ...valid(), height: 50 }, 'create', NOW).height)
  assert.ok(validateRecipientForm({ ...valid(), weight: 500 }, 'create', NOW).weight)
  assert.ok(validateRecipientForm({ ...valid(), hla: { A: ['1', '2', '3'], B: [], DRB1: [] } }, 'create', NOW).hlaA)
  assert.ok(validateRecipientForm({ ...valid(), waitlist: [] }, 'create', NOW).waitlist)
  assert.ok(validateRecipientForm({ ...valid(), waitlist: [{ organType: '3', urgency: null, listedDate: null }] }, 'create', NOW).waitlist)
})

test('validateRecipientForm: edit mode ignores the waitlist and checks status', () => {
  assert.deepEqual(validateRecipientForm({ ...valid(), waitlist: [] }, 'edit', NOW), {})
  assert.ok(validateRecipientForm({ ...valid(), status: 'WAITING' }, 'edit', NOW).status)
})

test('waitlist row helpers add, edit and remove rows immutably', () => {
  const f = emptyRecipientForm()
  assert.equal(f.waitlist.length, 1)
  const two = addWaitlistRow(f)
  assert.equal(two.waitlist.length, 2)
  assert.equal(f.waitlist.length, 1)
  const set = setWaitlistRow(two, 1, { organType: '5' })
  assert.equal(set.waitlist[1].organType, '5')
  assert.equal(set.waitlist[0].organType, null)
  assert.equal(removeWaitlistRow(set, 0).waitlist.length, 1)
})

test('formToRecipientBody: create sends the waitlist and no status; edit sends status and no waitlist', () => {
  const create = formToRecipientBody(valid(), 'create')
  assert.deepEqual(create, {
    name: 'Neha Kulkarni', dateOfBirth: '1979-09-30', bloodGroupId: 1, hospitalId: 4,
    heightCm: 158, weightKg: 55, hlaAlleleIds: [1, 7, 8],
    waitlist: [{ organTypeId: 3, urgencyId: 1, listedDate: '2026-01-10' }],
  })
  const noDate = formToRecipientBody({ ...valid(), waitlist: [{ organType: '3', urgency: '2', listedDate: null }] }, 'create')
  assert.deepEqual(noDate.waitlist, [{ organTypeId: 3, urgencyId: 2 }], 'listedDate is omitted so the DB default applies')
  const edit = formToRecipientBody({ ...valid(), status: 'INACTIVE' }, 'edit')
  assert.equal(edit.status, 'INACTIVE')
  assert.equal('waitlist' in edit, false)
})

test('recipientToForm prefills live (ids) and mock (names) forms', () => {
  const live = recipientToForm(adaptRecipient(apiRecipient), { live: true })
  assert.equal(live.bloodGroup, '4')
  assert.equal(live.hospital, '2')
  assert.deepEqual(live.hla.A, ['2'])
  assert.equal(live.status, 'ACTIVE')
  assert.equal(live.dob.getFullYear(), 1990)
  const mock = recipientToForm(adaptMockRecipient(mockRecipients[0]), { live: false, now: NOW })
  assert.equal(mock.bloodGroup, mockRecipients[0].bloodGroup)
  assert.equal(mock.hospital, mockRecipients[0].hospital)
  assert.deepEqual(mock.hla.A, [mockRecipients[0].hlaA])
})

test('serverErrorToForm shows the server message and maps fields and constraints', () => {
  const m = serverErrorToForm(new ApiError(400, 'CONSTRAINT_VIOLATION', 'Listing date cannot be in the future', { constraint: 'ck_waitlist_not_future' }))
  assert.equal(m.message, 'Listing date cannot be in the future')
  assert.equal(m.fields.waitlist, m.message)
  const v = serverErrorToForm(new ApiError(400, 'VALIDATION_ERROR', 'Invalid: heightCm', { fields: ['heightCm', 'waitlist[0].organTypeId'] }))
  assert.equal(v.fields.height, 'Invalid: heightCm')
  assert.equal(v.fields.waitlist, 'Invalid: heightCm')
  assert.equal(serverErrorToForm(new ApiError(409, 'DUPLICATE', 'dup', {})).fields.waitlist, 'dup')
})

test('formToMockRecipient builds the one-organ mock shape from the first waitlist row', () => {
  const m = formToMockRecipient(
    { ...valid(), bloodGroup: 'A+', hospital: 'Apollo Chennai', waitlist: [{ organType: 'Kidney', urgency: '1A' }] },
    { id: 'RCP-401-X' },
  )
  assert.equal(m.organNeeded, 'Kidney')
  assert.equal(m.urgency, '1A')
  assert.equal(m.hlaA, '1')
})

test('listRecipients (mock) filters organ, bloodGroup, urgency and status client-side', async () => {
  const all = await listRecipients({}, false)
  assert.equal(all.length, mockRecipients.length)
  const kidney = await listRecipients({ organ: 'Kidney' }, false)
  assert.ok(kidney.length > 0 && kidney.every((r) => r.waitlist[0].organType === 'Kidney'))
  const bg = await listRecipients({ bloodGroup: 'A+' }, false)
  assert.ok(bg.length > 0 && bg.every((r) => r.bloodGroup === 'A+'))
  const urg = await listRecipients({ urgency: '1A' }, false)
  assert.ok(urg.every((r) => r.urgency === '1A'))
  const st = await listRecipients({ status: 'DECEASED' }, false)
  assert.equal(st.length, 0)
})

test('filterRecipients: a locally added row survives setting and clearing filters', () => {
  const session = mockRecipients.map(adaptMockRecipient)
  const added = adaptMockRecipient({ ...mockRecipients[0], id: 'RCP-999-Z', name: 'Added Locally', organNeeded: 'Pancreas', urgency: '2', bloodGroup: 'AB-' })
  session.unshift(added)
  const filtered = filterRecipients(session, { organ: 'Pancreas', bloodGroup: 'AB-' })
  assert.deepEqual(filtered.map((r) => r.id), ['RCP-999-Z'])
  assert.equal(filterRecipients(session, { urgency: '1A' }).includes(added), false)
  const cleared = filterRecipients(session, {})
  assert.equal(cleared.length, mockRecipients.length + 1)
  assert.ok(cleared.includes(added))
  const edited = session.map((r) => (r === added ? { ...r, status: 'INACTIVE' } : r))
  assert.equal(filterRecipients(edited, { status: 'INACTIVE' }).some((r) => r.id === 'RCP-999-Z'), true)
})

test('page wiring: mock mode filters the session list in memory', () => {
  const src = readFileSync(new URL('../../src/pages/RecipientWaitlistPage.jsx', import.meta.url), 'utf8')
  assert.match(src, /filterRecipients\(recipients, filters\)/)
  assert.match(src, /listRecipients\(USE_LIVE_API \? filters : \{\}\)/)
})

test('listRecipients (live) sends filters as query params and adapts rows', async () => {
  const { waitlist: _w, ...item } = apiRecipient
  const calls = stub([item])
  const rows = await listRecipients({ organ: '4', bloodGroup: 'A+', urgency: '1A', status: 'ACTIVE' }, true)
  assert.equal(calls[0].method, 'GET')
  assert.match(calls[0].url, /\/recipients\?/)
  assert.match(calls[0].url, /bloodGroup=A%2B/)
  assert.match(calls[0].url, /organ=4/)
  assert.match(calls[0].url, /urgency=1A/)
  assert.match(calls[0].url, /status=ACTIVE/)
  assert.equal(rows[0].id, 'R-0118')
})

test('getRecipient / createRecipient / updateRecipient (live) call the right endpoints', async () => {
  let calls = stub(apiRecipient)
  const row = adaptRecipient(apiRecipient)
  assert.equal((await getRecipient(row, true)).waitlist.length, 2)
  assert.match(calls[0].url, /\/recipients\/118$/)

  calls = stub(apiRecipient, 201)
  await createRecipient({ name: 'x' }, true)
  assert.equal(calls[0].method, 'POST')
  assert.deepEqual(calls[0].body, { name: 'x' })

  calls = stub(apiRecipient)
  await updateRecipient(row, { status: 'INACTIVE' }, true)
  assert.equal(calls[0].method, 'PATCH')
  assert.match(calls[0].url, /\/recipients\/118$/)
  assert.deepEqual(calls[0].body, { status: 'INACTIVE' })
})

test('mock mode: get returns the row; create and update refuse (the page handles them locally)', async () => {
  const row = adaptMockRecipient(mockRecipients[0])
  assert.equal(await getRecipient(row, false), row)
  await assert.rejects(createRecipient({}, false))
  await assert.rejects(updateRecipient(row, {}, false))
})

test('live create surfaces the server error as an ApiError', async () => {
  stub({ error: { code: 'DUPLICATE', message: 'already listed', details: {} } }, 409)
  await assert.rejects(createRecipient({}, true), (e) => e.code === 'DUPLICATE' && e.message === 'already listed')
})

test('page wiring: API-backed list, filters, drawer with every entry, both form modes', () => {
  const src = readFileSync(new URL('../../src/pages/RecipientWaitlistPage.jsx', import.meta.url), 'utf8')
  assert.match(src, /listRecipients\(USE_LIVE_API/)
  assert.match(src, /USE_LIVE_API \? filters : null/, 'live list re-queries when a filter changes')
  assert.match(src, /getRecipient\(row\)/)
  assert.match(src, /selected\.waitlist\.map/, 'drawer lists every waitlist entry')
  assert.match(src, /Waitlist Entries/)
  assert.match(src, /createRecipient\(body\)/)
  assert.match(src, /updateRecipient\(editing, body\)/)
  assert.match(src, /serverErrorToForm/)
  assert.match(src, /validateRecipientForm\(form, editing \? 'edit' : 'create'\)/)
  assert.match(src, /title=\{editing \? 'Edit Recipient' : 'Add Recipient'\}/)
  assert.match(src, /addWaitlistRow/)
  assert.match(src, /removeWaitlistRow/)
  assert.match(src, /maxValues=\{MAX_ALLELES_PER_LOCUS\}/)
  assert.match(src, /\{editing && \(\s*<Select\s+label="Status"/, 'status select only in edit mode')
  assert.doesNotMatch(src, /useState\(mockRecipients\)/)
  // OL-022: waitlist calls go through src/api/waitlist.js, never a raw fetch from the page.
  assert.doesNotMatch(src, /fetch\(/)
})
