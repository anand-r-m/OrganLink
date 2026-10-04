import { useEffect, useState } from 'react';
import { Button, Title, Tooltip as MantineTooltip } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconDownload } from '@tabler/icons-react';
import { generateAuditReportPdf } from './reportsAuditPdf.js';
import { listOffers } from '../api/offers.js';
import { showApiError } from '../api/notify.js';
import { getCompliance, getDeclineReasons, getFairness, getUtilization, getWaitingTimes } from '../api/reports.js';
import {
  adaptCompliance,
  adaptDeclineReasons,
  adaptFairness,
  adaptUtilization,
  adaptWaitingTimes,
  formatDays,
  formatPct,
} from '../api/adapters/reports.js';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const TOOLTIP_STYLE = {
  background: 'var(--bg-base)',
  border: 'none',
  borderRadius: 'var(--radius-input)',
  boxShadow: '4px 4px 8px var(--shadow-dark), -4px -4px 8px var(--shadow-light)',
  fontSize: 12,
  maxWidth: 220,
};

const CHART_HEIGHT = 280;

const CHART_CARD_STYLE = {
  padding: 'var(--card-padding)',
  minWidth: 0,
  height: 360,
  display: 'flex',
  flexDirection: 'column',
};

const ORGAN_TYPE_COLORS = [
  'var(--color-primary)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-info)',
  'var(--color-danger)',
];

const AXIS_TICK = { fill: 'var(--text-secondary)', fontSize: 12 };

function EmptyChart({ message = 'No data yet' }) {
  return (
    <div
      role="status"
      style={{
        height: CHART_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-secondary)',
        fontSize: 13,
      }}
    >
      {message}
    </div>
  );
}

