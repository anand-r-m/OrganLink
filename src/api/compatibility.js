import { USE_LIVE_API, apiFetch } from './client.js';
import { adaptBloodCompatibility, mockBloodCompatibility, mockHlaRows } from './adapters/compatibility.js';

// Settings > Compatibility endpoints (OL-025). `live` is a trailing parameter so tests can exercise both branches.
// Write functions are live-only: mock mode edits the page's session state instead.

const liveOnly = (what) => {
  throw new Error(`${what} through the API needs live mode`);
};

export async function getBloodCompatibility(live = USE_LIVE_API) {
  if (!live) return mockBloodCompatibility();
  return adaptBloodCompatibility(await apiFetch('/blood-compatibility'));
}
// body: { donorBloodGroupId, recipientBloodGroupId, compatible } -> the updated pair
export async function setBloodCompatibility(body, live = USE_LIVE_API) {
  if (!live) return liveOnly('Changing compatibility');
  return apiFetch('/blood-compatibility', { method: 'PATCH', body });
}

export async function listHlaAlleles(locus, live = USE_LIVE_API) {
  if (!live) return mockHlaRows().filter((a) => !locus || a.locus === locus);
  return apiFetch('/hla-alleles', { params: { locus } });
}
// body: { locus, alleleName }
export async function createHlaAllele(body, live = USE_LIVE_API) {
  if (!live) return liveOnly('Adding alleles');
  return apiFetch('/hla-alleles', { method: 'POST', body });
}
export async function deleteHlaAllele(id, live = USE_LIVE_API) {
  if (!live) return liveOnly('Deleting alleles');
  return apiFetch(`/hla-alleles/${id}`, { method: 'DELETE' });
}
