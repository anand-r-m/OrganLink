// Frontend API layer: client wrapper, adapter, display IDs, mock/live switch. No DB or browser needed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, apiFetch } from '../../src/api/client.js'
import { adaptHospital } from '../../src/api/adapters/hospitals.js'
import { listHospitals } from '../../src/api/hospitals.js'
import { getLookups, resetLookupsCache } from '../../src/api/lookups.js'
import { mockHospitals } from '../../src/data/mockHospitals.js'
import * as ids from '../../src/utils/displayId.js'

const realFetch = globalThis.fetch
test.afterEach(() => {
  globalThis.fetch = realFetch
  resetLookupsCache()
})
const stubFetch = (status, body, calls = []) => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => {
        if (body === undefined) throw new Error('no body')
        return body
      },
    }
  }
  return calls
}

test('apiFetch sends credentials, builds the query string and returns JSON', async () => {
  const calls = stubFetch(200, [{ id: 1 }])
  const out = await apiFetch('/hospitals', { params: { status: 'ACTIVE', regionId: undefined, x: '' } })
  assert.deepEqual(out, [{ id: 1 }])
  assert.equal(calls[0].url, '/api/hospitals?status=ACTIVE')
  assert.equal(calls[0].init.credentials, 'include')
})

test('apiFetch parses the error envelope into ApiError(code, message, details)', async () => {
  stubFetch(409, { error: { code: 'ACTIVE_OFFER_EXISTS', message: 'This organ already has an active offer', details: { a: 1 } } })
  await assert.rejects(apiFetch('/offers', { method: 'POST', body: {} }), (e) => {
    assert.ok(e instanceof ApiError)
    assert.equal(e.status, 409)
    assert.equal(e.code, 'ACTIVE_OFFER_EXISTS')
    assert.equal(e.message, 'This organ already has an active offer')
    assert.deepEqual(e.details, { a: 1 })
    return true
  })
})

test('apiFetch falls back for non-envelope bodies and network failures', async () => {
  stubFetch(502, undefined)
  await assert.rejects(apiFetch('/x'), (e) => e.status === 502 && e.code === 'UNKNOWN' && e.message === 'Request failed')
  globalThis.fetch = async () => { throw new TypeError('fetch failed') }
  await assert.rejects(apiFetch('/x'), (e) => e.code === 'NETWORK_ERROR' && e.status === 0)
})

test('apiFetch returns null for 204', async () => {
  stubFetch(204, undefined)
  assert.equal(await apiFetch('/auth/logout', { method: 'POST' }), null)
})

test('display IDs follow A11/U5 formats', () => {
  assert.equal(ids.donorId(42), 'D-0042')
  assert.equal(ids.recipientId(118), 'R-0118')
  assert.equal(ids.organId(7), 'O-0007')
  assert.equal(ids.offerId(12), 'OF-0012')
  assert.equal(ids.transportId(3), 'T-0003')
  assert.equal(ids.matchRunId(42), 'MR-0042')
  assert.equal(ids.hospitalId(1), 'HSP-001')
  assert.equal(ids.donorId(12345), 'D-12345')
})

test('adaptHospital maps the API row onto the mock-shaped table row', () => {
  const row = adaptHospital({
    id: 2, name: 'Apollo Chennai', address: null, phone: null, latitude: 13.0604, longitude: 80.2496,
    regionId: 1, regionCode: 'SR', regionName: 'Southern Region', status: 'SUSPENDED',
  })
  assert.deepEqual(row, {
    id: 'HSP-002', dbId: 2, name: 'Apollo Chennai', region: 'Southern Region', regionCode: 'SR',
    traumaLevel: null, status: 'suspended', lat: 13.0604, lng: 80.2496, address: '', phone: '',
  })
  // every key the mock rows have is present
  for (const k of Object.keys(mockHospitals[0])) assert.ok(k in row, k)
})

test('listHospitals: mock mode returns mockHospitals without fetching', async () => {
  const calls = stubFetch(200, [])
  assert.equal(await listHospitals(undefined, false), mockHospitals)
  assert.equal(calls.length, 0)
})

test('listHospitals: live mode calls /api/hospitals and adapts rows', async () => {
  const calls = stubFetch(200, [
    { id: 1, name: 'A', address: 'x', phone: '1', latitude: 1, longitude: 2, regionId: 1, regionCode: 'NR', regionName: 'Northern Region', status: 'ACTIVE' },
  ])
  const rows = await listHospitals({ status: 'ACTIVE' }, true)
  assert.equal(calls[0].url, '/api/hospitals?status=ACTIVE')
  assert.equal(rows[0].id, 'HSP-001')
  assert.equal(rows[0].status, 'active')
})

test('listHospitals: live mode surfaces the server message through ApiError', async () => {
  stubFetch(401, { error: { code: 'UNAUTHENTICATED', message: 'Login required', details: {} } })
  await assert.rejects(listHospitals(undefined, true), (e) => e.message === 'Login required')
})

test('getLookups: null in mock mode; cached once in live mode; failures are not cached', async () => {
  assert.equal(await getLookups(false), null)
  const calls = stubFetch(200, { bloodGroups: [] })
  await getLookups(true)
  await getLookups(true)
  assert.equal(calls.length, 1)
  resetLookupsCache()
  stubFetch(500, { error: { code: 'INTERNAL', message: 'Unexpected server error', details: {} } })
  await assert.rejects(getLookups(true))
  const calls2 = stubFetch(200, { bloodGroups: [1] })
  assert.deepEqual(await getLookups(true), { bloodGroups: [1] })
  assert.equal(calls2.length, 1)
})

