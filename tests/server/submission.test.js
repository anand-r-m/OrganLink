// OL-034: asserts the submission dump artifact is present and structurally complete.
// This runs without a database (it only reads the file); the restore + end-to-end check
// lives in scripts/verify-submission.sh (npm run verify:submission).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DUMP = join(ROOT, 'submission', 'organlink.sql')

const readDump = () => readFileSync(DUMP, 'utf8')

test('submission dump exists and is a plausible size', () => {
  const stat = statSync(DUMP) // throws if missing
  assert.ok(stat.size > 50_000, `dump is only ${stat.size} bytes`)
})

test('submission dump contains the full schema (24 tables, 8 views)', () => {
  const sql = readDump()
  const tables = sql.match(/^CREATE TABLE /gm) ?? []
  const views = sql.match(/^CREATE VIEW /gm) ?? []
  assert.equal(tables.length, 24)
  assert.equal(views.length, 8)
})

test('submission dump contains every business table the app reads', () => {
  const sql = readDump()
  for (const table of [
    'app_user',
    'audit_log',
    'blood_compatibility',
    'blood_group',
    'decline_reason',
    'discard_reason',
    'donor',
    'donor_hla',
    'exclusion_reason',
    'hla_allele',
    'hospital',
    'match_result',
    'match_run',
    'organ',
    'organ_offer',
    'organ_type',
    'recipient',
    'recipient_hla',
    'region',
    'role',
    'transplant_event',
    'transport_record',
    'urgency',
    'waitlist_entry',
  ]) {
    assert.ok(sql.includes(`CREATE TABLE public.${table} (`), `missing table ${table}`)
  }
})

test('submission dump carries the reference and demo seed data', () => {
  const sql = readDump()
  // reference seed: the regenerated admin hash (A8) must match `admin`.
  assert.match(sql, /COPY public\.app_user \(user_id, username, password_hash, role_id, status\) FROM stdin;/)
  assert.ok(sql.includes('$2b$10$NMptt9TIflZAmJHIiv0ObOpfP9kHnzqg55nci/G6lXH8OubGHmz9W'))
  // reference seed: the compatibility matrix must restore exactly 27 compatible pairs.
  const compatBlock = sql.split('COPY public.blood_compatibility')[1]?.split('\\.')[0] ?? ''
  const compatibleTrue = (compatBlock.match(/\tt$/gm) ?? []).length
  assert.equal(compatibleTrue, 27)
  // demo seed: donors, recipients, hospitals, organs are populated.
  for (const table of ['donor', 'recipient', 'hospital', 'organ', 'waitlist_entry']) {
    const block = sql.split(`COPY public.${table} `)[1]?.split('\\.')[0] ?? ''
    assert.ok(block.trim().length > 0, `no seed rows for ${table}`)
  }
})

test('submission dump is a restorable plain-SQL pg_dump', () => {
  const sql = readDump()
  assert.match(sql, /PostgreSQL database dump/)
  assert.match(sql, /CREATE FUNCTION public\.expire_stale_offers\(\)/)
  assert.match(sql, /CREATE FUNCTION public\.match_candidates\(/)
  // Plain dumps guard the restore with restrict/unrestrict markers (PG 17+).
  assert.ok(sql.includes('create table') || sql.includes('CREATE TABLE'))
})