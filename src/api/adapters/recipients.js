import { recipientId } from '../../utils/displayId.js';
import { calcAge, groupHla, groupHlaIds } from './donors.js';

// Mock recipient status (old shape) -> schema status. Offered/Waiting are both ACTIVE; the offer
// shows as the open-offer flag instead (07 §7: recipient status is not a waitlist state).
const MOCK_STATUS = { Waiting: 'ACTIVE', Offered: 'ACTIVE', Transplanted: 'TRANSPLANTED', Inactive: 'INACTIVE' };

// API WaitlistEntry -> drawer row. priorityScore is the view's number, unrounded.
export function adaptWaitlistEntry(w) {
  return {
    organTypeId: w.organTypeId,
    organType: w.organType,
    urgencyId: w.urgencyId,
    urgency: w.urgencyCode,
    listedDate: w.listedDate,
    status: w.status,
    waitMonths: w.waitMonths,
    urgencyScore: w.urgencyScore,
    waitScore: w.waitScore,
    priorityScore: w.priorityScore,
  };
}

// API Recipient -> table/drawer row. List items carry `waitlistCount` and HLA but no `waitlist`;
// detail items (GET /:id, POST, PATCH) carry the entries too. Per-entry columns (urgency, priority,
// wait time) have no single value for a recipient with several listings, so they are null in live
// mode; OL-022 shows them per waitlist row.
export function adaptRecipient(r) {
  const waitlist = Array.isArray(r.waitlist) ? r.waitlist.map(adaptWaitlistEntry) : null;
  const count = r.waitlistCount ?? waitlist?.length ?? 0;
  const hlaByLocus = groupHla(r.hla);
  return {
    id: recipientId(r.id),
    dbId: r.id,
    name: r.name,
    dob: r.dateOfBirth,
    age: calcAge(r.dateOfBirth),
    bloodGroup: r.bloodGroup,
    bloodGroupId: r.bloodGroupId,
    hospital: r.hospitalName,
    hospitalId: r.hospitalId,
    region: r.regionCode,
    status: r.status,
    height: r.heightCm,
    weight: r.weightKg,
    hasOpenOffer: Boolean(r.hasOpenOffer),
    waitlistCount: count,
    organsLabel: waitlist && waitlist.length ? waitlist.map((w) => w.organType).join(', ') : String(count),
    urgency: null,
    priorityScore: null,
    waitTime: null,
    waitlist: waitlist ?? [],
    hlaByLocus,
    hlaIdsByLocus: groupHlaIds(r.hla),
    hasDetail: waitlist !== null,
  };
}

export const adaptRecipients = (rows) => rows.map(adaptRecipient);

// Mock recipient (one row per recipient, one organ) -> the same row shape.
export function adaptMockRecipient(m) {
  const split = (v) => (v ? [v] : []);
  return {
    ...m,
    dbId: null,
    age: null,
    status: MOCK_STATUS[m.status] ?? 'ACTIVE',
    hasOpenOffer: m.status === 'Offered',
    waitlistCount: 1,
    organsLabel: m.organNeeded,
    waitTime: m.waitTime,
    waitlist: [
      {
        organTypeId: null,
        organType: m.organNeeded,
        urgency: m.urgency,
        listedDate: null,
        status: 'ACTIVE',
        waitMonths: null,
        priorityScore: m.priorityScore,
      },
    ],
    hlaByLocus: { A: split(m.hlaA), B: split(m.hlaB), DRB1: split(m.hlaDR) },
    hasDetail: true,
  };
}

// Mock-mode filter, mirroring the server: any waitlist entry may match organ (name) or urgency.
export function filterRecipients(rows, { organ, bloodGroup, urgency, status } = {}) {
  return rows.filter(
    (r) =>
      (!organ || r.waitlist.some((w) => w.organType === organ)) &&
      (!bloodGroup || r.bloodGroup === bloodGroup) &&
      (!urgency || r.waitlist.some((w) => w.urgency === urgency)) &&
      (!status || r.status === status),
  );
}
