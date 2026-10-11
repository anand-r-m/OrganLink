// OL-037: audit_log.row_id carries the real primary key of every audited table.
// Needs DATABASE_URL pointing at a reset dev DB (db:reset).
//
// Everything runs in one transaction that is rolled back, so no fixture or audit row survives.
// waitlist_entry has a composite key, so its audit rows legitimately keep row_id = 'composite'.
import test from 'node:test'
import assert from 'node:assert/strict'
import { pool } from '../../server/db.js'

test.after(async () => {
  await pool.end().catch(() => {})
})

test('audit row_id is the table primary key for all audited tables; waitlist_entry stays composite', async () => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const one = async (sql, params) => (await client.query(sql, params)).rows[0]

    const baseline = (await one('SELECT coalesce(max(audit_id), 0) AS id FROM audit_log')).id
    const hospital = (await one('SELECT min(hospital_id) AS id FROM hospital')).id
    const bg = (await one("SELECT blood_group_id AS id FROM blood_group WHERE group_name = 'O+'")).id
    const kidney = (await one("SELECT organ_type_id AS id FROM organ_type WHERE name = 'Kidney'")).id
    const urgency = (await one("SELECT urgency_id AS id FROM urgency WHERE code = '2'")).id

    const donor = (
      await one(
        `INSERT INTO donor (name, date_of_birth, blood_group_id, hospital_id, donor_type, height_cm, weight_kg,
                            death_date, death_cause)
         VALUES ('OL-037 Donor', '1985-01-01', $1, $2, 'DECEASED', 175, 70, now() - interval '3 hours', 'test')
         RETURNING donor_id AS id`,
        [bg, hospital],
      )
    ).id
    const recipient = (
      await one(
        `INSERT INTO recipient (name, date_of_birth, blood_group_id, hospital_id, status, height_cm, weight_kg)
         VALUES ('OL-037 Recipient', '1980-01-01', $1, $2, 'ACTIVE', 175, 70) RETURNING recipient_id AS id`,
        [bg, hospital],
      )
    ).id
    await client.query(
      `INSERT INTO waitlist_entry (recipient_id, organ_type_id, urgency_id, listed_date, status)
       VALUES ($1, $2, $3, CURRENT_DATE - 30, 'ACTIVE')`,
      [recipient, kidney, urgency],
    )
    const organ = (
      await one(
        `INSERT INTO organ (donor_id, organ_type_id, recovering_hospital_id, recovered_at)
         VALUES ($1, $2, $3, now() - interval '1 hour') RETURNING organ_id AS id`,
        [donor, kidney, hospital],
      )
    ).id
    const offer = (
      await one(
        `INSERT INTO organ_offer (organ_id, recipient_id, status) VALUES ($1, $2, 'CREATED') RETURNING offer_id AS id`,
        [organ, recipient],
      )
    ).id
    await client.query(`UPDATE organ_offer SET status = 'SENT', sent_at = now() WHERE offer_id = $1`, [offer])
    // Same hospital, so acceptance creates the transport already DELIVERED (BR-11).
    await client.query(`UPDATE organ_offer SET status = 'ACCEPTED', responded_at = now() WHERE offer_id = $1`, [offer])
    const transplant = (
      await one(
        `INSERT INTO transplant_event (offer_id, hospital_id, outcome) VALUES ($1, $2, 'SUCCESS')
         RETURNING transplant_id AS id`,
        [offer, hospital],
      )
    ).id

    const rowIds = async (table, pkColumn, pk) =>
      (
        await client.query(
          `SELECT DISTINCT row_id FROM audit_log
           WHERE table_name = $1 AND coalesce(new_values, old_values) ->> $2 = $3::text`,
          [table, pkColumn, String(pk)],
        )
      ).rows.map((r) => r.row_id)

    assert.deepEqual(await rowIds('donor', 'donor_id', donor), [String(donor)])
    assert.deepEqual(await rowIds('recipient', 'recipient_id', recipient), [String(recipient)])
    assert.deepEqual(await rowIds('organ', 'organ_id', organ), [String(organ)])
    // The two tables this task corrects. The rows are looked up by their id inside the JSON, so a
    // wrong row_id cannot hide itself.
    assert.deepEqual(await rowIds('organ_offer', 'offer_id', offer), [String(offer)])
    assert.deepEqual(await rowIds('transplant_event', 'transplant_id', transplant), [String(transplant)])

    // Every audit row for the offer (INSERT + 2 UPDATEs) is covered, not just one.
    const offerRows = await client.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE table_name = 'organ_offer' AND row_id = $1`,
      [String(offer)],
    )
    assert.equal(offerRows.rows[0].n, 3)

    // Preserved behaviour: the composite key of waitlist_entry has no single id column.
    const waitlist = await client.query(
      `SELECT DISTINCT row_id FROM audit_log
       WHERE table_name = 'waitlist_entry' AND new_values ->> 'recipient_id' = $1::text`,
      [String(recipient)],
    )
    assert.deepEqual(waitlist.rows.map((r) => r.row_id), ['composite'])

    // Every audit row written in this transaction uses a real id except waitlist_entry.
    const stray = await client.query(
      `SELECT DISTINCT table_name FROM audit_log
       WHERE audit_id > $1 AND row_id = 'composite' AND table_name <> 'waitlist_entry'`,
      [baseline],
    )
    assert.deepEqual(stray.rows, [], 'only waitlist_entry may use the composite fallback for new rows')
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
})
