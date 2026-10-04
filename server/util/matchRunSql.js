// Shared match-run reads (matching routes, organ run history). API_CONTRACT "MatchRun".
import { toCamel } from './case.js'

const WEIGHTS = (r) => ({
  hla: r.hla_weight,
  urgency: r.urgency_weight,
  distance: r.distance_weight,
  wait: r.wait_weight,
})

const runBy = (r) => (r.run_by === null ? null : { id: r.run_by, username: r.run_by_username })

// Loads one saved run with its qualified (by rank) and excluded candidates. null if not found.
export async function loadMatchRun(db, runId) {
  const run = await db.query(
    `SELECT mr.run_id, mr.organ_id, mr.run_at, mr.hla_weight, mr.urgency_weight, mr.distance_weight,
            mr.wait_weight, mr.run_by, u.username AS run_by_username
     FROM match_run mr LEFT JOIN app_user u ON u.user_id = mr.run_by
     WHERE mr.run_id = $1`,
    [runId],
  )
  if (run.rowCount === 0) return null
  const r = run.rows[0]
  const results = await db.query(
    `SELECT m.recipient_id, rec.name AS recipient_name, bg.group_name AS blood_group,
            h.name AS hospital_name, m.rank, m.match_score, m.hla_score, m.urgency_score,
            m.distance_score, m.wait_score, m.distance_km, m.qualified,
            er.code AS exclusion_code, er.description AS exclusion_description,
            (SELECT f.status FROM organ_offer f
              WHERE f.organ_id = $2 AND f.recipient_id = m.recipient_id
              ORDER BY f.offer_id DESC LIMIT 1) AS offer_status
     FROM match_result m
     JOIN recipient rec ON rec.recipient_id = m.recipient_id
     JOIN blood_group bg ON bg.blood_group_id = rec.blood_group_id
     JOIN hospital h ON h.hospital_id = rec.hospital_id
     LEFT JOIN exclusion_reason er ON er.exclusion_reason_id = m.exclusion_reason_id
     WHERE m.run_id = $1
     ORDER BY m.rank NULLS LAST, m.match_score DESC NULLS LAST, m.wait_score DESC NULLS LAST, m.recipient_id`,
    [runId, r.organ_id],
  )
  const qualified = []
  const excluded = []
  for (const row of results.rows) {
    const c = toCamel(row)
    const person = {
      recipientId: c.recipientId,
      recipientName: c.recipientName,
      bloodGroup: c.bloodGroup,
      hospitalName: c.hospitalName,
      distanceKm: c.distanceKm,
    }
    if (c.qualified) {
      qualified.push({
        ...person,
        rank: c.rank,
        matchScore: c.matchScore,
        hlaScore: c.hlaScore,
        urgencyScore: c.urgencyScore,
        distanceScore: c.distanceScore,
        waitScore: c.waitScore,
        offerStatus: c.offerStatus,
      })
    } else {
      excluded.push({ ...person, exclusionCode: c.exclusionCode, exclusionDescription: c.exclusionDescription })
    }
  }
  return {
    id: r.run_id,
    organId: r.organ_id,
    runAt: r.run_at,
    runBy: runBy(r),
    weights: WEIGHTS(r),
    qualified,
    excluded,
  }
}

// Saved runs for an organ, newest first, with counts (no candidate rows).
export async function listOrganRuns(db, organId) {
  const { rows } = await db.query(
    `SELECT mr.run_id, mr.run_at, mr.hla_weight, mr.urgency_weight, mr.distance_weight, mr.wait_weight,
            mr.run_by, u.username AS run_by_username,
            count(*) FILTER (WHERE m.qualified) AS qualified_count,
            count(*) FILTER (WHERE NOT m.qualified) AS excluded_count
     FROM match_run mr
     LEFT JOIN app_user u ON u.user_id = mr.run_by
     LEFT JOIN match_result m ON m.run_id = mr.run_id
     WHERE mr.organ_id = $1
     GROUP BY mr.run_id, u.username
     ORDER BY mr.run_at DESC, mr.run_id DESC`,
    [organId],
  )
  return rows.map((r) => ({
    id: r.run_id,
    runAt: r.run_at,
    runBy: runBy(r),
    weights: WEIGHTS(r),
    qualifiedCount: r.qualified_count,
    excludedCount: r.excluded_count,
  }))
}
