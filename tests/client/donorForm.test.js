// OL-020: donor form helpers, donor write API (live branch, stubbed fetch) and page wiring (source checks).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  emptyDonorForm, setDonorType, donorToForm, validateDonorForm, formToDonorBody, serverErrorToForm,
  hlaOptionsFromLookups, hlaOptionsFromMock, toDateOnly,
} from '../../src/api/adapters/donorForm.js'
import { adaptDonor, adaptMockDonor } from '../../src/api/adapters/donors.js'
import { createDonor, updateDonor } from '../../src/api/donors.js'
import { mockDonors } from '../../src/data/mockDonors.js'
import { ApiError } from '../../src/api/client.js'

const realFetch = globalThis.fetch
test.afterEach(() => {
  globalThis.fetch = realFetch
})

const valid = () => ({
  ...emptyDonorForm(),
  name: 'Anita Desai',
  dob: new Date(1988, 1, 14),
  bloodGroup: '1',
  hospital: '4',
  height: 162,
  weight: 58,
  hla: { A: ['1', '2'], B: ['7'], DRB1: [] },
})
const NOW = new Date(2026, 9, 4).getTime()

test('validateDonorForm: a valid form has no errors; required fields are flagged', () => {
  assert.deepEqual(validateDonorForm(valid(), NOW), {})
  const e = validateDonorForm(emptyDonorForm(), NOW)
  for (const k of ['name', 'dob', 'bloodGroup', 'hospital', 'height', 'weight']) assert.ok(e[k], k)
  assert.equal(e.organType, undefined, 'organ type is no longer part of the form')
  assert.ok(validateDonorForm({ ...valid(), dob: new Date(2030, 0, 1) }, NOW).dob)
  assert.ok(validateDonorForm({ ...valid(), height: 50 }, NOW).height)
  assert.ok(validateDonorForm({ ...valid(), weight: 500 }, NOW).weight)
})

test('validateDonorForm: max 2 alleles per locus, but the death rule is left to the DB', () => {
  assert.ok(validateDonorForm({ ...valid(), hla: { A: ['1', '2', '3'], B: [], DRB1: [] } }, NOW).hlaA)
  // Deceased without a death date passes client validation so the server's message reaches the form.
  const e = validateDonorForm({ ...valid(), donorType: 'DECEASED', deathDate: null }, NOW)
  assert.deepEqual(e, {})
})

test('setDonorType: switching to LIVING clears death date and cause; DECEASED keeps them', () => {
  const dec = { ...valid(), donorType: 'DECEASED', deathDate: new Date(), deathCause: 'Trauma' }
  const living = setDonorType(dec, 'LIVING')
  assert.equal(living.deathDate, null)
  assert.equal(living.deathCause, '')
  const back = setDonorType(dec, 'DECEASED')
  assert.equal(back.deathCause, 'Trauma')
})

test('formToDonorBody: ids, local date-only DOB, flattened HLA, death fields only when DECEASED', () => {
  const b = formToDonorBody(valid())
  assert.deepEqual(b, {
    name: 'Anita Desai', dateOfBirth: '1988-02-14', bloodGroupId: 1, hospitalId: 4,
    donorType: 'LIVING', status: 'ACTIVE', heightCm: 162, weightKg: 58,
    deathDate: null, deathCause: null, hlaAlleleIds: [1, 2, 7],
  })
  const when = new Date('2026-10-03T20:30:00Z')
  const d = formToDonorBody({ ...valid(), donorType: 'DECEASED', status: 'INACTIVE', deathDate: when, deathCause: ' Stroke ' })
  assert.equal(d.deathDate, when.toISOString())
  assert.equal(d.deathCause, 'Stroke')
  assert.equal(d.status, 'INACTIVE')
  // Stale death data on a LIVING form is never sent.
  const l = formToDonorBody({ ...valid(), deathDate: when, deathCause: 'x' })
  assert.equal(l.deathDate, null)
  assert.equal(l.deathCause, null)
  assert.equal(toDateOnly(new Date(2026, 0, 5)), '2026-01-05')
})

test('donorToForm: live prefill uses ids; mock prefill uses names and an approximate DOB', () => {
  const api = adaptDonor({
    id: 5, name: 'X', dateOfBirth: '1990-03-02', bloodGroupId: 3, bloodGroup: 'B+', hospitalId: 4, hospitalName: 'H',
    regionCode: 'NR', donorType: 'DECEASED', status: 'INACTIVE', heightCm: 170, weightKg: 65,
    deathDate: '2026-10-04T02:00:00.000Z', deathCause: 'Trauma',
    hla: [{ id: 1, locus: 'A', alleleName: 'A*01:01' }, { id: 9, locus: 'B', alleleName: 'B*07:02' }], organs: [],
  })
  const f = donorToForm(api, { live: true })
  assert.equal(f.bloodGroup, '3')
  assert.equal(f.hospital, '4')
  assert.deepEqual(f.hla, { A: ['1'], B: ['9'], DRB1: [] })
  assert.equal(f.donorType, 'DECEASED')
  assert.equal(f.status, 'INACTIVE')
  assert.equal(f.deathDate.toISOString(), '2026-10-04T02:00:00.000Z')
  assert.equal(toDateOnly(f.dob), '1990-03-02')
  assert.equal(f.height, 170)
  // Round trip: an unchanged edit form posts the same HLA ids it loaded.
  assert.deepEqual(formToDonorBody(f).hlaAlleleIds, [1, 9])

  const m = donorToForm(adaptMockDonor(mockDonors[0]), { live: false, now: NOW })
  assert.equal(m.bloodGroup, 'A+')
  assert.equal(m.hospital, 'AIIMS New Delhi')
  assert.equal(m.donorType, 'DECEASED')
  assert.deepEqual(m.hla, { A: ['A*02:01'], B: ['B*07:02'], DRB1: ['DRB1*03:01'] })
  assert.ok(m.dob instanceof Date)
})

