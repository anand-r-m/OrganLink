import { mockCompatibility, mockHlaAlleles, BLOOD_GROUPS } from '../../data/mockCompatibility.js';

// Pure helpers for the Settings > Compatibility tab (OL-025).

export const HLA_LOCI = ['A', 'B', 'DRB1'];

// Rows = donor groups, columns = recipient groups. cells[i] belongs to groups[i] as recipient.
export function pairsToGrid(bloodGroups, pairs) {
  const byKey = new Map(pairs.map((p) => [`${p.donorBloodGroupId}:${p.recipientBloodGroupId}`, p]));
  return bloodGroups.map((donor) => ({
    donor,
    cells: bloodGroups.map((recipient) => {
      const p = byKey.get(`${donor.id}:${recipient.id}`);
      return { recipient, compatible: p ? p.compatible : false, exists: Boolean(p) };
    }),
  }));
}

export const countCompatible = (pairs) => pairs.filter((p) => p.compatible).length;

export const compatibleLabel = (pairs) => {
  const n = countCompatible(pairs);
  return `${n} compatible pair${n === 1 ? '' : 's'}`;
};

// Immutable update of one pair in the list (used for optimistic toggles and revert).
export function setPairCompatible(pairs, donorBloodGroupId, recipientBloodGroupId, compatible) {
  return pairs.map((p) =>
    p.donorBloodGroupId === donorBloodGroupId && p.recipientBloodGroupId === recipientBloodGroupId
      ? { ...p, compatible }
      : p,
  );
}

export const pairToPatchBody = (pair, compatible) => ({
  donorBloodGroupId: pair.donorBloodGroupId,
  recipientBloodGroupId: pair.recipientBloodGroupId,
  compatible,
});

export function adaptBloodCompatibility(payload) {
  return { bloodGroups: payload.bloodGroups, pairs: payload.pairs };
}

// Mock matrix in the API shape (ids 1..8 follow the mock group order).
export function mockBloodCompatibility() {
  const bloodGroups = BLOOD_GROUPS.map((name, i) => ({ id: i + 1, name }));
  const idOf = Object.fromEntries(bloodGroups.map((g) => [g.name, g.id]));
  const pairs = [];
  for (const d of bloodGroups) {
    const ok = new Set(mockCompatibility.find((c) => c.bloodGroup === d.name)?.compatibleWith ?? []);
    for (const r of bloodGroups) {
      pairs.push({
        donorBloodGroupId: d.id,
        donorGroup: d.name,
        recipientBloodGroupId: idOf[r.name],
        recipientGroup: r.name,
        compatible: ok.has(r.name),
      });
    }
  }
  return { bloodGroups, pairs };
}

// Mock HLA rows in the API shape: the mock locus 'DR' becomes 'DRB1' and the description is dropped.
export const mockHlaRows = () =>
  mockHlaAlleles.map((a, i) => ({
    id: i + 1,
    locus: a.locus === 'DR' ? 'DRB1' : a.locus,
    alleleName: a.code,
  }));

export const hlaAlleleLabel = (a) => `${a.alleleName} (${a.locus})`;

export const emptyHlaForm = () => ({ locus: null, alleleName: '' });

// Only shape checks the form needs to build a body; the DB owns every value rule (uniqueness, locus CHECK).
export const hlaFormToBody = (form) => ({ locus: form.locus, alleleName: form.alleleName.trim() });
export const hlaFormComplete = (form) => Boolean(form.locus) && form.alleleName.trim().length > 0;

export function filterHla(rows, locus) {
  return locus ? rows.filter((a) => a.locus === locus) : rows;
}
