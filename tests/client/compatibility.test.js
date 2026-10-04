// OL-025: compatibility grid helpers, mock adapters, API module (both modes) and page wiring.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  HLA_LOCI, pairsToGrid, countCompatible, compatibleLabel, setPairCompatible, pairToPatchBody,
  mockBloodCompatibility, mockHlaRows, emptyHlaForm, hlaFormToBody, hlaFormComplete, filterHla,
} from '../../src/api/adapters/compatibility.js'
import {
  getBloodCompatibility, setBloodCompatibility, listHlaAlleles, createHlaAllele, deleteHlaAllele,
} from '../../src/api/compatibility.js'

const realFetch = globalThis.fetch
test.afterEach(() => {
  globalThis.fetch = realFetch
})
const stub = (payload, status = 200) => {
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined })
    return status === 204
      ? new Response(null, { status })
      : new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
  }
  return calls
}

const mock = mockBloodCompatibility()

test('64-pair input maps to an 8x8 grid, rows = donor, columns = recipient', () => {
  assert.equal(mock.pairs.length, 64)
  const grid = pairsToGrid(mock.bloodGroups, mock.pairs)
  assert.equal(grid.length, 8)
  for (const row of grid) {
    assert.equal(row.cells.length, 8)
    assert.ok(row.cells.every((c) => c.exists))
  }
  const row = (name) => grid.find((r) => r.donor.name === name)
  const cell = (d, r) => row(d).cells.find((c) => c.recipient.name === r).compatible
  assert.equal(cell('O-', 'A+'), true)
  assert.equal(cell('A+', 'O-'), false)
  assert.equal(cell('AB+', 'AB+'), true)
  assert.equal(cell('AB+', 'A+'), false)
})

test('27 compatible pairs, label, and immutable pair update', () => {
  assert.equal(countCompatible(mock.pairs), 27)
  assert.equal(compatibleLabel(mock.pairs), '27 compatible pairs')
  assert.equal(compatibleLabel(mock.pairs.slice(0, 0)), '0 compatible pairs')
  const a = mock.bloodGroups.find((g) => g.name === 'A+').id
  const b = mock.bloodGroups.find((g) => g.name === 'B+').id
  const next = setPairCompatible(mock.pairs, a, b, true)
  assert.equal(countCompatible(next), 28)
  assert.equal(countCompatible(mock.pairs), 27)
  assert.deepEqual(pairToPatchBody(next.find((p) => p.donorBloodGroupId === a && p.recipientBloodGroupId === b), false), {
    donorBloodGroupId: a, recipientBloodGroupId: b, compatible: false,
  })
  const missing = pairsToGrid(mock.bloodGroups, mock.pairs.slice(1))
  assert.equal(missing[0].cells[0].exists, false)
})

test('mock HLA rows use DRB1 and carry no description', () => {
  const rows = mockHlaRows()
  assert.ok(rows.length > 0)
  assert.ok(rows.some((r) => r.locus === 'DRB1'))
  assert.ok(rows.every((r) => HLA_LOCI.includes(r.locus)))
  assert.ok(rows.every((r) => Object.keys(r).sort().join() === 'alleleName,id,locus'))
  assert.equal(filterHla(rows, 'DRB1').every((r) => r.locus === 'DRB1'), true)
  assert.equal(filterHla(rows, null).length, rows.length)
})

test('HLA form helpers', () => {
  assert.equal(hlaFormComplete(emptyHlaForm()), false)
  assert.equal(hlaFormComplete({ locus: 'B', alleleName: '  ' }), false)
  assert.deepEqual(hlaFormToBody({ locus: 'B', alleleName: ' B*27:05 ' }), { locus: 'B', alleleName: 'B*27:05' })
})

test('API module, mock mode: reads from mock data, writes are live-only', async () => {
  const bc = await getBloodCompatibility(false)
  assert.equal(bc.pairs.length, 64)
  assert.equal((await listHlaAlleles('DRB1', false)).every((a) => a.locus === 'DRB1'), true)
  await assert.rejects(() => setBloodCompatibility({}, false), /live mode/)
  await assert.rejects(() => createHlaAllele({}, false), /live mode/)
  await assert.rejects(() => deleteHlaAllele(1, false), /live mode/)
})

test('API module, live mode: correct requests', async () => {
  let calls = stub(mock)
  const bc = await getBloodCompatibility(true)
  assert.equal(bc.pairs.length, 64)
  assert.deepEqual(calls[0], { url: '/api/blood-compatibility', method: 'GET', body: undefined })

  calls = stub({ ok: 1 })
  const body = { donorBloodGroupId: 1, recipientBloodGroupId: 4, compatible: false }
  await setBloodCompatibility(body, true)
  assert.deepEqual(calls[0], { url: '/api/blood-compatibility', method: 'PATCH', body })

  calls = stub([])
  await listHlaAlleles('DRB1', true)
  assert.equal(calls[0].url, '/api/hla-alleles?locus=DRB1')
  await listHlaAlleles(undefined, true)
  assert.equal(calls[1].url, '/api/hla-alleles')

  calls = stub({ id: 9, locus: 'B', alleleName: 'B*27:05' }, 201)
  await createHlaAllele({ locus: 'B', alleleName: 'B*27:05' }, true)
  assert.deepEqual(calls[0], { url: '/api/hla-alleles', method: 'POST', body: { locus: 'B', alleleName: 'B*27:05' } })

  calls = stub(null, 204)
  assert.equal(await deleteHlaAllele(9, true), null)
  assert.deepEqual(calls[0], { url: '/api/hla-alleles/9', method: 'DELETE', body: undefined })
})

test('live errors carry code and message (409 DUPLICATE, REFERENCE_IN_USE)', async () => {
  stub({ error: { code: 'REFERENCE_IN_USE', message: 'This record is referenced by other data and cannot be deleted', details: {} } }, 409)
  await assert.rejects(() => deleteHlaAllele(1, true), (e) => e.code === 'REFERENCE_IN_USE' && /cannot be deleted/.test(e.message))
  stub({ error: { code: 'DUPLICATE', message: 'A record with these values already exists', details: {} } }, 409)
  await assert.rejects(() => createHlaAllele({ locus: 'A', alleleName: 'A*02:01' }, true), (e) => e.code === 'DUPLICATE')
})

test('SettingsPage compatibility tab wiring (source checks)', () => {
  const src = readFileSync(new URL('../../src/pages/SettingsPage.jsx', import.meta.url), 'utf8')
  const tab = src.slice(src.indexOf('function CompatibilityTab'), src.indexOf('Tab 5'))
  for (const needle of [
    'getBloodCompatibility', 'setBloodCompatibility', 'createHlaAllele', 'deleteHlaAllele',
    'pairsToGrid', 'compatibleLabel', 'HLA_LOCI', 'USE_LIVE_API', 'setPairCompatible', 'showApiError', 'alleleName',
  ]) assert.ok(tab.includes(needle) || src.includes(needle), needle)
  assert.ok(!/description/i.test(tab), 'no description column or field in the HLA section')
  assert.ok(!/'DR'/.test(tab), 'locus DR was renamed DRB1')
  assert.ok(!src.includes('mockHlaAlleles'))
  assert.ok(!/BLOOD_GROUPS|isABOCompatible/.test(src))
  assert.ok(tab.includes('Delete Allele') && tab.includes('Confirm Compatibility Change'))
})
