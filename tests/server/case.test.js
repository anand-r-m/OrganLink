import test from 'node:test'
import assert from 'node:assert/strict'
import { toCamel, toCamelKey } from '../../server/util/case.js'

test('toCamelKey converts snake_case', () => {
  assert.equal(toCamelKey('recovering_hospital_id'), 'recoveringHospitalId')
  assert.equal(toCamelKey('id'), 'id')
  assert.equal(toCamelKey('hla_a1'), 'hlaA1')
})

test('toCamel maps top-level keys and keeps values', () => {
  const d = new Date()
  const out = toCamel({ organ_id: 7, recovered_at: d, default_weights: { hla_x: 1 } })
  assert.deepEqual(Object.keys(out), ['organId', 'recoveredAt', 'defaultWeights'])
  assert.equal(out.recoveredAt, d)
  assert.deepEqual(out.defaultWeights, { hla_x: 1 })
})

test('toCamel passes through null', () => {
  assert.equal(toCamel(null), null)
})
