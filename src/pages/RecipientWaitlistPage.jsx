import { useState, useMemo, useEffect } from 'react';
import {
  Button,
  Title,
  Drawer,
  Group,
  Stack,
  Select,
  MultiSelect,
  TextInput,
  NumberInput,
  Tooltip,
  Text,
  Loader,
  Alert,
  ActionIcon,
  SegmentedControl,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconHeartbeat, IconPlus, IconTrash } from '@tabler/icons-react';
import DataTable from '../components/DataTable.jsx';
import FormModal from '../components/FormModal.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { USE_LIVE_API } from '../api/client.js';
import { listRecipients, getRecipient, createRecipient, updateRecipient } from '../api/recipients.js';
import { listWaitlist, addWaitlistEntry, updateWaitlistEntry } from '../api/waitlist.js';
import { listHospitals } from '../api/hospitals.js';
import { getLookups } from '../api/lookups.js';
import { showApiError } from '../api/notify.js';
import { adaptMockRecipient, filterRecipients } from '../api/adapters/recipients.js';
import {
  EDITABLE_STATUSES,
  WAITLIST_STATUSES,
  entryPatchBody,
  filterWaitlistRows,
  formatScore,
  listingFormToBody,
  mockWaitlistRows,
  priorityBreakdown,
  recipientStub,
  validateListingForm,
} from '../api/adapters/waitlist.js';
import {
  LOCI,
  MAX_ALLELES_PER_LOCUS,
  RECIPIENT_STATUSES,
  emptyRecipientForm,
  addWaitlistRow,
  removeWaitlistRow,
  setWaitlistRow,
  recipientToForm,
  hlaOptionsFromLookups,
  hlaOptionsFromMock,
  validateRecipientForm,
  formToRecipientBody,
  formToMockRecipient,
  serverErrorToForm,
} from '../api/adapters/recipientForm.js';
import { mockRecipients } from '../data/mockRecipients.js';
import { mockHospitals } from '../data/mockHospitals.js';

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const ORGAN_TYPES = ['Kidney', 'Liver', 'Heart', 'Lung', 'Pancreas'];
const URGENCY_LEVELS = ['1A', '1B', '2'];
const LOCUS_LABELS = { A: 'HLA-A', B: 'HLA-B', DRB1: 'HLA-DRB1' };
const MOCK_HLA_OPTIONS = hlaOptionsFromMock(mockRecipients);
const STATUS_OPTIONS = RECIPIENT_STATUSES.map((s) => ({
  value: s,
  label: s[0] + s.slice(1).toLowerCase(),
}));

const ENTRY_STATUS_OPTIONS = WAITLIST_STATUSES.map((s) => ({
  value: s,
  label: s[0] + s.slice(1).toLowerCase(),
}));
const EDITABLE_STATUS_OPTIONS = EDITABLE_STATUSES.map((s) => ({
  value: s,
  label: s[0] + s.slice(1).toLowerCase(),
}));
const VIEW_OPTIONS = [
  { value: 'entries', label: 'Waitlist entries' },
  { value: 'recipients', label: 'Recipients' },
];

const NEU_INSET_INPUT_STYLES = {
  input: {
    border: 'none',
    background: 'var(--bg-base)',
    borderRadius: 'var(--radius-input)',
    boxShadow:
      'inset 4px 4px 8px var(--shadow-dark), inset -4px -4px 8px var(--shadow-light)',
  },
};

const sectionLabelStyle = {
  color: 'var(--text-secondary)',
  fontSize: 12,
  textTransform: 'uppercase',
  fontWeight: 600,
  marginTop: 16,
  marginBottom: 4,
};
const fieldRowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' };
const fieldLabelStyle = { color: 'var(--text-secondary)', fontSize: 13 };

function calcPriorityScore(urgency) {
  const base = urgency === '1A' ? 90 : urgency === '1B' ? 70 : 40;
  const range = urgency === '1A' ? 10 : 20;
  return parseFloat((base + Math.random() * range).toFixed(1));
}

function randomWaitTime() {
  return `${Math.floor(Math.random() * 30) + 1} months`;
}

