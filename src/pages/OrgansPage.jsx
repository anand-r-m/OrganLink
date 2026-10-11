import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Group, Loader, Select, Title, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconHeartbeat } from '@tabler/icons-react';
import DataTable from '../components/DataTable.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import ViabilityCountdown from '../components/ViabilityCountdown.jsx';
import FormModal from '../components/FormModal.jsx';
import { discardOrgan, listOrgans } from '../api/organs.js';
import { getLookups } from '../api/lookups.js';
import {
  defaultDiscardReasonId,
  discardBlockedTooltip,
  discardReasonOptions,
  showsDiscard,
} from '../api/adapters/organs.js';
import { showApiError } from '../api/notify.js';

const STATUS_OPTIONS = ['AVAILABLE', 'ALLOCATED', 'TRANSPLANTED', 'EXPIRED', 'DISCARDED'].map((s) => ({
  value: s,
  label: s.charAt(0) + s.slice(1).toLowerCase(),
}));

// The clock only matters while an organ can still expire (the sweep expires AVAILABLE organs only).
const SHOWS_COUNTDOWN = new Set(['AVAILABLE', 'EXPIRED']);

// Mock mode has no lookups endpoint; same coded reasons as db/02_seed_reference.sql.
const MOCK_DISCARD_REASONS = [
  ['NO_SUITABLE_RECIPIENT', 'No compatible recipient identified'],
  ['ALL_DECLINED', 'All ranked candidates declined the offer'],
  ['VIABILITY_ELAPSED', 'Viability window elapsed before placement'],
  ['QUALITY_ASSESSMENT', 'Failed quality assessment on inspection'],
  ['TRANSPLANT_FAILED', 'Organ not used or transplant unsuccessful'],
  ['TRANSPORT_FAILURE', 'Lost or damaged in transport'],
].map(([code, description], i) => ({ id: i + 1, code, description }));

const formatTime = (iso) =>
  iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';

// A10: Organs page (06 Stage 3). Expired organs stay in the list with the EXPIRED badge.
export default function OrgansPage() {
  const [organs, setOrgans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [reasons, setReasons] = useState([]);
  const [discardTarget, setDiscardTarget] = useState(null);
  const [reasonId, setReasonId] = useState(null);
  const [reasonError, setReasonError] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [discarding, setDiscarding] = useState(false);

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
  }, [filterStatus, reloadKey]);

  // Coded discard reasons (live lookups). Mock mode has no lookups, so it uses this fixed list.
  useEffect(() => {
    let cancelled = false;
    getLookups()
      .then((l) => !cancelled && setReasons(l ? l.discardReasons : MOCK_DISCARD_REASONS))
      .catch((err) => !cancelled && showApiError(err, 'Could not load discard reasons'));
    return () => {
      cancelled = true;
    };
  }, []);

  const openDiscard = (organ) => {
    setDiscardTarget(organ);
    setReasonId(defaultDiscardReasonId(organ, reasons));
    setReasonError(null);
    setSubmitError(null);
  };
  const closeDiscard = () => setDiscardTarget(null);

  async function submitDiscard() {
    if (!reasonId) {
      setReasonError('Select a discard reason');
      return;
    }
    setDiscarding(true);
    setSubmitError(null);
    try {
      await discardOrgan(discardTarget, reasonId);
      notifications.show({ title: 'Organ discarded', message: `${discardTarget.id} has been discarded`, color: 'orange' });
      closeDiscard();
    } catch (err) {
      // Show the server's message in the modal and refresh: the organ may have changed state meanwhile.
      setSubmitError(err?.message || 'Could not discard the organ');
    } finally {
      setDiscarding(false);
      setReloadKey((k) => k + 1);
    }
  }

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
      {
        id: 'actions',
        header: 'Actions',
        size: 110,
        enableSorting: false,
        Cell: ({ row }) => {
          const o = row.original;
          if (!showsDiscard(o)) return null;
          const blockedReason = discardBlockedTooltip(o);
          const blocked = blockedReason !== null;
          return (
            <Tooltip label={blockedReason ?? ''} disabled={!blocked}>
              <span>
                <Button size="compact-sm" variant="light" color="red" disabled={blocked} onClick={() => openDiscard(o)}>
                  Discard
                </Button>
              </span>
            </Tooltip>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reasons],
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
      <FormModal
        opened={discardTarget !== null}
        onClose={closeDiscard}
        title={discardTarget ? `Discard ${discardTarget.id}` : 'Discard organ'}
        onSubmit={submitDiscard}
        submitLabel="Discard organ"
        loading={discarding}
      >
        {submitError && (
          <Alert color="red" mb="md" title="Could not discard">
            {submitError}
          </Alert>
        )}
        <Select
          label="Discard reason"
          placeholder="Select a reason"
          data={discardReasonOptions(reasons)}
          value={reasonId}
          onChange={(v) => {
            setReasonId(v);
            setReasonError(null);
          }}
          error={reasonError}
          required
          allowDeselect={false}
        />
      </FormModal>
    </div>
  );
}
