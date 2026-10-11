import { donorId, organId } from '../../utils/displayId.js';

// API OrganSummary -> Organs page row. Elapsed hours feed ViabilityCountdown.
export function adaptOrganRow(o) {
  return {
    id: organId(o.id),
    dbId: o.id,
    organType: o.organType,
    donor: donorId(o.donorId),
    donorName: o.donorName,
    bloodGroup: o.donorBloodGroup,
    hospital: o.recoveringHospitalName,
    region: o.regionCode,
    recoveredAt: o.recoveredAt,
    expiresAt: o.expiresAt,
    viabilityHours: o.maxViabilityHours,
    elapsedHours: Math.max(0, o.maxViabilityHours - o.hoursRemaining),
    isExpired: o.isExpired,
    status: o.status,
    hasActiveOffer: o.hasActiveOffer,
    activeOfferId: o.activeOfferId,
    transportStatus: o.transportStatus ?? null,
  };
}

export const adaptOrganRows = (rows) => rows.map(adaptOrganRow);

// Mock organ (old shape: Title Case status, string ids) -> the same row shape. Mock organs have
// no recovery time, so recoveredAt/expiresAt are null; the active-offer flag is not modelled.
export function adaptMockOrgan(m) {
  const status = String(m.status).toUpperCase();
  return {
    id: m.id,
    dbId: null,
    organType: m.organType,
    donor: m.donorId,
    donorName: null,
    bloodGroup: m.bloodGroup,
    hospital: m.hospital,
    region: m.region,
    recoveredAt: null,
    expiresAt: null,
    viabilityHours: m.viabilityHours,
    elapsedHours: m.elapsedHours,
    isExpired: status === 'EXPIRED',
    status,
    hasActiveOffer: false,
    activeOfferId: null,
    transportStatus: null,
  };
}

// An ALLOCATED organ whose viability window has elapsed (the sweep never expires it, OL-DEC-02).
const expiredAllocation = (organ) => organ?.status === 'ALLOCATED' && organ.isExpired === true;

// Discard is accepted for an AVAILABLE or EXPIRED organ, and for an expired ALLOCATED organ whose
// transport has not departed (OL-042). TRANSPLANTED and DISCARDED are terminal for this action
// (API_CONTRACT organs/:id/discard).
export const canDiscard = (organ) =>
  organ?.status === 'AVAILABLE' ||
  organ?.status === 'EXPIRED' ||
  (expiredAllocation(organ) && organ.transportStatus === 'PENDING');

export const DISCARD_BLOCKED_TOOLTIP = 'Cancel the active offer before discarding';
export const DISCARD_IN_TRANSIT_TOOLTIP = 'Already in transit; it can still be delivered, so it cannot be discarded';

// The Discard button is shown when the server would accept it, and shown disabled for an expired
// organ that is already in transit.
export const showsDiscard = (organ) =>
  canDiscard(organ) || (expiredAllocation(organ) && organ.transportStatus === 'IN_TRANSIT');

// Why a shown Discard button is disabled (its tooltip), or null when it is enabled.
export function discardBlockedTooltip(organ) {
  if (!canDiscard(organ)) return DISCARD_IN_TRANSIT_TOOLTIP;
  if (organ.hasActiveOffer) return DISCARD_BLOCKED_TOOLTIP;
  return null;
}

// Lookup discard reasons -> Select options ("CODE - description").
export const discardReasonOptions = (reasons = []) =>
  reasons.map((r) => ({ value: String(r.id), label: `${r.code} - ${r.description}` }));

// An EXPIRED organ, or an expired ALLOCATED one (OL-042), defaults to VIABILITY_ELAPSED (06: the
// candidate chain ran out); otherwise no default.
export function defaultDiscardReasonId(organ, reasons = []) {
  if (organ?.status !== 'EXPIRED' && !expiredAllocation(organ)) return null;
  const hit = reasons.find((r) => r.code === 'VIABILITY_ELAPSED');
  return hit ? String(hit.id) : null;
}