test('HLA option builders group by locus (ids in live mode, names in mock mode)', () => {
  const o = hlaOptionsFromLookups([
    { id: 1, locus: 'A', alleleName: 'A*01:01' }, { id: 2, locus: 'DRB1', alleleName: 'DRB1*03:01' },
  ])
  assert.deepEqual(o.A, [{ value: '1', label: 'A*01:01' }])
  assert.deepEqual(o.B, [])
  assert.deepEqual(o.DRB1, [{ value: '2', label: 'DRB1*03:01' }])
  const mo = hlaOptionsFromMock(mockDonors)
  assert.ok(mo.A.length > 0 && mo.A.every((x) => x.value === x.label))
})

test('serverErrorToForm: death-field CHECK and validation fields map to inline errors', () => {
  const death = serverErrorToForm(new ApiError(400, 'CONSTRAINT_VIOLATION', 'Deceased donors need a death date', { constraint: 'ck_donor_death_fields' }))
  assert.equal(death.message, 'Deceased donors need a death date')
  assert.equal(death.fields.deathDate, 'Deceased donors need a death date')
  const v = serverErrorToForm(new ApiError(400, 'VALIDATION_ERROR', 'Invalid or missing: heightCm', { fields: ['heightCm', 'bloodGroupId'] }))
  assert.ok(v.fields.height && v.fields.bloodGroup)
  assert.deepEqual(serverErrorToForm(new Error('boom')).fields, {})
})

const stub = (status, body, calls) => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return { status, ok: status < 300, json: async () => body }
  }
}
const apiDonor = { id: 12, name: 'N', dateOfBirth: '1990-01-01', bloodGroupId: 1, bloodGroup: 'A+', hospitalId: 1, hospitalName: 'H', regionCode: 'NR', donorType: 'LIVING', status: 'ACTIVE', heightCm: 170, weightKg: 70, hla: [], organs: [] }

test('createDonor / updateDonor call POST / PATCH in live mode and adapt the result', async () => {
  const calls = []
  stub(201, apiDonor, calls)
  const created = await createDonor({ name: 'N' }, true)
  assert.equal(created.id, 'D-0012')
  assert.match(calls[0].url, /\/api\/donors$/)
  assert.equal(calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].init.body), { name: 'N' })
  stub(200, { ...apiDonor, status: 'INACTIVE' }, calls)
  const upd = await updateDonor({ dbId: 12 }, { status: 'INACTIVE' }, true)
  assert.equal(upd.status, 'INACTIVE')
  assert.match(calls[1].url, /\/api\/donors\/12$/)
  assert.equal(calls[1].init.method, 'PATCH')
  assert.deepEqual(JSON.parse(calls[1].init.body), { status: 'INACTIVE' })
})

test('createDonor surfaces the server message as an ApiError', async () => {
  stub(400, { error: { code: 'CONSTRAINT_VIOLATION', message: 'Deceased donors need a death date', details: { constraint: 'ck_donor_death_fields' } } }, [])
  await assert.rejects(createDonor({}, true), (e) => e.code === 'CONSTRAINT_VIOLATION' && /death date/.test(e.message))
})

test('mock mode never calls fetch for writes', async () => {
  globalThis.fetch = async () => { throw new Error('fetch must not be called') }
  await assert.rejects(createDonor({}, false), /live mode/)
  await assert.rejects(updateDonor({ dbId: null }, {}, false), /live mode/)
})

test('DonorRegistryPage wiring: split type/status, conditional death fields, no organ field, live API', () => {
  const src = readFileSync(new URL('../../src/pages/DonorRegistryPage.jsx', import.meta.url), 'utf8')
  assert.match(src, /label="Donor Type"/)
  assert.match(src, /label="Status"[\s\S]*value=\{form\.status\}/)
  assert.match(src, /form\.donorType === 'DECEASED' && \(/)
  assert.match(src, /label="Death Date"/)
  assert.match(src, /label="Cause of Death"/)
  assert.doesNotMatch(src, /label="Organ Type"\s+data=\{ORGAN_TYPES\}/)
  assert.doesNotMatch(src, /formOrganType|ORGAN_TYPES/)
  assert.match(src, /maxValues=\{MAX_ALLELES_PER_LOCUS\}/)
  assert.match(src, /createDonor\(body\)/)
  assert.match(src, /updateDonor\(editingDonor, body\)/)
  assert.match(src, /updateDonor\(selectedDonor, \{ status: 'INACTIVE' \}\)/)
  assert.match(src, /serverErrorToForm\(err\)/)
  assert.doesNotMatch(src, /not live yet \(OL-020\)/)
  assert.doesNotMatch(src, /disabled=\{USE_LIVE_API\}/)
})
