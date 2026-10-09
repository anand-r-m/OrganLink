import { useState, useMemo, useEffect } from 'react';
import {
  Button,
  Title,
  Drawer,
  Group,
  Stack,
  Text,
  TextInput,
  Select,
  MultiSelect,
  NumberInput,
  Loader,
  Alert,
} from '@mantine/core';
import { DatePickerInput, DateTimePicker } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconUserPlus, IconHeartPlus } from '@tabler/icons-react';
import DataTable from '../components/DataTable.jsx';
import FormModal from '../components/FormModal.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import ViabilityCountdown from '../components/ViabilityCountdown.jsx';
import { USE_LIVE_API } from '../api/client.js';
import { listDonors, getDonor, procureOrgan, createDonor, updateDonor } from '../api/donors.js';
import { listHospitals } from '../api/hospitals.js';
import { getLookups } from '../api/lookups.js';
import { showApiError } from '../api/notify.js';
import { calcAge } from '../api/adapters/donors.js';
import {
  LOCI,
  MAX_ALLELES_PER_LOCUS,
  emptyDonorForm,
  setDonorType,
  donorToForm,
  hlaOptionsFromLookups,
  hlaOptionsFromMock,
  validateDonorForm,
  formToDonorBody,
  serverErrorToForm,
} from '../api/adapters/donorForm.js';
import { mockHospitals } from '../data/mockHospitals.js';
import { mockDonors } from '../data/mockDonors.js';

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const LOCUS_LABELS = { A: 'HLA-A', B: 'HLA-B', DRB1: 'HLA-DRB1' };
const MOCK_HLA_OPTIONS = hlaOptionsFromMock(mockDonors);
const TYPE_OPTIONS = [
  { value: 'LIVING', label: 'Living' },
  { value: 'DECEASED', label: 'Deceased' },
];
const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
];
// Donor type badge (07 §7): separate from the Active/Inactive status badge.
const TYPE_VARIANT = { DECEASED: 'primary', LIVING: 'info' };
function TypeBadge({ type }) {
  return <StatusBadge status={type} variant={TYPE_VARIANT[type] ?? 'muted'} />;
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function calcBmi(height, weight) {
  if (!height || !weight) return '—';
  const h = height / 100;
  if (h === 0) return '—';
  return (weight / (h * h)).toFixed(1);
}

const sectionLabelStyle = {
  color: 'var(--text-secondary)',
  fontSize: 12,
  textTransform: 'uppercase',
  fontWeight: 600,
  marginTop: 16,
  marginBottom: 4,
};

const fieldRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '4px 0',
};

const fieldLabelStyle = {
  color: 'var(--text-secondary)',
  fontSize: 13,
};

