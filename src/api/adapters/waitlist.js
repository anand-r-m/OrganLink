import { recipientId as displayRecipientId } from '../../utils/displayId.js';

// Urgency score values from the reference seed (urgency.score_value). Mock mode only: live mode
// gets the real scores from v_waitlist_scored.
const MOCK_URGENCY_SCORE = { '1A': 100, '1B': 60, '2': 25 };

export const WAITLIST_STATUSES = ['ACTIVE', 'SUSPENDED', 'TRANSPLANTED', 'REMOVED'];
// PATCH may set these; TRANSPLANTED is set only by the transplant trigger (API_CONTRACT).
export const EDITABLE_STATUSES = ['ACTIVE', 'SUSPENDED', 'REMOVED'];

// Months -> "7 months" / "14 months" / "2.5 years". Under a month reads "< 1 month".
export function formatWaitMonths(months) {
  if (months == null || Number.isNaN(Number(months))) return '—';
  const m = Number(months);
  if (m < 1) return '< 1 month';
  if (m < 24) return `${Math.round(m)} ${Math.round(m) === 1 ? 'month' : 'months'}`;
  return `${(m / 12).toFixed(1)} years`;
}

// Two decimals, matching the view's NUMERIC(.,2) priority score.
export const formatScore = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(2));

// Priority tooltip content (08 §7): exactly urgency and waiting time. No HLA, distance, size or
// match score; those belong to the per-organ match score, not the waitlist priority.
export function priorityBreakdown(entry) {
  return [
    { key: 'urgency', label: 'Urgency', detail: entry.urgency ?? '—', score: entry.urgencyScore ?? null },
    { key: 'waiting', label: 'Waiting time', detail: formatWaitMonths(entry.waitMonths), score: entry.waitScore ?? null },
  ];
}

// API WaitlistEntry -> table row (one per waitlist entry). `urgency` is the code.
export function adaptWaitlistRow(w) {
  return {
    key: `${w.recipientId}-${w.organTypeId}`,
    id: displayRecipientId(w.recipientId),
    recipientDbId: w.recipientId,
    name: w.recipientName,
    bloodGroup: w.bloodGroup,
    hospital: w.hospitalName,
    organTypeId: w.organTypeId,
    organType: w.organType,
    urgencyId: w.urgencyId,
    urgency: w.urgencyCode,
    listedDate: w.listedDate,
    status: w.status,
    waitMonths: w.waitMonths,
    waitTime: formatWaitMonths(w.waitMonths),
    urgencyScore: w.urgencyScore,
    waitScore: w.waitScore,
    priorityScore: w.priorityScore,
  };
}

export const adaptWaitlistRows = (rows) => rows.map(adaptWaitlistRow);

const parseMonths = (text) => {
  const m = /^(\d+(?:\.\d+)?)\s*month/.exec(text ?? '');
  return m ? Number(m[1]) : null;
};

// Mock mode: flatten the session recipients into one row per waitlist entry. Component scores are
// derived from the mock urgency and wait time with the view's formula; the mock priority score
// itself stays as in the mock data.
export function mockWaitlistRows(recipients) {
  return recipients.flatMap((r) =>
    (r.waitlist ?? []).map((w, i) => {
      const months = w.waitMonths ?? (i === 0 ? parseMonths(r.waitTime) : null);
      return {
        key: `${r.id}-${w.organType}`,
        id: r.id,
        recipientDbId: r.dbId ?? null,
        name: r.name,
        bloodGroup: r.bloodGroup,
        hospital: r.hospital,
        organTypeId: w.organTypeId ?? null,
        organType: w.organType,
        urgencyId: null,
        urgency: w.urgency,
        listedDate: w.listedDate ?? null,
        status: w.status,
        waitMonths: months,
        waitTime: formatWaitMonths(months),
        urgencyScore: w.urgencyScore ?? MOCK_URGENCY_SCORE[w.urgency] ?? null,
        waitScore:
          w.waitScore ?? (months == null ? null : Math.min(100, (100 * Math.log(1 + months)) / Math.log(61))),
        priorityScore: w.priorityScore,
        recipient: r,
      };
    }),
  );
}

// Mock-mode filter for waitlist rows: organ is the organ NAME, status is the entry status.
export function filterWaitlistRows(rows, { organ, bloodGroup, urgency, status } = {}) {
  return rows.filter(
    (r) =>
      (!organ || r.organType === organ) &&
      (!bloodGroup || r.bloodGroup === bloodGroup) &&
      (!urgency || r.urgency === urgency) &&
      (!status || r.status === status),
  );
}

// Minimal drawer row shown while GET /api/recipients/:id loads (hasDetail false keeps Edit disabled).
export function recipientStub(row) {
  return {
    id: row.id,
    dbId: row.recipientDbId,
    name: row.name,
    bloodGroup: row.bloodGroup,
    hospital: row.hospital,
    status: null,
    hasOpenOffer: false,
    waitlist: [],
    hlaByLocus: {},
    hasDetail: false,
  };
}

// Draft ({urgencyId, status} as select strings) -> PATCH body holding only what changed.
export function entryPatchBody(entry, draft) {
  const body = {};
  if (draft.urgencyId != null && Number(draft.urgencyId) !== Number(entry.urgencyId)) {
    body.urgencyId = Number(draft.urgencyId);
  }
  if (draft.status != null && draft.status !== entry.status) body.status = draft.status;
  return body;
}

// "Add organ listing" form ({organTypeId, urgencyId, listedDate: Date|string|null}) -> POST body.
export function listingFormToBody(recipientId, f) {
  const body = { recipientId, organTypeId: Number(f.organTypeId), urgencyId: Number(f.urgencyId) };
  if (f.listedDate) {
    const d = new Date(f.listedDate);
    const pad = (n) => String(n).padStart(2, '0');
    body.listedDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return body;
}

// Both selects are required; the date is optional (defaults to today server-side).
export const validateListingForm = (f) => {
  const e = {};
  if (!f.organTypeId) e.organTypeId = 'Choose an organ type';
  if (!f.urgencyId) e.urgencyId = 'Choose an urgency';
  return e;
};
