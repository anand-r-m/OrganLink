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
  };
}

// Discard is offered only while an organ is AVAILABLE or EXPIRED; ALLOCATED, TRANSPLANTED and
// DISCARDED are terminal for this action (API_CONTRACT organs/:id/discard).
export const canDiscard = (organ) => organ?.status === 'AVAILABLE' || organ?.status === 'EXPIRED';

export const DISCARD_BLOCKED_TOOLTIP = 'Cancel the active offer before discarding';

// Lookup discard reasons -> Select options ("CODE - description").
export const discardReasonOptions = (reasons = []) =>
  reasons.map((r) => ({ value: String(r.id), label: `${r.code} - ${r.description}` }));

// An EXPIRED organ defaults to VIABILITY_ELAPSED (06: the candidate chain ran out); otherwise no default.
export function defaultDiscardReasonId(organ, reasons = []) {
  if (organ?.status !== 'EXPIRED') return null;
  const hit = reasons.find((r) => r.code === 'VIABILITY_ELAPSED');
  return hit ? String(hit.id) : null;
}
