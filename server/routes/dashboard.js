import { Router } from 'express'
import { pool } from '../db.js'
import { adaptOfferRow, offerSql } from '../util/offerSql.js'

const router = Router()

// Definitions the contract leaves open (OL-027):
// - availableOrgans: AVAILABLE and not expired (v_organ), the same set as GET /api/organs?available=true.
// - activeWaitlist: waitlist ENTRIES with status ACTIVE (one recipient may hold several entries).
// - transplantsThisMonth: SUCCESS transplant_event rows whose transplant_at is in the current
//   calendar month (date_trunc('month', now()), DB session time zone).
// - allocationTrend: the 12 calendar months ending with the current one, oldest first, 'YYYY-MM',
//   SUCCESS transplants only; generate_series + LEFT JOIN zero-fills months.
// - criticalAlerts: AVAILABLE, unexpired organs with < 2 h left (ORGAN_EXPIRING / danger, soonest
//   first) and SENT offers with < 1 h left before offer_expires_at (OFFER_AWAITING_RESPONSE / warning).
const STATS_SQL = `
  SELECT
    (SELECT COUNT(*) FROM v_organ WHERE status = 'AVAILABLE' AND NOT is_expired)::int AS available_organs,
    (SELECT COUNT(*) FROM waitlist_entry WHERE status = 'ACTIVE')::int AS active_waitlist,
    (SELECT COUNT(*) FROM organ_offer WHERE status IN ('CREATED', 'SENT'))::int AS pending_offers,
    (SELECT COUNT(*) FROM transplant_event
       WHERE outcome = 'SUCCESS' AND transplant_at >= date_trunc('month', now())
         AND transplant_at < date_trunc('month', now()) + interval '1 month')::int AS transplants_this_month`

const TREND_SQL = `
  SELECT to_char(m.month, 'YYYY-MM') AS month, COUNT(te.transplant_id)::int AS transplants
  FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') AS m(month)
  LEFT JOIN transplant_event te
    ON te.outcome = 'SUCCESS' AND te.transplant_at >= m.month AND te.transplant_at < m.month + interval '1 month'
  GROUP BY m.month ORDER BY m.month`

const ORGAN_ALERTS_SQL = `
  SELECT organ_id, hours_remaining FROM v_organ
  WHERE status = 'AVAILABLE' AND NOT is_expired AND hours_remaining < 2
  ORDER BY hours_remaining ASC, organ_id`

const OFFER_ALERTS_SQL = `
  SELECT offer_id, ROUND((EXTRACT(EPOCH FROM (offer_expires_at - now())) / 3600)::numeric, 2) AS hours_remaining
  FROM v_offer
  WHERE status = 'SENT' AND offer_expires_at - now() < interval '1 hour'
  ORDER BY offer_expires_at ASC, offer_id`

// GET /api/dashboard (endpoint #47, Proposed shape). Sweeps first.
router.get('/', async (_req, res, next) => {
  try {
    await pool.query('SELECT expire_stale_offers()')
    const [stats, trend, organAlerts, offerAlerts, recent] = await Promise.all([
      pool.query(STATS_SQL),
      pool.query(TREND_SQL),
      pool.query(ORGAN_ALERTS_SQL),
      pool.query(OFFER_ALERTS_SQL),
      pool.query(offerSql('TRUE', 'ORDER BY v.created_at DESC, v.offer_id DESC LIMIT 5')),
    ])
    const s = stats.rows[0]
    res.json({
      stats: {
        availableOrgans: s.available_organs,
        activeWaitlist: s.active_waitlist,
        pendingOffers: s.pending_offers,
        transplantsThisMonth: s.transplants_this_month,
      },
      criticalAlerts: [
        ...organAlerts.rows.map((r) => ({
          type: 'ORGAN_EXPIRING',
          severity: 'danger',
          organId: Number(r.organ_id),
          hoursRemaining: Number(r.hours_remaining),
        })),
        ...offerAlerts.rows.map((r) => ({
          type: 'OFFER_AWAITING_RESPONSE',
          severity: 'warning',
          offerId: Number(r.offer_id),
          hoursRemaining: Math.max(0, Number(r.hours_remaining)),
        })),
      ],
      allocationTrend: trend.rows,
      recentOffers: recent.rows.map(adaptOfferRow),
    })
  } catch (err) {
    next(err)
  }
})

export default router
