// Pure helpers for the Register/Edit recipient form. HLA, date and option helpers are shared with
// the donor form. Select values are strings: ids in live mode, names in mock mode.
import { LOCI, MAX_ALLELES_PER_LOCUS, toDateOnly } from './donorForm.js';

export { LOCI, MAX_ALLELES_PER_LOCUS, hlaOptionsFromLookups, hlaOptionsFromMock } from './donorForm.js';

export const RECIPIENT_STATUSES = ['ACTIVE', 'INACTIVE', 'TRANSPLANTED', 'DECEASED'];

export const emptyWaitlistRow = () => ({ organType: null, urgency: null, listedDate: null });

export function emptyRecipientForm() {
  return {
    name: '',
    dob: null,
    bloodGroup: null,
    hospital: null,
    status: 'ACTIVE',
    height: '',
    weight: '',
    hla: { A: [], B: [], DRB1: [] },
    waitlist: [emptyWaitlistRow()],
  };
}

export const addWaitlistRow = (f) => ({ ...f, waitlist: [...f.waitlist, emptyWaitlistRow()] });
export const removeWaitlistRow = (f, i) => ({ ...f, waitlist: f.waitlist.filter((_, j) => j !== i) });
export const setWaitlistRow = (f, i, patch) => ({
  ...f,
  waitlist: f.waitlist.map((w, j) => (j === i ? { ...w, ...patch } : w)),
});

// Adapted recipient row -> edit-form state (no waitlist: PATCH cannot change it).
export function recipientToForm(r, { live, now = Date.now() } = {}) {
  const dob = r.dob
    ? new Date(`${r.dob}T00:00:00`)
    : r.age != null
      ? new Date(now - r.age * 365.25 * 24 * 3600 * 1000)
      : null;
  const hla = live
    ? Object.fromEntries(LOCI.map((l) => [l, (r.hlaIdsByLocus?.[l] ?? []).map(String)]))
    : Object.fromEntries(LOCI.map((l) => [l, [...(r.hlaByLocus?.[l] ?? [])]]));
  return {
    name: r.name ?? '',
    dob,
    bloodGroup: live ? (r.bloodGroupId != null ? String(r.bloodGroupId) : null) : r.bloodGroup ?? null,
    hospital: live ? (r.hospitalId != null ? String(r.hospitalId) : null) : r.hospital ?? null,
    status: r.status ?? 'ACTIVE',
    height: r.height ?? '',
    weight: r.weight ?? '',
    hla,
    waitlist: [],
  };
}

const isBlank = (v) => v === '' || v === null || v === undefined;

// Client-side shape checks only. Range and date rules the DB owns (ck_waitlist_not_future, height and
// weight CHECKs) surface as the server's message; the min/max here only mirror the inputs' bounds.
// `mode` 'create' needs at least one waitlist row; 'edit' ignores the waitlist.
export function validateRecipientForm(f, mode = 'create', now = Date.now()) {
  const e = {};
  if (!f.name || f.name.trim().length < 2) e.name = 'Name is required';
  if (!f.dob || Number.isNaN(new Date(f.dob).getTime()) || new Date(f.dob).getTime() >= now) {
    e.dob = 'Valid date of birth required';
  }
  if (!f.bloodGroup) e.bloodGroup = 'Select blood group';
  if (!f.hospital) e.hospital = 'Select hospital';
  if (mode === 'edit' && !RECIPIENT_STATUSES.includes(f.status)) e.status = 'Select status';
  if (isBlank(f.height)) e.height = 'Height is required';
  else if (Number(f.height) < 100 || Number(f.height) > 220) e.height = 'Height must be between 100–220 cm';
  if (isBlank(f.weight)) e.weight = 'Weight is required';
  else if (Number(f.weight) < 20 || Number(f.weight) > 200) e.weight = 'Weight must be between 20–200 kg';
  for (const l of LOCI) {
    if ((f.hla?.[l] ?? []).length > MAX_ALLELES_PER_LOCUS) {
      e[`hla${l}`] = `Select at most ${MAX_ALLELES_PER_LOCUS} alleles`;
    }
  }
  if (mode === 'create') {
    if (!f.waitlist?.length) e.waitlist = 'Add at least one waitlist entry';
    else if (f.waitlist.some((w) => !w.organType || !w.urgency)) e.waitlist = 'Each entry needs an organ type and urgency';
  }
  return e;
}

// Form -> request body (live mode: select values are ids). Create sends the waitlist and no status
// (the server defaults ACTIVE); edit sends status and never the waitlist.
export function formToRecipientBody(f, mode = 'create') {
  const body = {
    name: f.name.trim(),
    dateOfBirth: toDateOnly(f.dob),
    bloodGroupId: Number(f.bloodGroup),
    hospitalId: Number(f.hospital),
    heightCm: Number(f.height),
    weightKg: Number(f.weight),
    hlaAlleleIds: LOCI.flatMap((l) => (f.hla?.[l] ?? []).map(Number)),
  };
  if (mode === 'edit') return { ...body, status: f.status };
  return {
    ...body,
    waitlist: f.waitlist.map((w) => ({
      organTypeId: Number(w.organType),
      urgencyId: Number(w.urgency),
      ...(w.listedDate ? { listedDate: toDateOnly(w.listedDate) } : {}),
    })),
  };
}

const FIELD_MAP = {
  name: 'name',
  dateOfBirth: 'dob',
  bloodGroupId: 'bloodGroup',
  hospitalId: 'hospital',
  status: 'status',
  heightCm: 'height',
  weightKg: 'weight',
  waitlist: 'waitlist',
};
const CONSTRAINT_FIELD = { ck_waitlist_not_future: 'waitlist' };

// ApiError -> { message, fields }: the server message always shows form-level; known fields and
// constraints also get an inline error.
export function serverErrorToForm(err) {
  const message = err?.message || 'Request failed';
  const fields = {};
  const c = err?.details?.constraint;
  if (c && CONSTRAINT_FIELD[c]) fields[CONSTRAINT_FIELD[c]] = message;
  for (const f of err?.details?.fields ?? []) {
    const key = FIELD_MAP[String(f).split(/[[.]/)[0]];
    if (key) fields[key] = message;
  }
  if (err?.code === 'DUPLICATE') fields.waitlist = message;
  return { message, fields };
}

// Mock mode: form -> the old one-organ mock row (extra entries are kept only in the drawer).
export function formToMockRecipient(f, { id, region = '' } = {}) {
  const first = f.waitlist?.[0] ?? {};
  const join = (l) => (f.hla?.[l] ?? []).join(', ');
  return {
    id,
    name: f.name,
    bloodGroup: f.bloodGroup,
    organNeeded: first.organType ?? '',
    urgency: first.urgency ?? '',
    priorityScore: 0,
    waitTime: '0 months',
    status: 'Waiting',
    hospital: f.hospital,
    region,
    hlaA: join('A'),
    hlaB: join('B'),
    hlaDR: join('DRB1'),
    height: Number(f.height),
    weight: Number(f.weight),
  };
}
