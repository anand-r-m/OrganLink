import { ApiError, USE_LIVE_API, apiFetch } from './client.js';
import { adaptTransplant, canRecordTransplant, TRANSPLANT_DISABLED_TIP } from './adapters/offers.js';
import { saveMockOffer } from './offers.js';

export const TRANSPLANT_OUTCOMES = [
  { value: 'SUCCESS', label: 'Success' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'ORGAN_NOT_USED', label: 'Organ Not Used' },
];

// POST /api/transplants for an ACCEPTED offer row. Resolves to the new transplant summary.
// `transplantAt` is an ISO string (optional; the server defaults to now). Live errors: 422 RULE_VIOLATION
// before delivery, 409 TRANSPLANT_ALREADY_RECORDED. `live` is a parameter only so tests can use both branches.
export async function recordTransplant(offer, { outcome, transplantAt, notes } = {}, live = USE_LIVE_API) {
  if (!live) {
    // Mock mirror of the delivery trigger. Mock accepts create no transport, so this is rarely reachable.
    if (!canRecordTransplant(offer)) {
      throw new ApiError(422, 'RULE_VIOLATION', `Cannot record transplant: ${TRANSPLANT_DISABLED_TIP.toLowerCase()}`);
    }
    const transplant = { dbId: null, hospitalId: null, hospitalName: null, transplantAt: transplantAt ?? new Date().toISOString(), outcome, notes: notes || null };
    saveMockOffer({ ...offer, transplant });
    return transplant;
  }
  return adaptTransplant(
    await apiFetch('/transplants', {
      method: 'POST',
      body: { offerId: offer.dbId, outcome, transplantAt: transplantAt || undefined, notes: notes || undefined },
    }),
  );
}
