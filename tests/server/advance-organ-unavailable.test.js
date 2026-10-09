// OL-029: Advance on an offer whose organ was later discarded (valid backend enforcement). The insert trigger
// fn_offer_viability raises P0001 "Organ N is not available (status DISCARDED)"; the route rethrows
// organ-level failures (offers.js, /^Organ /) and translatePgError maps P0001 to 422 RULE_VIOLATION
// with the trigger text verbatim (API_CONTRACT: advance 422 RULE_VIOLATION). Pure: no database.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { translatePgError } from '../../server/errors.js'

test('organ-unavailable trigger error becomes 422 RULE_VIOLATION with the message verbatim', () => {
  const pg = Object.assign(new Error('Organ 3 is not available (status DISCARDED)'), { code: 'P0001' })
  const e = translatePgError(pg)
  assert.equal(e.status, 422)
  assert.equal(e.code, 'RULE_VIOLATION')
  assert.equal(e.message, 'Organ 3 is not available (status DISCARDED)')
})

test('advance route: organ-level P0001 ends the walk (not a per-candidate skip)', () => {
  const src = readFileSync('server/routes/offers.js', 'utf8')
  assert.match(src, /err\.code === 'P0001' && \/\^Organ \/\.test\(err\.message\)\) throw err/)
})
