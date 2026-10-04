// Pure helpers for the Register/Edit donor form: state shape, prefill, validation, request body and
// server-error mapping. No React here, so node --test can cover them.
// Select values are strings: ids (as strings) in live mode, names in mock mode.

export const LOCI = ['A', 'B', 'DRB1'];
export const MAX_ALLELES_PER_LOCUS = 2;

export function emptyDonorForm() {
  return {
    name: '',
    dob: null,
    bloodGroup: null,
    hospital: null,
    donorType: 'LIVING',
    status: 'ACTIVE',
    deathDate: null,
    deathCause: '',
    height: '',
    weight: '',
    hla: { A: [], B: [], DRB1: [] },
  };
}

// Donor type drives the death fields (BR-1): switching to LIVING clears them.
export function setDonorType(form, donorType) {
  return donorType === 'LIVING'
    ? { ...form, donorType, deathDate: null, deathCause: '' }
    : { ...form, donorType };
}

// Adapted donor row (adaptDonor / adaptMockDonor) -> form state.
export function donorToForm(d, { live, now = Date.now() } = {}) {
  const dob = d.dob
    ? new Date(`${d.dob}T00:00:00`)
    : d.age != null
      ? new Date(now - d.age * 365.25 * 24 * 3600 * 1000) // mock rows only carry an age
      : null;
  const hla = live
    ? Object.fromEntries(LOCI.map((l) => [l, (d.hlaIdsByLocus?.[l] ?? []).map(String)]))
    : Object.fromEntries(LOCI.map((l) => [l, [...(d.hlaByLocus?.[l] ?? [])]]));
  return {
    name: d.name ?? '',
    dob,
    bloodGroup: live ? (d.bloodGroupId != null ? String(d.bloodGroupId) : null) : d.bloodGroup ?? null,
    hospital: live ? (d.hospitalId != null ? String(d.hospitalId) : null) : d.hospital ?? null,
    donorType: d.donorType ?? 'LIVING',
    status: d.status ?? 'ACTIVE',
    deathDate: d.deathDate ? new Date(d.deathDate) : null,
    deathCause: d.deathCause ?? '',
    height: d.height ?? '',
    weight: d.weight ?? '',
    hla,
  };
}

// GET /api/lookups hlaAlleles -> { A: [{value,label}], B: [...], DRB1: [...] } (value = id string).
export function hlaOptionsFromLookups(hlaAlleles = []) {
  const out = Object.fromEntries(LOCI.map((l) => [l, []]));
  for (const a of hlaAlleles) out[a.locus]?.push({ value: String(a.id), label: a.alleleName });
  return out;
}

// Mock mode has no lookups: offer the alleles that appear in the mock donors (value = name).
export function hlaOptionsFromMock(mockRows = []) {
  const sets = Object.fromEntries(LOCI.map((l) => [l, new Set()]));
  for (const m of mockRows) {
    if (m.hlaA) sets.A.add(m.hlaA);
    if (m.hlaB) sets.B.add(m.hlaB);
    if (m.hlaDR) sets.DRB1.add(m.hlaDR);
  }
  return Object.fromEntries(LOCI.map((l) => [l, [...sets[l]].sort().map((v) => ({ value: v, label: v }))]));
}

const isBlank = (v) => v === '' || v === null || v === undefined;

// Client-side checks. The death-field rule is deliberately NOT checked here: the database owns it
// (ck_donor_death_fields) and the server message is shown in the form.
export function validateDonorForm(f, now = Date.now()) {
  const e = {};
  if (!f.name || f.name.trim().length < 2) e.name = 'Name is required';
  if (!f.dob || Number.isNaN(new Date(f.dob).getTime()) || new Date(f.dob).getTime() >= now) {
    e.dob = 'Valid date of birth required';
  }
  if (!f.bloodGroup) e.bloodGroup = 'Select blood group';
  if (!f.hospital) e.hospital = 'Select hospital';
  if (f.donorType !== 'LIVING' && f.donorType !== 'DECEASED') e.donorType = 'Select donor type';
  if (f.status !== 'ACTIVE' && f.status !== 'INACTIVE') e.status = 'Select status';
  if (isBlank(f.height)) e.height = 'Height is required';
  else if (Number(f.height) < 100 || Number(f.height) > 220) e.height = 'Height must be between 100–220 cm';
  if (isBlank(f.weight)) e.weight = 'Weight is required';
  else if (Number(f.weight) < 20 || Number(f.weight) > 200) e.weight = 'Weight must be between 20–200 kg';
  for (const l of LOCI) {
    if ((f.hla?.[l] ?? []).length > MAX_ALLELES_PER_LOCUS) {
      e[`hla${l}`] = `Select at most ${MAX_ALLELES_PER_LOCUS} alleles`;
    }
  }
  return e;
}

const pad2 = (n) => String(n).padStart(2, '0');
// Local calendar date -> 'YYYY-MM-DD' (the date the user picked, not its UTC shift).
export function toDateOnly(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}

// Form -> POST/PATCH body (live mode: select values are ids). Death fields are explicit nulls for
// LIVING donors so a PATCH from DECEASED to LIVING clears them.
export function formToDonorBody(f) {
  const deceased = f.donorType === 'DECEASED';
  const cause = (f.deathCause ?? '').trim();
  return {
    name: f.name.trim(),
    dateOfBirth: toDateOnly(f.dob),
    bloodGroupId: Number(f.bloodGroup),
    hospitalId: Number(f.hospital),
    donorType: f.donorType,
    status: f.status,
    heightCm: Number(f.height),
    weightKg: Number(f.weight),
    deathDate: deceased && f.deathDate ? new Date(f.deathDate).toISOString() : null,
    deathCause: deceased && cause ? cause : null,
    hlaAlleleIds: LOCI.flatMap((l) => (f.hla?.[l] ?? []).map(Number)),
  };
}

const FIELD_MAP = {
  name: 'name',
  dateOfBirth: 'dob',
  bloodGroupId: 'bloodGroup',
  hospitalId: 'hospital',
  donorType: 'donorType',
  status: 'status',
  heightCm: 'height',
  weightKg: 'weight',
  deathDate: 'deathDate',
  deathCause: 'deathCause',
};
const CONSTRAINT_FIELD = {
  ck_donor_death_fields: 'deathDate',
  ck_donor_death_after_birth: 'deathDate',
};

// ApiError -> { message, fields } for the form: the server message always shows as a form-level
// message, and known fields/constraints also get an inline error.
export function serverErrorToForm(err) {
  const message = err?.message || 'Request failed';
  const fields = {};
  const c = err?.details?.constraint;
  if (c && CONSTRAINT_FIELD[c]) fields[CONSTRAINT_FIELD[c]] = message;
  for (const f of err?.details?.fields ?? []) if (FIELD_MAP[f]) fields[FIELD_MAP[f]] = message;
  return { message, fields };
}
