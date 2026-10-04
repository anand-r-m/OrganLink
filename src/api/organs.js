import { USE_LIVE_API, apiFetch } from './client.js';
import { adaptMockOrgan, adaptOrganRows } from './adapters/organs.js';
import { mockOrgans } from '../data/mockOrgans.js';
import { hasActiveMockOffer } from './offers.js';

// Filters the mock rows the way the server does, so the UI behaves the same in both modes.
function filterMock(rows, { status, available } = {}) {
  return rows.filter(
    (o) => (!status || o.status === status) && (available !== true || (o.status === 'AVAILABLE' && !o.isExpired)),
  );
}

// Mock mode returns mockOrgans; live mode calls GET /api/organs (05 §7). `available` is a boolean
// here and is sent as ?available=true. `live` is a parameter only so tests can exercise both branches.
export async function listOrgans({ status, available, organTypeId } = {}, live = USE_LIVE_API) {
  if (!live) {
    // Mock organs do not model offers; the mock offer store supplies the open-offer flag.
    const rows = mockOrgans.map(adaptMockOrgan).map((o) => ({ ...o, hasActiveOffer: hasActiveMockOffer(o.id) }));
    return filterMock(rows, { status, available });
  }
  return adaptOrganRows(
    await apiFetch('/organs', { params: { status, available: available ? 'true' : undefined, organTypeId } }),
  );
}
