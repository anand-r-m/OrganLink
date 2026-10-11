import { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { Button, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconTruckDelivery } from '@tabler/icons-react';

import DataTable from '../components/DataTable.jsx';
import './TransportPage.css';
import StatusBadge from '../components/StatusBadge.jsx';
import TransportMap from '../components/TransportMap.jsx';
import ViabilityCountdown from '../components/ViabilityCountdown.jsx';
import FormModal from '../components/FormModal.jsx';
import { deliverTransport, departTransport, listTransports } from '../api/transport.js';
import { nextTransportAction, viabilityElapsed } from '../api/adapters/transport.js';
import { showApiError } from '../api/notify.js';

const formatTime = (iso) => (iso ? dayjs(iso).format('YYYY-MM-DD HH:mm') : '—');

// The clock is the organ's own viability window; it stops mattering once the organ is delivered or failed.
const SHOWS_COUNTDOWN = new Set(['PENDING', 'IN_TRANSIT']);

const ACTIONS = {
  depart: {
    label: 'Mark In Transit',
    title: 'Mark In Transit',
    run: departTransport,
    done: 'Transport marked in transit',
    failed: 'Could not mark in transit',
  },
  deliver: {
    label: 'Mark Delivered',
    title: 'Mark Delivered',
    run: deliverTransport,
    done: 'Transport marked delivered',
    failed: 'Could not mark delivered',
  },
};

export default function TransportPage() {
  const [transports, setTransports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(null); // { row, action }
  const [busy, setBusy] = useState(false);

  const reload = useCallback(
    () => listTransports().then(setTransports).catch((err) => showApiError(err, 'Could not load transports')),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    listTransports()
      .then((rows) => !cancelled && setTransports(rows))
      .catch((err) => !cancelled && showApiError(err, 'Could not load transports'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function confirmAction() {
    const { row, action } = pending;
    const def = ACTIONS[action];
    setBusy(true);
    try {
      const updated = await def.run(row);
      setTransports((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      notifications.show({ title: def.done, message: `${row.id} · ${row.organId}`, color: 'green' });
    } catch (err) {
      showApiError(err, def.failed);
      reload(); // the row may have moved on (409); show the current state
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

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
        Cell: ({ row }) =>
          SHOWS_COUNTDOWN.has(row.original.status) ? (
            <ViabilityCountdown
              key={`${row.original.id}-${row.original.expiresAt}-${row.original.elapsedHours}`}
              viabilityHours={row.original.viabilityHours}
              elapsedHours={row.original.elapsedHours}
            />
          ) : (
            '—'
          ),
      },
      {
        accessorKey: 'departedAt',
        header: 'Departed At',
        size: 140,
        Cell: ({ cell }) => <span className="mono">{formatTime(cell.getValue())}</span>,
      },
      {
        accessorKey: 'arrivedAt',
        header: 'Arrived At',
        size: 140,
        Cell: ({ cell }) => <span className="mono">{formatTime(cell.getValue())}</span>,
      },
      {
        id: 'actions',
        header: 'Actions',
        size: 160,
        enableSorting: false,
        enableGlobalFilter: false,
        // Only the button valid for the current status is rendered (invalid states show none).
        Cell: ({ row }) => {
          const action = nextTransportAction(row.original.status);
          if (!action) return <span>—</span>;
          if (action === 'depart' && viabilityElapsed(row.original)) {
            return (
              <Text size="xs" c="red">
                Viability elapsed — cannot dispatch
              </Text>
            );
          }
          return (
            <Button size="xs" onClick={() => setPending({ row: row.original, action })}>
              {ACTIONS[action].label}
            </Button>
          );
        },
      },
    ],
    [],
  );

  const pendingDef = pending ? ACTIONS[pending.action] : null;

  return (
    <div
      className="transport-page"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--grid-gap)', minWidth: 0 }}
      aria-label="Transport"
    >
      <Group justify="space-between">
        <Title order={2}>Transport</Title>
        {loading && <Loader size="sm" />}
      </Group>
      <TransportMap transports={transports} />
      <DataTable
        columns={transportColumns}
        data={transports}
        emptyMessage="No transport records found"
        emptyIcon={IconTruckDelivery}
        state={{ isLoading: loading && transports.length === 0 }}
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
      <FormModal
        opened={!!pending}
        onClose={() => !busy && setPending(null)}
        title={pendingDef?.title ?? ''}
        submitLabel={pendingDef?.label ?? 'Confirm'}
        loading={busy}
        onSubmit={confirmAction}
        size="md"
      >
        <Stack gap={8}>
          <Text>
            {pending?.action === 'depart'
              ? `Confirm that organ ${pending.row.organId} (${pending.row.organType}) has left ${pending.row.originHospital} for ${pending.row.destHospital}.`
              : pending
                ? `Confirm that organ ${pending.row.organId} (${pending.row.organType}) has arrived at ${pending.row.destHospital}. This unlocks Record Transplant.`
                : null}
          </Text>
        </Stack>
      </FormModal>
    </div>
  );
}
