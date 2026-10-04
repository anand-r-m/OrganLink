import { useState, useMemo, useEffect } from 'react';
import {
  Tabs,
  Title,
  Button,
  Group,
  Stack,
  Text,
  TextInput,
  Select,
  NumberInput,
  Slider,
  Table,
  ActionIcon,
  Tooltip,
  Modal,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconBuilding,
  IconMap,
  IconHeart,
  IconDna,
  IconScale,
  IconPlus,
  IconEdit,
  IconBan,
  IconCheck,
  IconClock,
  IconTrash,
} from '@tabler/icons-react';
import DataTable from '../components/DataTable.jsx';
import FormModal from '../components/FormModal.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { mockHospitals } from '../data/mockHospitals.js';
import { USE_LIVE_API } from '../api/client.js';
import { listHospitals } from '../api/hospitals.js';
import {
  listRegions, createRegion, updateRegion, listOrganTypes, createOrganType, updateOrganType,
  createHospital, updateHospital,
} from '../api/settings.js';
import {
  WEIGHT_KEYS, MOCK_DEFAULT_WEIGHTS, regionOptions, regionToSliderValues, sliderValuesToPatch,
  sliderValuesChanged, weightShares, regionToForm, regionFormToBody,
  emptyHospitalForm, hospitalToForm, hospitalFormToBody, formatRatioRange, emptyOrganTypeForm,
  organTypeToForm, organTypeFormToBody, settingsErrorToForm,
} from '../api/adapters/settings.js';
import { showApiError } from '../api/notify.js';
import { getBloodCompatibility, setBloodCompatibility, listHlaAlleles, createHlaAllele, deleteHlaAllele } from '../api/compatibility.js';
import {
  HLA_LOCI, pairsToGrid, compatibleLabel, setPairCompatible, emptyHlaForm, hlaFormToBody, hlaFormComplete, filterHla,
} from '../api/adapters/compatibility.js';


/* ==========================================================================
   Tab 1 — Hospitals
   ========================================================================== */

