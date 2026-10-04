import { matchRunId, recipientId } from '../../utils/displayId.js';

// API MatchRun candidate -> console card row.
export function adaptQualified(q) {
  return {
    key: q.recipientId,
    recipientDbId: q.recipientId,
    recipient: recipientId(q.recipientId),
    name: q.recipientName,
    bloodGroup: q.bloodGroup,
    hospital: q.hospitalName,
    rank: q.rank,
    matchScore: q.matchScore,
    hlaScore: q.hlaScore,
    urgencyScore: q.urgencyScore,
    distanceScore: q.distanceScore,
    waitScore: q.waitScore,
    distanceKm: q.distanceKm,
    offerStatus: q.offerStatus,
  };
}

export function adaptExcluded(e) {
  return {
    key: e.recipientId,
    recipient: recipientId(e.recipientId),
    name: e.recipientName,
    bloodGroup: e.bloodGroup,
    hospital: e.hospitalName,
    distanceKm: e.distanceKm,
    code: e.exclusionCode,
    description: e.exclusionDescription,
  };
}

// API MatchRun -> console run view model (display id "MR-0042").
export function adaptMatchRun(run) {
  return {
    dbId: run.id,
    id: matchRunId(run.id),
    organDbId: run.organId,
    runAt: run.runAt,
    weights: run.weights,
    qualified: run.qualified.map(adaptQualified),
    excluded: run.excluded.map(adaptExcluded),
  };
}

// "Run #MR-0042 at 14:05" label text for the console.
export function runLabel(run, locale) {
  const time = new Date(run.runAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `Run #${run.id} at ${time}`;
}
