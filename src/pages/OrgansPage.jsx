import { useEffect, useMemo, useState } from 'react';
import { Group, Loader, Select, Title } from '@mantine/core';
import { IconHeartbeat } from '@tabler/icons-react';
import DataTable from '../components/DataTable.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import ViabilityCountdown from '../components/ViabilityCountdown.jsx';
import { listOrgans } from '../api/organs.js';
import { showApiError } from '../api/notify.js';

const STATUS_OPTIONS = ['AVAILABLE', 'ALLOCATED', 'TRANSPLANTED', 'EXPIRED', 'DISCARDED'].map((s) => ({
  value: s,
  label: s.charAt(0) + s.slice(1).toLowerCase(),
}));

// The clock only matters while an organ can still expire (the sweep expires AVAILABLE organs only).
const SHOWS_COUNTDOWN = new Set(['AVAILABLE', 'EXPIRED']);

const formatTime = (iso) =>
  iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';

// A10: Organs page (06 Stage 3). Expired organs stay in the list with the EXPIRED badge.
export default function OrgansPage() {
  const [organs, setOrgans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listOrgans({ status: filterStatus ?? undefined })
      .then((rows) => !cancelled && setOrgans(rows))
      .catch((err) => !cancelled && showApiError(err, 'Could not load organs'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [filterStatus]);

  const columns = useMemo(
    () => [
      { accessorKey: 'id', header: 'Organ ID', size: 100, Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span> },
      { accessorKey: 'organType', header: 'Type', size: 100 },
      { accessorKey: 'donor', header: 'Donor', size: 100, Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span> },
      { accessorKey: 'bloodGroup', header: 'Blood Group', size: 90, Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span> },
      { accessorKey: 'hospital', header: 'Recovering Hospital', size: 180 },
      { accessorKey: 'recoveredAt', header: 'Recovered', size: 150, Cell: ({ cell }) => formatTime(cell.getValue()) },
      {
        id: 'viability',
        header: 'Viability',
        size: 190,
        enableSorting: false,
        Cell: ({ row }) => {
          const o = row.original;
          if (!SHOWS_COUNTDOWN.has(o.status)) return '—';
          // Key on expiresAt so a refreshed row restarts its timer.
          return (
            <ViabilityCountdown
              key={`${o.id}-${o.expiresAt}-${o.elapsedHours}`}
              viabilityHours={o.viabilityHours}
              elapsedHours={o.elapsedHours}
            />
          );
        },
      },
      { accessorKey: 'status', header: 'Status', size: 120, Cell: ({ cell }) => <StatusBadge status={cell.getValue()} /> },
      {
        accessorKey: 'hasActiveOffer',
        header: 'Active Offer',
        size: 110,
        Cell: ({ row }) =>
          row.original.hasActiveOffer ? <StatusBadge status="SENT" label="Active offer" /> : <span>—</span>,
      },
    ],
    [],
  );

  return (
    <div>
      <Group justify="space-between" mb="md">
        <Title order={2}>Organs</Title>
        <Group>
          {loading && <Loader size="sm" />}
          <Select
            placeholder="All statuses"
            aria-label="Filter by status"
            data={STATUS_OPTIONS}
            value={filterStatus}
            onChange={setFilterStatus}
            clearable
            w={180}
          />
        </Group>
      </Group>
      <DataTable
        columns={columns}
        data={organs}
        emptyMessage="No organs found"
        emptyIcon={IconHeartbeat}
        state={{ isLoading: loading && organs.length === 0 }}
      />
    </div>
  );
}
