// Transport API layer + adapters: no DB or browser needed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { deliverTransport, departTransport, listTransports, resetMockTransports } from '../../src/api/transport.js'
import { adaptMockTransport, adaptTransport, hospitalMarkers, nextTransportAction } from '../../src/api/adapters/transport.js'
import { mockTransports } from '../../src/data/mockTransports.js'

const realFetch = globalThis.fetch
test.afterEach(() => {
  globalThis.fetch = realFetch
  resetMockTransports()
})

const apiTransport = {
  id: 3, organId: 7, organType: 'Heart', offerId: 12, recipientId: 118, recipientName: 'Priya Sharma',
  origin: { id: 1, name: 'AIIMS New Delhi', latitude: 28.5672, longitude: 77.21 },
  destination: { id: 2, name: 'Apollo Chennai', latitude: 13.0604, longitude: 80.2496 },
  status: 'PENDING', departedAt: null, arrivedAt: null,
  organExpiresAt: '2026-10-04T14:00:00.000Z', organHoursRemaining: 4.5, maxViabilityHours: 6,
}

const stubFetch = (body, status = 200) => {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET' })
    return { ok: status < 400, status, json: async () => body }
  }
  return calls
}

test('adaptTransport formats ids, coordinates and derives elapsed hours', () => {
  const r = adaptTransport(apiTransport)
  assert.equal(r.id, 'T-0003')
  assert.equal(r.dbId, 3)
  assert.equal(r.organId, 'O-0007')
  assert.deepEqual(r.originCoords, [28.5672, 77.21])
  assert.deepEqual(r.destCoords, [13.0604, 80.2496])
  assert.equal(r.originHospital, 'AIIMS New Delhi')
  assert.equal(r.elapsedHours, 1.5)
  assert.equal(r.viabilityHours, 6)
  assert.equal(adaptTransport({ ...apiTransport, organHoursRemaining: 99 }).elapsedHours, 0)
})

test('actions are offered by status only: PENDING depart, IN_TRANSIT deliver, none otherwise', () => {
  assert.equal(nextTransportAction('PENDING'), 'depart')
  assert.equal(nextTransportAction('IN_TRANSIT'), 'deliver')
  assert.equal(nextTransportAction('DELIVERED'), null)
  assert.equal(nextTransportAction('FAILED'), null)
})

test('hospitalMarkers yields one marker per hospital with origin/destination counts', () => {
  const rows = [
    adaptTransport(apiTransport),
    adaptTransport({ ...apiTransport, id: 4, status: 'DELIVERED', origin: apiTransport.destination, destination: apiTransport.origin }),
  ]
  const markers = hospitalMarkers(rows)
  assert.equal(markers.length, 2)
  const delhi = markers.find((m) => m.name === 'AIIMS New Delhi')
  assert.deepEqual([delhi.origins, delhi.destinations, delhi.active], [1, 1, 1])
})

test('mock rows map statuses to schema values', async () => {
  const rows = await listTransports({}, false)
  assert.equal(rows.length, mockTransports.length)
  assert.deepEqual(
    new Set(rows.map((r) => r.status)),
    new Set(['PENDING', 'IN_TRANSIT', 'DELIVERED', 'FAILED']),
  )
  assert.equal(adaptMockTransport(mockTransports[0]).status, 'IN_TRANSIT')
  const active = await listTransports({ status: 'PENDING,IN_TRANSIT' }, false)
  assert.ok(active.every((r) => ['PENDING', 'IN_TRANSIT'].includes(r.status)))
})

test('mock depart then deliver move forward; repeating or skipping is a 409', async () => {
  const pending = (await listTransports({ status: 'PENDING' }, false))[0]
  await assert.rejects(() => deliverTransport(pending, false), (e) => e.status === 409 && e.code === 'INVALID_STATE_TRANSITION')
  const moving = await departTransport(pending, false)
  assert.equal(moving.status, 'IN_TRANSIT')
  assert.ok(moving.departedAt)
  await assert.rejects(() => departTransport(pending, false), (e) => e.code === 'INVALID_STATE_TRANSITION')
  const done = await deliverTransport(pending, false)
  assert.equal(done.status, 'DELIVERED')
  assert.ok(done.arrivedAt)
  await assert.rejects(() => deliverTransport(pending, false), (e) => e.code === 'INVALID_STATE_TRANSITION')
})

test('live mode calls the transport endpoints and adapts the result', async () => {
  let calls = stubFetch([apiTransport])
  const rows = await listTransports({ status: 'PENDING' }, true)
  assert.equal(calls[0].url, '/api/transport?status=PENDING')
  assert.equal(rows[0].id, 'T-0003')

  calls = stubFetch({ ...apiTransport, status: 'IN_TRANSIT', departedAt: '2026-10-04T10:00:00.000Z' })
  const dep = await departTransport(rows[0], true)
  assert.deepEqual([calls[0].url, calls[0].method], ['/api/transport/3/depart', 'POST'])
  assert.equal(dep.status, 'IN_TRANSIT')

  calls = stubFetch({ ...apiTransport, status: 'DELIVERED', arrivedAt: '2026-10-04T11:00:00.000Z' })
  const del = await deliverTransport(rows[0], true)
  assert.deepEqual([calls[0].url, calls[0].method], ['/api/transport/3/deliver', 'POST'])
  assert.equal(del.arrivedAt, '2026-10-04T11:00:00.000Z')
})

test('live 409 surfaces as ApiError INVALID_STATE_TRANSITION', async () => {
  stubFetch({ error: { code: 'INVALID_STATE_TRANSITION', message: 'nope', details: {} } }, 409)
  await assert.rejects(() => departTransport({ dbId: 3 }, true), (e) => e.status === 409 && e.code === 'INVALID_STATE_TRANSITION')
})

test('TransportPage wires both buttons behind a confirmation modal and no longer reads mock data directly', () => {
  const page = readFileSync(new URL('../../src/pages/TransportPage.jsx', import.meta.url), 'utf8')
  assert.match(page, /Mark In Transit/)
  assert.match(page, /Mark Delivered/)
  assert.match(page, /<FormModal/)
  assert.doesNotMatch(page, /data\/mockTransports/)
  const map = readFileSync(new URL('../../src/components/TransportMap.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(map, /data\/mock/)
})
