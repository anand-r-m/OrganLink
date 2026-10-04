// Mock-mode matching: a small in-memory ranker producing the same run shape as the live adapter.
import { mockCompatibility } from './mockCompatibility.js';
import { mockDonors } from './mockDonors.js';
import { mockRecipients } from './mockRecipients.js';

const DESCRIPTIONS = {
  ABO_INCOMPATIBLE: 'Blood group incompatible with donor',
  RECIPIENT_INACTIVE: 'Recipient or waitlist entry not active',
};

const NORTH = ['AIIMS New Delhi', 'PGIMER Chandigarh', 'KGMU Lucknow'];
const SOUTH = ['Apollo Chennai', 'CMC Vellore', 'Narayana Bangalore'];
const WEST = ['KEM Mumbai'];

function isAboCompatible(donorBloodGroup, recipientBloodGroup) {
  const compat = mockCompatibility.find((c) => c.bloodGroup === donorBloodGroup);
  return compat ? compat.compatibleWith.includes(recipientBloodGroup) : false;
}

function distance(organHospital, recipientHospital) {
  if (organHospital === recipientHospital) return { km: 20, score: 100 };
  const same = [NORTH, SOUTH, WEST].some((g) => g.includes(organHospital) && g.includes(recipientHospital));
  return same ? { km: 70, score: 90 } : { km: 560, score: 40 };
}

const allele = (d, r) => (d === r ? 1 : r && d.slice(0, 4) === r.slice(0, 4) ? 0.5 : 0);

let nextRunId = 1;
const runs = [];

// organ: an adapted mock organ row. weights: {hla, urgency, distance, wait}.
export function mockRunMatch(organ, weights) {
  const donor = mockDonors.find((d) => d.id === organ.donor);
  const qualified = [];
  const excluded = [];
  for (const r of mockRecipients.filter((x) => x.organNeeded === organ.organType)) {
    const base = { key: r.id, recipient: r.id, name: r.name, bloodGroup: r.bloodGroup, hospital: r.hospital };
    const dist = distance(organ.hospital, r.hospital);
    let code = null;
    if (!isAboCompatible(organ.bloodGroup, r.bloodGroup)) code = 'ABO_INCOMPATIBLE';
    else if (r.status === 'Transplanted' || r.status === 'Inactive') code = 'RECIPIENT_INACTIVE';
    if (code) {
      excluded.push({ ...base, distanceKm: dist.km, code, description: DESCRIPTIONS[code] });
      continue;
    }
    const hla = Math.round(
      ((allele(donor?.hlaA ?? 'A*02:01', r.hlaA ?? '') +
        allele(donor?.hlaB ?? 'B*07:02', r.hlaB ?? '') +
        allele(donor?.hlaDR ?? 'DRB1*03:01', r.hlaDR ?? '')) /
        3) *
        100,
    );
    const urgency = r.urgency === '1A' ? 100 : r.urgency === '1B' ? 75 : 50;
    const wait = Math.min(100, r.priorityScore ?? 70);
    const sum = weights.hla + weights.urgency + weights.distance + weights.wait;
    const score = sum === 0 ? 0 : (hla * weights.hla + urgency * weights.urgency + dist.score * weights.distance + wait * weights.wait) / sum;
    qualified.push({
      ...base,
      matchScore: Math.round(score * 100) / 100,
      hlaScore: hla,
      urgencyScore: urgency,
      distanceScore: dist.score,
      waitScore: wait,
      distanceKm: dist.km,
      offerStatus: null,
    });
  }
  qualified.sort((a, b) => b.matchScore - a.matchScore || b.waitScore - a.waitScore);
  qualified.forEach((q, i) => {
    q.rank = i + 1;
  });
  const id = nextRunId++;
  const run = {
    dbId: id,
    id: `MR-${String(id).padStart(4, '0')}`,
    organDbId: organ.id,
    runAt: new Date().toISOString(),
    weights: { ...weights },
    qualified,
    excluded,
  };
  runs.push(run);
  return run;
}

export const mockLatestRun = (organKey) => [...runs].reverse().find((r) => r.organDbId === organKey) ?? null;
export const mockRunById = (id) => runs.find((r) => r.dbId === Number(id)) ?? null;
