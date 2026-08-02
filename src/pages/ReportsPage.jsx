import { useState } from 'react';
import { Button, Title } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconDownload } from '@tabler/icons-react';
import { generateAuditReportPdf } from './reportsAuditPdf.js';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const WAITING_TIME = [
  { bucket: '0–3 mo', count: 124 },
  { bucket: '3–6 mo', count: 98 },
  { bucket: '6–12 mo', count: 156 },
  { bucket: '1–2 yr', count: 87 },
  { bucket: '2+ yr', count: 42 },
];

const ORGAN_UTILIZATION = [
  { region: 'North', count: 42, fill: 'var(--color-primary)' },
  { region: 'South', count: 38, fill: 'var(--color-success)' },
  { region: 'East', count: 31, fill: 'var(--color-warning)' },
  { region: 'West', count: 27, fill: 'var(--color-danger)' },
  { region: 'Central', count: 35, fill: 'var(--color-info)' },
];

const DECLINE_REASONS = [
  { reason: 'Medical contraindication', count: 18 },
  { reason: 'Patient too ill', count: 24 },
  { reason: 'Organ quality', count: 31 },
  { reason: 'Logistical timeout', count: 12 },
  { reason: 'Patient refused', count: 8 },
];

const ALLOCATION_FAIRNESS = [
  { region: 'North', actual: 22, expected: 20 },
  { region: 'South', actual: 18, expected: 20 },
  { region: 'East', actual: 21, expected: 20 },
  { region: 'West', actual: 16, expected: 20 },
  { region: 'Central', actual: 23, expected: 20 },
];

const TOTAL_ORGANS = ORGAN_UTILIZATION.reduce((sum, item) => sum + item.count, 0);

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

function DonutCenterLabel({ viewBox, x, y }) {
  const centerX =
    (typeof viewBox?.cx === 'number' ? viewBox.cx : undefined) ??
    (typeof x === 'number' ? x : undefined) ??
    (typeof viewBox?.x === 'number' && typeof viewBox?.width === 'number'
      ? viewBox.x + viewBox.width / 2
      : undefined);
  const centerY =
    (typeof viewBox?.cy === 'number' ? viewBox.cy : undefined) ??
    (typeof y === 'number' ? y : undefined) ??
    (typeof viewBox?.y === 'number' && typeof viewBox?.height === 'number'
      ? viewBox.y + viewBox.height / 2
      : undefined);

  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
    return null;
  }

  return (
    <>
      <text
        x={centerX}
        y={centerY - 6}
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--text-primary)"
        style={{ fontSize: 28, fontWeight: 700, fontFamily: 'Manrope, sans-serif' }}
      >
        {TOTAL_ORGANS}
      </text>
      <text
        x={centerX}
        y={centerY + 18}
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--text-secondary)"
        style={{ fontSize: 12, fontFamily: 'Manrope, sans-serif' }}
      >
        Total Organs
      </text>
    </>
  );
}

export default function ReportsPage() {
  const [dateRange, setDateRange] = useState([null, null]);

  const handleExportAuditReport = () => {
    generateAuditReportPdf({
      dateRange,
      declineReasons: DECLINE_REASONS,
      allocationFairness: ALLOCATION_FAIRNESS,
      totalOrgans: TOTAL_ORGANS,
    });
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
          <Button
            leftSection={<IconDownload size={16} stroke={1.75} />}
            onClick={handleExportAuditReport}
          >
            Export Audit Report
          </Button>
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
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart
                data={WAITING_TIME}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid stroke="rgba(0,0,0,0.04)" vertical={false} />
                <XAxis
                  dataKey="bucket"
                  tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar
                  dataKey="count"
                  fill="var(--color-primary)"
                  radius={[6, 6, 0, 0]}
                  name="Recipients"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="neu-raised" style={CHART_CARD_STYLE}>
          <Title order={3} mb="md">
            Organ Utilization by Region
          </Title>
          <div style={{ flex: 1, minHeight: CHART_HEIGHT, minWidth: 0 }}>
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <PieChart margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <Pie
                  data={ORGAN_UTILIZATION}
                  dataKey="count"
                  nameKey="region"
                  cx="50%"
                  cy="42%"
                  innerRadius="58%"
                  outerRadius="76%"
                  paddingAngle={2}
                >
                  {ORGAN_UTILIZATION.map((entry) => (
                    <Cell key={entry.region} fill={entry.fill} />
                  ))}
                  <Label content={DonutCenterLabel} position="center" />
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend
                  verticalAlign="bottom"
                  iconType="circle"
                  wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="neu-raised" style={CHART_CARD_STYLE}>
          <Title order={3} mb="md">
            Decline Reasons
          </Title>
          <div style={{ flex: 1, minHeight: CHART_HEIGHT, minWidth: 0 }}>
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart
                layout="vertical"
                data={DECLINE_REASONS}
                margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
              >
                <CartesianGrid stroke="rgba(0,0,0,0.04)" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="reason"
                  width={168}
                  tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar
                  dataKey="count"
                  fill="var(--color-danger)"
                  fillOpacity={0.6}
                  radius={[0, 6, 6, 0]}
                  barSize={18}
                  name="Declines"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="neu-raised" style={CHART_CARD_STYLE}>
          <Title order={3} mb="md">
            Allocation Fairness
          </Title>
          <div style={{ flex: 1, minHeight: CHART_HEIGHT, minWidth: 0 }}>
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart
                data={ALLOCATION_FAIRNESS}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid stroke="rgba(0,0,0,0.04)" vertical={false} />
                <XAxis
                  dataKey="region"
                  tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={32}
                />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend
                  iconType="circle"
                  wrapperStyle={{ fontSize: 12 }}
                />
                <Bar
                  dataKey="actual"
                  fill="var(--color-primary)"
                  radius={[4, 4, 0, 0]}
                  name="Actual allocation"
                />
                <Bar
                  dataKey="expected"
                  fill="var(--color-info)"
                  radius={[4, 4, 0, 0]}
                  name="Expected allocation"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <section
        className="neu-raised"
        style={{
          padding: 'var(--card-padding)',
          minWidth: 0,
        }}
      >
        <Title order={3} mb="lg">
          Compliance Summary
        </Title>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 'var(--space-48)',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <p
              className="mono"
              style={{
                margin: 0,
                fontSize: 48,
                fontWeight: 700,
                lineHeight: 1.1,
                color: 'var(--color-success)',
              }}
            >
              94.2%
            </p>
            <p
              style={{
                margin: 'var(--space-8) 0 0',
                fontSize: 13,
                color: 'var(--text-secondary)',
              }}
            >
              Overall compliance score
            </p>
          </div>
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-32)',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                Response Time Avg
              </p>
              <p className="mono" style={{ margin: 'var(--space-4) 0 0', fontSize: 16 }}>
                2.3h
              </p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                Viability Window Compliance
              </p>
              <p className="mono" style={{ margin: 'var(--space-4) 0 0', fontSize: 16 }}>
                97%
              </p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                ABO Match Rate
              </p>
              <p className="mono" style={{ margin: 'var(--space-4) 0 0', fontSize: 16 }}>
                100%
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