export default function DonorRegistryPage() {
  const [donors, setDonors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ type: null, status: null, hospital: null });
  const [hospitalOptions, setHospitalOptions] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [registerOpen, registerHandlers] = useDisclosure(false);
  const [selectedDonor, setSelectedDonor] = useState(null);
  const [drawerOpen, drawerHandlers] = useDisclosure(false);

  // Procure Organ modal state (live mode only)
  const [procureOpen, procureHandlers] = useDisclosure(false);
  const [organTypeOptions, setOrganTypeOptions] = useState([]);
  const [procType, setProcType] = useState(null);
  const [procHospital, setProcHospital] = useState(null);
  const [procRecoveredAt, setProcRecoveredAt] = useState(new Date());
  const [procErrors, setProcErrors] = useState({});
  const [procSaving, setProcSaving] = useState(false);

  // Form state
  const [editingDonor, setEditingDonor] = useState(null);
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState(emptyDonorForm);
  const [formRegion, setFormRegion] = useState('');
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [bloodOptions, setBloodOptions] = useState(BLOOD_GROUPS);
  const [hlaOptions, setHlaOptions] = useState(MOCK_HLA_OPTIONS);
  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // Re-query whenever a filter changes: live mode sends it to the server as a query parameter.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listDonors({
      type: filters.type,
      status: filters.status,
      hospital: filters.hospital,
    })
      .then((rows) => !cancelled && setDonors(rows))
      .catch((err) => !cancelled && showApiError(err, 'Could not load donors'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [filters]);

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
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getLookups()
      .then((lk) => {
        if (cancelled || !lk) return;
        setOrganTypeOptions(lk.organTypes.map((t) => ({ value: String(t.id), label: t.name })));
        setBloodOptions(lk.bloodGroups.map((g) => ({ value: String(g.id), label: g.name })));
        setHlaOptions(hlaOptionsFromLookups(lk.hlaAlleles));
      })
      .catch((err) => !cancelled && showApiError(err, 'Could not load reference lists'));
    return () => {
      cancelled = true;
    };
  }, []);

  // Row click: show the list row at once, then load the full detail (HLA + organs) in live mode.
  function openDrawer(row) {
    setSelectedDonor(row);
    drawerHandlers.open();
    if (!USE_LIVE_API) return;
    setDetailLoading(true);
    getDonor(row)
      .then((full) => setSelectedDonor((cur) => (cur?.dbId === full.dbId ? full : cur)))
      .catch((err) => showApiError(err, 'Could not load donor'))
      .finally(() => setDetailLoading(false));
  }

  function openProcureModal() {
    setProcType(null);
    setProcHospital(selectedDonor?.hospitalId != null ? String(selectedDonor.hospitalId) : null);
    setProcRecoveredAt(new Date());
    setProcErrors({});
    procureHandlers.open();
  }

  async function handleProcure() {
    const e = {};
    if (!procType) e.organType = 'Select an organ type';
    if (!procHospital) e.hospital = 'Select the recovering hospital';
    if (!(procRecoveredAt instanceof Date) || Number.isNaN(procRecoveredAt.getTime())) {
      e.recoveredAt = 'Recovery time is required';
    } else if (procRecoveredAt.getTime() > Date.now()) {
      e.recoveredAt = 'Recovery time cannot be in the future';
    }
    setProcErrors(e);
    if (Object.keys(e).length) return;
    setProcSaving(true);
    try {
      const organ = await procureOrgan(selectedDonor, {
        organTypeId: Number(procType),
        recoveringHospitalId: Number(procHospital),
        recoveredAt: procRecoveredAt.toISOString(),
      });
      notifications.show({
        title: 'Organ Procured',
        message: `${organ.id} ${organ.organType} is now available`,
        color: 'green',
      });
      procureHandlers.close();
      // Refresh the drawer's organ list from the server, and the registry's organ counts.
      const [full, rows] = await Promise.all([
        getDonor(selectedDonor),
        listDonors({ type: filters.type, status: filters.status, hospital: filters.hospital }),
      ]);
      setSelectedDonor((cur) => (cur?.dbId === full.dbId ? full : cur));
      setDonors(rows);
    } catch (err) {
      // Server rule messages (e.g. ck_organ_not_future) are shown inside the modal.
      if (err?.code === 'CONSTRAINT_VIOLATION') setProcErrors({ recoveredAt: err.message });
      else showApiError(err, 'Could not procure organ');
    } finally {
      setProcSaving(false);
    }
  }

  const columns = useMemo(
    () => [
      {
        accessorKey: 'id',
        header: 'Donor ID',
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
      { accessorKey: 'age', header: 'Age', size: 60 },
      { accessorKey: 'organsLabel', header: 'Organs', size: 100 },
      { accessorKey: 'hospital', header: 'Hospital', size: 200, Cell: ({ cell }) => <span className="cell-truncate">{cell.getValue()}</span> },
      { accessorKey: 'region', header: 'Region', size: 120 },
      {
        accessorKey: 'donorType',
        header: 'Type',
        size: 100,
        Cell: ({ cell }) => <TypeBadge type={cell.getValue()} />,
      },
      {
        accessorKey: 'status',
        header: 'Status',
        size: 100,
        Cell: ({ cell }) => <StatusBadge status={cell.getValue()} />,
      },
      {
        accessorKey: 'dateRegistered',
        header: 'Date Registered',
        size: 140,
        Cell: ({ cell }) => <span className="mono">{cell.getValue() ?? '—'}</span>,
      },
    ],
    [],
  );

  function resetForm() {
    setForm(emptyDonorForm());
    setFormRegion('');
    setFormError(null);
    setErrors({});
  }

  function openRegisterModal() {
    resetForm();
    setEditingDonor(null);
    registerHandlers.open();
  }

  function openEditModal(donor) {
    setForm(donorToForm(donor, { live: USE_LIVE_API }));
    setFormRegion(donor.region || '');
    setFormError(null);
    setErrors({});
    setEditingDonor(donor);
    drawerHandlers.close();
    registerHandlers.open();
  }

  function closeFormModal() {
    registerHandlers.close();
    resetForm();
    setEditingDonor(null);
  }

  function handleHospitalChange(value) {
    setField('hospital', value);
    const hospital = mockHospitals.find((h) => h.name === value);
    setFormRegion(hospital ? hospital.region : '');
  }

  async function refreshList() {
    setDonors(await listDonors({ type: filters.type, status: filters.status, hospital: filters.hospital }));
  }

  // Live mode: POST/PATCH, then refresh the table and the drawer. A server error (e.g. the death-field
  // CHECK) is shown in the form and the modal stays open.
  async function submitLive() {
    setSaving(true);
    try {
      const body = formToDonorBody(form);
      const saved = editingDonor ? await updateDonor(editingDonor, body) : await createDonor(body);
      notifications.show({
        title: editingDonor ? 'Donor Updated' : 'Donor Registered',
        message: editingDonor ? `${saved.id} updated successfully` : `${saved.id} added successfully`,
        color: editingDonor ? 'blue' : 'green',
      });
      closeFormModal();
      if (editingDonor) {
        // The edit form replaced the drawer; reopen it on the saved donor.
        setSelectedDonor(saved);
        drawerHandlers.open();
      }
      await refreshList().catch((err) => showApiError(err, 'Could not refresh donors'));
    } catch (err) {
      const mapped = serverErrorToForm(err);
      setFormError(mapped.message);
      setErrors(mapped.fields);
    } finally {
      setSaving(false);
    }
  }

  function submitMock() {
    const hlaByLocus = form.hla;
    const hlaJoined = { hlaA: hlaByLocus.A.join(', '), hlaB: hlaByLocus.B.join(', '), hlaDR: hlaByLocus.DRB1.join(', ') };
    const common = {
      name: form.name,
      bloodGroup: form.bloodGroup,
      age: calcAge(form.dob),
      hospital: form.hospital,
      region: formRegion,
      donorType: form.donorType,
      status: form.status,
      deathDate: form.donorType === 'DECEASED' && form.deathDate ? form.deathDate.toISOString() : null,
      deathCause: form.donorType === 'DECEASED' ? form.deathCause.trim() || null : null,
      hlaByLocus,
      ...hlaJoined,
      height: Number(form.height),
      weight: Number(form.weight),
    };
    if (editingDonor) {
      const updated = { ...editingDonor, ...common };
      setDonors((prev) => prev.map((d) => (d.id === editingDonor.id ? updated : d)));
      notifications.show({ title: 'Donor Updated', message: 'Donor updated successfully', color: 'blue' });
    } else {
      const maxIdNum = donors.reduce((max, d) => {
        const num = parseInt(d.id.replace('DNR-', ''), 10);
        return isNaN(num) ? max : Math.max(max, num);
      }, 1000);
      const newId = `DNR-${String(maxIdNum + 1).padStart(4, '0')}`;
      const newDonor = {
        ...common,
        id: newId,
        organType: '',
        organCount: 0,
        organsLabel: '0',
        hasDetail: true,
        organs: [],
        dateRegistered: todayISO(),
      };
      setDonors((prev) => [newDonor, ...prev]);
      notifications.show({ title: 'Donor Registered', message: `${newId} added successfully`, color: 'green' });
    }
    closeFormModal();
  }

  function handleSubmit() {
    setFormError(null);
    const e = validateDonorForm(form);
    setErrors(e);
    if (Object.keys(e).length) return;
    if (USE_LIVE_API) submitLive();
    else submitMock();
  }

  // Deactivate = PATCH { status: 'INACTIVE' } in live mode; the Type badge is untouched.
  async function handleDeactivate() {
    if (!selectedDonor) return;
    if (!USE_LIVE_API) {
      setDonors((prev) => prev.map((d) => (d.id === selectedDonor.id ? { ...d, status: 'INACTIVE' } : d)));
      setSelectedDonor({ ...selectedDonor, status: 'INACTIVE' });
      notifications.show({ title: 'Donor Deactivated', message: `${selectedDonor.id} has been deactivated`, color: 'orange' });
      return;
    }
    setSaving(true);
    try {
      const saved = await updateDonor(selectedDonor, { status: 'INACTIVE' });
      setSelectedDonor((cur) => (cur?.dbId === saved.dbId ? saved : cur));
      notifications.show({ title: 'Donor Deactivated', message: `${saved.id} has been deactivated`, color: 'orange' });
      await refreshList().catch((err) => showApiError(err, 'Could not refresh donors'));
    } catch (err) {
      showApiError(err, 'Could not deactivate donor');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="Donor Registry" className="page-fade-in">
      {/* Header row */}
      <Group
        justify="space-between"
        align="center"
        style={{ marginBottom: 24 }}
      >
        <Title order={2}>Donor Registry</Title>
        <Button leftSection={<IconUserPlus size={18} />} onClick={openRegisterModal}>
          Register Donor
        </Button>
      </Group>

      <Group gap={12} align="flex-end" style={{ marginBottom: 16 }} aria-label="Donor filters">
        <Select
          label="Type"
          placeholder="All types"
          data={TYPE_OPTIONS}
          clearable
          value={filters.type}
          onChange={(v) => setFilters((f) => ({ ...f, type: v }))}
          w={160}
        />
        <Select
          label="Status"
          placeholder="All statuses"
          data={STATUS_OPTIONS}
          clearable
          value={filters.status}
          onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
          w={160}
        />
        <Select
          label="Hospital"
          placeholder="All hospitals"
          data={hospitalOptions}
          clearable
          searchable
          value={filters.hospital}
          onChange={(v) => setFilters((f) => ({ ...f, hospital: v }))}
          w={240}
        />
        {loading && <Loader size="sm" aria-label="Loading donors" />}
      </Group>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={donors}
        emptyMessage="No donors registered"
        mantineTableBodyRowProps={({ row }) => ({
          onClick: () => openDrawer(row.original),
          style: { cursor: 'pointer' },
        })}
      />

      {/* Register / Edit Modal */}
      <FormModal
        opened={registerOpen}
        onClose={closeFormModal}
        title={editingDonor ? 'Edit Donor' : 'Register Donor'}
        submitLabel={editingDonor ? 'Update' : 'Register'}
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
            onChange={handleHospitalChange}
            error={errors.hospital}
          />
          {!USE_LIVE_API && <TextInput label="Region" readOnly value={formRegion} />}
          <Select
            label="Donor Type"
            data={TYPE_OPTIONS}
            required
            allowDeselect={false}
            value={form.donorType}
            onChange={(v) => v && setForm((f) => setDonorType(f, v))}
            error={errors.donorType}
          />
          <Select
            label="Status"
            data={STATUS_OPTIONS}
            required
            allowDeselect={false}
            value={form.status}
            onChange={(v) => v && setField('status', v)}
            error={errors.status}
          />
          {form.donorType === 'DECEASED' && (
            <>
              <DateTimePicker
                label="Death Date"
                required
                value={form.deathDate}
                onChange={(v) => setField('deathDate', v)}
                error={errors.deathDate}
              />
              <TextInput
                label="Cause of Death"
                value={form.deathCause}
                onChange={(e) => setField('deathCause', e.currentTarget.value)}
                error={errors.deathCause}
              />
            </>
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
        </Stack>
      </FormModal>

      {/* Procure Organ modal (06 Stage 2) */}
      <FormModal
        opened={procureOpen}
        onClose={procureHandlers.close}
        title="Procure Organ"
        submitLabel="Procure"
        onSubmit={handleProcure}
        loading={procSaving}
        size="md"
        // Opened from the Donor Profile drawer. Modal and Drawer share Mantine's default z-index (200)
        // and this modal is earlier in the tree, so the drawer's overlay covered it. 250 stays below
        // the 300 that Select/DateTimePicker dropdowns use.
        zIndex={250}
      >
        <Stack gap={16}>
          <Select
            label="Organ Type"
            required
            data={organTypeOptions}
            value={procType}
            onChange={setProcType}
            error={procErrors.organType}
          />
          <Select
            label="Recovering Hospital"
            required
            searchable
            data={hospitalOptions}
            value={procHospital}
            onChange={setProcHospital}
            error={procErrors.hospital}
          />
          <DateTimePicker
            label="Recovery Time"
            required
            value={procRecoveredAt}
            onChange={setProcRecoveredAt}
            maxDate={new Date()}
            error={procErrors.recoveredAt}
          />
        </Stack>
      </FormModal>

      {/* Detail Drawer */}
      <Drawer
        opened={drawerOpen}
        onClose={drawerHandlers.close}
        title="Donor Profile"
        position="right"
        size={360}
        padding="lg"
        classNames={{ content: 'neu-raised', header: 'form-modal__header' }}
      >
        {selectedDonor && (
          <Stack gap={16}>
            <Title order={3}>{selectedDonor.name}</Title>
            <span className="mono">{selectedDonor.id}</span>
            <Group gap={8}>
              <TypeBadge type={selectedDonor.donorType} />
              <StatusBadge status={selectedDonor.status} />
            </Group>

            <div style={sectionLabelStyle}>Medical Data</div>
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>Blood Group</span>
              <span className="mono">{selectedDonor.bloodGroup}</span>
            </div>
            {Object.entries(LOCUS_LABELS).map(([locus, label]) => (
              <div key={locus} style={fieldRowStyle}>
                <span style={fieldLabelStyle}>{label}</span>
                <span className="mono">
                  {selectedDonor.hlaByLocus?.[locus]?.join(', ') || (detailLoading ? '…' : '—')}
                </span>
              </div>
            ))}

            <div style={sectionLabelStyle}>Body Metrics</div>
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>Height</span>
              <span>{selectedDonor.height} cm</span>
            </div>
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>Weight</span>
              <span>{selectedDonor.weight} kg</span>
            </div>
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>BMI</span>
              <span className="mono">
                {calcBmi(selectedDonor.height, selectedDonor.weight)}
              </span>
            </div>

            <div style={sectionLabelStyle}>Registration</div>
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>Hospital</span>
              <span>{selectedDonor.hospital}</span>
            </div>
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>Region</span>
              <span>{selectedDonor.region}</span>
            </div>
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>Date</span>
              <span className="mono">{selectedDonor.dateRegistered ?? '—'}</span>
            </div>

            <Group justify="space-between" style={sectionLabelStyle}>
              <span>Organs</span>
              <Button
                size="compact-sm"
                variant="light"
                leftSection={<IconHeartPlus size={14} />}
                onClick={openProcureModal}
                disabled={!USE_LIVE_API}
                title={USE_LIVE_API ? undefined : 'Procure Organ needs live mode'}
              >
                Procure Organ
              </Button>
            </Group>
            {detailLoading && <Loader size="sm" aria-label="Loading organs" />}
            {!detailLoading && selectedDonor.organs.length === 0 && (
              <Text size="sm" c="dimmed">No organs procured</Text>
            )}
            {selectedDonor.organs.map((o) => (
              <Stack key={o.id} gap={4} aria-label={`Organ ${o.organType}`}>
                <Group justify="space-between">
                  <span>
                    <span className="mono">{o.dbId ? `${o.id} ` : ''}</span>
                    {o.organType}
                  </span>
                  {o.status && <StatusBadge status={o.status} />}
                </Group>
                {o.status === 'AVAILABLE' && (
                  <ViabilityCountdown viabilityHours={o.viabilityHours} elapsedHours={o.elapsedHours} />
                )}
              </Stack>
            ))}

            <Group gap={12} style={{ marginTop: 24 }}>
              <Button
                variant="filled"
                onClick={() => openEditModal(selectedDonor)}
                disabled={USE_LIVE_API && (detailLoading || !selectedDonor.hasDetail)}
              >
                Edit
              </Button>
              <Button
                variant="light"
                color="red"
                onClick={handleDeactivate}
                loading={saving}
                disabled={selectedDonor.status === 'INACTIVE'}
              >
                Deactivate
              </Button>
            </Group>
          </Stack>
        )}
      </Drawer>
    </section>
  );
}