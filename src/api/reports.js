import { USE_LIVE_API, apiFetch } from './client.js';

// Reports endpoints (OL-026): one function per view. `live` is a trailing parameter so tests can
// exercise both branches. Mock rows use the API shapes and keep the pre-OL-026 mock page look.

const MOCK_WAITING = [
  [1, 62], [2, 62], [3, 98], [4, 78], [5, 40], [6, 30], [7, 24], [8, 18], [9, 10], [10, 6], [13, 4],
].map(([bucket, recipients]) => ({ organType: 'Kidney', bucket, recipients }));

const MOCK_UTILIZATION = [
  ['Northern Region', 42, 4, 2], ['Southern Region', 38, 3, 1], ['Eastern Region', 31, 2, 2],
  ['Western Region', 27, 3, 1], ['Central Region', 35, 1, 2],
].map(([regionName, transplanted, expired, discarded]) => {
  const totalRecovered = transplanted + expired + discarded;
  return {
    regionName, organType: 'Kidney', transplanted, expired, discarded, totalRecovered,
    utilizationPct: Math.round((10000 * transplanted) / totalRecovered) / 100,
  };
});

const MOCK_DECLINES = [
  ['ORGAN_QUALITY', 'Organ quality', 31], ['PATIENT_TOO_ILL', 'Patient too ill', 24],
  ['MEDICAL_CONTRAINDICATION', 'Medical contraindication', 18], ['LOGISTICAL_TIMEOUT', 'Logistical timeout', 12],
  ['PATIENT_REFUSED', 'Patient refused', 8],
].map(([code, description, occurrences]) => ({ code, description, occurrences, pct: Math.round((10000 * occurrences) / 93) / 100 }));

const MOCK_FAIRNESS = [
  { regionName: 'Northern Region', waitlistSize: 40, transplantsCompleted: 11, allocationRatePct: 27.5, medianWaitDays: 212.5, retentionPct: 81.82 },
  { regionName: 'Southern Region', waitlistSize: 52, transplantsCompleted: 14, allocationRatePct: 26.92, medianWaitDays: 240, retentionPct: 78.57 },
  { regionName: 'Eastern Region', waitlistSize: 35, transplantsCompleted: 8, allocationRatePct: 22.86, medianWaitDays: 301.4, retentionPct: 62.5 },
  { regionName: 'Western Region', waitlistSize: 30, transplantsCompleted: 0, allocationRatePct: 0, medianWaitDays: null, retentionPct: null },
];

const MOCK_COMPLIANCE = { transplanted: 98, expiredUnallocated: 4, discarded: 2, totalOrgans: 104, placementRatePct: 94.23 };

export async function getWaitingTimes(live = USE_LIVE_API) {
  if (!live) return MOCK_WAITING.map((r) => ({ ...r }));
  return apiFetch('/reports/waiting-times');
}
export async function getUtilization(live = USE_LIVE_API) {
  if (!live) return MOCK_UTILIZATION.map((r) => ({ ...r }));
  return apiFetch('/reports/utilization');
}
export async function getDeclineReasons(live = USE_LIVE_API) {
  if (!live) return MOCK_DECLINES.map((r) => ({ ...r }));
  return apiFetch('/reports/decline-reasons');
}
export async function getFairness(live = USE_LIVE_API) {
  if (!live) return MOCK_FAIRNESS.map((r) => ({ ...r }));
  return apiFetch('/reports/fairness');
}
export async function getCompliance(live = USE_LIVE_API) {
  if (!live) return { ...MOCK_COMPLIANCE };
  return apiFetch('/reports/compliance');
}
