import { USE_LIVE_API, apiFetch } from './client.js';
import { adaptDashboard } from './adapters/dashboard.js';
import { mockOffers } from '../data/mockOffers.js';
import { adaptMockOffer } from './adapters/offers.js';

// GET /api/dashboard (OL-027). Returns the page model (see adapters/dashboard.js). `live` is a
// trailing parameter so tests can exercise both branches. Mock mode derives the same shape from
// the pre-OL-027 constants so the page looks as before.
const MOCK_TREND_COUNTS = [18, 22, 26, 24, 31, 28, 35, 32, 38, 41, 36, 44];

// 12 months ending with the current one, shaped like the API's allocationTrend.
export function mockTrend(now = new Date()) {
  return MOCK_TREND_COUNTS.map((transplants, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return { month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, transplants };
  });
}

export function mockDashboard(now = new Date()) {
  return {
    stats: { availableOrgans: 12, activeWaitlist: 847, pendingOffers: 3, transplantsThisMonth: 28 },
    criticalAlerts: [
      { type: 'ORGAN_EXPIRING', severity: 'danger', organId: 912, hoursRemaining: 1.6 },
      { type: 'OFFER_AWAITING_RESPONSE', severity: 'warning', offerId: 2201, hoursRemaining: 0.4 },
    ],
    allocationTrend: mockTrend(now),
    recentOffers: [],
  };
}

export async function getDashboard(live = USE_LIVE_API) {
  if (!live) {
    const model = adaptDashboard(mockDashboard());
    // Mock offers are already display rows; reuse the mock adapter used by the Offers page.
    return { ...model, offers: mockOffers.slice(0, 5).map(adaptMockOffer) };
  }
  return adaptDashboard(await apiFetch('/dashboard'));
}