// One small bar chart per fairness metric: the metrics have different units, so they do not share an axis.
function FairnessMetric({ title, data, dataKey, color, format }) {
  return (
    <div style={{ flex: '1 1 0', minWidth: 160 }}>
      <p style={{ margin: '0 0 var(--space-8)', fontSize: 13, color: 'var(--text-secondary)' }}>{title}</p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(0,0,0,0.04)" vertical={false} />
          <XAxis dataKey="shortRegion" tick={{ ...AXIS_TICK, fontSize: 11 }} axisLine={false} tickLine={false} interval={0} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => format(v)} />
          <Bar dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} name={title} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function ReportsPage() {
  const [dateRange, setDateRange] = useState([null, null]);
  const [waiting, setWaiting] = useState({ data: [], organTypes: [] });
  const [utilization, setUtilization] = useState([]);
  const [declines, setDeclines] = useState([]);
  const [fairness, setFairness] = useState([]);
  const [compliance, setCompliance] = useState(adaptCompliance(null));
  // Counts the decline/fairness/compliance loads that have settled (success or failure).
  const [settledCount, setSettledCount] = useState(0);
  const reportDataReady = settledCount >= 3;

  // Each report loads independently: one failing view shows an error notification and leaves its
  // own chart empty; the others still render.
  useEffect(() => {
    let cancelled = false;
    const load = (fetcher, adapt, set, title, countsForExport = false) =>
      fetcher()
        .then((rows) => !cancelled && set(adapt(rows)))
        .catch((err) => !cancelled && showApiError(err, title))
        .finally(() => !cancelled && countsForExport && setSettledCount((n) => n + 1));
    load(getWaitingTimes, adaptWaitingTimes, setWaiting, 'Could not load waiting times');
    load(getUtilization, adaptUtilization, setUtilization, 'Could not load organ utilization');
    load(getDeclineReasons, adaptDeclineReasons, setDeclines, 'Could not load decline reasons', true);
    load(getFairness, adaptFairness, setFairness, 'Could not load allocation fairness', true);
    load(getCompliance, adaptCompliance, setCompliance, 'Could not load compliance summary', true);
    return () => {
      cancelled = true;
    };
  }, []);

  // The decline, fairness and compliance rows are the same state the charts render (one API
  // response each), so the PDF totals match the page. Only the offers are fetched on demand.
  const handleExportAuditReport = async () => {
    try {
      const offers = await listOffers();
      generateAuditReportPdf({ dateRange, offers, declineReasons: declines, fairness, compliance });
    } catch (err) {
      showApiError(err, 'Could not export the audit report');
    }
  };

  return (
    <div
      className="reports-page"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--grid-gap)',
        minWidth: 0,
      }}
      aria-label="Analytics and Compliance"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-16)',
          flexWrap: 'wrap',
        }}
      >
        <Title order={2}>Analytics & Compliance</Title>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-12)',
            flexWrap: 'wrap',
            marginLeft: 'auto',
          }}
        >
          <DatePickerInput
            type="range"
            placeholder="Select date range"
            value={dateRange}
            onChange={setDateRange}
            valueFormat="MMM D, YYYY"
            w={280}
            classNames={{ input: 'neu-inset' }}
            styles={{
              input: {
                border: 'none',
                background: 'var(--bg-base)',
              },
            }}
          />
          <MantineTooltip label="Loading report data…" disabled={reportDataReady}>
            <span>
              <Button
                leftSection={<IconDownload size={16} stroke={1.75} />}
                onClick={handleExportAuditReport}
                disabled={!reportDataReady}
              >
                Export Audit Report
              </Button>
            </span>
          </MantineTooltip>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 'var(--grid-gap)',
        }}
      >
        <section className="neu-raised" style={CHART_CARD_STYLE}>
          <Title order={3} mb="md">
            Waiting Time Distribution
          </Title>
          <div style={{ flex: 1, minHeight: CHART_HEIGHT, minWidth: 0 }}>
            {waiting.data.length === 0 ? (
              <EmptyChart message="No active waitlist entries" />
            ) : (
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <BarChart data={waiting.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(0,0,0,0.04)" vertical={false} />
                  <XAxis dataKey="label" tick={{ ...AXIS_TICK, fontSize: 10 }} axisLine={false} tickLine={false} interval={0} angle={-35} textAnchor="end" height={48} />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  {waiting.organTypes.map((t, i) => (
                    <Bar key={t} dataKey={t} stackId="wait" fill={ORGAN_TYPE_COLORS[i % ORGAN_TYPE_COLORS.length]} name={t} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="neu-raised" style={CHART_CARD_STYLE}>
          <Title order={3} mb="md">
            Organ Utilization by Region
          </Title>
          <div style={{ flex: 1, minHeight: CHART_HEIGHT, minWidth: 0 }}>
            {utilization.length === 0 ? (
              <EmptyChart message="No organs recovered yet" />
            ) : (
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <BarChart data={utilization} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(0,0,0,0.04)" vertical={false} />
                  <XAxis dataKey="region" tick={{ ...AXIS_TICK, fontSize: 11 }} axisLine={false} tickLine={false} interval={0} />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="transplanted" stackId="util" fill="var(--color-success)" name="Transplanted" />
                  <Bar dataKey="expired" stackId="util" fill="var(--color-warning)" name="Expired" />
                  <Bar dataKey="discarded" stackId="util" fill="var(--color-danger)" name="Discarded" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="neu-raised" style={CHART_CARD_STYLE}>
          <Title order={3} mb="md">
            Decline Reasons
          </Title>
          <div style={{ flex: 1, minHeight: CHART_HEIGHT, minWidth: 0 }}>
            {declines.length === 0 ? (
              <EmptyChart message="No declined offers yet" />
            ) : (
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <BarChart layout="vertical" data={declines} margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                  <CartesianGrid stroke="rgba(0,0,0,0.04)" horizontal={false} />
                  <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="reason" width={168} tick={{ ...AXIS_TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, _n, item) => [`${v} (${formatPct(item?.payload?.pct)})`, 'Declines']} />
                  <Bar dataKey="count" fill="var(--color-danger)" fillOpacity={0.6} radius={[0, 6, 6, 0]} barSize={18} name="Declines" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="neu-raised" style={{ padding: 'var(--card-padding)', minWidth: 0, height: 360 }}>
          <Title order={3} mb="lg">
            Compliance Summary
          </Title>
          <p
            className="mono"
            aria-label="Placement rate"
            style={{ margin: 0, fontSize: 48, fontWeight: 700, lineHeight: 1.1, color: 'var(--color-success)' }}
          >
            {compliance.placementRateLabel}
          </p>
          <p style={{ margin: 'var(--space-8) 0 var(--space-24)', fontSize: 13, color: 'var(--text-secondary)' }}>
            Placement rate
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-32)', flexWrap: 'wrap' }}>
            {[
              ['Transplanted', compliance.transplanted],
              ['Expired unallocated', compliance.expiredUnallocated],
              ['Discarded', compliance.discarded],
              ['Total organs', compliance.totalOrgans],
            ].map(([label, value]) => (
              <div key={label}>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>{label}</p>
                <p className="mono" style={{ margin: 'var(--space-4) 0 0', fontSize: 16 }}>
                  {value}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="neu-raised" style={{ padding: 'var(--card-padding)', minWidth: 0 }}>
        <Title order={3} mb="md">
          Allocation Fairness
        </Title>
        {fairness.length === 0 ? (
          <EmptyChart message="No regions to report" />
        ) : (
          <>
            <div style={{ display: 'flex', gap: 'var(--space-24)', flexWrap: 'wrap' }}>
              <FairnessMetric title="Allocation rate (%)" data={fairness} dataKey="allocationRatePct" color="var(--color-primary)" format={formatPct} />
              <FairnessMetric title="Median wait (days)" data={fairness} dataKey="medianWaitDays" color="var(--color-info)" format={formatDays} />
              <FairnessMetric title="Retention (%)" data={fairness} dataKey="retentionPct" color="var(--color-success)" format={formatPct} />
            </div>
            <table style={{ width: '100%', marginTop: 'var(--space-16)', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                  <th>Region</th>
                  <th>Waitlist</th>
                  <th>Transplants</th>
                  <th>Allocation rate</th>
                  <th>Median wait</th>
                  <th>Retention</th>
                </tr>
              </thead>
              <tbody>
                {fairness.map((r) => (
                  <tr key={r.region}>
                    <td>{r.region}</td>
                    <td className="mono">{r.waitlistSize}</td>
                    <td className="mono">{r.transplantsCompleted}</td>
                    <td className="mono">{formatPct(r.allocationRatePct)}</td>
                    <td className="mono">{formatDays(r.medianWaitDays)}</td>
                    <td className="mono">{formatPct(r.retentionPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  );
}
