import { useMemo } from 'react';
import dayjs from 'dayjs';

import DataTable from '../components/DataTable.jsx';
import './TransportPage.css';
import StatusBadge from '../components/StatusBadge.jsx';
import TransportMap from '../components/TransportMap.jsx';
import ViabilityCountdown from '../components/ViabilityCountdown.jsx';
import { mockTransports } from '../data/mockTransports.js';

export default function TransportPage() {
  const transportColumns = useMemo(
    () => [
      {
        accessorKey: 'id',
        header: 'Transport ID',
        size: 100,
        Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span>,
      },
      {
        accessorKey: 'organId',
        header: 'Organ ID',
        size: 90,
        Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span>,
      },
      {
        accessorKey: 'organType',
        header: 'Organ Type',
        size: 90,
      },
      {
        accessorKey: 'originHospital',
        header: 'Origin Hospital',
        size: 110,
        mantineTableBodyCellProps: { style: { whiteSpace: 'normal' } },
      },
      {
        accessorKey: 'destHospital',
        header: 'Destination Hospital',
        size: 110,
        mantineTableBodyCellProps: { style: { whiteSpace: 'normal' } },
      },
      {
        accessorKey: 'status',
        header: 'Status',
        size: 110,
        Cell: ({ cell }) => <StatusBadge status={cell.getValue()} />,
      },
      {
        id: 'viabilityRemaining',
        header: 'Viability Remaining',
        size: 180,
        minSize: 160,
        accessorFn: (row) => row,
        enableGlobalFilter: false,
        Cell: ({ row }) => (
          <ViabilityCountdown
            viabilityHours={row.original.viabilityHours}
            elapsedHours={row.original.elapsedHours}
          />
        ),
      },
      {
        accessorKey: 'departedAt',
        header: 'Departed At',
        size: 140,
        Cell: ({ cell }) => {
          const value = cell.getValue();
          return (
            <span className="mono">{value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—'}</span>
          );
        },
      },
    ],
    [],
  );

  return (
    <div
      className="transport-page"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--grid-gap)', minWidth: 0 }}
      aria-label="Transport"
    >
      <TransportMap />
      <DataTable
        columns={transportColumns}
        data={mockTransports}
        emptyMessage="No transport records found"
        enablePagination={false}
        enableBottomToolbar={false}
        enableColumnActions={false}
        layoutMode="grid"
        mantinePaperProps={{
          className: 'data-table-paper neu-raised transport-records-table',
          shadow: 'none',
          withBorder: false,
        }}
      />
    </div>
  );
}
