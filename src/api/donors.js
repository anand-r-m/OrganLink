import { USE_LIVE_API, apiFetch } from './client.js';
import { adaptDonor, adaptDonors, adaptMockDonor } from './adapters/donors.js';
import { mockDonors } from '../data/mockDonors.js';

// Filters the mock rows the way the server does, so the UI behaves the same in both modes.
// In mock mode `hospital` is a hospital name (mock hospitals have string ids).
function filterMock(rows, { status, type, hospital } = {}) {
  return rows.filter(
    (d) =>
      (!status || d.status === status) &&
      (!type || d.donorType === type) &&
      (!hospital || d.hospital === hospital),
  );
}

// Mock mode returns mockDonors; live mode calls GET /api/donors with the filters in the query
// string (05 §7). `live` is a parameter only so tests can exercise both branches.
export async function listDonors(params, live = USE_LIVE_API) {
  if (!live) return filterMock(mockDonors.map(adaptMockDonor), params);
  return adaptDonors(await apiFetch('/donors', { params }));
}

// GET /api/donors/:id (donor + HLA + organs). `donor` is an adapted list row.
export async function getDonor(donor, live = USE_LIVE_API) {
  if (!live) return donor;
  return adaptDonor(await apiFetch(`/donors/${donor.dbId}`));
}
