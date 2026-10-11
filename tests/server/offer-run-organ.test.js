// OL-039: an offer's match run must belong to the same organ (composite FK).
// Needs DATABASE_URL pointing at a reset dev DB (db:reset).
//
// Every fixture lives in one transaction that is rolled back; expected failures run under SAVEPOINTs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { pool } from '../../server/db.js'

test.after(async () => {
  await pool.end().catch(() => {})
})

// Runs fn inside a savepoint and returns the PostgreSQL error it raised (or null).
async function pgError(client, fn) {
  await client.query('SAVEPOINT expect_error')
  try {
    await fn()
    await client.query('RELEASE SAVEPOINT expect_error')
    return null
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT expect_error')
    return err
  }
}

test('schema declares the composite provenance FK (RESTRICT, MATCH SIMPLE) and its parent unique key', async () => {
  const fk = await pool.query(
    `SELECT pg_get_constraintdef(oid) AS def, confdeltype, confmatchtype
     FROM pg_constraint WHERE conrelid = 'organ_offer'::regclass AND conname = 'fk_offer_run_same_organ'`,
  )
  assert.equal(fk.rowCount, 1, 'fk_offer_run_same_organ exists')
  assert.match(fk.rows[0].def, /FOREIGN KEY \(run_id, organ_id\) REFERENCES match_run\(run_id, organ_id\)/)
  assert.equal(fk.rows[0].confdeltype, 'r', 'ON DELETE RESTRICT')
  assert.equal(fk.rows[0].confmatchtype, 's', 'MATCH SIMPLE')

  const old = await pool.query(
    `SELECT 1 FROM pg_constraint
     WHERE conrelid = 'organ_offer'::regclass AND contype = 'f'
       AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'organ_offer'::regclass AND attname = 'run_id')]`,
  )
  assert.equal(old.rowCount, 0, 'the single-column run_id FK is gone')

  const uq = await pool.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
     WHERE conrelid = 'match_run'::regclass AND conname = 'ux_match_run_run_organ'`,
  )
  assert.equal(uq.rowCount, 1)
  assert.equal(uq.rows[0].def, 'UNIQUE (run_id, organ_id)')
})

test('every stored offer with a run points at a run of the same organ (seed and history included)', async () => {
  const r = await pool.query(
    `SELECT count(*)::int AS mismatched
     FROM organ_offer f JOIN match_run m ON m.run_id = f.run_id
     WHERE f.organ_id <> m.organ_id`,
  )
  assert.equal(r.rows[0].mismatched, 0)
})

test('matching pair accepted, mismatched pair rejected, NULL run accepted, referenced run cannot be deleted', async () => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const one = async (sql, params) => (await client.query(sql, params)).rows[0]

    const hospital = (await one('SELECT min(hospital_id) AS id FROM hospital')).id
    const bg = (await one("SELECT blood_group_id AS id FROM blood_group WHERE group_name = 'O+'")).id
    const kidney = (await one("SELECT organ_type_id AS id FROM organ_type WHERE name = 'Kidney'")).id
    const urgency = (await one("SELECT urgency_id AS id FROM urgency WHERE code = '2'")).id

    const donor = (
      await one(
        `INSERT INTO donor (name, date_of_birth, blood_group_id, hospital_id, donor_type, height_cm, weight_kg,
                            death_date, death_cause)
         VALUES ('OL-039 Donor', '1985-01-01', $1, $2, 'DECEASED', 175, 70, now() - interval '3 hours', 'test')
         RETURNING donor_id AS id`,
        [bg, hospital],
      )
    ).id
    const recipient = (
      await one(
        `INSERT INTO recipient (name, date_of_birth, blood_group_id, hospital_id, status, height_cm, weight_kg)
         VALUES ('OL-039 Recipient', '1980-01-01', $1, $2, 'ACTIVE', 175, 70) RETURNING recipient_id AS id`,
        [bg, hospital],
      )
    ).id
    await client.query(
      `INSERT INTO waitlist_entry (recipient_id, organ_type_id, urgency_id, listed_date, status)
       VALUES ($1, $2, $3, CURRENT_DATE - 30, 'ACTIVE')`,
      [recipient, kidney, urgency],
    )
    const newOrgan = async () =>
      (
        await one(
          `INSERT INTO organ (donor_id, organ_type_id, recovering_hospital_id, recovered_at)
           VALUES ($1, $2, $3, now() - interval '1 hour') RETURNING organ_id AS id`,
          [donor, kidney, hospital],
        )
      ).id
    const newRun = async (organ) =>
      (
        await one(
          `INSERT INTO match_run (organ_id, hla_weight, urgency_weight, distance_weight, wait_weight)
           VALUES ($1, 25, 35, 20, 20) RETURNING run_id AS id`,
          [organ],
        )
      ).id
    const organA = await newOrgan()
    const organB = await newOrgan()
    const runA = await newRun(organA)
    const runB = await newRun(organB)

    // 1. Mismatched pair: organ A with organ B's run is rejected by PostgreSQL itself.
    const mismatch = await pgError(client, () =>
      client.query(`INSERT INTO organ_offer (organ_id, recipient_id, run_id) VALUES ($1, $2, $3)`, [
        organA,
        recipient,
        runB,
      ]),
    )
    assert.ok(mismatch, 'mismatched run/organ insert must fail')
    assert.equal(mismatch.code, '23503')
    assert.equal(mismatch.constraint, 'fk_offer_run_same_organ')

    // 2. Matching pair is accepted.
    const offerA = (
      await one(
        `INSERT INTO organ_offer (organ_id, recipient_id, run_id) VALUES ($1, $2, $3) RETURNING offer_id AS id`,
        [organA, recipient, runA],
      )
    ).id
    assert.ok(offerA)

    // 3. An offer cannot be moved onto another organ's run afterwards either.
    const moved = await pgError(client, () =>
      client.query('UPDATE organ_offer SET run_id = $2 WHERE offer_id = $1', [offerA, runB]),
    )
    assert.ok(moved, 'updating run_id to another organ\'s run must fail')
    assert.equal(moved.constraint, 'fk_offer_run_same_organ')

    // 4. NULL run (MATCH SIMPLE): allowed. Free the one-open-offer slot first (BR-7).
    await client.query(`UPDATE organ_offer SET status = 'CANCELLED' WHERE offer_id = $1`, [offerA])
    const nullRun = (
      await one(
        `INSERT INTO organ_offer (organ_id, recipient_id, run_id) VALUES ($1, $2, NULL) RETURNING offer_id AS id, run_id`,
        [organA, recipient],
      )
    )
    assert.equal(nullRun.run_id, null)

    // 5. A run referenced by an offer cannot be deleted (ON DELETE RESTRICT), and the offer is unchanged.
    const del = await pgError(client, () => client.query('DELETE FROM match_run WHERE run_id = $1', [runA]))
    assert.ok(del, 'deleting a referenced run must fail')
    assert.equal(del.code, '23001')
    assert.equal(del.constraint, 'fk_offer_run_same_organ')
    const still = await one('SELECT run_id, organ_id FROM organ_offer WHERE offer_id = $1', [offerA])
    assert.deepEqual([still.run_id, still.organ_id], [runA, organA])

    // 6. An unreferenced run can still be deleted, and its results cascade away.
    await client.query(
      `INSERT INTO match_result (run_id, recipient_id, rank, match_score, qualified) VALUES ($1, $2, 1, 50, true)`,
      [runB, recipient],
    )
    await client.query('DELETE FROM match_run WHERE run_id = $1', [runB])
    const left = await one('SELECT count(*)::int AS n FROM match_result WHERE run_id = $1', [runB])
    assert.equal(left.n, 0)
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
})
