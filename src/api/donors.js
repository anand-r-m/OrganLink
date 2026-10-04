import { USE_LIVE_API, apiFetch } from './client.js';
import { adaptDonor, adaptDonors, adaptMockDonor, adaptOrgan } from './adapters/donors.js';
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

// POST /api/donors/:id/organs: procure an organ (starts the viability clock). Live mode only;
// mock mode has no organ store, so the UI disables the action there. Returns the adapted organ.
export async function procureOrgan(donor, { organTypeId, recoveringHospitalId, recoveredAt }, live = USE_LIVE_API) {
  if (!live) throw new Error('Procure Organ is only available in live mode');
  const organ = await apiFetch(`/donors/${donor.dbId}/organs`, {
    method: 'POST',
    body: { organTypeId, recoveringHospitalId, recoveredAt },
  });
  return adaptOrgan(organ);
}

// POST /api/donors: register a donor (body from formToDonorBody). Live mode only; mock mode keeps
// its local-state behaviour in the page. Returns the adapted donor (with HLA and organs).
export async function createDonor(body, live = USE_LIVE_API) {
  if (!live) throw new Error('Registering donors through the API needs live mode');
  return adaptDonor(await apiFetch('/donors', { method: 'POST', body }));
}

// PATCH /api/donors/:id: any subset of the donor fields; hlaAlleleIds replaces the HLA set.
// Deactivate is updateDonor(donor, { status: 'INACTIVE' }).
export async function updateDonor(donor, body, live = USE_LIVE_API) {
  if (!live) throw new Error('Updating donors through the API needs live mode');
  return adaptDonor(await apiFetch(`/donors/${donor.dbId}`, { method: 'PATCH', body }));
}
