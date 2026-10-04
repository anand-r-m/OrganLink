import { Router } from 'express'
import { pool, query } from '../db.js'

const router = Router()

// Reports (API_CONTRACT "Reports"): each endpoint is SELECT * FROM <view>, camelCased.
// ORDER BY makes the output deterministic; it does not change the view's columns.
// Sweep (contract index): utilization and compliance run expire_stale_offers() first.
const sweep = () => pool.query('SELECT expire_stale_offers()')

const listRoute = (path, sql, { withSweep = false } = {}) =>
  router.get(path, async (_req, res, next) => {
    try {
      if (withSweep) await sweep()
      res.json(await query(sql))
    } catch (err) {
      next(err)
    }
  })

listRoute('/waiting-times', 'SELECT * FROM v_waiting_time_distribution ORDER BY organ_type, bucket')
listRoute('/utilization', 'SELECT * FROM v_organ_utilization ORDER BY region_name, organ_type', { withSweep: true })
listRoute('/decline-reasons', 'SELECT * FROM v_decline_reasons ORDER BY occurrences DESC, code')
listRoute('/fairness', 'SELECT * FROM v_allocation_fairness ORDER BY region_name')

router.get('/compliance', async (_req, res, next) => {
  try {
    await sweep()
    res.json((await query('SELECT * FROM v_compliance_summary'))[0])
  } catch (err) {
    next(err)
  }
})

export default router
