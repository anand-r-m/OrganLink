// OL-033: documentation acceptance checks.
//
// The behaviour this task introduces is the documentation itself, so these tests
// assert the content the backlog requires: README prerequisites, the documented
// commands (.env setup, db:reset, dev, smoke, db:rules), the VITE_DATA_SOURCE flag,
// the OL-DEC-03 live/mock page split, the VITE_DATA_SOURCE entry in .env.example,
// and a recorded outcome for every OL-DEC entry in AUDIT_NOTES.md.
//
// Run: npm run test:docs   (no database needed)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')

const readme = read('README.md')
const envExample = read('.env.example')
const audit = read('docs/implementation/AUDIT_NOTES.md')

test('README: prerequisites state Node 20+ and Postgres 14+', () => {
  assert.match(readme, /## Prerequisites/)
  assert.match(readme, /\bNode(\.js)?\b[^|\n]*\|\s*20 or newer/i)
  assert.match(readme, /PostgreSQL\s*\|\s*14 or newer/i)
  assert.match(readme, /\bpsql\b/)
  assert.match(readme, /\bjq\b/)
  assert.match(readme, /\bcurl\b/)
})

test('README: documents .env setup from .env.example with DATABASE_URL', () => {
  assert.match(readme, /cp \.env\.example \.env/)
  assert.match(readme, /DATABASE_URL=/)
  assert.match(readme, /## Environment variables/)
})

test('README: documents every required npm script', () => {
  for (const script of ['db:reset', 'dev', 'smoke', 'db:rules', 'test:server', 'test:client', 'lint', 'build']) {
    assert.ok(readme.includes(`npm run ${script}`), `README must document: npm run ${script}`)
  }
})

test('README: documents the VITE_DATA_SOURCE flag and both modes', () => {
  assert.match(readme, /VITE_DATA_SOURCE=api/)
  assert.match(readme, /Mock/i)
  assert.match(readme, /Live mode/i)
  assert.match(readme, /restart/i)
})

test('README: live/mock page split lists every route per OL-DEC-03', () => {
  assert.match(readme, /OL-DEC-03/)
  assert.match(readme, /Which pages are live/)
  for (const route of ['/login', '/donors', '/recipients', '/organs', '/matching', '/offers', '/transport']) {
    assert.ok(readme.includes(route), `MUST-live route missing: ${route}`)
  }
  for (const route of ['/settings', '/reports', '/dashboard']) {
    assert.ok(readme.includes(route), `STRETCH route missing: ${route}`)
  }
  assert.match(readme, /STRETCH/)
  assert.match(readme, /\bMUST\b/)
})

test('README: states the default credentials and the quick-start path to the dashboard', () => {
  assert.match(readme, /admin/i)
  assert.match(readme, /localhost:5173/)
  assert.match(readme, /Quick start/)
  assert.match(readme, /dashboard/i)
})

test('README: records the known limitations (OL-DEC-02, sessions, seed age)', () => {
  assert.match(readme, /Known limitations/i)
  assert.match(readme, /OL-DEC-02/)
  assert.match(readme, /in-memory/i)
})

test('.env.example: documents the VITE_DATA_SOURCE mock/live switch', () => {
  assert.ok(envExample.includes('VITE_DATA_SOURCE'), '.env.example must mention VITE_DATA_SOURCE')
  assert.match(envExample, /# VITE_DATA_SOURCE=api/, 'flag ships commented out so mock mode stays the default')
  assert.ok(envExample.includes('DATABASE_URL='))
})

test('AUDIT_NOTES: every OL-DEC entry has a recorded outcome', () => {
  assert.match(audit, /## Final status recorded at OL-033/)
  const section = audit.slice(audit.indexOf('## Final status recorded at OL-033'))
  for (const id of ['OL-DEC-01', 'OL-DEC-02', 'OL-DEC-03']) {
    const row = section.split('\n').find((l) => l.startsWith(`| ${id}`))
    assert.ok(row, `decision-gate table must have a row for ${id}`)
    assert.match(row, /\*\*Option [AB]\*\*/, `${id} row must record which option was chosen`)
    assert.match(row, /2026-10-04/, `${id} row must record the resolution date`)
  }
  // The in-body resolutions must still be present (the table summarises them).
  assert.ok((audit.match(/RESOLVED 2026-10-04/g) || []).length >= 3, 'each decision keeps its RESOLVED block')
})

test('AUDIT_NOTES: assumptions A1..A17 are still defined and a final status is recorded', () => {
  for (const id of ['A1', 'A5', 'A8', 'A14', 'A17']) {
    assert.ok(new RegExp(`\\| ${id} \\|`).test(audit), `assumption table must still define ${id}`)
  }
  const section = sectionOf(audit, '### Assumption status')
  assert.match(section, /\| A14 \|/)
  assert.match(section, /\| A5 \|/)
})

function sectionOf(text, heading) {
  const start = text.indexOf(heading)
  assert.ok(start >= 0, `missing section: ${heading}`)
  const rest = text.slice(start + heading.length)
  const next = rest.search(/\n## /)
  return next < 0 ? rest : rest.slice(0, next)
}
