// OL-006: DB tests for db/03_seed_demo.sql.
// Needs DATABASE_URL pointing at a freshly reset dev DB (npm run db:reset).
// Match runs are executed inside a rolled-back transaction so the seed is left untouched.
import test from 'node:test'
import assert from 'node:assert/strict'
import { pool } from '../../server/db.js'

test.after(() => pool.end().catch(() => {}))

const one = async (sql, params) => (await pool.query(sql, params)).rows[0]

// OL-031 added a retrospective block to the same seed file. The fixtures
// asserted below describe the present-day block, which is inserted first and
// therefore owns the lowest identity values.
const PRESENT_DONORS = 'donor_id <= 10'
const PRESENT_RECIPIENTS = 'recipient_id <= 20'

test('8 hospitals across all four regions, with coordinates', async () => {
  const r = await one(
    `SELECT count(*)::int n, count(DISTINCT region_id)::int regions,
            count(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL)::int located
       FROM hospital`)
  assert.deepEqual(r, { n: 8, regions: 4, located: 8 })
})

test('about 10 donors, mixed type, 6 HLA alleles each', async () => {
  const r = await one(
    `SELECT count(*)::int n,
            count(*) FILTER (WHERE donor_type = 'LIVING')::int living,
            count(*) FILTER (WHERE donor_type = 'DECEASED')::int deceased
       FROM donor WHERE ${PRESENT_DONORS}`)
  assert.equal(r.n, 10)
  assert.ok(r.living > 0 && r.deceased > 0)
  const bad = await pool.query(
    `SELECT d.donor_id FROM donor d LEFT JOIN donor_hla h USING (donor_id)
      GROUP BY d.donor_id HAVING count(h.allele_id) <> 6`)
  assert.equal(bad.rowCount, 0)
})

test('about 20 recipients with 22+ waitlist entries listed 1-24 months ago', async () => {
  const r = await one(
    `SELECT (SELECT count(*) FROM recipient WHERE ${PRESENT_RECIPIENTS})::int recipients,
            (SELECT count(*) FROM waitlist_entry WHERE ${PRESENT_RECIPIENTS})::int entries,
            (SELECT min(listed_date) FROM waitlist_entry WHERE ${PRESENT_RECIPIENTS})
                >= (CURRENT_DATE - INTERVAL '25 months') AS not_too_old,
            (SELECT max(listed_date) FROM waitlist_entry WHERE ${PRESENT_RECIPIENTS})
                <= (CURRENT_DATE - INTERVAL '1 month') AS not_too_new`)
  assert.equal(r.recipients, 20)
  assert.ok(r.entries >= 22)
  assert.ok(r.not_too_old && r.not_too_new)
  const bad = await pool.query(
    `SELECT r.recipient_id FROM recipient r LEFT JOIN recipient_hla h USING (recipient_id)
      GROUP BY r.recipient_id HAVING count(h.allele_id) <> 6`)
  assert.equal(bad.rowCount, 0)
})

test('at least one recipient has 2 ACTIVE entries, including kidney+pancreas', async () => {
  const multi = await pool.query(
    `SELECT recipient_id FROM waitlist_entry WHERE status = 'ACTIVE'
      GROUP BY recipient_id HAVING count(*) >= 2`)
  assert.ok(multi.rowCount >= 1)
  const kp = await pool.query(
    `SELECT w.recipient_id FROM waitlist_entry w JOIN organ_type ot USING (organ_type_id)
      WHERE w.status = 'ACTIVE' AND ot.name IN ('Kidney','Pancreas')
      GROUP BY w.recipient_id HAVING count(DISTINCT ot.name) = 2`)
  assert.ok(kp.rowCount >= 1)
})

test('exactly 3 AVAILABLE, unexpired organs (Heart, Liver, Kidney) recovered 0.5-2 h ago', async () => {
  const { rows } = await pool.query(
    `SELECT organ_type_name, hours_remaining::float8 AS hours_remaining,
            EXTRACT(EPOCH FROM now() - recovered_at) / 3600 AS age_h
       FROM v_organ WHERE status = 'AVAILABLE' AND NOT is_expired ORDER BY organ_type_name`)
  assert.deepEqual(rows.map((r) => r.organ_type_name), ['Heart', 'Kidney', 'Liver'])
  for (const r of rows) {
    assert.ok(r.hours_remaining > 0)
    assert.ok(r.age_h >= 0.4 && r.age_h <= 2.5, `age ${r.age_h}`)
  }
})

test('match_candidates on each available organ: >=3 qualified, >=1 excluded', async () => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const organs = await client.query(`SELECT organ_id FROM organ WHERE status = 'AVAILABLE'`)
    assert.equal(organs.rowCount, 3)
    for (const { organ_id } of organs.rows) {
      const run = await client.query('SELECT match_candidates($1) AS run_id', [organ_id])
      const c = await client.query(
        `SELECT count(*) FILTER (WHERE qualified)::int q,
                count(*) FILTER (WHERE NOT qualified)::int x
           FROM match_result WHERE run_id = $1`, [run.rows[0].run_id])
      assert.ok(c.rows[0].q >= 3, `organ ${organ_id}: qualified ${c.rows[0].q}`)
      assert.ok(c.rows[0].x >= 1, `organ ${organ_id}: excluded ${c.rows[0].x}`)
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    client.release()
  }
})

test('admin user and reference data are unchanged', async () => {
  const r = await one(
    `SELECT (SELECT count(*) FROM app_user)::int users,
            (SELECT count(*) FROM app_user WHERE username = 'admin')::int admins,
            (SELECT count(*) FROM region)::int regions,
            (SELECT count(*) FROM organ_type)::int organ_types,
            (SELECT count(*) FROM blood_group)::int blood_groups,
            (SELECT count(*) FROM blood_compatibility)::int compat,
            (SELECT count(*) FROM hla_allele)::int alleles,
            (SELECT count(*) FROM urgency)::int urgencies`)
  assert.deepEqual(r, { users: 1, admins: 1, regions: 4, organ_types: 5, blood_groups: 8,
                        compat: 64, alleles: 18, urgencies: 3 })
})
