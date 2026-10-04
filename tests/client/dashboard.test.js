import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getDashboard, mockDashboard, mockTrend } from '../../src/api/dashboard.js'
import { adaptAlerts, adaptDashboard, adaptStats, adaptTrend, emptyDashboard, monthLabel } from '../../src/api/adapters/dashboard.js'

const page = readFileSync(new URL('../../src/pages/DashboardPage.jsx', import.meta.url), 'utf8')

test('adaptStats maps four StatCards and defaults to 0', () => {
  const s = adaptStats({ availableOrgans: 3, activeWaitlist: 22, pendingOffers: 1, transplantsThisMonth: 4 })
  assert.deepEqual(s.map((x) => [x.label, x.value]), [['Available Organs', 3], ['Active Waitlist', 22], ['Pending Offers', 1], ['Transplants This Month', 4]])
  assert.ok(adaptStats(undefined).every((x) => x.value === 0))
})

test('adaptAlerts builds display-id text and colour urgency', () => {
  const rows = adaptAlerts([
    { type: 'ORGAN_EXPIRING', severity: 'danger', organId: 7, hoursRemaining: 1.6 },
    { type: 'OFFER_AWAITING_RESPONSE', severity: 'warning', offerId: 12, hoursRemaining: 0.4 },
  ])
  assert.equal(rows[0].message, 'Organ O-0007 expires in 1.6 h')
  assert.equal(rows[0].urgency, 'danger')
  assert.equal(rows[0].link, '/organs')
  assert.match(rows[1].message, /Offer OF-0012 .*0\.4 h/)
  assert.equal(rows[1].urgency, 'warning')
  assert.equal(rows[1].link, '/offers')
  assert.notEqual(rows[0].key, rows[1].key)
  assert.deepEqual(adaptAlerts(undefined), [])
})

test('trend labels and empty inputs', () => {
  assert.equal(monthLabel('2025-11'), 'Nov 25')
  assert.deepEqual(adaptTrend([{ month: '2026-01', transplants: 6 }]), [{ month: 'Jan 26', count: 6 }])
  assert.deepEqual(adaptTrend(undefined), [])
  const e = emptyDashboard(new Date(2026, 9, 5))
  assert.equal(e.trend.length, 12)
  assert.equal(e.trend[11].month, 'Oct 26')
  assert.equal(e.trend[0].month, 'Nov 25')
  assert.ok(e.trend.every((p) => p.count === 0) && e.alerts.length === 0 && e.offers.length === 0)
})

test('adaptDashboard maps recent offers with the offers adapter', () => {
  const m = adaptDashboard({
    recentOffers: [{ id: 5, organId: 2, organType: 'Heart', donorId: 3, recipientId: 4, status: 'SENT', createdAt: 'x' }],
  })
  assert.equal(m.offers[0].id, 'OF-0005')
  assert.equal(m.offers[0].organId, 'O-0002')
})

test('getDashboard in mock mode returns the page model', async () => {
  const d = await getDashboard(false)
  assert.equal(d.stats.length, 4)
  assert.equal(d.trend.length, 12)
  assert.equal(d.offers.length, 5)
  assert.ok(d.alerts.some((a) => a.urgency === 'danger') && d.alerts.some((a) => a.urgency === 'warning'))
  assert.equal(mockTrend().length, 12)
  assert.equal(mockDashboard().stats.activeWaitlist, 847)
})

test('getDashboard in live mode calls /api/dashboard and adapts', async () => {
  const real = globalThis.fetch
  let url
  globalThis.fetch = async (u) => {
    url = String(u)
    return new Response(
      JSON.stringify({
        stats: { availableOrgans: 1, activeWaitlist: 2, pendingOffers: 3, transplantsThisMonth: 4 },
        criticalAlerts: [],
        allocationTrend: [{ month: '2026-10', transplants: 2 }],
        recentOffers: [],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
  try {
    const d = await getDashboard(true)
    assert.match(url, /\/api\/dashboard$/)
    assert.equal(d.stats[1].value, 2)
    assert.deepEqual(d.trend, [{ month: 'Oct 26', count: 2 }])
    assert.deepEqual(d.alerts, [])
  } finally {
    globalThis.fetch = real
  }
})

test('page source reads the API model, not inline constants', () => {
  assert.doesNotMatch(page, /ALLOCATION_TRENDS|CRITICAL_ALERTS|RECENT_OFFERS|mockOffers/)
  assert.match(page, /getDashboard\(/)
  assert.match(page, /data\.stats\.map/)
  assert.match(page, /data\.trend/)
  assert.match(page, /data\.offers/)
  assert.match(page, /No critical alerts/)
  assert.match(page, /showApiError/)
  assert.match(page, /to="\/offers"/)
})
