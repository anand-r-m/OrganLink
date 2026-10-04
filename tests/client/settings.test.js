// OL-024: Settings adapters/helpers, API module (both modes) and page wiring.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  regionToSliderValues, sliderValuesToPatch, sliderValuesChanged, weightShares, regionOptions,
  adaptRegion, hospitalToForm, hospitalFormToBody, organTypeFormToBody, adaptOrganType,
  formatRatioRange, settingsErrorToForm, regionFormToBody, WEIGHT_KEYS,
} from '../../src/api/adapters/settings.js'
import {
  listRegions, createRegion, updateRegion, listOrganTypes, createOrganType, updateOrganType,
  createHospital, updateHospital,
} from '../../src/api/settings.js'

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

const regions = [
  { id: 1, code: 'SR', name: 'Southern Region', hospitalCount: 3, weights: { hla: 25, urgency: 35, distance: 20, wait: 20 } },
  { id: 2, code: 'NR', name: 'Northern Region', hospitalCount: 2, weights: { hla: 20, urgency: 40, distance: 25, wait: 15 } },
]

test('region dropdown -> slider values: switching region loads that region weights', () => {
  assert.deepEqual(regionToSliderValues(regions, '1'), { hla: 25, urgency: 35, distance: 20, wait: 20 })
  assert.deepEqual(regionToSliderValues(regions, '2'), { hla: 20, urgency: 40, distance: 25, wait: 15 })
  assert.equal(regionToSliderValues(regions, '99'), null)
  assert.equal(regionToSliderValues(regions, null), null)
})

test('slider values -> PATCH body, change detection, shares, options', () => {
  assert.deepEqual(sliderValuesToPatch({ hla: 1, urgency: 2, distance: 3, wait: 4 }), {
    weights: { hla: 1, urgency: 2, distance: 3, wait: 4 },
  })
  assert.equal(sliderValuesChanged(regions[0].weights, { ...regions[0].weights }), false)
  assert.equal(sliderValuesChanged(regions[0].weights, { ...regions[0].weights, wait: 21 }), true)
  const shares = weightShares({ hla: 25, urgency: 25, distance: 25, wait: 25 })
  assert.deepEqual(Object.values(shares), [25, 25, 25, 25])
  assert.deepEqual(Object.values(weightShares({ hla: 0, urgency: 0, distance: 0, wait: 0 })), [25, 25, 25, 25])
  assert.deepEqual(regionOptions(regions), [
    { value: '1', label: 'Southern Region' },
    { value: '2', label: 'Northern Region' },
  ])
  assert.deepEqual(WEIGHT_KEYS, ['hla', 'urgency', 'distance', 'wait'])
  assert.deepEqual(adaptRegion(regions[0]).weights, regions[0].weights)
})

test('hospital form <-> body', () => {
  const form = hospitalToForm(
    { name: 'A', address: '', phone: '1', lat: 1.5, lng: 2.5, regionCode: 'NR', status: 'suspended' },
    regions,
  )
  assert.deepEqual(form, { name: 'A', address: '', phone: '1', latitude: 1.5, longitude: 2.5, regionId: '2', status: 'SUSPENDED' })
  assert.deepEqual(hospitalFormToBody({ ...form, name: ' A ' }), {
    name: 'A', address: '', phone: '1', latitude: 1.5, longitude: 2.5, regionId: 2, status: 'SUSPENDED',
  })
  assert.equal(hospitalFormToBody({ ...form, latitude: '' }).latitude, undefined)
  assert.deepEqual(regionFormToBody({ code: ' CR ', name: ' Central ' }), { code: 'CR', name: 'Central' })
})

test('organ types: adapter, ratio format (2 dp), form body', () => {
  const t = adaptOrganType({
    id: 1, name: 'Kidney', maxViabilityHours: 30, responseWindowHours: 6, priorityWeight: 1,
    minWeightRatio: 0.5, maxWeightRatio: 3,
  })
  assert.equal(t.maxViability, 30)
  assert.equal(t.responseWindow, 6)
  assert.equal(formatRatioRange(t.minRatio, t.maxRatio), '0.50–3.00')
  assert.deepEqual(
    organTypeFormToBody({ name: 'X', maxViability: 10, responseWindow: 2, priorityWeight: '', minRatio: 0.8, maxRatio: 1.5 }),
    { name: 'X', maxViabilityHours: 10, responseWindowHours: 2, priorityWeight: undefined, minWeightRatio: 0.8, maxWeightRatio: 1.5 },
  )
})

