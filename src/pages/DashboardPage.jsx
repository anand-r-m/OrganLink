import { useMemo } from 'react';
import { Title } from '@mantine/core';
import {
  IconActivity,
  IconClipboardCheck,
  IconHeart,
  IconUsers,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Link } from 'react-router-dom';

import DataTable from '../components/DataTable.jsx';
import StatCard from '../components/StatCard.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { mockOffers } from '../data/mockOffers.js';

const ALLOCATION_TRENDS = [
  { month: 'Jan', count: 18 },
  { month: 'Feb', count: 22 },
  { month: 'Mar', count: 26 },
  { month: 'Apr', count: 24 },
  { month: 'May', count: 31 },
  { month: 'Jun', count: 28 },
  { month: 'Jul', count: 35 },
  { month: 'Aug', count: 32 },
  { month: 'Sep', count: 38 },
  { month: 'Oct', count: 41 },
  { month: 'Nov', count: 36 },
  { month: 'Dec', count: 44 },
];

const CRITICAL_ALERTS = [
  {
    urgency: 'danger',
    message: 'Organ K-0912 viability expires in 2h 15m',
    timestamp: '10 mins ago',
  },
  {
    urgency: 'warning',
    message: '3 offers pending response > 4 hours',
    timestamp: '25 mins ago',
  },
  {
    urgency: 'danger',
    message: 'Transport T-882 delayed — viability window narrowing',
    timestamp: '42 mins ago',
  },
  {
    urgency: 'info',
    message: 'Match #4921 accepted — allocation confirmed',
    timestamp: '1 hour ago',
  },
];

const URGENCY_COLORS = {
  danger: 'var(--color-danger)',
  warning: 'var(--color-warning)',
  info: 'var(--color-info)',
  success: 'var(--color-success)',
};

const RECENT_OFFERS = mockOffers.slice(0, 5);

export default function DashboardPage() {
  const offerColumns = useMemo(
    () => [
      {
        accessorKey: 'id',
        header: 'Offer ID',
        Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span>,
      },
      {
        accessorKey: 'organType',
        header: 'Organ Type',
      },
      {
        accessorKey: 'donorId',
        header: 'Donor ID',
        Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span>,
      },
      {
        accessorKey: 'recipientId',
        header: 'Recipient ID',
        Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span>,
      },
      {
        accessorKey: 'status',
        header: 'Status',
        Cell: ({ cell }) => <StatusBadge status={cell.getValue()} />,
      },
      {
        accessorKey: 'offeredAt',
        header: 'Created',
        Cell: ({ cell }) => (
          <span className="mono">{dayjs(cell.getValue()).format('YYYY-MM-DD HH:mm')}</span>
        ),
      },
    ],
    [],
  );

  return (
    <div
      className="dashboard-page"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--grid-gap)', minWidth: 0 }}
      aria-label="Dashboard"
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: '20px',
        }}
      >
        <StatCard
          icon={IconHeart}
          color="danger"
          value={12}
          label="Available Organs"
          trend={3}
        />
        <StatCard
          icon={IconUsers}
          color="primary"
          value={847}
          label="Active Waitlist"
          trend={12}
        />
        <StatCard
          icon={IconClipboardCheck}
          color="warning"
          value={3}
          label="Pending Offers"
          trend={-2}
        />
        <StatCard
          icon={IconActivity}
          color="success"
          value={28}
          label="Transplants This Month"
          trend={5}
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '3fr 2fr',
          gap: '20px',
          minWidth: 0,
        }}
      >
        <section className="neu-raised" style={{ padding: 'var(--card-padding)', minWidth: 0 }}>
          <Title order={3} mb="md">
            Allocation Trends
          </Title>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={ALLOCATION_TRENDS} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="allocationGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(0,0,0,0.04)" vertical={false} />
              <XAxis
                dataKey="month"
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
              <Tooltip
                contentStyle={{
                  background: 'var(--bg-base)',
                  border: 'none',
                  borderRadius: 'var(--radius-input)',
                  boxShadow:
                    '4px 4px 8px var(--shadow-dark), -4px -4px 8px var(--shadow-light)',
                }}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="var(--color-primary)"
                strokeWidth={2}
                fill="url(#allocationGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </section>

        <section
          className="neu-raised"
          style={{
            padding: 'var(--card-padding)',
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <Title order={3} mb="md">
            Critical Alerts
          </Title>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-12)',
              overflowY: 'auto',
              flex: 1,
            }}
          >
            {CRITICAL_ALERTS.map((alert) => (
              <article
                key={alert.message}
                style={{
                  display: 'flex',
                  gap: 'var(--space-12)',
                  alignItems: 'flex-start',
                  padding: 'var(--space-12)',
                  borderRadius: 'var(--radius-input)',
                  background: 'var(--bg-base)',
                  boxShadow:
                    'inset 2px 2px 4px var(--shadow-dark), inset -2px -2px 4px var(--shadow-light)',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: URGENCY_COLORS[alert.urgency] ?? URGENCY_COLORS.info,
                    flexShrink: 0,
                    marginTop: 6,
                  }}
                />
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{alert.message}</p>
                  <p
                    className="mono"
                    style={{
                      margin: 'var(--space-4) 0 0',
                      fontSize: 12,
                      color: 'var(--text-muted)',
                    }}
                  >
                    {alert.timestamp}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className="neu-raised" style={{ padding: 'var(--card-padding)', minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 'var(--space-16)',
            gap: 'var(--space-16)',
          }}
        >
          <Title order={3}>Recent Organ Offers</Title>
          <Link
            to="/offers"
            style={{
              color: 'var(--color-primary)',
              fontWeight: 600,
              fontSize: 14,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            View All →
          </Link>
        </div>
        <DataTable
          columns={offerColumns}
          data={RECENT_OFFERS}
          enablePagination={false}
          enableBottomToolbar={false}
          initialState={{ showGlobalFilter: false }}
          mantinePaperProps={{
            className: 'data-table-paper',
            shadow: 'none',
            withBorder: false,
            style: { background: 'transparent', boxShadow: 'none', padding: 0 },
          }}
        />
      </section>
    </div>
  );
}