// ---- OL-011: donors API module and adapter ----
import { listDonors, getDonor } from '../../src/api/donors.js'
import { adaptDonor, adaptMockDonor, groupHla } from '../../src/api/adapters/donors.js'
import { mockDonors } from '../../src/data/mockDonors.js'

const apiDonor = {
  id: 42, name: 'Rajesh Kumar', dateOfBirth: '1984-03-11', bloodGroupId: 4, bloodGroup: 'A+',
  hospitalId: 1, hospitalName: 'AIIMS New Delhi', regionCode: 'NR', donorType: 'DECEASED', status: 'ACTIVE',
  heightCm: 175, weightKg: 72, deathDate: '2026-10-04T03:10:00.000Z', deathCause: 'RTA', organCount: 1,
}

test('adaptDonor: display id, separate type and status, list row has no detail', () => {
  const d = adaptDonor(apiDonor)
  assert.equal(d.id, 'D-0042')
  assert.equal(d.dbId, 42)
  assert.equal(d.donorType, 'DECEASED')
  assert.equal(d.status, 'ACTIVE')
  assert.equal(d.hospital, 'AIIMS New Delhi')
  assert.equal(d.region, 'NR')
  assert.equal(d.organsLabel, '1')
  assert.equal(d.hasDetail, false)
  assert.deepEqual(d.organs, [])
  assert.ok(d.age >= 40)
})

test('adaptDonor: detail groups the 6 HLA alleles by locus and adapts organs', () => {
  const hla = [
    { id: 1, locus: 'A', alleleName: 'A*01:01' }, { id: 2, locus: 'A', alleleName: 'A*02:01' },
    { id: 3, locus: 'B', alleleName: 'B*07:02' }, { id: 4, locus: 'B', alleleName: 'B*08:01' },
    { id: 5, locus: 'DRB1', alleleName: 'DRB1*03:01' }, { id: 6, locus: 'DRB1', alleleName: 'DRB1*15:01' },
  ]
  const d = adaptDonor({
    ...apiDonor, hla,
    organs: [{ id: 7, organType: 'Heart', status: 'AVAILABLE', maxViabilityHours: 6, hoursRemaining: 4.5,
      recoveringHospitalName: 'AIIMS New Delhi', hasActiveOffer: false }],
  })
  assert.equal(d.hasDetail, true)
  assert.deepEqual(d.hlaByLocus, { A: ['A*01:01', 'A*02:01'], B: ['B*07:02', 'B*08:01'], DRB1: ['DRB1*03:01', 'DRB1*15:01'] })
  assert.equal(d.organs[0].id, 'O-0007')
  assert.equal(d.organs[0].viabilityHours, 6)
  assert.equal(d.organs[0].elapsedHours, 1.5)
  assert.deepEqual(groupHla([]), { A: [], B: [], DRB1: [] })
})

test('adaptMockDonor splits the old conflated status into type and status', () => {
  const deceased = adaptMockDonor(mockDonors.find((m) => m.status === 'Deceased'))
  assert.equal(deceased.donorType, 'DECEASED')
  assert.equal(deceased.status, 'ACTIVE')
  const inactive = mockDonors.find((m) => m.status === 'Inactive')
  if (inactive) assert.equal(adaptMockDonor(inactive).status, 'INACTIVE')
  assert.ok(adaptMockDonor(mockDonors[0]).organs.length >= 1)
})

test('listDonors mock mode returns adapted mock rows and filters client-side', async () => {
  const calls = stubFetch(200, [])
  const all = await listDonors(undefined, false)
  assert.equal(all.length, mockDonors.length)
  const deceased = await listDonors({ type: 'DECEASED' }, false)
  assert.ok(deceased.length > 0 && deceased.every((d) => d.donorType === 'DECEASED'))
  assert.equal(calls.length, 0, 'mock mode must not call the API')
})

test('listDonors live mode puts the filters in the query string and adapts rows', async () => {
  const calls = stubFetch(200, [apiDonor])
  const rows = await listDonors({ type: 'DECEASED', status: null, hospital: '1' }, true)
  assert.equal(calls[0].url, '/api/donors?type=DECEASED&hospital=1')
  assert.equal(rows[0].id, 'D-0042')
})

test('getDonor live mode fetches /donors/:id; mock mode returns the row unchanged', async () => {
  const calls = stubFetch(200, { ...apiDonor, hla: [], organs: [] })
  const full = await getDonor({ dbId: 42 }, true)
  assert.equal(calls[0].url, '/api/donors/42')
  assert.equal(full.hasDetail, true)
  const row = { dbId: null }
  assert.equal(await getDonor(row, false), row)
})

test('procureOrgan POSTs the body to the donor and adapts the organ; refuses in mock mode', async () => {
  const { procureOrgan } = await import('../../src/api/donors.js')
  const calls = stubFetch(201, {
    id: 9, donorId: 3, organType: 'Kidney', status: 'AVAILABLE', recoveringHospitalName: 'AIIMS',
    recoveredAt: 'x', expiresAt: 'y', maxViabilityHours: 30, hoursRemaining: 29, hasActiveOffer: false,
  })
  const body = { organTypeId: 4, recoveringHospitalId: 1, recoveredAt: '2026-10-04T10:00:00.000Z' }
  const organ = await procureOrgan({ dbId: 3 }, body, true)
  assert.equal(calls[0].url, '/api/donors/3/organs')
  assert.equal(calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].init.body), body)
  assert.equal(organ.id, 'O-0009')
  assert.equal(organ.elapsedHours, 1)
  await assert.rejects(() => procureOrgan({ dbId: null }, body, false), /live mode/)
})
