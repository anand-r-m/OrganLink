import { USE_LIVE_API, apiFetch } from './client.js';
import { adaptRegions, adaptOrganTypes, MOCK_DEFAULT_WEIGHTS } from './adapters/settings.js';
import { mockRegions } from '../data/mockRegions.js';

// Settings endpoints (OL-024). `live` is a trailing parameter so tests can exercise both branches.
// Write functions are live-only: mock mode edits the page's session state instead.

const liveOnly = (what) => {
  throw new Error(`${what} through the API needs live mode`);
};

// Mock regions are given the schema-default weights so the Policy Weights tab can bind to them.
const mockRegionRows = () =>
  mockRegions.map((r, i) => ({
    id: i + 1,
    code: r.code,
    name: r.name,
    allocationPolicy: r.allocationPolicy,
    hospitalCount: r.hospitalCount,
    weights: { ...MOCK_DEFAULT_WEIGHTS },
  }));

export async function listRegions(live = USE_LIVE_API) {
  if (!live) return mockRegionRows();
  return adaptRegions(await apiFetch('/regions'));
}
export async function createRegion(body, live = USE_LIVE_API) {
  if (!live) return liveOnly('Creating regions');
  return apiFetch('/regions', { method: 'POST', body });
}
// body: { name?, code?, weights?: { hla?, urgency?, distance?, wait? } }
export async function updateRegion(id, body, live = USE_LIVE_API) {
  if (!live) return liveOnly('Updating regions');
  return apiFetch(`/regions/${id}`, { method: 'PATCH', body });
}

export async function listOrganTypes(live = USE_LIVE_API) {
  if (!live) return null; // the tab keeps its own mock rows
  return adaptOrganTypes(await apiFetch('/organ-types'));
}
export async function createOrganType(body, live = USE_LIVE_API) {
  if (!live) return liveOnly('Creating organ types');
  return apiFetch('/organ-types', { method: 'POST', body });
}
export async function updateOrganType(id, body, live = USE_LIVE_API) {
  if (!live) return liveOnly('Updating organ types');
  return apiFetch(`/organ-types/${id}`, { method: 'PATCH', body });
}

export async function createHospital(body, live = USE_LIVE_API) {
  if (!live) return liveOnly('Creating hospitals');
  return apiFetch('/hospitals', { method: 'POST', body });
}
// Suspend / activate: updateHospital(id, { status: 'SUSPENDED' | 'ACTIVE' }).
export async function updateHospital(id, body, live = USE_LIVE_API) {
  if (!live) return liveOnly('Updating hospitals');
  return apiFetch(`/hospitals/${id}`, { method: 'PATCH', body });
}
