import { donorId, offerId, organId, recipientId } from '../../utils/displayId.js';

// API Transplant -> row summary (hospital display id is not needed; the name is shown).
export const adaptTransplant = (t) =>
  t ? { dbId: t.id, hospitalId: t.hospitalId, hospitalName: t.hospitalName, transplantAt: t.transplantAt, outcome: t.outcome, notes: t.notes } : null;

// Record Transplant is enabled only once the accepted offer's transport is DELIVERED (07 §6).
export const TRANSPLANT_DISABLED_TIP = 'Organ has not been delivered yet';
export const canRecordTransplant = (offer) =>
  offer.status === 'ACCEPTED' && !offer.transplant && offer.transport?.status === 'DELIVERED';

// API Offer -> Offer Workflow row. Statuses stay UPPER_SNAKE; display ids are made here (A11).
export function adaptOffer(o) {
  let response = null;
  if (o.status === 'DECLINED') response = o.declineReasonCode;
  else if (o.status === 'VOIDED') response = o.voidReason;
  return {
    id: offerId(o.id),
    dbId: o.id,
    organId: organId(o.organId),
    organDbId: o.organId,
    organType: o.organType,
    donorId: donorId(o.donorId),
    recipientId: recipientId(o.recipientId),
    recipientDbId: o.recipientId,
    recipientName: o.recipientName,
    status: o.status,
    offeredAt: o.createdAt,
    sentAt: o.sentAt,
    respondedAt: o.respondedAt,
    offerExpiresAt: o.offerExpiresAt,
    response,
    declineReason: o.declineReasonCode,
    declineNotes: o.notes,
    matchRunId: o.matchRunId,
    rank: o.rank,
    transport: o.transport ?? null,
    transplant: adaptTransplant(o.transplant),
  };
}

export const adaptOfferRows = (rows) => rows.map(adaptOffer);

// Mock offer (Title Case status, string ids) -> the same row shape. Mock offers carry no run,
// rank or response deadline.
export function adaptMockOffer(m) {
  return {
    id: m.id,
    dbId: null,
    organId: m.organId,
    organDbId: null,
    organType: m.organType,
    donorId: m.donorId,
    recipientId: m.recipientId,
    recipientDbId: null,
    recipientName: null,
    status: String(m.status).toUpperCase(),
    offeredAt: m.offeredAt,
    sentAt: null,
    offerExpiresAt: null,
    response: m.response ?? null,
    declineReason: m.declineReason ?? null,
    declineNotes: m.declineNotes ?? null,
    matchRunId: null,
    rank: null,
    transport: null,
    transplant: null,
  };
}

// Record Accept modal details in live mode. The offer row carries only organType and
// recipientName, so the blood groups, hospitals and urgency come from the organ list
// (GET /api/organs) and the recipient detail (GET /api/recipients/:id). A field the source rows
// do not carry stays null and the modal shows "—". Nothing is looked up in mock data.
export function acceptDetailFromLive(offer, organRows, recipient) {
  const organ = organRows?.find((o) => o.dbId === offer.organDbId) ?? null;
  const entry = recipient?.waitlist?.find((w) => w.organType === offer.organType) ?? null;
  return {
    organ: organ && { bloodGroup: organ.bloodGroup ?? null, hospital: organ.hospital ?? null },
    recipient: recipient && {
      name: recipient.name ?? offer.recipientName ?? null,
      bloodGroup: recipient.bloodGroup ?? null,
      hospital: recipient.hospital ?? null,
      urgency: entry?.urgency ?? null,
    },
  };
}
