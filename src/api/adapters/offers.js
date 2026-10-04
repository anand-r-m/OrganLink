import { donorId, offerId, organId, recipientId } from '../../utils/displayId.js';

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
  };
}
