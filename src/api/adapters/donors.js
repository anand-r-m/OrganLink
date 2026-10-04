import { donorId, organId } from '../../utils/displayId.js';

const LOCI = ['A', 'B', 'DRB1'];

export function calcAge(dob, now = Date.now()) {
  if (!dob) return null;
  return Math.floor((now - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

// API OrganSummary -> drawer organ row. Elapsed hours feed ViabilityCountdown.
export function adaptOrgan(o) {
  return {
    id: organId(o.id),
    dbId: o.id,
    organType: o.organType,
    status: o.status,
    recoveringHospital: o.recoveringHospitalName,
    recoveredAt: o.recoveredAt,
    expiresAt: o.expiresAt,
    viabilityHours: o.maxViabilityHours,
    elapsedHours: Math.max(0, o.maxViabilityHours - o.hoursRemaining),
    hasActiveOffer: o.hasActiveOffer,
  };
}

// Groups HLA alleles by locus (A, B, DRB1) for the drawer: { A: ['A*02:01', ...], B: [...], DRB1: [...] }.
export function groupHla(hla = []) {
  const out = Object.fromEntries(LOCI.map((l) => [l, []]));
  for (const a of hla) (out[a.locus] ??= []).push(a.alleleName);
  return out;
}

// API Donor (schema-shaped) -> the row shape the registry already uses (mockDonors), plus the
// split donorType/status (07 §7) and the HLA/organ detail. dateRegistered is not in the schema,
// so it is null in live mode. List items have no `hla`/`organs`; detail items do.
export function adaptDonor(d) {
  const hlaByLocus = groupHla(d.hla);
  return {
    id: donorId(d.id),
    dbId: d.id,
    name: d.name,
    dob: d.dateOfBirth,
    bloodGroup: d.bloodGroup,
    age: calcAge(d.dateOfBirth),
    donorType: d.donorType,
    status: d.status,
    hospital: d.hospitalName,
    hospitalId: d.hospitalId,
    region: d.regionCode,
    organCount: d.organCount ?? d.organs?.length ?? 0,
    organsLabel: String(d.organCount ?? d.organs?.length ?? 0),
    dateRegistered: null,
    deathDate: d.deathDate,
    deathCause: d.deathCause,
    height: d.heightCm,
    weight: d.weightKg,
    hlaByLocus,
    hlaA: hlaByLocus.A.join(', '),
    hlaB: hlaByLocus.B.join(', '),
    hlaDR: hlaByLocus.DRB1.join(', '),
    hasDetail: Array.isArray(d.hla),
    organs: (d.organs ?? []).map(adaptOrgan),
  };
}

export const adaptDonors = (rows) => rows.map(adaptDonor);

// Mock donor (old shape: status 'Deceased'|'Active'|'Inactive', one HLA string per locus) -> the
// same row shape, so the page renders one model in both modes (07 §7: type and status are separate).
export function adaptMockDonor(m) {
  const deceased = m.status === 'Deceased';
  const status = deceased ? 'ACTIVE' : String(m.status).toUpperCase();
  const split = (v) => (v ? [v] : []);
  const organTypes = m.organType ? m.organType.split(',').map((s) => s.trim()) : [];
  return {
    ...m,
    dbId: null,
    donorType: deceased ? 'DECEASED' : 'LIVING',
    status,
    organCount: organTypes.length,
    organsLabel: m.organType || '0',
    hlaByLocus: { A: split(m.hlaA), B: split(m.hlaB), DRB1: split(m.hlaDR) },
    hasDetail: true,
    // Mock organs carry no status or timing (mock shape), so the drawer shows the type only.
    organs: organTypes.map((t, i) => ({ id: `${m.id}-${i}`, dbId: null, organType: t, status: null })),
  };
}