test('settingsErrorToForm maps constraints to fields and keeps the server message', () => {
  assert.deepEqual(settingsErrorToForm({ message: 'm', details: { constraint: 'hospital_latitude_check' } }), {
    field: 'latitude', message: 'm',
  })
  assert.equal(settingsErrorToForm({ message: 'm', code: 'DUPLICATE', details: {} }).field, 'name')
  assert.equal(settingsErrorToForm({ message: 'x', details: { constraint: 'ck_region_weights_nonzero' } }).field, null)
})

test('API module, live: regions/organ types/hospitals call the right endpoints', async () => {
  let calls = stub(regions)
  const rows = await listRegions(true)
  assert.equal(calls[0].url, '/api/regions')
  assert.equal(rows[0].code, 'SR')

  calls = stub({ id: 1 })
  await updateRegion(1, { weights: { hla: 5 } }, true)
  assert.deepEqual(calls[0], { url: '/api/regions/1', method: 'PATCH', body: { weights: { hla: 5 } } })
  await createRegion({ code: 'CR', name: 'C' }, true)
  assert.equal(calls[1].method, 'POST')
  await createHospital({ name: 'H' }, true)
  assert.deepEqual([calls[2].url, calls[2].method], ['/api/hospitals', 'POST'])
  await updateHospital(7, { status: 'SUSPENDED' }, true)
  assert.deepEqual(calls[3], { url: '/api/hospitals/7', method: 'PATCH', body: { status: 'SUSPENDED' } })
  await createOrganType({ name: 'T' }, true)
  await updateOrganType(3, { maxViabilityHours: 9 }, true)
  assert.deepEqual([calls[4].url, calls[5].url, calls[5].method], ['/api/organ-types', '/api/organ-types/3', 'PATCH'])

  stub([{ id: 1, name: 'Kidney', maxViabilityHours: 30, responseWindowHours: 6, priorityWeight: 1, minWeightRatio: 0.5, maxWeightRatio: 3 }])
  const types = await listOrganTypes(true)
  assert.equal(types[0].maxViability, 30)
})

test('API module, live: a 400 surfaces the server message', async () => {
  stub({ error: { code: 'CONSTRAINT_VIOLATION', message: 'At least one policy weight must be greater than zero', details: {} } }, 400)
  await assert.rejects(
    updateRegion(1, { weights: { hla: 0, urgency: 0, distance: 0, wait: 0 } }, true),
    (e) => e.status === 400 && /at least one policy weight/i.test(e.message),
  )
})

test('API module, mock: no fetch; regions have weights; writes need live mode', async () => {
  const calls = stub([])
  const rows = await listRegions(false)
  assert.ok(rows.length >= 5)
  for (const r of rows) assert.deepEqual(Object.keys(r.weights).sort(), ['distance', 'hla', 'urgency', 'wait'])
  assert.equal(await listOrganTypes(false), null)
  await assert.rejects(updateRegion(1, {}, false), /live mode/)
  await assert.rejects(createHospital({}, false), /live mode/)
  await assert.rejects(updateOrganType(1, {}, false), /live mode/)
  assert.equal(calls.length, 0)
})

test('SettingsPage wiring (source checks)', () => {
  const src = readFileSync(new URL('../../src/pages/SettingsPage.jsx', import.meta.url), 'utf8')
  assert.ok(!src.includes('Editing hospitals is not available in live mode'))
  assert.ok(!/disabled=\{USE_LIVE_API\}/.test(src))
  assert.ok(!/mockRegions/.test(src))
  assert.match(src, /createHospital\(/)
  assert.match(src, /updateHospital\(editingHospital\.dbId/)
  assert.match(src, /status: suspend \? 'SUSPENDED' : 'ACTIVE'/)
  assert.match(src, /listOrganTypes\(/)
  assert.match(src, /formatRatioRange/)
  assert.match(src, /listRegions\(/)
  // Policy Weights: region select + sliders bound through the pure helpers
  const policy = src.slice(src.indexOf('function PolicyWeightsTab'), src.indexOf('Main — SettingsPage'))
  assert.match(policy, /<Select[\s\S]*label="Region"/)
  assert.match(policy, /regionToSliderValues\(regions, regionId\)/)
  assert.match(policy, /sliderValuesToPatch\(weights\)/)
  assert.match(policy, /updateRegion\(regionId, patch\)/)
  // Regions tab no longer gets mock hospitals in live mode
  assert.ok(!/USE_LIVE_API \? mockHospitals : hospitals/.test(src))
})
