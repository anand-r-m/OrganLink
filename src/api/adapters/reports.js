// OL-026: pure mappers from /api/reports/* rows to Reports-page chart data. Every mapper accepts
// empty/undefined input (sparse seed) and never produces NaN.

export const BUCKET_WIDTH_MONTHS = 5;
export const LAST_BUCKET = 13; // 60 months or more
export const EMPTY = '—';

// width_bucket(months, 0, 60, 12): bucket b covers [(b-1)*5, b*5) months; 13 is 60+; 0 only occurs
// for a future-dated listing (negative age).
export function bucketLabel(bucket) {
  if (bucket >= LAST_BUCKET) return `${(LAST_BUCKET - 1) * BUCKET_WIDTH_MONTHS}+ mo`;
  if (bucket < 1) return 'Future-dated';
  return `${(bucket - 1) * BUCKET_WIDTH_MONTHS}–${bucket * BUCKET_WIDTH_MONTHS} mo`;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Stacked by organ type: one entry per bucket 1..13 (zero-filled, so the axis is stable), plus
// bucket 0 only when it occurs. Returns { data, organTypes }; empty rows give { data: [], organTypes: [] }.
export function adaptWaitingTimes(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return { data: [], organTypes: [] };
  const organTypes = [...new Set(list.map((r) => r.organType))].sort();
  const buckets = [];
  if (list.some((r) => r.bucket < 1)) buckets.push(0);
  for (let b = 1; b <= LAST_BUCKET; b += 1) buckets.push(b);
  const data = buckets.map((b) => {
    const entry = { bucket: b, label: bucketLabel(b), total: 0 };
    for (const t of organTypes) entry[t] = 0;
    for (const r of list) {
      if ((r.bucket < 1 ? 0 : r.bucket) === b) {
        const n = num(r.recipients) ?? 0;
        entry[r.organType] += n;
        entry.total += n;
      }
    }
    return entry;
  });
  return { data, organTypes };
}

// Grouped by region: counts summed across organ types; utilization % recomputed from the sums.
export function adaptUtilization(rows) {
  const byRegion = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const e = byRegion.get(r.regionName) ?? { region: r.regionName, transplanted: 0, expired: 0, discarded: 0, total: 0 };
    e.transplanted += num(r.transplanted) ?? 0;
    e.expired += num(r.expired) ?? 0;
    e.discarded += num(r.discarded) ?? 0;
    e.total += num(r.totalRecovered) ?? 0;
    byRegion.set(r.regionName, e);
  }
  return [...byRegion.values()]
    .map((e) => ({ ...e, utilizationPct: e.total > 0 ? Math.round((1000 * e.transplanted) / e.total) / 10 : null }))
    .sort((a, b) => a.region.localeCompare(b.region));
}

export function adaptDeclineReasons(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    code: r.code,
    reason: r.description || r.code,
    count: num(r.occurrences) ?? 0,
    pct: num(r.pct),
  }));
}

// Three metrics in different units, so each is its own series; null stays null (no NaN, no bar).
export function adaptFairness(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    region: r.regionName,
    shortRegion: String(r.regionName ?? '').replace(/ Region$/, ''),
    waitlistSize: num(r.waitlistSize) ?? 0,
    transplantsCompleted: num(r.transplantsCompleted) ?? 0,
    allocationRatePct: num(r.allocationRatePct),
    medianWaitDays: num(r.medianWaitDays),
    retentionPct: num(r.retentionPct),
  }));
}

export const formatPct = (v) => (num(v) === null ? EMPTY : `${v}%`);
export const formatDays = (v) => (num(v) === null ? EMPTY : `${v} d`);

// Compliance headline. null/undefined input (error or not loaded) and a null rate both give "—".
export function adaptCompliance(row) {
  const r = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
  return {
    transplanted: num(r.transplanted) ?? 0,
    expiredUnallocated: num(r.expiredUnallocated) ?? 0,
    discarded: num(r.discarded) ?? 0,
    totalOrgans: num(r.totalOrgans) ?? 0,
    placementRatePct: num(r.placementRatePct),
    placementRateLabel: formatPct(r.placementRatePct),
  };
}
