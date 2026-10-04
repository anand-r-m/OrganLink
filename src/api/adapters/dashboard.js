import { offerId, organId } from '../../utils/displayId.js';
import { adaptOffer } from './offers.js';

// Pure mappers: GET /api/dashboard payload -> the Dashboard page props. Display ids and alert
// text are built here (A11); the API carries integer keys and structured fields only.

// stats -> StatCard props (icon is attached by the page). Counts default to 0.
export function adaptStats(stats) {
  const s = stats ?? {};
  const n = (v) => Number(v) || 0;
  return [
    { key: 'availableOrgans', color: 'danger', label: 'Available Organs', value: n(s.availableOrgans) },
    { key: 'activeWaitlist', color: 'primary', label: 'Active Waitlist', value: n(s.activeWaitlist) },
    { key: 'pendingOffers', color: 'warning', label: 'Pending Offers', value: n(s.pendingOffers) },
    { key: 'transplantsThisMonth', color: 'success', label: 'Transplants This Month', value: n(s.transplantsThisMonth) },
  ];
}

const SEVERITY_URGENCY = { danger: 'danger', warning: 'warning', info: 'info', success: 'success' };

// "1.6 h" style remaining time.
export const formatHours = (h) => `${Number((Number(h) || 0).toFixed(1))} h`;

// alerts -> rows { key, urgency, message, link }. urgency keys the page's colour table:
// danger = red (organ expiring), warning = amber (offer awaiting response).
export function adaptAlerts(alerts) {
  return (alerts ?? []).map((a) => {
    const urgency = SEVERITY_URGENCY[a.severity] ?? 'info';
    if (a.type === 'ORGAN_EXPIRING') {
      return {
        key: `organ-${a.organId}`,
        urgency,
        message: `Organ ${organId(a.organId)} expires in ${formatHours(a.hoursRemaining)}`,
        link: '/organs',
      };
    }
    if (a.type === 'OFFER_AWAITING_RESPONSE') {
      return {
        key: `offer-${a.offerId}`,
        urgency,
        message: `Offer ${offerId(a.offerId)} awaiting response, expires in ${formatHours(a.hoursRemaining)}`,
        link: '/offers',
      };
    }
    return { key: `${a.type}-${a.organId ?? a.offerId}`, urgency, message: String(a.type), link: null };
  });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// '2025-11' -> 'Nov 25'
export function monthLabel(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return String(month);
  return `${MONTHS[Number(m[2]) - 1]} ${m[1].slice(2)}`;
}

// trend -> chart points { month, count }. The chart's dataKey stays `count`.
export const adaptTrend = (trend) =>
  (trend ?? []).map((t) => ({ month: monthLabel(t.month), count: Number(t.transplants) || 0 }));

// recent offers -> table rows (same row shape as the Offers page).
export const adaptRecentOffers = (offers) => (offers ?? []).map(adaptOffer);

// Whole payload -> page model. Missing parts become empty/zero so the page always renders.
export function adaptDashboard(d) {
  return {
    stats: adaptStats(d?.stats),
    alerts: adaptAlerts(d?.criticalAlerts),
    trend: adaptTrend(d?.allocationTrend),
    offers: adaptRecentOffers(d?.recentOffers),
  };
}

// Before the first load (or after a failed one): zero stats, no alerts, 12 zero months.
export function emptyDashboard(now = new Date()) {
  const trend = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return { month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, transplants: 0 };
  });
  return adaptDashboard({ allocationTrend: trend });
}
