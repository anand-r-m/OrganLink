import { ApiError, USE_LIVE_API, apiFetch } from './client.js';
import { adaptMockOrgan, adaptOrganRow, adaptOrganRows, canDiscard } from './adapters/organs.js';
import { mockOrgans } from '../data/mockOrgans.js';
import { hasActiveMockOffer } from './offers.js';

// Mock mode keeps discards in this module (the imported mock data is never mutated).
const mockDiscarded = new Map();
export const resetMockOrgans = () => mockDiscarded.clear();
const withMockDiscards = (o) => (mockDiscarded.has(o.id) ? { ...o, status: 'DISCARDED', isExpired: false } : o);

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
    const rows = mockOrgans.map(adaptMockOrgan).map(withMockDiscards).map((o) => ({ ...o, hasActiveOffer: hasActiveMockOffer(o.id) }));
    return filterMock(rows, { status, available });
  }
  return adaptOrganRows(
    await apiFetch('/organs', { params: { status, available: available ? 'true' : undefined, organTypeId } }),
  );
}

// POST /api/organs/:id/discard: AVAILABLE or EXPIRED -> DISCARDED with a coded reason (lookups
// discardReasons id). Resolves to the updated row. Mock mode applies the same rules in memory.
export async function discardOrgan(organ, discardReasonId, live = USE_LIVE_API) {
  if (!live) {
    // Same order as the server: status first, then the open offer.
    if (!canDiscard(organ)) {
      throw new ApiError(409, 'INVALID_STATE_TRANSITION', `Organ is ${organ.status}; only an AVAILABLE or EXPIRED organ, or an ALLOCATED organ whose viability elapsed before departure, can be discarded`);
    }
    if (hasActiveMockOffer(organ.id)) {
      throw new ApiError(409, 'ACTIVE_OFFER_EXISTS', 'This organ already has an active offer');
    }
    mockDiscarded.set(organ.id, discardReasonId);
    return { ...organ, status: 'DISCARDED', isExpired: false };
  }
  return adaptOrganRow(
    await apiFetch(`/organs/${organ.dbId}/discard`, { method: 'POST', body: { discardReasonId: Number(discardReasonId) } }),
  );
}
