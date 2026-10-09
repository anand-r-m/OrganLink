// OL-029 browser-QA defects: Waitlist Select crash, Procure modal stacking, Record Accept details.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { MantineProvider, Select } from '@mantine/core'
import { recipientLookupOptions, optionLabels } from '../../src/api/adapters/recipientForm.js'
import { acceptDetailFromLive } from '../../src/api/adapters/offers.js'

// Shape of GET /api/lookups (API_CONTRACT): organTypes / hlaAlleles are full objects.
const lookups = {
  bloodGroups: [{ id: 1, name: 'O-' }, { id: 2, name: 'A+' }],
  urgencies: [{ id: 1, code: '1A', description: 'Critical', scoreValue: 100 }, { id: 2, code: '1B', description: 'High', scoreValue: 70 }],
  organTypes: [{ id: 1, code: 'HEART', name: 'Heart' }, { id: 4, code: 'KIDNEY', name: 'Kidney' }],
  declineReasons: [], discardReasons: [], exclusionReasons: [], hlaAlleles: [],
}
const render = (data) =>
  renderToString(h(MantineProvider, null, h(Select, { placeholder: 'Blood Group', data })))

test('Waitlist: lookups become Select options with string ids and names', () => {
  const o = recipientLookupOptions(lookups)
  assert.deepEqual(o.bloods, [{ value: '1', label: 'O-' }, { value: '2', label: 'A+' }])
  assert.deepEqual(o.urgencies.map((u) => u.label), ['1A', '1B'])
  assert.deepEqual(o.organs, [{ value: '1', label: 'Heart' }, { value: '4', label: 'Kidney' }])
  assert.doesNotThrow(() => render(optionLabels(o.bloods)))
})

test('Waitlist: root cause - the old live initial state produced undefined Select entries', () => {
  // Before the fix, live mode started with plain strings and called .map((o) => o.label).
  const old = ['A+', 'B+'].map((o) => o.label)
  assert.deepEqual(old, [undefined, undefined])
  assert.throws(() => render(old), /'in' operator/)
})

test('Waitlist: optionLabels tolerates strings and objects and never yields undefined', () => {
  assert.deepEqual(optionLabels(['A+', { value: '2', label: 'B+' }, { value: '3' }, undefined].filter(Boolean)), ['A+', 'B+'])
  assert.deepEqual(optionLabels([]), [])
  assert.doesNotThrow(() => render(optionLabels([])))
})

test('Waitlist: malformed lookups throw a clear error instead of reaching Select', () => {
  assert.throws(() => recipientLookupOptions({}), /missing "organTypes"/)
  assert.throws(() => recipientLookupOptions({ ...lookups, bloodGroups: undefined }), /missing "bloodGroups"/)
  assert.throws(() => recipientLookupOptions(null), /missing/)
})

test('Waitlist page: live mode starts with empty lists (loading/error state), not mock strings', () => {
  const src = readFileSync('src/pages/RecipientWaitlistPage.jsx', 'utf8')
  assert.match(src, /useState\(USE_LIVE_API \? \[\] : BLOOD_GROUPS\)/)
  assert.match(src, /useState\(USE_LIVE_API \? \[\] : URGENCY_LEVELS\)/)
  assert.match(src, /useState\(USE_LIVE_API \? \[\] : ORGAN_TYPES\)/)
  assert.match(src, /optionLabels\(bloodOptions\)/)
  assert.doesNotMatch(src, /bloodOptions\.map\(\(o\) => o\.label\)/)
  assert.match(src, /Could not load reference lists/) // error state is surfaced, not swallowed
})

test('Procure Organ modal sits above the Donor Profile drawer (both default to z-index 200)', () => {
  const src = readFileSync('src/pages/DonorRegistryPage.jsx', 'utf8')
  const modal = src.slice(src.indexOf('title="Procure Organ"'), src.indexOf('{/* Detail Drawer */}'))
  assert.match(modal, /zIndex=\{250\}/) // above drawer 200, below Select/DateTimePicker dropdowns 300
  assert.match(src, /function openProcureModal\(\)/)
  assert.doesNotMatch(src.slice(src.indexOf('function openProcureModal'), src.indexOf('async function handleProcure')), /drawerHandlers\.close/)
})

// Live rows after the adapters: organ list row and recipient detail row.
const offer = { organDbId: 7, organType: 'Kidney', recipientName: 'Arjun Mehta' }
const organRows = [{ dbId: 6, bloodGroup: 'B+', hospital: 'X' }, { dbId: 7, bloodGroup: 'O-', hospital: 'Apollo Chennai' }]
const recipient = {
  name: 'Arjun Mehta', bloodGroup: 'A+', hospital: 'AIIMS New Delhi',
  waitlist: [{ organType: 'Heart', urgency: '2' }, { organType: 'Kidney', urgency: '1A' }],
}

test('Record Accept: live details come from the organ row and recipient entry for this organ type', () => {
  const d = acceptDetailFromLive(offer, organRows, recipient)
  assert.deepEqual(d.organ, { bloodGroup: 'O-', hospital: 'Apollo Chennai' })
  assert.deepEqual(d.recipient, { name: 'Arjun Mehta', bloodGroup: 'A+', hospital: 'AIIMS New Delhi', urgency: '1A' })
})

test('Record Accept: missing source data stays null (never fabricated or taken from mock data)', () => {
  const none = acceptDetailFromLive(offer, [], null)
  assert.equal(none.organ, null)
  assert.equal(none.recipient, null)
  const noEntry = acceptDetailFromLive(offer, organRows, { ...recipient, waitlist: [] })
  assert.equal(noEntry.recipient.urgency, null)
})

test('Record Accept page: live mode no longer matches display ids against mock lists', () => {
  const src = readFileSync('src/pages/OfferWorkflowPage.jsx', 'utf8')
  assert.match(src, /USE_LIVE_API \? liveAccept\.organ : mockAcceptOrgan/)
  assert.match(src, /listOrgans\(\), getRecipient\(/)
})
