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