function HospitalsTab({ hospitals, setHospitals, loading = false, regions = [], onChanged }) {
  const [modalOpen, modalHandlers] = useDisclosure(false);
  const [editingHospital, setEditingHospital] = useState(null);
  const [errors, setErrors] = useState({});

  // Form state
  const [formName, setFormName] = useState('');
  const [formRegion, setFormRegion] = useState(null);
  const [formTrauma, setFormTrauma] = useState(null);
  const [formAddress, setFormAddress] = useState('');

  // Live mode: the form state is one object (adapters/settings.js) and the server owns validation.
  const [liveForm, setLiveForm] = useState(emptyHospitalForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const setLive = (patch) => setLiveForm((f) => ({ ...f, ...patch }));

  function validate() {
    const e = {};
    if (!formName || formName.trim().length < 2) e.name = 'Hospital name is required';
    if (!formRegion) e.region = 'Region is required';
    if (!formTrauma) e.trauma = 'Trauma level is required';
    if (!formAddress || formAddress.trim().length === 0) e.address = 'Address is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function resetForm() {
    setFormName('');
    setFormRegion(null);
    setFormTrauma(null);
    setFormAddress('');
    setErrors({});
    setLiveForm(emptyHospitalForm());
    setFormError(null);
  }

  function openAdd() {
    setEditingHospital(null);
    resetForm();
    modalHandlers.open();
  }

  function openEdit(hospital) {
    setEditingHospital(hospital);
    if (USE_LIVE_API) {
      setLiveForm(hospitalToForm(hospital, regions));
      setFormError(null);
      modalHandlers.open();
      return;
    }
    setFormName(hospital.name || '');
    setFormRegion(hospital.region || null);
    setFormTrauma(hospital.traumaLevel || null);
    setFormAddress(hospital.address || '');
    modalHandlers.open();
  }

  async function handleLiveSubmit() {
    setSaving(true);
    setFormError(null);
    const body = hospitalFormToBody(liveForm);
    try {
      if (editingHospital) await updateHospital(editingHospital.dbId, body);
      else await createHospital(body);
      notifications.show({
        title: editingHospital ? 'Hospital Updated' : 'Hospital Added',
        message: body.name,
        color: editingHospital ? 'blue' : 'green',
      });
      modalHandlers.close();
      resetForm();
      setEditingHospital(null);
      await onChanged?.();
    } catch (err) {
      const { field, message } = settingsErrorToForm(err);
      setFormError(message);
      if (field) setErrors({ [field]: message });
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit() {
    if (USE_LIVE_API) {
      setErrors({});
      handleLiveSubmit();
      return;
    }
    if (!validate()) return;

    if (editingHospital) {
      setHospitals((prev) =>
        prev.map((h) =>
          h.id === editingHospital.id
            ? {
                ...h,
                name: formName,
                region: formRegion,
                traumaLevel: formTrauma,
                address: formAddress,
              }
            : h,
        ),
      );
      notifications.show({
        title: 'Hospital Updated',
        message: formName,
        color: 'blue',
      });
    } else {
      const newId = `HSP-${String(hospitals.length + 1).padStart(3, '0')}`;
      const newHospital = {
        id: newId,
        name: formName,
        region: formRegion,
        traumaLevel: formTrauma,
        status: 'active',
        lat: 0,
        lng: 0,
        address: formAddress,
      };
      setHospitals((prev) => [newHospital, ...prev]);
      notifications.show({
        title: 'Hospital Added',
        message: `${newId} added successfully`,
        color: 'green',
      });
    }
    modalHandlers.close();
    resetForm();
    setEditingHospital(null);
  }

  async function toggleStatus(hospital) {
    if (USE_LIVE_API) {
      const suspend = hospital.status === 'active';
      try {
        await updateHospital(hospital.dbId, { status: suspend ? 'SUSPENDED' : 'ACTIVE' });
        notifications.show({
          title: suspend ? 'Hospital Suspended' : 'Hospital Activated',
          message: hospital.name,
          color: suspend ? 'red' : 'green',
        });
        await onChanged?.();
      } catch (err) {
        showApiError(err, 'Could not update hospital');
      }
      return;
    }
    setHospitals((prev) =>
      prev.map((h) =>
        h.id === hospital.id
          ? { ...h, status: h.status === 'active' ? 'suspended' : 'active' }
          : h,
      ),
    );
    notifications.show({
      title:
        hospital.status === 'active' ? 'Hospital Suspended' : 'Hospital Activated',
      message: hospital.name,
      color: hospital.status === 'active' ? 'red' : 'green',
    });
  }

  const columns = useMemo(
    () => [
      {
        accessorKey: 'id',
        header: 'Hospital ID',
        size: 100,
        Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span>,
      },
      { accessorKey: 'name', header: 'Name', size: 200, Cell: ({ cell }) => <span className="cell-truncate">{cell.getValue()}</span> },
      { accessorKey: 'region', header: 'Region', size: 120 },
      {
        accessorKey: 'traumaLevel',
        header: 'Trauma Level',
        size: 120,
        Cell: ({ cell }) => (cell.getValue() ? `Level ${cell.getValue()}` : '—'),
      },
      {
        accessorKey: 'status',
        header: 'Network Status',
        size: 130,
        Cell: ({ cell }) => <StatusBadge status={cell.getValue()} />,
      },
      { accessorKey: 'address', header: 'Address', size: 250, Cell: ({ cell }) => <span className="cell-truncate">{cell.getValue()}</span> },
      {
        id: 'actions',
        header: 'Actions',
        size: 120,
        Cell: ({ row }) => (
          <Group gap={4}>
            <Tooltip label="Edit">
              <ActionIcon
                variant="subtle"
                color="gray"
                onClick={(e) => {
                  e.stopPropagation();
                  openEdit(row.original);
                }}
              >
                <IconEdit size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip
              label={row.original.status === 'active' ? 'Suspend' : 'Activate'}
            >
              <ActionIcon
                variant="subtle"
                color={row.original.status === 'active' ? 'red' : 'green'}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleStatus(row.original);
                }}
              >
                {row.original.status === 'active' ? (
                  <IconBan size={16} />
                ) : (
                  <IconCheck size={16} />
                )}
              </ActionIcon>
            </Tooltip>
          </Group>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hospitals, regions],
  );

  return (
    <Stack gap={16}>
      <Group justify="flex-end" mb={12}>
        <Button leftSection={<IconPlus size={16} />} onClick={openAdd}>
          Add Hospital
        </Button>
      </Group>

      <DataTable
        columns={columns}
        data={hospitals}
        emptyMessage="No hospitals found"
        state={{ isLoading: loading }}
      />

      <FormModal
        opened={modalOpen}
        onClose={() => {
          modalHandlers.close();
          resetForm();
          setEditingHospital(null);
        }}
        title={editingHospital ? 'Edit Hospital' : 'Add Hospital'}
        submitLabel={editingHospital ? 'Update' : 'Add'}
        onSubmit={handleSubmit}
        loading={saving}
        size="md"
      >
        {USE_LIVE_API ? (
          <Stack gap={16}>
            <TextInput
              label="Hospital Name"
              required
              value={liveForm.name}
              onChange={(e) => setLive({ name: e.currentTarget.value })}
              error={errors.name}
            />
            <Select
              label="Region"
              data={regionOptions(regions)}
              required
              value={liveForm.regionId}
              onChange={(v) => setLive({ regionId: v })}
              error={errors.region}
            />
            <TextInput
              label="Address"
              value={liveForm.address}
              onChange={(e) => setLive({ address: e.currentTarget.value })}
            />
            <TextInput
              label="Phone"
              value={liveForm.phone}
              onChange={(e) => setLive({ phone: e.currentTarget.value })}
            />
            <Group grow>
              <NumberInput
                label="Latitude"
                required
                decimalScale={6}
                value={liveForm.latitude}
                onChange={(v) => setLive({ latitude: v })}
                error={errors.latitude}
              />
              <NumberInput
                label="Longitude"
                required
                decimalScale={6}
                value={liveForm.longitude}
                onChange={(v) => setLive({ longitude: v })}
                error={errors.longitude}
              />
            </Group>
            <Select
              label="Status"
              data={[
                { value: 'ACTIVE', label: 'Active' },
                { value: 'SUSPENDED', label: 'Suspended' },
              ]}
              allowDeselect={false}
              value={liveForm.status}
              onChange={(v) => setLive({ status: v })}
            />
            {formError && (
              <Text size="sm" c="red" role="alert">
                {formError}
              </Text>
            )}
          </Stack>
        ) : (
          <Stack gap={16}>
            <TextInput
              label="Hospital Name"
              required
              value={formName}
              onChange={(e) => setFormName(e.currentTarget.value)}
              error={errors.name}
            />
            <Select
              label="Region"
              data={regions.map((r) => r.name)}
              required
              value={formRegion}
              onChange={setFormRegion}
              error={errors.region}
            />
            <Select
              label="Trauma Level"
              data={['I', 'II', 'III']}
              required
              value={formTrauma}
              onChange={setFormTrauma}
              error={errors.trauma}
            />
            <TextInput
              label="Address"
              required
              value={formAddress}
              onChange={(e) => setFormAddress(e.currentTarget.value)}
              error={errors.address}
            />
          </Stack>
        )}
      </FormModal>
    </Stack>
  );
}

/* ==========================================================================
   Tab 2 — Regions
   ========================================================================== */

// Live: rows come from GET /api/regions (hospitalCount from the API); weights are edited in the
// Policy Weights tab. Mock: session state, counts derived from the mock hospitals by region name.
function RegionsTab({ regions, setRegions, hospitals, loading = false, onChanged }) {
  const [modalOpen, modalHandlers] = useDisclosure(false);
  const [editingRegion, setEditingRegion] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formPolicy, setFormPolicy] = useState('');

  function validate() {
    const e = {};
    if (!formName || formName.trim().length === 0) e.name = 'Region name is required';
    if (!formCode || !/^[A-Z]{2,4}$/.test(formCode)) e.code = 'Code must be 2–4 uppercase letters';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function resetForm() {
    setFormName('');
    setFormCode('');
    setFormPolicy('');
    setErrors({});
    setFormError(null);
    setEditingRegion(null);
  }

  function openAdd() {
    resetForm();
    modalHandlers.open();
  }

  function openEdit(region) {
    resetForm();
    const f = regionToForm(region);
    setEditingRegion(region);
    setFormName(f.name);
    setFormCode(f.code);
    modalHandlers.open();
  }

  async function handleLiveSubmit() {
    setSaving(true);
    setFormError(null);
    const body = regionFormToBody({ code: formCode, name: formName });
    try {
      if (editingRegion) await updateRegion(editingRegion.id, body);
      else await createRegion(body);
      notifications.show({
        title: editingRegion ? 'Region Updated' : 'Region Added',
        message: body.name,
        color: editingRegion ? 'blue' : 'green',
      });
      modalHandlers.close();
      resetForm();
      await onChanged?.();
    } catch (err) {
      const { field, message } = settingsErrorToForm(err);
      setFormError(message);
      if (field) setErrors({ [field]: message });
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit() {
    if (USE_LIVE_API) {
      setErrors({});
      handleLiveSubmit();
      return;
    }
    if (!validate()) return;

    const newRegion = {
      id: Math.max(0, ...regions.map((r) => r.id)) + 1,
      code: formCode || `RGN-${String(regions.length + 1).padStart(2, '0')}`,
      name: formName,
      allocationPolicy: formPolicy || 'Local first, then regional',
      hospitalCount: 0,
      weights: { ...MOCK_DEFAULT_WEIGHTS },
    };
    setRegions((prev) => [newRegion, ...prev]);
    notifications.show({
      title: 'Region Added',
      message: `${newRegion.name} added successfully`,
      color: 'green',
    });
    modalHandlers.close();
    resetForm();
  }

  const columns = useMemo(
    () => [
      {
        accessorKey: 'code',
        header: 'Region Code',
        size: 120,
        Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span>,
      },
      { accessorKey: 'name', header: 'Region Name', size: 200 },
      USE_LIVE_API
        ? {
            id: 'weights',
            header: 'Weights (HLA / Urgency / Distance / Wait)',
            size: 350,
            Cell: ({ row }) => (
              <span className="mono">{WEIGHT_KEYS.map((k) => row.original.weights[k]).join(' / ')}</span>
            ),
          }
        : {
            accessorKey: 'allocationPolicy',
            header: 'Allocation Policy',
            size: 350,
          },
      {
        id: 'hospitalCount',
        header: 'Hospital Count',
        size: 140,
        Cell: ({ row }) =>
          USE_LIVE_API
            ? row.original.hospitalCount
            : hospitals.filter((h) => h.region === row.original.name).length,
      },
      ...(USE_LIVE_API
        ? [
            {
              id: 'actions',
              header: 'Actions',
              size: 90,
              Cell: ({ row }) => (
                <Tooltip label="Edit">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(row.original);
                    }}
                  >
                    <IconEdit size={16} />
                  </ActionIcon>
                </Tooltip>
              ),
            },
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hospitals, regions],
  );

  return (
    <Stack gap={16}>
      <Group justify="flex-end" mb={12}>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={openAdd}
        >
          Add Region
        </Button>
      </Group>

      <DataTable
        columns={columns}
        data={regions}
        emptyMessage="No regions found"
        state={{ isLoading: loading }}
      />

      <FormModal
        opened={modalOpen}
        onClose={() => {
          modalHandlers.close();
          resetForm();
        }}
        title={editingRegion ? 'Edit Region' : 'Add Region'}
        submitLabel={editingRegion ? 'Update' : 'Add'}
        onSubmit={handleSubmit}
        loading={saving}
        size="md"
      >
        <Stack gap={16}>
          <TextInput
            label="Region Name"
            required
            value={formName}
            onChange={(e) => setFormName(e.currentTarget.value)}
            error={errors.name}
          />
          <TextInput
            label="Region Code"
            required
            placeholder="e.g. NTH"
            value={formCode}
            onChange={(e) => setFormCode(e.currentTarget.value.toUpperCase())}
            error={errors.code}
          />
          {!USE_LIVE_API && (
            <TextInput
              label="Allocation Policy"
              placeholder="e.g. Priority-based with distance weight"
              value={formPolicy}
              onChange={(e) => setFormPolicy(e.currentTarget.value)}
            />
          )}
          {formError && (
            <Text size="sm" c="red" role="alert">
              {formError}
            </Text>
          )}
        </Stack>
      </FormModal>
    </Stack>
  );
}

/* ==========================================================================
   Tab 3 — Organ Types
   ========================================================================== */

const ORGAN_TYPES_DEFAULT = [
  { code: 'KID', name: 'Kidney', maxViability: 36, priorityWeight: 1.0 },
  { code: 'LIV', name: 'Liver', maxViability: 12, priorityWeight: 1.2 },
  { code: 'HRT', name: 'Heart', maxViability: 6, priorityWeight: 1.5 },
  { code: 'LNG', name: 'Lung', maxViability: 8, priorityWeight: 1.3 },
  { code: 'PAN', name: 'Pancreas', maxViability: 18, priorityWeight: 0.9 },
];

function OrganTypesTab() {
  // Live mode loads GET /api/organ-types; mock mode keeps the local list.
  const [organTypes, setOrganTypes] = useState(USE_LIVE_API ? [] : ORGAN_TYPES_DEFAULT);
  const [loading, setLoading] = useState(USE_LIVE_API);
  const [modalOpen, modalHandlers] = useDisclosure(false);
  const [errors, setErrors] = useState({});

  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formViability, setFormViability] = useState(null);
  const [formWeight, setFormWeight] = useState(null);

  // Live form
  const [editingType, setEditingType] = useState(null);
  const [liveForm, setLiveForm] = useState(emptyOrganTypeForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const setLive = (patch) => setLiveForm((f) => ({ ...f, ...patch }));

  async function reload() {
    try {
      setOrganTypes(await listOrganTypes());
    } catch (err) {
      showApiError(err, 'Could not load organ types');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (USE_LIVE_API) reload();
  }, []);

  function validate() {
    const e = {};
    if (!formCode || !/^[A-Z]{2,3}$/.test(formCode)) e.code = 'Code must be 2–3 uppercase letters';
    if (!formName || formName.trim().length === 0) e.name = 'Name is required';
    if (!formViability || formViability <= 0) e.viability = 'Viability must be greater than 0';
    if (!formWeight || formWeight <= 0) e.weight = 'Weight must be greater than 0';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function resetForm() {
    setFormCode('');
    setFormName('');
    setFormViability(null);
    setFormWeight(null);
    setErrors({});
    setLiveForm(emptyOrganTypeForm());
    setFormError(null);
    setEditingType(null);
  }

  function openAdd() {
    resetForm();
    modalHandlers.open();
  }

  function openEdit(t) {
    resetForm();
    setEditingType(t);
    setLiveForm(organTypeToForm(t));
    modalHandlers.open();
  }

  async function handleLiveSubmit() {
    setSaving(true);
    setFormError(null);
    const body = organTypeFormToBody(liveForm);
    try {
      if (editingType) await updateOrganType(editingType.id, body);
      else await createOrganType(body);
      notifications.show({
        title: editingType ? 'Organ Type Updated' : 'Organ Type Added',
        message: body.name,
        color: editingType ? 'blue' : 'green',
      });
      modalHandlers.close();
      resetForm();
      await reload();
    } catch (err) {
      const { field, message } = settingsErrorToForm(err);
      setFormError(message);
      if (field) setErrors({ [field]: message });
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit() {
    if (USE_LIVE_API) {
      setErrors({});
      handleLiveSubmit();
      return;
    }
    if (!validate()) return;

    const newType = {
      code: formCode.toUpperCase().slice(0, 3),
      name: formName,
      maxViability: formViability,
      priorityWeight: formWeight,
    };
    setOrganTypes((prev) => [newType, ...prev]);
    notifications.show({
      title: 'Organ Type Added',
      message: `${newType.name} (${newType.code}) added successfully`,
      color: 'green',
    });
    modalHandlers.close();
    resetForm();
  }

  const columns = useMemo(
    () => [
      ...(USE_LIVE_API
        ? []
        : [
            {
              accessorKey: 'code',
              header: 'Code',
              size: 100,
              Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span>,
            },
          ]),
      { accessorKey: 'name', header: 'Name', size: 200 },
      {
        accessorKey: 'maxViability',
        header: 'Max Viability (hours)',
        size: 180,
        Cell: ({ cell }) => (
          <span className="mono">{cell.getValue()}h</span>
        ),
      },
      ...(USE_LIVE_API
        ? [
            {
              accessorKey: 'responseWindow',
              header: 'Response Window (hours)',
              size: 190,
              Cell: ({ cell }) => <span className="mono">{cell.getValue()}h</span>,
            },
            {
              id: 'ratio',
              header: 'Weight Ratio (min–max)',
              size: 180,
              Cell: ({ row }) => (
                <span className="mono">{formatRatioRange(row.original.minRatio, row.original.maxRatio)}</span>
              ),
            },
          ]
        : []),
      {
        accessorKey: 'priorityWeight',
        header: 'Default Priority Weight',
        size: 200,
        Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span>,
      },
      ...(USE_LIVE_API
        ? [
            {
              id: 'actions',
              header: 'Actions',
              size: 90,
              Cell: ({ row }) => (
                <Tooltip label="Edit">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(row.original);
                    }}
                  >
                    <IconEdit size={16} />
                  </ActionIcon>
                </Tooltip>
              ),
            },
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [organTypes],
  );

  return (
    <Stack gap={16}>
      <Group justify="flex-end" mb={12}>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={openAdd}
        >
          Add Organ Type
        </Button>
      </Group>

      <DataTable
        columns={columns}
        data={organTypes}
        emptyMessage="No organ types found"
        state={{ isLoading: loading }}
      />

      <FormModal
        opened={modalOpen}
        onClose={() => {
          modalHandlers.close();
          resetForm();
        }}
        title={editingType ? 'Edit Organ Type' : 'Add Organ Type'}
        submitLabel={editingType ? 'Update' : 'Add'}
        onSubmit={handleSubmit}
        loading={saving}
        size="md"
      >
        {USE_LIVE_API ? (
          <Stack gap={16}>
            <TextInput
              label="Name"
              required
              value={liveForm.name}
              onChange={(e) => setLive({ name: e.currentTarget.value })}
              error={errors.name}
            />
            <NumberInput
              label="Max Viability (hours)"
              required
              value={liveForm.maxViability}
              onChange={(v) => setLive({ maxViability: v })}
            />
            <NumberInput
              label="Response Window (hours)"
              required
              value={liveForm.responseWindow}
              onChange={(v) => setLive({ responseWindow: v })}
            />
            <Group grow>
              <NumberInput
                label="Min Weight Ratio"
                required
                step={0.1}
                decimalScale={2}
                value={liveForm.minRatio}
                onChange={(v) => setLive({ minRatio: v })}
              />
              <NumberInput
                label="Max Weight Ratio"
                required
                step={0.1}
                decimalScale={2}
                value={liveForm.maxRatio}
                onChange={(v) => setLive({ maxRatio: v })}
              />
            </Group>
            <NumberInput
              label="Default Priority Weight"
              step={0.1}
              decimalScale={2}
              placeholder="1.00 if left empty"
              value={liveForm.priorityWeight}
              onChange={(v) => setLive({ priorityWeight: v })}
            />
            {formError && (
              <Text size="sm" c="red" role="alert">
                {formError}
              </Text>
            )}
          </Stack>
        ) : (
          <Stack gap={16}>
            <TextInput
              label="Code"
              required
              placeholder="e.g. KID"
              value={formCode}
              onChange={(e) =>
                setFormCode(e.currentTarget.value.toUpperCase().slice(0, 3))
              }
              error={errors.code}
            />
            <TextInput
              label="Name"
              required
              value={formName}
              onChange={(e) => setFormName(e.currentTarget.value)}
              error={errors.name}
            />
            <NumberInput
              label="Max Viability (hours)"
              required
              min={1}
              max={72}
              value={formViability}
              onChange={setFormViability}
              error={errors.viability}
            />
            <NumberInput
              label="Default Priority Weight"
              required
              min={0.1}
              max={5.0}
              step={0.1}
              decimalScale={1}
              value={formWeight}
              onChange={setFormWeight}
              error={errors.weight}
            />
          </Stack>
        )}
      </FormModal>
    </Stack>
  );
}

/* ==========================================================================
   Tab 4 — Compatibility Matrix
   ========================================================================== */

function CompatibilityTab() {
  // Both modes share this state. Live: loaded from the API and written through it. Mock: mock data, local edits.
  const [bloodGroups, setBloodGroups] = useState([]);
  const [pairs, setPairs] = useState([]);
  const [hlaAlleles, setHlaAlleles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [toggling, setToggling] = useState(false);

  const [confirmToggle, setConfirmToggle] = useState(null);
  const [confirmOpen, confirmHandlers] = useDisclosure(false);

  const [hlaModalOpen, hlaModalHandlers] = useDisclosure(false);
  const [hlaForm, setHlaForm] = useState(emptyHlaForm());
  const [hlaError, setHlaError] = useState(null);
  const [hlaSaving, setHlaSaving] = useState(false);
  const [locusFilter, setLocusFilter] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteOpen, deleteHandlers] = useDisclosure(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [bc, hla] = await Promise.all([getBloodCompatibility(), listHlaAlleles()]);
        if (cancelled) return;
        setBloodGroups(bc.bloodGroups);
        setPairs(bc.pairs);
        setHlaAlleles(hla);
      } catch (err) {
        if (!cancelled) setLoadError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const grid = useMemo(() => pairsToGrid(bloodGroups, pairs), [bloodGroups, pairs]);

  async function handleConfirmToggle() {
    if (!confirmToggle) return;
    const { donor, recipient, current } = confirmToggle;
    const next = !current;
    confirmHandlers.close();
    setPairs((prev) => setPairCompatible(prev, donor.id, recipient.id, next)); // optimistic
    setToggling(true);
    try {
      if (USE_LIVE_API) {
        await setBloodCompatibility({
          donorBloodGroupId: donor.id,
          recipientBloodGroupId: recipient.id,
          compatible: next,
        });
      }
      notifications.show({
        title: 'Compatibility Updated',
        message: `${donor.name} → ${recipient.name}: ${next ? 'Compatible' : 'Incompatible'}`,
        color: next ? 'green' : 'red',
      });
    } catch (err) {
      setPairs((prev) => setPairCompatible(prev, donor.id, recipient.id, current)); // revert
      showApiError(err, 'Could not update compatibility');
    } finally {
      setToggling(false);
    }
  }

  function openHlaAdd() {
    setHlaForm(emptyHlaForm());
    setHlaError(null);
    hlaModalHandlers.open();
  }

  async function handleHlaSubmit() {
    if (!hlaFormComplete(hlaForm)) {
      setHlaError('Locus and allele name are required');
      return;
    }
    const body = hlaFormToBody(hlaForm);
    setHlaSaving(true);
    setHlaError(null);
    try {
      const created = USE_LIVE_API
        ? await createHlaAllele(body)
        : { id: Math.max(0, ...hlaAlleles.map((a) => a.id)) + 1, ...body };
      setHlaAlleles((prev) => [created, ...prev]);
      notifications.show({ title: 'Allele Added', message: `${created.alleleName} added successfully`, color: 'green' });
      hlaModalHandlers.close();
    } catch (err) {
      setHlaError(err?.message || 'Could not add allele'); // e.g. 409 DUPLICATE
    } finally {
      setHlaSaving(false);
    }
  }

  async function handleHlaDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (USE_LIVE_API) await deleteHlaAllele(deleteTarget.id);
      setHlaAlleles((prev) => prev.filter((a) => a.id !== deleteTarget.id));
      notifications.show({ title: 'Allele Deleted', message: `${deleteTarget.alleleName} deleted`, color: 'green' });
      deleteHandlers.close();
    } catch (err) {
      showApiError(err, 'Could not delete allele'); // e.g. 409 REFERENCE_IN_USE
      deleteHandlers.close();
    } finally {
      setDeleting(false);
    }
  }

  const hlaColumns = useMemo(
    () => [
      {
        accessorKey: 'alleleName',
        header: 'Allele Name',
        size: 200,
        Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span>,
      },
      { accessorKey: 'locus', header: 'Locus', size: 100 },
      {
        id: 'actions',
        header: '',
        size: 60,
        enableSorting: false,
        Cell: ({ row }) => (
          <Tooltip label="Delete allele">
            <ActionIcon
              variant="subtle"
              color="red"
              aria-label={`Delete ${row.original.alleleName}`}
              onClick={() => {
                setDeleteTarget(row.original);
                deleteHandlers.open();
              }}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const visibleAlleles = useMemo(() => filterHla(hlaAlleles, locusFilter), [hlaAlleles, locusFilter]);

  return (
    <Stack gap={24}>
      {/* Section 1: Blood Group Compatibility Grid */}
      <div className="neu-raised" style={{ padding: 24, borderRadius: 20 }}>
        <Group justify="space-between" mb={16}>
          <Title order={3}>Blood Group Compatibility</Title>
          <Text size="sm" fw={600} data-testid="compat-count">
            {compatibleLabel(pairs)}
          </Text>
        </Group>
        <Text size="sm" c="dimmed" mb={16}>
          Rows = Donor, Columns = Recipient. Click a cell to toggle.
        </Text>
        {loadError && (
          <Text size="sm" c="red" mb={12}>
            {loadError.message}
          </Text>
        )}
        <div style={{ overflowX: 'auto' }}>
          <Table withColumnBorders withRowBorders={false}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 80 }}>D \ R</Table.Th>
                {bloodGroups.map((bg) => (
                  <Table.Th
                    key={bg.id}
                    style={{
                      textAlign: 'center',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 13,
                    }}
                  >
                    {bg.name}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {grid.map(({ donor, cells }) => (
                <Table.Tr key={donor.id}>
                  <Table.Td
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {donor.name}
                  </Table.Td>
                  {cells.map(({ recipient, compatible }) => (
                    <Table.Td
                      key={recipient.id}
                      className="compat-cell"
                      onClick={() => {
                        if (toggling) return;
                        setConfirmToggle({ donor, recipient, current: compatible });
                        confirmHandlers.open();
                      }}
                      style={{
                        textAlign: 'center',
                        cursor: 'pointer',
                        background: compatible ? 'rgba(106,176,123,0.2)' : 'rgba(199,92,92,0.15)',
                        color: compatible ? '#6AB07B' : '#C75C5C',
                        fontWeight: 700,
                        fontSize: 16,
                        transition: 'background 150ms ease',
                        borderRadius: 4,
                      }}
                    >
                      {compatible ? '✓' : '✕'}
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>
        {loading && (
          <Text size="sm" c="dimmed" mt={8}>
            Loading...
          </Text>
        )}
      </div>

      {/* Section 2: HLA Allele Reference */}
      <div>
        <Group justify="space-between" mb={12}>
          <Select
            placeholder="All loci"
            clearable
            data={HLA_LOCI}
            value={locusFilter}
            onChange={setLocusFilter}
            w={160}
          />
          <Button leftSection={<IconPlus size={16} />} onClick={openHlaAdd}>
            Add Allele
          </Button>
        </Group>
        <DataTable columns={hlaColumns} data={visibleAlleles} state={{ isLoading: loading }} emptyMessage="No alleles found" />
      </div>

      {/* Confirmation Modal for compatibility toggle */}
      <Modal
        opened={confirmOpen}
        onClose={confirmHandlers.close}
        title="Confirm Compatibility Change"
        centered
        size="sm"
      >
        {confirmToggle && (
          <Stack gap={16}>
            <Text>
              {confirmToggle.current ? 'Remove' : 'Add'} compatibility between donor{' '}
              <span className="mono">{confirmToggle.donor.name}</span> and recipient{' '}
              <span className="mono">{confirmToggle.recipient.name}</span>?
            </Text>
            <Group justify="flex-end" gap={12}>
              <Button variant="subtle" color="gray" onClick={confirmHandlers.close}>
                Cancel
              </Button>
              <Button color={confirmToggle.current ? 'red' : 'green'} onClick={handleConfirmToggle}>
                Confirm
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      {/* HLA delete confirmation */}
      <Modal opened={deleteOpen} onClose={deleteHandlers.close} title="Delete Allele" centered size="sm">
        {deleteTarget && (
          <Stack gap={16}>
            <Text>
              Delete allele <span className="mono">{deleteTarget.alleleName}</span> ({deleteTarget.locus})?
            </Text>
            <Group justify="flex-end" gap={12}>
              <Button variant="subtle" color="gray" onClick={deleteHandlers.close}>
                Cancel
              </Button>
              <Button color="red" loading={deleting} onClick={handleHlaDelete}>
                Delete
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      {/* HLA Add Modal */}
      <FormModal
        opened={hlaModalOpen}
        onClose={hlaModalHandlers.close}
        title="Add Allele"
        submitLabel="Add"
        onSubmit={handleHlaSubmit}
        loading={hlaSaving}
        size="md"
      >
        <Stack gap={16}>
          <TextInput
            label="Allele Name"
            required
            placeholder="e.g. A*02:01"
            value={hlaForm.alleleName}
            onChange={(e) => setHlaForm((f) => ({ ...f, alleleName: e.currentTarget.value }))}
          />
          <Select
            label="Locus"
            data={HLA_LOCI}
            required
            value={hlaForm.locus}
            onChange={(v) => setHlaForm((f) => ({ ...f, locus: v }))}
          />
          {hlaError && (
            <Text size="sm" c="red">
              {hlaError}
            </Text>
          )}
        </Stack>
      </FormModal>
    </Stack>
  );
}

/* ==========================================================================
   Tab 5 — Policy Weights
   ========================================================================== */

const WEIGHT_COLORS = {
  urgency: '#C75C5C',
  wait: '#D4A056',
  distance: '#5B8A9A',
  hla: '#6AB07B',
};

const WEIGHT_LABELS = [
  { key: 'urgency', label: 'Urgency Weight', icon: IconHeart },
  { key: 'wait', label: 'Wait Time Weight', icon: IconClock },
  { key: 'distance', label: 'Distance Weight', icon: IconMap },
  { key: 'hla', label: 'HLA Match Weight', icon: IconDna },
];

// Sliders are bound to the selected region's weights (07 §7). Live: Save sends PATCH /api/regions/:id;
// mock: Save updates the session's region rows.
function PolicyWeightsTab({ regions, setRegions, onChanged }) {
  const [regionId, setRegionId] = useState(null);
  const [weights, setWeights] = useState(MOCK_DEFAULT_WEIGHTS);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Default to the first region once the list is available (and when the selected one disappears).
  useEffect(() => {
    if (regions.length && !regions.some((r) => String(r.id) === regionId)) {
      setRegionId(String(regions[0].id));
    }
  }, [regions, regionId]);

  const selected = regionToSliderValues(regions, regionId);
  // Re-bind the sliders whenever the region (or its stored values) changes.
  const selectedKey = selected ? WEIGHT_KEYS.map((k) => selected[k]).join('|') : '';
  useEffect(() => {
    if (selected) setWeights(selected);
    setSaveError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionId, selectedKey]);

  const shares = weightShares(weights);
  const dirty = selected ? sliderValuesChanged(weights, selected) : false;

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    setSaveError(null);
    const patch = sliderValuesToPatch(weights);
    try {
      if (USE_LIVE_API) {
        await updateRegion(regionId, patch);
        await onChanged?.();
      } else {
        setRegions((prev) =>
          prev.map((r) => (String(r.id) === regionId ? { ...r, weights: patch.weights } : r)),
        );
      }
      notifications.show({
        title: 'Configuration Saved',
        message: 'Policy weights updated successfully',
        color: 'green',
      });
    } catch (err) {
      setSaveError(err?.message || 'Could not save policy weights');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="neu-raised" style={{ padding: 32, borderRadius: 20 }}>
      <Stack gap={32}>
        <Title order={3}>Allocation Policy Weights</Title>
        <Text size="sm" c="dimmed">
          Adjust the relative importance of each factor in the matching
          algorithm for the selected region. Weights are normalized to 100%.
        </Text>

        <Select
          label="Region"
          data={regionOptions(regions)}
          value={regionId}
          onChange={(v) => v && setRegionId(v)}
          allowDeselect={false}
          maw={320}
        />

        {/* Sliders */}
        {WEIGHT_LABELS.map(({ key, label }) => (
          <Stack key={key} gap={8}>
            <Group justify="space-between">
              <Text fw={600}>{label}</Text>
              <Text className="mono">{weights[key]}</Text>
            </Group>
            <Slider
              value={weights[key]}
              onChange={(val) =>
                setWeights((prev) => ({ ...prev, [key]: val }))
              }
              min={0}
              max={100}
              step={1}
              color="organlink"
              styles={{
                track: {
                  background: 'var(--bg-base)',
                  boxShadow:
                    'inset 4px 4px 8px var(--shadow-dark), inset -4px -4px 8px var(--shadow-light)',
                },
                bar: { background: 'var(--color-primary)' },
                thumb: {
                  borderColor: 'var(--color-primary)',
                  background: 'white',
                },
              }}
            />
          </Stack>
        ))}

        {/* Weight distribution bar */}
        <Stack gap={8}>
          <Text fw={600} size="sm">
            Weight Distribution
          </Text>
          <div
            style={{
              display: 'flex',
              height: 32,
              borderRadius: 'var(--radius-input)',
              overflow: 'hidden',
              boxShadow:
                'inset 4px 4px 8px var(--shadow-dark), inset -4px -4px 8px var(--shadow-light)',
            }}
          >
            {WEIGHT_LABELS.map(({ key }) => (
              <Tooltip key={key} label={`${key}: ${shares[key].toFixed(0)}%`}>
                <div
                  style={{
                    width: `${shares[key]}%`,
                    background: WEIGHT_COLORS[key],
                    transition: 'width 300ms ease',
                  }}
                />
              </Tooltip>
            ))}
          </div>
        </Stack>

        {saveError && (
          <Text size="sm" c="red" role="alert">
            {saveError}
          </Text>
        )}

        {/* Actions */}
        <Group justify="flex-end" gap={12}>
          <Button
            variant="subtle"
            color="gray"
            disabled={!dirty}
            onClick={() => selected && setWeights(selected)}
          >
            Reset
          </Button>
          <Button
            className="neu-raised-sm neu-button"
            loading={saving}
            disabled={!selected}
            onClick={handleSave}
          >
            Save Configuration
          </Button>
        </Group>
      </Stack>
    </div>
  );
}

/* ==========================================================================
   Main — SettingsPage
   ========================================================================== */

export default function SettingsPage() {
  // Mock mode starts with mockHospitals (unchanged); live mode loads from GET /api/hospitals.
  const [hospitals, setHospitals] = useState(USE_LIVE_API ? [] : mockHospitals);
  const [hospitalsLoading, setHospitalsLoading] = useState(USE_LIVE_API);
  // Regions feed the Regions tab, the Policy Weights tab and the hospital form's region select.
  const [regions, setRegions] = useState([]);
  const [regionsLoading, setRegionsLoading] = useState(USE_LIVE_API);

  async function reloadHospitals() {
    try {
      setHospitals(await listHospitals());
    } catch (err) {
      showApiError(err, 'Could not load hospitals');
    } finally {
      setHospitalsLoading(false);
    }
  }

  async function reloadRegions() {
    try {
      setRegions(await listRegions());
    } catch (err) {
      showApiError(err, 'Could not load regions');
    } finally {
      setRegionsLoading(false);
    }
  }

  // Hospital writes change per-region hospital counts, so refresh both lists.
  async function reloadAll() {
    await Promise.all([reloadHospitals(), reloadRegions()]);
  }

  useEffect(() => {
    if (USE_LIVE_API) {
      reloadHospitals();
    }
    reloadRegions(); // mock mode: listRegions(false) returns the mock rows synchronously-ish
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section aria-label="Settings" className="page-fade-in">
      <Title order={2} mb={24}>
        System Configuration
      </Title>
      <Tabs
        defaultValue="hospitals"
        classNames={{ tab: 'settings-tab' }}
      >
        <Tabs.List mb={20}>
          <Tabs.Tab value="hospitals" leftSection={<IconBuilding size={16} />}>
            Hospitals
          </Tabs.Tab>
          <Tabs.Tab value="regions" leftSection={<IconMap size={16} />}>
            Regions
          </Tabs.Tab>
          <Tabs.Tab value="organs" leftSection={<IconHeart size={16} />}>
            Organ Types
          </Tabs.Tab>
          <Tabs.Tab
            value="compatibility"
            leftSection={<IconDna size={16} />}
          >
            Compatibility Matrix
          </Tabs.Tab>
          <Tabs.Tab value="weights" leftSection={<IconScale size={16} />}>
            Policy Weights
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="hospitals">
          <HospitalsTab
            hospitals={hospitals}
            setHospitals={setHospitals}
            loading={hospitalsLoading}
            regions={regions}
            onChanged={reloadAll}
          />
        </Tabs.Panel>

        <Tabs.Panel value="regions">
          <RegionsTab
            regions={regions}
            setRegions={setRegions}
            hospitals={hospitals}
            loading={regionsLoading}
            onChanged={reloadRegions}
          />
        </Tabs.Panel>

        <Tabs.Panel value="organs">
          <OrganTypesTab />
        </Tabs.Panel>

        <Tabs.Panel value="compatibility">
          <CompatibilityTab />
        </Tabs.Panel>

        <Tabs.Panel value="weights">
          <PolicyWeightsTab regions={regions} setRegions={setRegions} onChanged={reloadRegions} />
        </Tabs.Panel>
      </Tabs>
    </section>
  );
}