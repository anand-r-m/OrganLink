import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildAuditReportPdf, buildDeclineReasonRows, buildFairnessRows, buildOfferRows, buildSummaryRows,
  filterOffersByDateRange, FAIRNESS_HEAD,
} from '../../src/pages/reportsAuditPdf.js';
import { adaptCompliance, adaptDeclineReasons, adaptFairness } from '../../src/api/adapters/reports.js';
import { adaptOfferRows, adaptMockOffer } from '../../src/api/adapters/offers.js';
import { mockOffers } from '../../src/data/mockOffers.js';

const compliance = adaptCompliance({ transplanted: 98, expiredUnallocated: 4, discarded: 2, totalOrgans: 104, placementRatePct: 94.23 });
const fairness = adaptFairness([
  { regionName: 'Northern Region', waitlistSize: 40, transplantsCompleted: 11, allocationRatePct: 27.5, medianWaitDays: 212.5, retentionPct: 81.82 },
  { regionName: 'Western Region', waitlistSize: 30, transplantsCompleted: 0, allocationRatePct: 0, medianWaitDays: null, retentionPct: null },
]);
const declines = adaptDeclineReasons([{ code: 'ORGAN_QUALITY', description: 'Organ quality', occurrences: 31, pct: 33.3 }]);
const liveOffers = adaptOfferRows([
  { id: 12, organId: 3, organType: 'Kidney', donorId: 1, recipientId: 5, recipientName: 'Ann Lee', status: 'ACCEPTED', createdAt: '2026-03-10T10:00:00Z' },
  { id: 13, organId: 4, organType: 'Liver', donorId: 2, recipientId: 6, recipientName: 'Bo Chen', status: 'DECLINED', createdAt: '2026-03-20T10:00:00Z', declineReasonCode: 'ORGAN_QUALITY' },
  { id: 14, organId: 5, organType: 'Heart', donorId: 2, recipientId: 7, recipientName: null, status: 'SENT', createdAt: '2026-05-01T10:00:00Z' },
]);

test('fairness rows: nulls render as an em dash, Expected/Variance are gone', () => {
  const rows = buildFairnessRows(fairness);
  assert.deepEqual(rows[1], ['Western Region', '30', '0', '0', '—', '—']);
  assert.deepEqual(rows[0], ['Northern Region', '40', '11', '27.5', '212.5', '81.82']);
  assert.equal(FAIRNESS_HEAD.length, 6);
  assert.ok(!FAIRNESS_HEAD.some((h) => /expected|variance/i.test(h)));
});

test('summary rows carry the compliance values and offer counts by status', () => {
  const rows = Object.fromEntries(buildSummaryRows(liveOffers, compliance));
  assert.equal(rows['Total organs (all time)'], '104');
  assert.equal(rows['Organs transplanted (all time)'], '98');
  assert.equal(rows['Organs expired unallocated (all time)'], '4');
  assert.equal(rows['Organs discarded (all time)'], '2');
  assert.equal(rows['Placement rate (all time)'], '94.23%');
  assert.equal(rows['Offers in selected period'], '3');
  assert.equal(rows['Accepted offers'], '1');
  assert.equal(rows['Declined offers'], '1');
  assert.equal(rows['Pending offers (created or sent)'], '1');
});

test('date range filter is inclusive and open-ended when a bound is null', () => {
  const day = (s) => new Date(s);
  const ids = (r) => filterOffersByDateRange(liveOffers, r).map((o) => o.dbId);
  assert.deepEqual(ids([null, null]), [12, 13, 14]);
  assert.deepEqual(ids([day('2026-03-20T00:00:00'), day('2026-03-20T00:00:00')]).length, 1);
  assert.deepEqual(ids([day('2026-03-11T00:00:00'), null]), [13, 14]);
  assert.deepEqual(ids([null, day('2026-03-15T00:00:00')]), [12]);
});

test('end date is inclusive through the late evening; just after midnight is excluded', () => {
  const mk = (id, at) => ({ id, offeredAt: at });
  const offers = [mk('a', '2026-03-20T23:30:00'), mk('b', '2026-03-21T00:05:00'), mk('c', '2026-03-20T00:00:00')];
  const range = [new Date('2026-03-20T00:00:00'), new Date('2026-03-20T00:00:00')];
  assert.deepEqual(filterOffersByDateRange(offers, range).map((o) => o.id), ['a', 'c']);
});

test('offers table uses display ids; decline rows show share', () => {
  const rows = buildOfferRows(liveOffers);
  assert.equal(rows[0][0], 'OF-0012');
  assert.equal(rows[0][2], 'Ann Lee');
  assert.equal(rows[2][2], 'R-0007');
  assert.deepEqual(buildDeclineReasonRows(declines), [['Organ quality', '31', '33.3%']]);
  assert.deepEqual(buildOfferRows([]), [['—', '—', '—', '—', '—']]);
});

const pdfText = (doc) => Buffer.from(doc.output('arraybuffer')).toString('latin1');

test('generates a non-empty PDF from live-shaped data', () => {
  const doc = buildAuditReportPdf({ dateRange: [null, null], offers: liveOffers, declineReasons: declines, fairness, compliance });
  const text = pdfText(doc);
  assert.ok(text.startsWith('%PDF'));
  for (const needle of ['OF-0012', 'Organ quality', 'Northern Region', 'all time']) {
    assert.ok(text.includes(needle), `PDF should contain ${needle}`);
  }
  assert.ok(!text.includes('Expected'));
});

test('generates a PDF from mock-shaped data and the mock offers', () => {
  const offers = mockOffers.map(adaptMockOffer);
  const doc = buildAuditReportPdf({ dateRange: [null, null], offers, declineReasons: [], fairness: [], compliance: adaptCompliance(null) });
  assert.ok(pdfText(doc).startsWith('%PDF'));
});

test('page sources: no mock offers import, no inline constants, report data passed through', () => {
  const pdf = readFileSync(new URL('../../src/pages/reportsAuditPdf.js', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../../src/pages/ReportsPage.jsx', import.meta.url), 'utf8');
  assert.ok(!/mockOffers/.test(pdf));
  assert.ok(!/DECLINE_REASONS|ALLOCATION_FAIRNESS|TOTAL_ORGANS/.test(page));
  assert.match(page, /disabled=\{!reportDataReady\}/);
  assert.match(page, /Loading report data…/);
  assert.match(page, /\.finally\(/);
  assert.match(page, /listOffers\(\)/);
  assert.match(page, /generateAuditReportPdf\(\{ dateRange, offers, declineReasons: declines, fairness, compliance \}\)/);
});
