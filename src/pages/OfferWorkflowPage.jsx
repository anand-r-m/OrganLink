import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  Textarea,
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
import { cancelOffer, listOffers, saveMockOffer, sendOffer } from '../api/offers.js';
import { showApiError } from '../api/notify.js';

import {
  DECLINE_REASONS,
  createOfferFromSelection,
  getAllowedTransitions,
  hasActiveOfferForOrgan,
  isActiveOfferStatus,
  transitionOffer,
} from '../utils/offerTransitions.js';

// Accept, decline and advance are wired to the API in OL-016; until then they run on mock data only.
const MOCK_ONLY_ACTIONS = !USE_LIVE_API;
const ACCEPT_RESPONSE = 'Accepted — transplant scheduled';

function formatDateTime(value) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—';
}

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
  const [recipients, setRecipients] = useState(mockRecipients);

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

  function handleAccept() {
    const offer = acceptTarget;
    if (!offer) return;
    try {
      const updated = transitionOffer(offer, 'ACCEPTED', { response: ACCEPT_RESPONSE });
      saveMockOffer(updated);
      setOffers((prev) => prev.map((o) => (o.id === offer.id ? updated : o)));
      setOrgans((prev) =>
        prev.map((organ) => (organ.id === offer.organId ? { ...organ, status: 'Allocated' } : organ)),
      );
      setRecipients((prev) =>
        prev.map((recipient) =>
          recipient.id === offer.recipientId ? { ...recipient, status: 'Transplanted' } : recipient,
        ),
      );
      notifications.show({
        title: 'Offer accepted',
        message: 'Transplant event recorded successfully',
        color: 'green',
      });
      setAcceptTarget(null);
    } catch (error) {
      notifyError('Action blocked', error.message);
    }
  }

  function handleDecline() {
    const offer = declineTarget;
    if (!offer) return;
    const errors = {};
    if (!declineReason) errors.reason = 'Select a decline reason';
    setDeclineErrors(errors);
    if (Object.keys(errors).length > 0) return;

    try {
      const updated = transitionOffer(offer, 'DECLINED', {
        response: declineReason,
        declineReason,
        declineNotes: declineNotes.trim() || undefined,
      });
      saveMockOffer(updated);
      setOffers((prev) => prev.map((o) => (o.id === offer.id ? updated : o)));
      notifications.show({
        title: 'Offer declined',
        message: `${offer.id} declined — ${declineReason}`,
        color: 'orange',
      });
      setDeclineTarget(null);
      resetDeclineForm();
    } catch (error) {
      notifyError('Action blocked', error.message);
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

  function handleAdvanceToNext(offer) {
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
    if (MOCK_ONLY_ACTIONS && transitions.includes('ACCEPTED')) {
      actions.push({
        label: 'Record Accept',
        variant: 'filled',
        color: 'var(--color-success)',
        icon: <IconCheck size={14} aria-hidden="true" />,
        onClick: () => setAcceptTarget(offer),
      });
    }
    if (MOCK_ONLY_ACTIONS && transitions.includes('DECLINED')) {
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
    if (MOCK_ONLY_ACTIONS && offer.status === 'DECLINED') {
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
              <Button
                key={action.label}
                size="xs"
                variant={action.variant}
                color={action.color}
                leftSection={action.icon}
                onClick={action.onClick}
                aria-label={action.label}
              >
                {action.label}
              </Button>
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
        submitLabel="Confirm Transplant"
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
            Confirming this transplant marks the organ as Allocated and the recipient as
            Transplanted, and records a transplant event.
          </Text>
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
            data={DECLINE_REASONS}
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
