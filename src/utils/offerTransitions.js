/* Centralized offer status machine — ui_mastercontext.md Section 5.6.
   Kept separate from presentation so the workflow rules are easy to inspect
   and reuse (Dev 3 Task 3.3). */

/* Statuses use the schema's UPPER_SNAKE values (live and mock). Mock mode only. */
export const OFFER_STATUSES = ['CREATED', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'VOIDED', 'CANCELLED'];

/* One-active-offer rule (Section 5.6): an organ has an "active" offer when a
   CREATED or SENT offer exists for it. ACCEPTED / DECLINED / EXPIRED / VOIDED / CANCELLED are
   terminal and do not block a new offer for the same organ. */
export const ACTIVE_OFFER_STATUSES = ['CREATED', 'SENT'];

/* User-actionable transitions. Expired is applied automatically by the system
   after the viability window (no user action), so it is not listed as a target
   of any user transition. */
export const OFFER_TRANSITIONS = {
  CREATED: ['SENT', 'CANCELLED'],
  SENT: ['ACCEPTED', 'DECLINED', 'CANCELLED'],
  ACCEPTED: [],
  DECLINED: [],
  EXPIRED: [],
  VOIDED: [],
  CANCELLED: [],
};

/* Six documented decline reasons (Section 5.6). */
export const DECLINE_REASONS = [
  'Medical contraindication',
  'Patient too ill',
  'Organ quality concern',
  'Logistical timeout',
  'Patient refused',
  'Other',
];

export function isActiveOfferStatus(status) {
  return ACTIVE_OFFER_STATUSES.includes(status);
}

export function getAllowedTransitions(status) {
  return OFFER_TRANSITIONS[status] ?? [];
}

export function canTransition(from, to) {
  if (from === to) return false;
  return getAllowedTransitions(from).includes(to);
}

export function getActiveOfferForOrgan(offers, organId) {
  return offers.find((o) => o.organId === organId && isActiveOfferStatus(o.status)) ?? null;
}

export function hasActiveOfferForOrgan(offers, organId) {
  return getActiveOfferForOrgan(offers, organId) !== null;
}

/* Immutable transition: returns a new offer object with the new status (and any
   extra patch). Throws for transitions the document does not allow, so callers
   can surface a clear error instead of silently changing state. */
export function transitionOffer(offer, toStatus, patch = {}) {
  if (!offer) {
    throw new Error('Offer record is missing');
  }
  if (!canTransition(offer.status, toStatus)) {
    throw new Error(`Invalid offer transition: ${offer.status} → ${toStatus}`);
  }
  return { ...offer, status: toStatus, ...patch };
}

/* Deterministic frontend offer ID: increments past the highest numeric OFR-XXXX
   currently present, so IDs are unique without depending on Date.now/random. */
export function generateOfferId(offers) {
  const max = offers.reduce((acc, offer) => {
    const match = String(offer?.id ?? '').match(/OFR-(\d+)/);
    const num = match ? parseInt(match[1], 10) : 0;
    return Number.isNaN(num) ? acc : Math.max(acc, num);
  }, 0);
  return `OFR-${String(max + 1).padStart(4, '0')}`;
}

/* Builds a fresh Created offer for a selected organ + recipient, deriving
   organType and donorId from the organ record. Never mutates inputs. */
export function createOfferFromSelection({ offers, organs, organId, recipientId }) {
  const organ = organs.find((o) => o.id === organId);
  return {
    id: generateOfferId(offers),
    organId,
    organType: organ?.organType ?? 'Unknown',
    donorId: organ?.donorId ?? 'Unknown',
    recipientId,
    status: 'CREATED',
    offeredAt: new Date().toISOString(),
    response: null,
    declineReason: null,
  };
}