// Priority score with its tooltip: exactly two components, urgency and waiting time (08 §7).
function PriorityScore({ entry }) {
  if (entry.priorityScore == null) return <span>—</span>;
  const items = priorityBreakdown(entry);
  return (
    <Tooltip
      label={
        <Stack gap={4} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }} aria-label="Priority score breakdown">
          {items.map((it) => (
            <Text size="xs" key={it.key}>
              {it.label} ({it.detail}): {formatScore(it.score)}
            </Text>
          ))}
          <Text size="xs" fw={700}>Priority score: {formatScore(entry.priorityScore)}</Text>
          {/* The total is the region-weighted mean of the two components (v_waitlist_scored). */}
          <Text size="xs" c="dimmed">Weighted by the region&apos;s urgency and wait policy weights</Text>
        </Stack>
      }
      multiline
      withArrow
      position="top"
    >
      <span className="mono" style={{ cursor: 'help' }}>{formatScore(entry.priorityScore)}</span>
    </Tooltip>
  );
}

// Live drawer: change one entry's urgency/status through PATCH /api/waitlist. TRANSPLANTED is read-only.
function WaitlistEntryEditor({ entry, recipientDbId, urgencyOptions, onSaved }) {
  const [draft, setDraft] = useState({ urgencyId: String(entry.urgencyId), status: entry.status });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    setDraft({ urgencyId: String(entry.urgencyId), status: entry.status });
  }, [entry.urgencyId, entry.status]);

  if (entry.status === 'TRANSPLANTED') {
    return <Text size="xs" c="dimmed">Transplanted: read-only</Text>;
  }
  const body = entryPatchBody(entry, draft);
  const dirty = Object.keys(body).length > 0;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateWaitlistEntry(recipientDbId, entry.organTypeId, body);
      notifications.show({ title: 'Waitlist entry updated', message: `${entry.organType} listing saved`, color: 'blue' });
      await onSaved();
    } catch (err) {
      setError(err?.message || 'Could not update the entry');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack gap={6} aria-label={`Edit waitlist entry ${entry.organType}`}>
      {error && <Alert color="red" variant="light" role="alert">{error}</Alert>}
      <Group gap={8} align="flex-end" wrap="nowrap">
        <Select
          label="Urgency"
          size="xs"
          data={urgencyOptions}
          value={draft.urgencyId}
          allowDeselect={false}
          onChange={(v) => v && setDraft((d) => ({ ...d, urgencyId: v }))}
        />
        <Select
          label="Status"
          size="xs"
          data={EDITABLE_STATUS_OPTIONS}
          value={draft.status}
          allowDeselect={false}
          onChange={(v) => v && setDraft((d) => ({ ...d, status: v }))}
        />
        <Button size="xs" onClick={save} loading={saving} disabled={!dirty}>Save</Button>
      </Group>
    </Stack>
  );
}

// Live drawer: POST /api/waitlist for another organ type. Server errors (409, future date) show inline.
function AddListingForm({ recipientDbId, organOptions, urgencyOptions, onAdded }) {
  const empty = { organTypeId: null, urgencyId: null, listedDate: null };
  const [f, setF] = useState(empty);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    const e = validateListingForm(f);
    setErrors(e);
    setError(null);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      await addWaitlistEntry(listingFormToBody(recipientDbId, f));
      notifications.show({ title: 'Organ listing added', message: 'Waitlist entry created', color: 'green' });
      setF(empty);
      await onAdded();
    } catch (err) {
      setError(err?.message || 'Could not add the listing');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack gap={8} aria-label="Add organ listing">
      <div style={sectionLabelStyle}>Add organ listing</div>
      {error && <Alert color="red" variant="light" role="alert">{error}</Alert>}
      <Select
        label="Organ type"
        size="xs"
        data={organOptions}
        value={f.organTypeId}
        onChange={(v) => setF((x) => ({ ...x, organTypeId: v }))}
        error={errors.organTypeId}
      />
      <Select
        label="Urgency"
        size="xs"
        data={urgencyOptions}
        value={f.urgencyId}
        onChange={(v) => setF((x) => ({ ...x, urgencyId: v }))}
        error={errors.urgencyId}
      />
      <DatePickerInput
        label="Listed date"
        size="xs"
        placeholder="Today"
        clearable
        value={f.listedDate}
        onChange={(v) => setF((x) => ({ ...x, listedDate: v }))}
      />
      <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={submit} loading={saving}>
        Add listing
      </Button>
    </Stack>
  );
}

