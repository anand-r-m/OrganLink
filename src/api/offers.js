import { ApiError, USE_LIVE_API, apiFetch } from './client.js';
import { adaptMockOffer, adaptOffer, adaptOfferRows } from './adapters/offers.js';
import { mockOffers } from '../data/mockOffers.js';
import { generateOfferId, isActiveOfferStatus, transitionOffer } from '../utils/offerTransitions.js';

// Mock mode keeps offers in this module so the console and the Offers page share them. The
// imported mock data is never mutated.
let mockRows = mockOffers.map(adaptMockOffer);
export const resetMockOffers = () => {
  mockRows = mockOffers.map(adaptMockOffer);
};
// Mock accept/decline (live in OL-016) still run in the page; it persists their result here.
export const saveMockOffer = (row) => {
  mockRows = mockRows.some((o) => o.id === row.id) ? mockRows.map((o) => (o.id === row.id ? row : o)) : [row, ...mockRows];
};
export const hasActiveMockOffer = (organKey) => mockRows.some((o) => o.organId === organKey && isActiveOfferStatus(o.status));

// GET /api/offers. `status` is one status or a comma-separated list. `live` is a parameter only
// so tests can exercise both branches.
export async function listOffers({ status, organId } = {}, live = USE_LIVE_API) {
  if (!live) {
    const wanted = status ? status.split(',') : null;
    return mockRows.filter((o) => (!wanted || wanted.includes(o.status)) && (!organId || o.organDbId === organId));
  }
  return adaptOfferRows(await apiFetch('/offers', { params: { status, organId } }));
}

// POST /api/offers for a ranked candidate of `run` (adapted organ row, candidate card, run).
export async function createOffer({ organ, candidate, run }, live = USE_LIVE_API) {
  if (!live) {
    if (hasActiveMockOffer(organ.id)) {
      throw new ApiError(409, 'ACTIVE_OFFER_EXISTS', 'This organ already has an active offer');
    }
    const row = {
      ...adaptMockOffer({
        id: generateOfferId(mockRows),
        organId: organ.id,
        organType: organ.organType,
        donorId: organ.donor,
        recipientId: candidate.recipient,
        status: 'Created',
        offeredAt: new Date().toISOString(),
      }),
      matchRunId: run?.dbId ?? null,
      rank: candidate.rank ?? null,
    };
    saveMockOffer(row);
    return row;
  }
  return adaptOffer(
    await apiFetch('/offers', {
      method: 'POST',
      body: { organId: organ.dbId, recipientId: candidate.recipientDbId, matchRunId: run?.dbId },
    }),
  );
}

function mockTransition(offer, status, patch = {}) {
  const row = transitionOffer(offer, status, patch);
  saveMockOffer(row);
  return row;
}

// POST /api/offers/:id/send: CREATED -> SENT (409 INVALID_STATE_TRANSITION otherwise).
export async function sendOffer(offer, live = USE_LIVE_API) {
  if (!live) return mockTransition(offer, 'SENT', { sentAt: new Date().toISOString() });
  return adaptOffer(await apiFetch(`/offers/${offer.dbId}/send`, { method: 'POST' }));
}

// POST /api/offers/:id/cancel: CREATED or SENT -> CANCELLED.
export async function cancelOffer(offer, live = USE_LIVE_API) {
  if (!live) return mockTransition(offer, 'CANCELLED');
  return adaptOffer(await apiFetch(`/offers/${offer.dbId}/cancel`, { method: 'POST' }));
}
