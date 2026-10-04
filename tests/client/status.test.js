// StatusBadge mapping: spec colours (07 §4) and label formatting. Pure functions, no browser needed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { formatStatusLabel, getStatusVariant } from '../../src/utils/status.js'

const GROUPS = {
  success: ['ACCEPTED', 'DELIVERED', 'TRANSPLANTED', 'ACTIVE'],
  warning: ['SENT', 'IN_TRANSIT', 'PENDING', '1B'],
  danger: ['DECLINED', 'FAILED', 'EXPIRED', '1A'],
  info: ['CREATED', 'ALLOCATED', '2'],
  muted: ['VOIDED', 'CANCELLED', 'DISCARDED', 'SUSPENDED', 'INACTIVE'],
}

for (const [variant, states] of Object.entries(GROUPS)) {
  test(`${variant} states`, () => {
    for (const s of states) assert.equal(getStatusVariant(s), variant, s)
  })
}

test('numeric urgency 2 maps to info', () => {
  assert.equal(getStatusVariant(2), 'info')
})

test('EXPIRED is red and SUSPENDED is grey (changed behaviour)', () => {
  assert.equal(getStatusVariant('EXPIRED'), 'danger')
  assert.equal(getStatusVariant('Expired'), 'danger')
  assert.equal(getStatusVariant('SUSPENDED'), 'muted')
})

test('existing Title Case mock values still resolve', () => {
  assert.equal(getStatusVariant('In Transit'), 'warning')
  assert.equal(getStatusVariant('Active'), 'success')
  assert.equal(getStatusVariant('Deceased'), 'primary')
  assert.equal(getStatusVariant('Waiting'), 'warning')
  assert.equal(getStatusVariant('Preparing'), 'info')
  assert.equal(getStatusVariant('Available'), 'success')
})

test('unknown status falls back to grey', () => {
  assert.equal(getStatusVariant('SOMETHING_NEW'), 'muted')
})

test('label formatter', () => {
  assert.equal(formatStatusLabel('IN_TRANSIT'), 'In Transit')
  assert.equal(formatStatusLabel('ORGAN_NOT_USED'), 'Organ Not Used')
  assert.equal(formatStatusLabel('ACCEPTED'), 'Accepted')
  assert.equal(formatStatusLabel('In Transit'), 'In Transit')
  assert.equal(formatStatusLabel('Waiting'), 'Waiting')
  assert.equal(formatStatusLabel('1A'), '1A')
  assert.equal(formatStatusLabel(2), '2')
  assert.equal(formatStatusLabel(null), '')
})
