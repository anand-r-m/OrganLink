// Organs API layer + nav: no DB or browser needed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { listOrgans } from '../../src/api/organs.js'
import { adaptMockOrgan, adaptOrganRow } from '../../src/api/adapters/organs.js'
import { mockOrgans } from '../../src/data/mockOrgans.js'
import { readFileSync } from 'node:fs'

const realFetch = globalThis.fetch
test.afterEach(() => {
  globalThis.fetch = realFetch
})

const apiOrgan = {
  id: 7, donorId: 42, donorName: 'Rajesh Kumar', donorBloodGroup: 'A+', organTypeId: 1, organType: 'Heart',
  recoveringHospitalId: 1, recoveringHospitalName: 'AIIMS New Delhi', regionCode: 'NR',
  recoveredAt: '2026-10-04T08:00:00.000Z', maxViabilityHours: 6, expiresAt: '2026-10-04T14:00:00.000Z',
  hoursRemaining: 4.5, isExpired: false, status: 'AVAILABLE', hasActiveOffer: true, activeOfferId: 3,
}

test('adaptOrganRow formats display ids and derives elapsed hours', () => {
  const r = adaptOrganRow(apiOrgan)
  assert.equal(r.id, 'O-0007')
  assert.equal(r.donor, 'D-0042')
  assert.equal(r.bloodGroup, 'A+')
  assert.equal(r.hospital, 'AIIMS New Delhi')
  assert.equal(r.elapsedHours, 1.5)
  assert.equal(r.hasActiveOffer, true)
  assert.equal(adaptOrganRow({ ...apiOrgan, hoursRemaining: 0, isExpired: true, status: 'EXPIRED' }).elapsedHours, 6)
})

test('mock mode uses mockOrgans, with upper-case statuses; expired stays listed', async () => {
  const rows = await listOrgans({}, false)
  assert.equal(rows.length, mockOrgans.length)
  assert.ok(rows.some((r) => r.status === 'EXPIRED' && r.isExpired))
  // Mock mode now reports open offers from the mock offer store (OL-015); everything else is unchanged.
  assert.deepEqual({ ...rows[0], hasActiveOffer: false }, adaptMockOrgan(mockOrgans[0]))
  const avail = await listOrgans({ available: true }, false)
  assert.ok(avail.length > 0 && avail.every((r) => r.status === 'AVAILABLE'))
})

test('live mode calls GET /api/organs with ?available=true and adapts rows', async () => {
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(url)
    return { status: 200, ok: true, json: async () => [apiOrgan] }
  }
  const rows = await listOrgans({ available: true, organTypeId: 1 }, true)
  assert.equal(calls[0], '/api/organs?available=true&organTypeId=1')
  assert.equal(rows[0].id, 'O-0007')
})

test('nav shows Organs between Recipient Waitlist and Matching Console, and /organs is routed', () => {
  const shell = readFileSync(new URL('../../src/components/AppShell.jsx', import.meta.url), 'utf8')
  const labels = [...shell.matchAll(/label: '([^']+)'/g)].map((m) => m[1])
  const i = labels.indexOf('Organs')
  assert.ok(i > 0)
  assert.equal(labels[i - 1], 'Recipient Waitlist')
  assert.equal(labels[i + 1], 'Matching Console')
  assert.match(readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8'), /path="\/organs"/)
})
