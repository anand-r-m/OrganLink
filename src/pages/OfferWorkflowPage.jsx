import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBan,
  IconBuildingHospital,
  IconCheck,
  IconHeartbeat,
  IconPlus,
  IconSend,
  IconX,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';

import DataTable from '../components/DataTable.jsx';
import FormModal from '../components/FormModal.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

import { mockDonors } from '../data/mockDonors.js';
import { mockOrgans } from '../data/mockOrgans.js';
import { mockRecipients } from '../data/mockRecipients.js';

import { USE_LIVE_API } from '../api/client.js';
import { acceptOffer, advanceOffer, cancelOffer, declineOffer, listOffers, saveMockOffer, sendOffer } from '../api/offers.js';
import { recordTransplant, TRANSPLANT_OUTCOMES } from '../api/transplants.js';
import { canRecordTransplant, TRANSPLANT_DISABLED_TIP } from '../api/adapters/offers.js';
import { getLookups } from '../api/lookups.js';
import { showApiError } from '../api/notify.js';
import { recipientId } from '../utils/displayId.js';

import {
  DECLINE_REASONS,
  createOfferFromSelection,
  getAllowedTransitions,
  hasActiveOfferForOrgan,
  isActiveOfferStatus,
} from '../utils/offerTransitions.js';


const ADVANCE_FROM = ['DECLINED', 'EXPIRED', 'VOIDED', 'CANCELLED'];

function formatDateTime(value) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—';
}

const DATETIME_LOCAL = 'YYYY-MM-DDTHH:mm';
const outcomeLabel = (value) => TRANSPLANT_OUTCOMES.find((o) => o.value === value)?.label ?? value;