export default function RecipientWaitlistPage() {
  const [recipients, setRecipients] = useState([]);
  const [entries, setEntries] = useState([]);
  const [view, setView] = useState('entries');
  const [loading, setLoading] = useState(true);
  const [formOpen, formHandlers] = useDisclosure(false);
  const [drawerOpen, drawerHandlers] = useDisclosure(false);
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editing, setEditing] = useState(null);

  // Filter state: live values are ids (organ) or names (blood group); mock values are names.
  const [filters, setFilters] = useState({ organ: null, bloodGroup: null, urgency: null, status: null });
  const setFilter = (key) => (v) => setFilters((f) => ({ ...f, [key]: v }));

  // Reference lists (live: from /api/lookups and /api/hospitals; mock: hardcoded).
  const [hospitalOptions, setHospitalOptions] = useState([]);
  const [organOptions, setOrganOptions] = useState(ORGAN_TYPES);
  const [bloodOptions, setBloodOptions] = useState(BLOOD_GROUPS);
  const [urgencyOptions, setUrgencyOptions] = useState(URGENCY_LEVELS);
  const [hlaOptions, setHlaOptions] = useState(MOCK_HLA_OPTIONS);

  // Form state
  const [form, setForm] = useState(emptyRecipientForm);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // Live: re-query the server whenever a filter changes. Mock: load the rows once and keep them as
  // the session list (added/edited rows live here), filtering in memory below.
  const liveEntriesView = USE_LIVE_API && view === 'entries';
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load = liveEntriesView
      ? listWaitlist(filters).then((rows) => !cancelled && setEntries(rows))
      : listRecipients(USE_LIVE_API ? filters : {}).then((rows) => !cancelled && setRecipients(rows));
    load
      .catch((err) => !cancelled && showApiError(err, 'Could not load the waitlist'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [USE_LIVE_API ? filters : null, USE_LIVE_API ? view : null]);

  const visibleRecipients = useMemo(
    () => (USE_LIVE_API ? recipients : filterRecipients(recipients, filters)),
    [recipients, filters],
  );
  // Waitlist view: live rows come from GET /api/waitlist; mock rows are flattened from session state.
  const visibleEntries = useMemo(
    () =>
      USE_LIVE_API
        ? entries
        : filterWaitlistRows(mockWaitlistRows(recipients), filters).sort(
            (a, b) => b.priorityScore - a.priorityScore,
          ),
    [entries, recipients, filters],
  );
  const entriesView = view === 'entries';

  function changeView(v) {
    setView(v);
    // Status means entry status in one view and recipient status in the other.
    setFilters((f) => ({ ...f, status: null }));
  }

  useEffect(() => {
    let cancelled = false;
    listHospitals()
      .then((rows) => {
        if (cancelled) return;
        setHospitalOptions(
          rows.map((h) => ({ value: USE_LIVE_API ? String(h.dbId) : h.name, label: h.name })),
        );
      })
      .catch((err) => !cancelled && showApiError(err, 'Could not load hospitals'));
    getLookups()
      .then((lk) => {
        if (cancelled || !lk) return;
        setOrganOptions(lk.organTypes.map((t) => ({ value: String(t.id), label: t.name })));
        setBloodOptions(lk.bloodGroups.map((g) => ({ value: String(g.id), label: g.name })));
        setUrgencyOptions(lk.urgencies.map((u) => ({ value: String(u.id), label: u.code })));
        setHlaOptions(hlaOptionsFromLookups(lk.hlaAlleles));
      })
      .catch((err) => !cancelled && showApiError(err, 'Could not load reference lists'));
    return () => {
      cancelled = true;
    };
  }, []);

  // The filter selects: blood group filters by name in both modes (the API takes the name).
  const bloodFilterOptions = USE_LIVE_API ? bloodOptions.map((o) => o.label) : BLOOD_GROUPS;
  const urgencyFilterOptions = USE_LIVE_API ? urgencyOptions.map((o) => o.label) : URGENCY_LEVELS;

  const refreshList = async () => {
    if (liveEntriesView) setEntries(await listWaitlist(filters));
    else setRecipients(await listRecipients(filters));
  };

  // Drawer actions changed an entry: reload the drawer's recipient and the table.
  async function reloadAfterEntryChange() {
    try {
      const full = await getRecipient(selected);
      setSelected(full);
      await refreshList();
    } catch (err) {
      showApiError(err, 'Could not refresh the waitlist');
    }
  }

  function openEntry(row) {
    openDrawer(USE_LIVE_API ? recipientStub(row) : row.recipient);
  }

  // Row click: show the row at once, then load the full detail (every waitlist entry) in live mode.
  function openDrawer(row) {
    setSelected(row);
    drawerHandlers.open();
    if (!USE_LIVE_API) return;
    setDetailLoading(true);
    getRecipient(row)
      .then((full) => setSelected((cur) => (cur?.dbId === full.dbId ? full : cur)))
      .catch((err) => showApiError(err, 'Could not load recipient'))
      .finally(() => setDetailLoading(false));
  }

  const columns = useMemo(
    () => [
      {
        accessorKey: 'id',
        header: 'Recipient ID',
        size: 120,
        Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span>,
      },
      { accessorKey: 'name', header: 'Full Name', size: 180 },
      {
        accessorKey: 'bloodGroup',
        header: 'Blood Group',
        size: 80,
        Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span>,
      },
      {
        accessorKey: 'organsLabel',
        header: USE_LIVE_API ? 'Waitlist Entries' : 'Organ Needed',
        size: 120,
      },
      {
        accessorKey: 'urgency',
        header: 'Urgency',
        size: 80,
        Cell: ({ cell }) =>
          cell.getValue() ? <StatusBadge status={cell.getValue()} /> : <span>—</span>,
      },
      {
        accessorKey: 'priorityScore',
        header: 'Priority Score',
        size: 100,
        // Mock recipients carry one entry; derive its components for the tooltip.
        Cell: ({ row }) => <PriorityScore entry={mockWaitlistRows([row.original])[0] ?? row.original} />,
      },
      {
        accessorKey: 'waitTime',
        header: 'Wait Time',
        size: 100,
        Cell: ({ cell }) => cell.getValue() ?? <span>—</span>,
      },
      {
        accessorKey: 'status',
        header: 'Status',
        size: 110,
        Cell: ({ cell }) => <StatusBadge status={cell.getValue()} />,
      },
      {
        accessorKey: 'hasOpenOffer',
        header: 'Open Offer',
        size: 100,
        Cell: ({ cell }) =>
          cell.getValue() ? <StatusBadge status="Offered" label="Open offer" /> : <span>—</span>,
      },
      { accessorKey: 'hospital', header: 'Hospital', size: 180, Cell: ({ cell }) => <span className="cell-truncate">{cell.getValue()}</span> },
    ],
    [],
  );

  const entryColumns = useMemo(
    () => [
      { accessorKey: 'id', header: 'Recipient ID', size: 110, Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span> },
      { accessorKey: 'name', header: 'Full Name', size: 170 },
      { accessorKey: 'bloodGroup', header: 'Blood Group', size: 80, Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span> },
      { accessorKey: 'organType', header: 'Organ Needed', size: 110 },
      { accessorKey: 'urgency', header: 'Urgency', size: 80, Cell: ({ cell }) => <StatusBadge status={cell.getValue()} /> },
      { accessorKey: 'priorityScore', header: 'Priority Score', size: 100, Cell: ({ row }) => <PriorityScore entry={row.original} /> },
      { accessorKey: 'waitTime', header: 'Wait Time', size: 100 },
      { accessorKey: 'status', header: 'Entry Status', size: 110, Cell: ({ cell }) => <StatusBadge status={cell.getValue()} /> },
      { accessorKey: 'hospital', header: 'Hospital', size: 180, Cell: ({ cell }) => <span className="cell-truncate">{cell.getValue()}</span> },
    ],
    [],
  );

  function resetForm() {
    setForm(emptyRecipientForm());
    setFormError(null);
    setErrors({});
  }

  function openAddModal() {
    resetForm();
    setEditing(null);
    formHandlers.open();
  }

  function openEditModal(recipient) {
    setForm(recipientToForm(recipient, { live: USE_LIVE_API }));
    setFormError(null);
    setErrors({});
    setEditing(recipient);
    drawerHandlers.close();
    formHandlers.open();
  }

  function closeFormModal() {
    formHandlers.close();
    resetForm();
    setEditing(null);
  }

  async function submitLive() {
    setSaving(true);
    try {
      const body = formToRecipientBody(form, editing ? 'edit' : 'create');
      const saved = editing ? await updateRecipient(editing, body) : await createRecipient(body);
      notifications.show({
        title: editing ? 'Recipient Updated' : 'Recipient Added',
        message: editing ? `${saved.id} updated successfully` : `${saved.id} added to waitlist`,
        color: editing ? 'blue' : 'green',
      });
      closeFormModal();
      if (editing) {
        setSelected(saved);
        drawerHandlers.open();
      }
      await refreshList().catch((err) => showApiError(err, 'Could not refresh recipients'));
    } catch (err) {
      const mapped = serverErrorToForm(err);
      setFormError(mapped.message);
      setErrors(mapped.fields);
    } finally {
      setSaving(false);
    }
  }

  function submitMock() {
    if (editing) {
      const common = formToMockRecipient({ ...form, waitlist: [] }, { id: editing.id });
      const updated = {
        ...editing,
        name: common.name,
        bloodGroup: common.bloodGroup,
        hospital: common.hospital,
        hlaA: common.hlaA,
        hlaB: common.hlaB,
        hlaDR: common.hlaDR,
        hlaByLocus: form.hla,
        height: common.height,
        weight: common.weight,
        status: form.status,
      };
      setRecipients((prev) => prev.map((r) => (r.id === editing.id ? updated : r)));
      notifications.show({ title: 'Recipient Updated', message: 'Recipient updated successfully', color: 'blue' });
    } else {
      const maxIdNum = recipients.reduce((max, r) => {
        const match = String(r.id).match(/RCP-(\d+)/);
        return Math.max(max, match ? parseInt(match[1], 10) : 0);
      }, 400);
      const newId = `RCP-${String(maxIdNum + 1)}-${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`;
      const first = form.waitlist[0];
      const mock = {
        ...formToMockRecipient(form, { id: newId }),
        priorityScore: calcPriorityScore(first.urgency),
        waitTime: randomWaitTime(),
      };
      const row = adaptMockRecipient(mock);
      row.waitlist = form.waitlist.map((w) => ({
        organTypeId: null,
        organType: w.organType,
        urgency: w.urgency,
        listedDate: w.listedDate ? new Date(w.listedDate).toISOString().split('T')[0] : null,
        status: 'ACTIVE',
        waitMonths: null,
        priorityScore: calcPriorityScore(w.urgency),
      }));
      row.waitlistCount = row.waitlist.length;
      setRecipients((prev) => [row, ...prev]);
      notifications.show({ title: 'Recipient Added', message: 'Recipient added to waitlist', color: 'green' });
    }
    closeFormModal();
  }

  function handleSubmit() {
    setFormError(null);
    const e = validateRecipientForm(form, editing ? 'edit' : 'create');
    setErrors(e);
    if (Object.keys(e).length) return;
    if (USE_LIVE_API) submitLive();
    else submitMock();
  }

  return (
    <section aria-label="Recipient Waitlist" className="page-fade-in">
      {/* Header row */}
      <Group
        justify="space-between"
        align="center"
        style={{ marginBottom: 24 }}
      >
        <Title order={2}>Recipient Waitlist</Title>
        <Button
          leftSection={<IconHeartbeat size={18} />}
          onClick={openAddModal}
        >
          Add Recipient
        </Button>
      </Group>

      <SegmentedControl
        data={VIEW_OPTIONS}
        value={view}
        onChange={changeView}
        aria-label="Waitlist view"
        style={{ marginBottom: 16 }}
      />

      {/* Filter bar */}
      <Group gap={12} style={{ marginBottom: 20 }} aria-label="Recipient filters">
        <Select
          placeholder="Organ Needed"
          data={organOptions}
          value={filters.organ}
          onChange={setFilter('organ')}
          clearable
          styles={NEU_INSET_INPUT_STYLES}
        />
        <Select
          placeholder="Blood Group"
          data={bloodFilterOptions}
          value={filters.bloodGroup}
          onChange={setFilter('bloodGroup')}
          clearable
          styles={NEU_INSET_INPUT_STYLES}
        />
        <Select
          placeholder="Urgency"
          data={urgencyFilterOptions}
          value={filters.urgency}
          onChange={setFilter('urgency')}
          clearable
          styles={NEU_INSET_INPUT_STYLES}
        />
        <Select
          placeholder="Status"
          data={entriesView ? ENTRY_STATUS_OPTIONS : STATUS_OPTIONS}
          value={filters.status}
          onChange={setFilter('status')}
          clearable
          styles={NEU_INSET_INPUT_STYLES}
        />
        {loading && <Loader size="sm" aria-label="Loading recipients" />}
      </Group>

      {/* Data Table */}
      {entriesView ? (
        <DataTable
          key="entries"
          columns={entryColumns}
          data={visibleEntries}
          emptyMessage="No waitlist entries found"
          mantineTableBodyRowProps={({ row }) => ({
            onClick: () => openEntry(row.original),
            style: { cursor: 'pointer' },
          })}
        />
      ) : (
        <DataTable
          key="recipients"
          columns={columns}
          data={visibleRecipients}
          emptyMessage="No recipients found"
          mantineTableBodyRowProps={({ row }) => ({
            onClick: () => openDrawer(row.original),
            style: { cursor: 'pointer' },
          })}
        />
      )}

      {/* Add / Edit Recipient Modal */}
      <FormModal
        opened={formOpen}
        onClose={closeFormModal}
        title={editing ? 'Edit Recipient' : 'Add Recipient'}
        submitLabel={editing ? 'Update' : 'Add'}
        onSubmit={handleSubmit}
        loading={saving}
        size="md"
      >
        <Stack gap={16}>
          {formError && (
            <Alert color="red" variant="light" role="alert" aria-label="Form error">
              {formError}
            </Alert>
          )}
          <TextInput
            label="Full Name"
            required
            value={form.name}
            onChange={(e) => setField('name', e.currentTarget.value)}
            error={errors.name}
          />
          <DatePickerInput
            label="Date of Birth"
            required
            value={form.dob}
            onChange={(v) => setField('dob', v)}
            error={errors.dob}
          />
          <Select
            label="Blood Group"
            data={bloodOptions}
            required
            value={form.bloodGroup}
            onChange={(v) => setField('bloodGroup', v)}
            error={errors.bloodGroup}
          />
          <Select
            label="Hospital"
            data={USE_LIVE_API ? hospitalOptions : mockHospitals.map((h) => h.name)}
            required
            searchable
            value={form.hospital}
            onChange={(v) => setField('hospital', v)}
            error={errors.hospital}
          />
          {editing && (
            <Select
              label="Status"
              data={STATUS_OPTIONS}
              required
              allowDeselect={false}
              value={form.status}
              onChange={(v) => v && setField('status', v)}
              error={errors.status}
            />
          )}
          {LOCI.map((locus) => (
            <MultiSelect
              key={locus}
              label={LOCUS_LABELS[locus]}
              placeholder={`Up to ${MAX_ALLELES_PER_LOCUS} alleles`}
              data={hlaOptions[locus] ?? []}
              maxValues={MAX_ALLELES_PER_LOCUS}
              searchable
              clearable
              value={form.hla[locus]}
              onChange={(v) => setForm((f) => ({ ...f, hla: { ...f.hla, [locus]: v } }))}
              error={errors[`hla${locus}`]}
            />
          ))}
          <NumberInput
            label="Height (cm)"
            required
            min={100}
            max={220}
            value={form.height}
            onChange={(v) => setField('height', v)}
            error={errors.height}
          />
          <NumberInput
            label="Weight (kg)"
            required
            min={20}
            max={200}
            value={form.weight}
            onChange={(v) => setField('weight', v)}
            error={errors.weight}
          />
          {!editing && (
            <Stack gap={8} aria-label="Waitlist entries">
              <Group justify="space-between">
                <Text size="sm" fw={600}>Waitlist Entries</Text>
                <Button
                  size="compact-sm"
                  variant="light"
                  leftSection={<IconPlus size={14} />}
                  onClick={() => setForm((f) => addWaitlistRow(f))}
                >
                  Add Entry
                </Button>
              </Group>
              {errors.waitlist && <Text size="xs" c="red">{errors.waitlist}</Text>}
              {form.waitlist.map((w, i) => (
                <Group key={i} gap={8} align="flex-end" wrap="nowrap" aria-label={`Waitlist entry ${i + 1}`}>
                  <Select
                    label="Organ Needed"
                    data={organOptions}
                    value={w.organType}
                    onChange={(v) => setForm((f) => setWaitlistRow(f, i, { organType: v }))}
                  />
                  <Select
                    label="Urgency Level"
                    data={urgencyOptions}
                    value={w.urgency}
                    onChange={(v) => setForm((f) => setWaitlistRow(f, i, { urgency: v }))}
                  />
                  <DatePickerInput
                    label="Listed Date"
                    placeholder="Today"
                    clearable
                    maxDate={new Date()}
                    value={w.listedDate}
                    onChange={(v) => setForm((f) => setWaitlistRow(f, i, { listedDate: v }))}
                  />
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label={`Remove waitlist entry ${i + 1}`}
                    onClick={() => setForm((f) => removeWaitlistRow(f, i))}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              ))}
            </Stack>
          )}
        </Stack>
      </FormModal>

      {/* Detail Drawer */}
      <Drawer
        opened={drawerOpen}
        onClose={drawerHandlers.close}
        title="Recipient Profile"
        position="right"
        size={460}
        padding="lg"
        classNames={{ content: 'neu-raised', header: 'form-modal__header' }}
      >
        {selected && (
          <Stack gap={16}>
            <Title order={3}>{selected.name}</Title>
            <span className="mono">{selected.id}</span>
            <Group gap={8}>
              {selected.status && <StatusBadge status={selected.status} />}
              {selected.hasOpenOffer && <StatusBadge status="Offered" label="Open offer" />}
            </Group>

            <div style={sectionLabelStyle}>Medical Data</div>
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>Blood Group</span>
              <span className="mono">{selected.bloodGroup}</span>
            </div>
            {Object.entries(LOCUS_LABELS).map(([locus, label]) => (
              <div key={locus} style={fieldRowStyle}>
                <span style={fieldLabelStyle}>{label}</span>
                <span className="mono">{selected.hlaByLocus?.[locus]?.join(', ') || '—'}</span>
              </div>
            ))}
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>Height</span>
              <span>{selected.height} cm</span>
            </div>
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>Weight</span>
              <span>{selected.weight} kg</span>
            </div>

            <div style={sectionLabelStyle}>Registration</div>
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>Hospital</span>
              <span>{selected.hospital}</span>
            </div>
            {selected.region && (
              <div style={fieldRowStyle}>
                <span style={fieldLabelStyle}>Region</span>
                <span>{selected.region}</span>
              </div>
            )}

            <div style={sectionLabelStyle}>Waitlist Entries</div>
            {detailLoading && <Loader size="sm" aria-label="Loading waitlist entries" />}
            {!detailLoading && selected.waitlist.length === 0 && (
              <Text size="sm" c="dimmed">No waitlist entries</Text>
            )}
            {selected.waitlist.map((w, i) => (
              <Stack key={w.organTypeId ?? `${w.organType}-${i}`} gap={4} aria-label={`Waitlist entry ${w.organType}`}>
                <Group justify="space-between">
                  <strong>{w.organType}</strong>
                  <Group gap={6}>
                    {w.urgency && <StatusBadge status={w.urgency} />}
                    <StatusBadge status={w.status} />
                  </Group>
                </Group>
                <div style={fieldRowStyle}>
                  <span style={fieldLabelStyle}>Listed</span>
                  <span className="mono">{w.listedDate ?? '—'}</span>
                </div>
                <div style={fieldRowStyle}>
                  <span style={fieldLabelStyle}>Priority score</span>
                  <PriorityScore entry={w} />
                </div>
                {USE_LIVE_API && selected.hasDetail && (
                  <WaitlistEntryEditor
                    entry={w}
                    recipientDbId={selected.dbId}
                    urgencyOptions={urgencyOptions}
                    onSaved={reloadAfterEntryChange}
                  />
                )}
              </Stack>
            ))}
            {USE_LIVE_API && selected.hasDetail && (
              <AddListingForm
                recipientDbId={selected.dbId}
                organOptions={organOptions}
                urgencyOptions={urgencyOptions}
                onAdded={reloadAfterEntryChange}
              />
            )}
            {!USE_LIVE_API && (
              <Text size="xs" c="dimmed">Changing urgency or adding listings needs live mode</Text>
            )}

            <Group gap={12} style={{ marginTop: 24 }}>
              <Button
                variant="filled"
                onClick={() => openEditModal(selected)}
                disabled={USE_LIVE_API && (detailLoading || !selected.hasDetail)}
              >
                Edit
              </Button>
            </Group>
          </Stack>
        )}
      </Drawer>
    </section>
  );
}