export default function OfferWorkflowPage() {
  const navigate = useNavigate();

  /* Local state initialized from mock data. The imported arrays are never
     mutated — every update produces new objects/arrays (Section 5.6, task
     "do not mutate mockOffers.js"). Organs/recipients are mirrored locally so
     an accepted offer can mark the organ Allocated and the recipient
     Transplanted without touching the shared mock modules. */
  const [offers, setOffers] = useState([]);
  const [offersLoading, setOffersLoading] = useState(true);
  const [organs, setOrgans] = useState(mockOrgans);
  const [recipients] = useState(mockRecipients);

  /* Create Offer modal */
  const [createOpen, createHandlers] = useDisclosure(false);
  const [createOrganId, setCreateOrganId] = useState('');
  const [createRecipientId, setCreateRecipientId] = useState('');
  const [createErrors, setCreateErrors] = useState({});

  /* Record Accept / Record Decline modals */
  const [acceptTarget, setAcceptTarget] = useState(null);
  const [declineTarget, setDeclineTarget] = useState(null);
  const [declineReason, setDeclineReason] = useState('');
  const [declineNotes, setDeclineNotes] = useState('');
  const [declineErrors, setDeclineErrors] = useState({});
  /* Live decline reasons come from /api/lookups (coded reasons); mock mode keeps its text list. */
  const [declineOptions, setDeclineOptions] = useState(DECLINE_REASONS);
  /* Record Transplant modal (outcome, timestamp, notes; 07 §7). */
  const [transplantTarget, setTransplantTarget] = useState(null);
  const [transplantOutcome, setTransplantOutcome] = useState('');
  const [transplantAt, setTransplantAt] = useState('');
  const [transplantNotes, setTransplantNotes] = useState('');
  const [transplantErrors, setTransplantErrors] = useState({});
  /* Result of the last Advance to Next: the new offer and the ranks that were skipped. */
  const [advanceResult, setAdvanceResult] = useState(null);
  const [busy, setBusy] = useState(false);

  /* The list comes from the API layer (live: GET /api/offers; mock: the shared mock store). */
  useEffect(() => {
    let cancelled = false;
    listOffers()
      .then((rows) => !cancelled && setOffers(rows))
      .catch((err) => !cancelled && showApiError(err, 'Could not load offers'))
      .finally(() => !cancelled && setOffersLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!USE_LIVE_API) return undefined;
    let cancelled = false;
    getLookups()
      .then((l) => {
        if (!cancelled && l) setDeclineOptions(l.declineReasons.map((r) => ({ value: String(r.id), label: r.description })));
      })
      .catch((err) => !cancelled && showApiError(err, 'Could not load decline reasons'));
    return () => {
      cancelled = true;
    };
  }, []);

  function resetCreateForm() {
    setCreateOrganId('');
    setCreateRecipientId('');
    setCreateErrors({});
  }

  function resetDeclineForm() {
    setDeclineReason('');
    setDeclineNotes('');
    setDeclineErrors({});
  }

  function openTransplantModal(offer) {
    setTransplantOutcome('');
    setTransplantAt(dayjs().format(DATETIME_LOCAL));
    setTransplantNotes('');
    setTransplantErrors({});
    setTransplantTarget(offer);
  }

  function closeTransplantModal() {
    setTransplantTarget(null);
    setTransplantErrors({});
  }

  /* --- Derived options ---------------------------------------------------- */

  const createOrganOptions = useMemo(
    () =>
      organs
        .filter((organ) => organ.status === 'Available')
        .map((organ) => ({
          value: organ.id,
          label: `${organ.id} (${organ.organType}, ${organ.bloodGroup})`,
          disabled: hasActiveOfferForOrgan(offers, organ.id),
        })),
    [organs, offers],
  );

  const createableOrganCount = createOrganOptions.filter((option) => !option.disabled).length;
  const hasAvailableOrgans = organs.some((organ) => organ.status === 'Available');
  const createButtonDisabled = createableOrganCount === 0;
  const createButtonTooltip = hasAvailableOrgans
    ? 'Active offer exists for this organ'
    : 'No organs available for offers';

  const createRecipientOptions = useMemo(() => {
    if (!createOrganId) return [];
    const organ = organs.find((o) => o.id === createOrganId);
    if (!organ) return [];
    const offeredForOrgan = new Set(
      offers.filter((o) => o.organId === organ.id).map((o) => o.recipientId),
    );
    return recipients
      .filter(
        (recipient) =>
          recipient.organNeeded === organ.organType &&
          recipient.status === 'Waiting' &&
          !offeredForOrgan.has(recipient.id),
      )
      .map((recipient) => ({
        value: recipient.id,
        label: `${recipient.id} — ${recipient.name} (${recipient.bloodGroup}, Urgency ${recipient.urgency})`,
      }));
  }, [createOrganId, organs, recipients, offers]);

  const selectedCreateOrgan = organs.find((o) => o.id === createOrganId) ?? null;
  const selectedCreateDonor = mockDonors.find(
    (d) => d.id === selectedCreateOrgan?.donorId,
  );

  const summary = useMemo(() => {
    const active = offers.filter((offer) => isActiveOfferStatus(offer.status)).length;
    const accepted = offers.filter((offer) => offer.status === 'ACCEPTED').length;
    const declined = offers.filter((offer) => offer.status === 'DECLINED').length;
    const expired = offers.filter((offer) => offer.status === 'EXPIRED').length;
    return { active, accepted, declined, expired, total: offers.length };
  }, [offers]);

  /* --- Actions ------------------------------------------------------------ */

  function notifyError(title, message) {
    notifications.show({ title, message, color: 'red' });
  }

  const replaceOffer = (updated) => setOffers((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));

  async function handleSendOffer(offer) {
    try {
      replaceOffer(await sendOffer(offer));
      notifications.show({ title: 'Offer sent', message: `${offer.id} sent to ${offer.recipientId}`, color: 'blue' });
    } catch (error) {
      showApiError(error, 'Send failed');
      listOffers().then(setOffers).catch(() => {});
    }
  }

  async function handleCancelOffer(offer) {
    try {
      replaceOffer(await cancelOffer(offer));
      notifications.show({ title: 'Offer cancelled', message: `${offer.id} cancelled`, color: 'gray' });
    } catch (error) {
      showApiError(error, 'Cancel failed');
      listOffers().then(setOffers).catch(() => {});
    }
  }

  function handleCreateOffer() {
    const errors = {};
    if (!createOrganId) errors.organId = 'Select an organ';
    if (!createRecipientId) errors.recipientId = 'Select a recipient';
    setCreateErrors(errors);
    if (Object.keys(errors).length > 0) return;

    /* One-active-offer rule: never silently overwrite an existing active offer. */
    if (hasActiveOfferForOrgan(offers, createOrganId)) {
      notifyError(
        'Active offer exists',
        `${createOrganId} already has an active offer. Only one active offer is allowed per organ.`,
      );
      return;
    }

    const newOffer = createOfferFromSelection({
      offers,
      organs,
      organId: createOrganId,
      recipientId: createRecipientId,
    });
    saveMockOffer(newOffer);
    setOffers((prev) => [newOffer, ...prev]);
    notifications.show({
      title: 'Offer created',
      message: `${newOffer.id} created for ${createOrganId} → ${createRecipientId}`,
      color: 'green',
    });
    createHandlers.close();
    resetCreateForm();
  }

  async function handleAccept() {
    const offer = acceptTarget;
    if (!offer || busy) return;
    setBusy(true);
    try {
      replaceOffer(await acceptOffer(offer));
      if (!USE_LIVE_API) {
        setOrgans((prev) =>
          prev.map((organ) => (organ.id === offer.organId ? { ...organ, status: 'Allocated' } : organ)),
        );
      }
      notifications.show({
        title: 'Offer accepted',
        message: 'Accepted: organ allocated, transport created',
        color: 'green',
      });
      setAcceptTarget(null);
    } catch (error) {
      showApiError(error, 'Accept failed');
      setAcceptTarget(null);
      listOffers().then(setOffers).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function handleDecline() {
    const offer = declineTarget;
    if (!offer || busy) return;
    const errors = {};
    if (!declineReason) errors.reason = 'Select a decline reason';
    setDeclineErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    try {
      replaceOffer(await declineOffer(offer, { reason: declineReason, notes: declineNotes.trim() }));
      const label = declineOptions.find((o) => (o.value ?? o) === declineReason);
      notifications.show({
        title: 'Offer declined',
        message: `${offer.id} declined — ${label?.label ?? declineReason}`,
        color: 'orange',
      });
      setDeclineTarget(null);
      resetDeclineForm();
    } catch (error) {
      showApiError(error, 'Decline failed');
      setDeclineTarget(null);
      resetDeclineForm();
      listOffers().then(setOffers).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function handleRecordTransplant() {
    const offer = transplantTarget;
    if (!offer || busy) return;
    const errors = {};
    if (!transplantOutcome) errors.outcome = 'Select an outcome';
    if (!transplantAt || Number.isNaN(Date.parse(transplantAt))) errors.at = 'Enter the transplant date and time';
    else if (dayjs(transplantAt).isAfter(dayjs())) errors.at = 'Transplant time cannot be in the future';
    setTransplantErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    try {
      const transplant = await recordTransplant(offer, {
        outcome: transplantOutcome,
        transplantAt: new Date(transplantAt).toISOString(),
        notes: transplantNotes.trim(),
      });
      replaceOffer({ ...offer, transplant });
      notifications.show({
        title: 'Transplant recorded',
        message: `${offer.id}: ${outcomeLabel(transplantOutcome)}`,
        color: transplantOutcome === 'SUCCESS' ? 'green' : 'orange',
      });
      closeTransplantModal();
    } catch (error) {
      showApiError(error, 'Record transplant failed');
      closeTransplantModal();
      listOffers().then(setOffers).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  /* Declined -> "Advance to Next": pre-fill a fresh Created offer for the same
     organ and the next-ranked (highest priority) eligible recipient. */
  function pickNextCandidate(organ, declinedOffer) {
    if (!organ) return null;
    const offeredForOrgan = new Set(
      offers.filter((o) => o.organId === organ.id).map((o) => o.recipientId),
    );
    return (
      recipients
        .filter(
          (recipient) =>
            recipient.organNeeded === organ.organType &&
            recipient.status === 'Waiting' &&
            recipient.id !== declinedOffer.recipientId &&
            !offeredForOrgan.has(recipient.id),
        )
        .sort((a, b) => b.priorityScore - a.priorityScore)[0] ?? null
    );
  }

  /* Live: POST /advance walks the run's ranks; the result lists the ranks it skipped. Mock: the
     Create Offer modal is pre-filled with the next candidate. */
  async function handleAdvanceLive(offer) {
    if (busy) return;
    setBusy(true);
    setAdvanceResult(null);
    try {
      const { offer: created, skipped } = await advanceOffer(offer);
      setOffers(await listOffers());
      setAdvanceResult({ from: offer.id, offer: created, skipped });
      notifications.show({
        title: 'Advanced to next',
        message: `${created.id} created for ${created.recipientId}${created.rank ? ` (rank ${created.rank})` : ''}`,
        color: 'green',
      });
    } catch (error) {
      if (error.details?.skipped?.length) setAdvanceResult({ from: offer.id, offer: null, skipped: error.details.skipped });
      showApiError(error, 'Advance failed');
      listOffers().then(setOffers).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  function handleAdvanceToNext(offer) {
    if (USE_LIVE_API) return handleAdvanceLive(offer);
    if (hasActiveOfferForOrgan(offers, offer.organId)) {
      notifyError(
        'Active offer exists',
        `${offer.organId} already has an active offer. Resolve it before offering the next candidate.`,
      );
      return;
    }
    const organ = organs.find((o) => o.id === offer.organId);
    const nextCandidate = pickNextCandidate(organ, offer);
    setCreateErrors({});
    setCreateOrganId(offer.organId);
    setCreateRecipientId(nextCandidate ? nextCandidate.id : '');
    createHandlers.open();
    if (!nextCandidate) {
      notifications.show({
        title: 'No next candidate',
        message: `No remaining eligible candidate for ${offer.organId} — pick a recipient manually.`,
        color: 'yellow',
      });
    }
  }

  /* --- Row actions per status -------------------------------------------- */

  function getRowActions(offer) {
    const actions = [];
    const transitions = getAllowedTransitions(offer.status);

    if (transitions.includes('SENT')) {
      actions.push({
        label: 'Send Offer',
        variant: 'filled',
        color: 'var(--color-primary)',
        icon: <IconSend size={14} aria-hidden="true" />,
        onClick: () => handleSendOffer(offer),
      });
    }
    if (transitions.includes('ACCEPTED')) {
      actions.push({
        label: 'Record Accept',
        variant: 'filled',
        color: 'var(--color-success)',
        icon: <IconCheck size={14} aria-hidden="true" />,
        onClick: () => setAcceptTarget(offer),
      });
    }
    if (transitions.includes('DECLINED')) {
      actions.push({
        label: 'Record Decline',
        variant: 'light',
        color: 'var(--color-danger)',
        icon: <IconX size={14} aria-hidden="true" />,
        onClick: () => {
          resetDeclineForm();
          setDeclineTarget(offer);
        },
      });
    }
    if (transitions.includes('CANCELLED')) {
      actions.push({
        label: 'Cancel Offer',
        variant: 'subtle',
        color: 'var(--text-secondary)',
        icon: <IconBan size={14} aria-hidden="true" />,
        onClick: () => handleCancelOffer(offer),
      });
    }
    if (offer.status === 'ACCEPTED' && !offer.transplant) {
      const ready = canRecordTransplant(offer);
      actions.push({
        label: 'Record Transplant',
        variant: 'filled',
        color: 'var(--color-success)',
        icon: <IconHeartbeat size={14} aria-hidden="true" />,
        disabled: !ready,
        tooltip: ready ? null : TRANSPLANT_DISABLED_TIP,
        onClick: () => openTransplantModal(offer),
      });
    }
    if (ADVANCE_FROM.includes(offer.status) && (!USE_LIVE_API || offer.matchRunId)) {
      actions.push({
        label: 'Advance to Next',
        variant: 'subtle',
        color: 'var(--color-primary)',
        icon: <IconArrowRight size={14} aria-hidden="true" />,
        onClick: () => handleAdvanceToNext(offer),
      });
    }
    return actions;
  }

  /* --- Table columns ------------------------------------------------------ */

  const columns = [
    {
      accessorKey: 'id',
      header: 'Offer ID',
      size: 110,
      Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span>,
    },
    {
      accessorKey: 'organId',
      header: 'Organ ID',
      size: 100,
      Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span>,
    },
    { accessorKey: 'organType', header: 'Organ Type', size: 110 },
    {
      accessorKey: 'donorId',
      header: 'Donor ID',
      size: 110,
      Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span>,
    },
    {
      accessorKey: 'recipientId',
      header: 'Recipient ID',
      size: 110,
      Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span>,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      size: 120,
      Cell: ({ cell }) => <StatusBadge status={cell.getValue()} />,
    },
    {
      accessorKey: 'offeredAt',
      header: 'Offered At',
      size: 150,
      Cell: ({ cell }) => <span className="mono">{formatDateTime(cell.getValue())}</span>,
    },
    {
      accessorKey: 'sentAt',
      header: 'Sent At',
      size: 150,
      Cell: ({ cell }) => <span className="mono">{formatDateTime(cell.getValue())}</span>,
    },
    {
      accessorKey: 'offerExpiresAt',
      header: 'Response Deadline',
      size: 160,
      Cell: ({ cell }) => <span className="mono">{formatDateTime(cell.getValue())}</span>,
    },
    {
      accessorKey: 'response',
      header: 'Response',
      size: 160,
      Cell: ({ row }) => {
        const offer = row.original;
        const text =
          offer.status === 'DECLINED'
            ? offer.declineReason ?? offer.response
            : offer.response;
        const tooltipLabel = offer.declineNotes
          ? `${text}\nNotes: ${offer.declineNotes}`
          : text;
        return (
          <Tooltip label={tooltipLabel ?? '—'} disabled={!text} multiline>
            <span className="cell-truncate">{text ?? '—'}</span>
          </Tooltip>
        );
      },
    },
    {
      id: 'transplant',
      header: 'Transplant',
      size: 150,
      Cell: ({ row }) => {
        const t = row.original.transplant;
        if (!t) {
          return (
            <Text size="xs" c="var(--text-muted)">
              —
            </Text>
          );
        }
        return (
          <Tooltip label={t.notes ? `${formatDateTime(t.transplantAt)}\nNotes: ${t.notes}` : formatDateTime(t.transplantAt)} multiline>
            <span>
              <StatusBadge status={t.outcome} label={outcomeLabel(t.outcome)} />
            </span>
          </Tooltip>
        );
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      size: 250,
      enableSorting: false,
      Cell: ({ row }) => {
        const actions = getRowActions(row.original);
        if (actions.length === 0) {
          return (
            <Text size="xs" c="var(--text-muted)">
              —
            </Text>
          );
        }
        return (
          <Group gap={6} wrap="nowrap">
            {actions.map((action) => (
              <Tooltip key={action.label} label={action.tooltip} disabled={!action.tooltip}>
                {/* The wrapper keeps the tooltip working while the button is disabled. */}
                <span>
                  <Button
                    size="xs"
                    variant={action.variant}
                    color={action.color}
                    leftSection={action.icon}
                    onClick={action.onClick}
                    disabled={action.disabled}
                    aria-label={action.label}
                  >
                    {action.label}
                  </Button>
                </span>
              </Tooltip>
            ))}
          </Group>
        );
      },
    },
  ];

  /* --- Accept modal lookups ---------------------------------------------- */

  const acceptOrgan = acceptTarget
    ? organs.find((o) => o.id === acceptTarget.organId) ?? null
    : null;
  const acceptRecipient = acceptTarget
    ? recipients.find((r) => r.id === acceptTarget.recipientId) ?? null
    : null;
  const acceptDonor = acceptTarget
    ? mockDonors.find((d) => d.id === (acceptTarget.donorId ?? acceptOrgan?.donorId)) ?? null
    : null;

  /* --- Summary chips ------------------------------------------------------ */

  const summaryChips = [
    { key: 'active', label: 'Active Offers', value: summary.active, color: 'var(--color-primary)' },
    { key: 'accepted', label: 'Accepted', value: summary.accepted, color: 'var(--color-success)' },
    { key: 'declined', label: 'Declined', value: summary.declined, color: 'var(--color-danger)' },
    { key: 'expired', label: 'Expired', value: summary.expired, color: 'var(--text-muted)' },
    { key: 'total', label: 'Total', value: summary.total, color: 'var(--text-primary)' },
  ];

  return (
    <section aria-label="Offer Workflow" className="page-fade-in">
      {/* Header */}
      <Group justify="space-between" align="center" style={{ marginBottom: 24 }}>
        <div>
          <Title order={2}>Active Organ Offers</Title>
          <Text c="var(--text-secondary)" size="sm">
            Manage organ offers from creation through acceptance or decline
          </Text>
        </div>
        <Tooltip label={createButtonTooltip} disabled={USE_LIVE_API || !createButtonDisabled}>
          <Button
            leftSection={<IconPlus size={18} aria-hidden="true" />}
            onClick={() => {
              // An offer is made for a ranked candidate, so live mode starts from the console.
              if (USE_LIVE_API) return navigate('/matching');
              resetCreateForm();
              createHandlers.open();
            }}
            disabled={!USE_LIVE_API && createButtonDisabled}
            aria-label="Create Offer"
          >
            Create Offer
          </Button>
        </Tooltip>
      </Group>

      {/* Summary */}
      <div className="offer-summary" role="group" aria-label="Offer summary">
        {summaryChips.map((chip) => (
          <div key={chip.key} className="offer-summary-chip" aria-label={`${chip.label}: ${chip.value}`}>
            <span className="offer-summary-chip__value" style={{ color: chip.color }}>
              {chip.value}
            </span>
            <span className="offer-summary-chip__label">{chip.label}</span>
          </div>
        ))}
      </div>

      {advanceResult ? (
        <Alert
          color={advanceResult.offer ? 'blue' : 'red'}
          title={
            advanceResult.offer
              ? `Advanced from ${advanceResult.from}: ${advanceResult.offer.id} created for ${advanceResult.offer.recipientId}`
              : `No eligible candidate after ${advanceResult.from}`
          }
          withCloseButton
          onClose={() => setAdvanceResult(null)}
          style={{ marginBottom: 16 }}
          aria-label="Advance result"
        >
          {advanceResult.skipped.length === 0 ? (
            <Text size="sm">No ranks were skipped.</Text>
          ) : (
            <>
              <Text size="sm">Skipped ranks:</Text>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {advanceResult.skipped.map((s) => (
                  <li key={s.rank}>
                    <Text size="sm">
                      Rank {s.rank} — {s.recipientName} ({recipientId(s.recipientId)}): {s.reason}
                    </Text>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Alert>
      ) : null}

      {/* Table */}
      <DataTable
        columns={columns}
        data={offers}
        emptyMessage={offersLoading ? 'Loading offers...' : 'No offers found'}
        enableRowActions={false}
      />

      {/* Create Offer Modal */}
      <FormModal
        opened={createOpen}
        onClose={() => {
          createHandlers.close();
          resetCreateForm();
        }}
        title="Create Offer"
        submitLabel="Create Offer"
        onSubmit={handleCreateOffer}
        size="md"
      >
        <Stack gap={16}>
          <Select
            label="Organ"
            required
            placeholder={
              createOrganOptions.length === 0
                ? 'No organs available'
                : 'Select an available organ'
            }
            data={createOrganOptions}
            value={createOrganId}
            onChange={(value) => {
              setCreateOrganId(value ?? '');
              setCreateRecipientId('');
            }}
            error={createErrors.organId}
            renderOption={({ option }) => (
              <Tooltip
                label="Active offer exists for this organ"
                disabled={!option.disabled}
                position="left"
                withArrow
              >
                <Group gap={8} wrap="nowrap">
                  {option.disabled ? (
                    <IconAlertTriangle size={16} color="var(--color-warning)" aria-hidden="true" />
                  ) : (
                    <IconBuildingHospital size={16} color="var(--color-primary)" aria-hidden="true" />
                  )}
                  <span>{option.label}</span>
                </Group>
              </Tooltip>
            )}
          />
          {createOrganOptions.some((option) => option.disabled) ? (
            <Text size="xs" c="var(--color-warning)">
              Some organs are unavailable because an active offer already exists.
            </Text>
          ) : null}

          <Select
            label="Recipient"
            required
            placeholder={
              createRecipientOptions.length === 0
                ? 'No eligible recipients'
                : 'Select recipient from waitlist'
            }
            data={createRecipientOptions}
            value={createRecipientId}
            onChange={(value) => setCreateRecipientId(value ?? '')}
            error={createErrors.recipientId}
            disabled={!createOrganId || createRecipientOptions.length === 0}
          />

          {selectedCreateOrgan ? (
            <Paper p="md" className="offer-summary-paper">
              <div className="donor-info-grid">
                <div className="donor-info-item">
                  <span className="donor-info-label">Organ ID</span>
                  <span className="donor-info-value mono">{selectedCreateOrgan.id}</span>
                </div>
                <div className="donor-info-item">
                  <span className="donor-info-label">Blood Group</span>
                  <span className="donor-info-value mono">{selectedCreateOrgan.bloodGroup}</span>
                </div>
                <div className="donor-info-item">
                  <span className="donor-info-label">Donor</span>
                  <span className="donor-info-value mono">
                    {selectedCreateDonor
                      ? `${selectedCreateDonor.id} · ${selectedCreateDonor.name}`
                      : selectedCreateOrgan.donorId}
                  </span>
                </div>
                <div className="donor-info-item">
                  <span className="donor-info-label">Hospital</span>
                  <span className="donor-info-value">{selectedCreateOrgan.hospital}</span>
                </div>
              </div>
            </Paper>
          ) : null}
        </Stack>
      </FormModal>

      {/* Record Accept Modal */}
      <FormModal
        opened={!!acceptTarget}
        onClose={() => setAcceptTarget(null)}
        title="Record Accept"
        submitLabel="Record Accept"
        loading={busy}
        onSubmit={handleAccept}
        size="md"
      >
        <Stack gap={16}>
          <Paper p="md" className="offer-summary-paper">
            <div className="donor-info-grid">
              <div className="donor-info-item">
                <span className="donor-info-label">Organ ID</span>
                <span className="donor-info-value mono">{acceptTarget?.organId ?? '—'}</span>
              </div>
              <div className="donor-info-item">
                <span className="donor-info-label">Organ Type</span>
                <span className="donor-info-value">{acceptTarget?.organType ?? '—'}</span>
              </div>
              <div className="donor-info-item">
                <span className="donor-info-label">Blood Group</span>
                <span className="donor-info-value mono">{acceptOrgan?.bloodGroup ?? '—'}</span>
              </div>
              <div className="donor-info-item">
                <span className="donor-info-label">Donor</span>
                <span className="donor-info-value mono">
                  {acceptDonor ? `${acceptDonor.id} · ${acceptDonor.name}` : acceptTarget?.donorId ?? '—'}
                </span>
              </div>
              <div className="donor-info-item" style={{ gridColumn: 'span 2' }}>
                <span className="donor-info-label">Hospital</span>
                <span className="donor-info-value">{acceptOrgan?.hospital ?? '—'}</span>
              </div>
            </div>
          </Paper>

          <Paper p="md" className="offer-summary-paper">
            <div className="donor-info-grid">
              <div className="donor-info-item">
                <span className="donor-info-label">Recipient ID</span>
                <span className="donor-info-value mono">{acceptTarget?.recipientId ?? '—'}</span>
              </div>
              <div className="donor-info-item">
                <span className="donor-info-label">Name</span>
                <span className="donor-info-value">{acceptRecipient?.name ?? '—'}</span>
              </div>
              <div className="donor-info-item">
                <span className="donor-info-label">Blood Group</span>
                <span className="donor-info-value mono">{acceptRecipient?.bloodGroup ?? '—'}</span>
              </div>
              <div className="donor-info-item">
                <span className="donor-info-label">Urgency</span>
                <span className="donor-info-value">{acceptRecipient?.urgency ?? '—'}</span>
              </div>
              <div className="donor-info-item" style={{ gridColumn: 'span 2' }}>
                <span className="donor-info-label">Hospital</span>
                <span className="donor-info-value">{acceptRecipient?.hospital ?? '—'}</span>
              </div>
            </div>
          </Paper>

          <Text size="sm" c="var(--text-secondary)">
            Recording acceptance marks the organ as Allocated and creates a transport record.
            Surgery is recorded separately as a transplant.
          </Text>
        </Stack>
      </FormModal>

      {/* Record Transplant Modal */}
      <FormModal
        opened={!!transplantTarget}
        onClose={closeTransplantModal}
        title="Record Transplant"
        submitLabel="Record Transplant"
        loading={busy}
        onSubmit={handleRecordTransplant}
        size="md"
      >
        <Stack gap={16}>
          <Text size="sm" c="var(--text-secondary)">
            Record the surgery outcome for <span className="mono">{transplantTarget?.id ?? 'this offer'}</span> (
            <span className="mono">{transplantTarget?.organId ?? ''}</span> →{' '}
            <span className="mono">{transplantTarget?.recipientId ?? ''}</span>). This cannot be changed afterwards.
          </Text>
          <Select
            label="Outcome"
            required
            placeholder="Select an outcome"
            data={TRANSPLANT_OUTCOMES}
            value={transplantOutcome}
            onChange={(value) => setTransplantOutcome(value ?? '')}
            error={transplantErrors.outcome}
          />
          <TextInput
            label="Transplant time"
            type="datetime-local"
            required
            value={transplantAt}
            max={dayjs().format(DATETIME_LOCAL)}
            onChange={(event) => setTransplantAt(event.currentTarget.value)}
            error={transplantErrors.at}
          />
          <Textarea
            label="Notes"
            description="Optional"
            placeholder="Additional notes (optional)"
            value={transplantNotes}
            onChange={(event) => setTransplantNotes(event.currentTarget.value)}
            minRows={3}
          />
        </Stack>
      </FormModal>

      {/* Record Decline Modal */}
      <FormModal
        opened={!!declineTarget}
        onClose={() => {
          setDeclineTarget(null);
          resetDeclineForm();
        }}
        title="Record Decline"
        submitLabel="Record Decline"
        loading={busy}
        onSubmit={handleDecline}
        size="md"
      >
        <Stack gap={16}>
          <Text size="sm" c="var(--text-secondary)">
            Record why{' '}
            <span className="mono">{declineTarget?.id ?? 'this offer'}</span> for{' '}
            <span className="mono">{declineTarget?.organId ?? ''}</span> is being declined.
          </Text>
          <Select
            label="Decline Reason"
            required
            placeholder="Select a reason"
            data={declineOptions}
            value={declineReason}
            onChange={(value) => setDeclineReason(value ?? '')}
            error={declineErrors.reason}
          />
          <Textarea
            label="Notes"
            description="Optional"
            placeholder="Additional notes (optional)"
            value={declineNotes}
            onChange={(event) => setDeclineNotes(event.currentTarget.value)}
            minRows={3}
          />
        </Stack>
      </FormModal>
    </section>
  );
}
