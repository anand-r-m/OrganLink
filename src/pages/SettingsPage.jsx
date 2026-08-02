import { useState, useMemo } from 'react';
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
} from '@tabler/icons-react';
import DataTable from '../components/DataTable.jsx';
import FormModal from '../components/FormModal.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { mockHospitals } from '../data/mockHospitals.js';
import { mockRegions } from '../data/mockRegions.js';
import { mockCompatibility } from '../data/mockCompatibility.js';

/* ==========================================================================
   Helper — ABO/Rh compatibility (phase2.md Tab 4)
   ========================================================================== */

function isABOCompatible(recipient, donor) {
  const rType = recipient.replace(/[+-]/, '');
  const dType = donor.replace(/[+-]/, '');
  const rRh = recipient.includes('+');
  const dRh = donor.includes('+');
  const aboOk = dType === 'O' || rType === 'AB' || rType === dType;
  const rhOk = rRh || !dRh;
  return aboOk && rhOk;
}

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/* ==========================================================================
   Tab 1 — Hospitals
   ========================================================================== */

function HospitalsTab({ hospitals, setHospitals }) {
  const [modalOpen, modalHandlers] = useDisclosure(false);
  const [editingHospital, setEditingHospital] = useState(null);
  const [errors, setErrors] = useState({});

  // Form state
  const [formName, setFormName] = useState('');
  const [formRegion, setFormRegion] = useState(null);
  const [formTrauma, setFormTrauma] = useState(null);
  const [formAddress, setFormAddress] = useState('');

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
  }

  function openAdd() {
    setEditingHospital(null);
    resetForm();
    modalHandlers.open();
  }

  function openEdit(hospital) {
    setEditingHospital(hospital);
    setFormName(hospital.name || '');
    setFormRegion(hospital.region || null);
    setFormTrauma(hospital.traumaLevel || null);
    setFormAddress(hospital.address || '');
    modalHandlers.open();
  }

  function handleSubmit() {
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

  function toggleStatus(hospital) {
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
        Cell: ({ cell }) => `Level ${cell.getValue()}`,
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
    [hospitals],
  );

  return (
    <Stack gap={16}>
      <Group justify="flex-end" mb={12}>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={openAdd}
        >
          Add Hospital
        </Button>
      </Group>

      <DataTable
        columns={columns}
        data={hospitals}
        emptyMessage="No hospitals found"
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
        size="md"
      >
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
            data={mockRegions.map((r) => r.name)}
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
      </FormModal>
    </Stack>
  );
}

/* ==========================================================================
   Tab 2 — Regions
   ========================================================================== */

function RegionsTab({ hospitals }) {
  const [regions, setRegions] = useState(mockRegions);
  const [modalOpen, modalHandlers] = useDisclosure(false);
  const [errors, setErrors] = useState({});

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
  }

  function openAdd() {
    resetForm();
    modalHandlers.open();
  }

  function handleSubmit() {
    if (!validate()) return;

    const newRegion = {
      code: formCode || `RGN-${String(regions.length + 1).padStart(2, '0')}`,
      name: formName,
      allocationPolicy: formPolicy || 'Local first, then regional',
      hospitalCount: 0,
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
      {
        accessorKey: 'allocationPolicy',
        header: 'Allocation Policy',
        size: 350,
      },
      {
        id: 'hospitalCount',
        header: 'Hospital Count',
        size: 140,
        Cell: ({ row }) =>
          hospitals.filter((h) => h.region === row.original.name).length,
      },
    ],
    [hospitals],
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
      />

      <FormModal
        opened={modalOpen}
        onClose={() => {
          modalHandlers.close();
          resetForm();
        }}
        title="Add Region"
        submitLabel="Add"
        onSubmit={handleSubmit}
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
          <TextInput
            label="Allocation Policy"
            placeholder="e.g. Priority-based with distance weight"
            value={formPolicy}
            onChange={(e) => setFormPolicy(e.currentTarget.value)}
          />
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
  const [organTypes, setOrganTypes] = useState(ORGAN_TYPES_DEFAULT);
  const [modalOpen, modalHandlers] = useDisclosure(false);
  const [errors, setErrors] = useState({});

  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formViability, setFormViability] = useState(null);
  const [formWeight, setFormWeight] = useState(null);

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
  }

  function openAdd() {
    resetForm();
    modalHandlers.open();
  }

  function handleSubmit() {
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
      {
        accessorKey: 'code',
        header: 'Code',
        size: 100,
        Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span>,
      },
      { accessorKey: 'name', header: 'Name', size: 200 },
      {
        accessorKey: 'maxViability',
        header: 'Max Viability (hours)',
        size: 180,
        Cell: ({ cell }) => (
          <span className="mono">{cell.getValue()}h</span>
        ),
      },
      {
        accessorKey: 'priorityWeight',
        header: 'Default Priority Weight',
        size: 200,
        Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span>,
      },
    ],
    [],
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
      />

      <FormModal
        opened={modalOpen}
        onClose={() => {
          modalHandlers.close();
          resetForm();
        }}
        title="Add Organ Type"
        submitLabel="Add"
        onSubmit={handleSubmit}
        size="md"
      >
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
      </FormModal>
    </Stack>
  );
}

/* ==========================================================================
   Tab 4 — Compatibility Matrix
   ========================================================================== */

function CompatibilityTab() {
  const [matrix, setMatrix] = useState(() => {
    const m = {};
    BLOOD_GROUPS.forEach((r) => {
      m[r] = {};
      BLOOD_GROUPS.forEach((d) => {
        m[r][d] = isABOCompatible(r, d);
      });
    });
    return m;
  });

  const [confirmToggle, setConfirmToggle] = useState(null);
  const [confirmOpen, confirmHandlers] = useDisclosure(false);

  // HLA Allele state
  const [hlaAlleles, setHlaAlleles] = useState([
    { code: 'A*01:01', locus: 'A', description: 'Common allele in North Indian populations' },
    { code: 'A*02:01', locus: 'A', description: 'Most common HLA-A allele worldwide' },
    { code: 'B*07:02', locus: 'B', description: 'Associated with European and South Asian populations' },
    { code: 'B*44:02', locus: 'B', description: 'Common in diverse ethnic groups' },
    { code: 'DRB1*03:01', locus: 'DR', description: 'Associated with autoimmune conditions' },
    { code: 'DRB1*15:01', locus: 'DR', description: 'Most common DR allele in India' },
  ]);
  const [hlaModalOpen, hlaModalHandlers] = useDisclosure(false);
  const [hlaErrors, setHlaErrors] = useState({});

  const [hlaFormCode, setHlaFormCode] = useState('');
  const [hlaFormLocus, setHlaFormLocus] = useState(null);
  const [hlaFormDesc, setHlaFormDesc] = useState('');

  function validateHla() {
    const e = {};
    if (!hlaFormCode || hlaFormCode.trim().length === 0) e.code = 'Allele code is required';
    if (!hlaFormLocus) e.locus = 'Locus is required';
    setHlaErrors(e);
    return Object.keys(e).length === 0;
  }

  function resetHlaForm() {
    setHlaFormCode('');
    setHlaFormLocus(null);
    setHlaFormDesc('');
    setHlaErrors({});
  }

  function openHlaAdd() {
    resetHlaForm();
    hlaModalHandlers.open();
  }

  function handleHlaSubmit() {
    if (!validateHla()) return;

    const newAllele = {
      code: hlaFormCode,
      locus: hlaFormLocus,
      description: hlaFormDesc,
    };
    setHlaAlleles((prev) => [newAllele, ...prev]);
    notifications.show({
      title: 'Allele Added',
      message: `${newAllele.code} added successfully`,
      color: 'green',
    });
    hlaModalHandlers.close();
    resetHlaForm();
  }

  function handleConfirmToggle() {
    if (!confirmToggle) return;
    setMatrix((prev) => ({
      ...prev,
      [confirmToggle.recipient]: {
        ...prev[confirmToggle.recipient],
        [confirmToggle.donor]: !confirmToggle.current,
      },
    }));
    notifications.show({
      title: 'Compatibility Updated',
      message: `${confirmToggle.recipient} ← ${confirmToggle.donor}: ${!confirmToggle.current ? 'Compatible' : 'Incompatible'}`,
      color: !confirmToggle.current ? 'green' : 'red',
    });
    confirmHandlers.close();
  }

  const hlaColumns = useMemo(
    () => [
      {
        accessorKey: 'code',
        header: 'Allele Code',
        size: 150,
        Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span>,
      },
      { accessorKey: 'locus', header: 'Locus', size: 100 },
      { accessorKey: 'description', header: 'Description', size: 400 },
    ],
    [],
  );

  return (
    <Stack gap={24}>
      {/* Section 1: Blood Group Compatibility Grid */}
      <div className="neu-raised" style={{ padding: 24, borderRadius: 20 }}>
        <Title order={3} mb={16}>
          Blood Group Compatibility
        </Title>
        <Text size="sm" c="dimmed" mb={16}>
          Rows = Recipient, Columns = Donor. Click a cell to toggle.
        </Text>
        <div style={{ overflowX: 'auto' }}>
        <Table withColumnBorders withRowBorders={false}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ width: 80 }}>R \ D</Table.Th>
              {BLOOD_GROUPS.map((bg) => (
                <Table.Th
                  key={bg}
                  style={{
                    textAlign: 'center',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 13,
                  }}
                >
                  {bg}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {BLOOD_GROUPS.map((recipient) => (
              <Table.Tr key={recipient}>
                <Table.Td
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {recipient}
                </Table.Td>
                {BLOOD_GROUPS.map((donor) => {
                  const compatible = matrix[recipient][donor];
                  return (
                    <Table.Td
                      key={donor}
                      className="compat-cell"
                      onClick={() => {
                        setConfirmToggle({
                          recipient,
                          donor,
                          current: compatible,
                        });
                        confirmHandlers.open();
                      }}
                      style={{
                        textAlign: 'center',
                        cursor: 'pointer',
                        background: compatible
                          ? 'rgba(106,176,123,0.2)'
                          : 'rgba(199,92,92,0.15)',
                        color: compatible ? '#6AB07B' : '#C75C5C',
                        fontWeight: 700,
                        fontSize: 16,
                        transition: 'background 150ms ease',
                        borderRadius: 4,
                      }}
                    >
                      {compatible ? '✓' : '✕'}
                    </Table.Td>
                  );
                })}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        </div>
      </div>

      {/* Section 2: HLA Allele Reference */}
      <div>
        <Group justify="flex-end" mb={12}>
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={openHlaAdd}
          >
            Add Allele
          </Button>
        </Group>
        <DataTable
          columns={hlaColumns}
          data={hlaAlleles}
          emptyMessage="No alleles found"
        />
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
              {confirmToggle.current ? 'Remove' : 'Add'} compatibility between
              recipient <span className="mono">{confirmToggle.recipient}</span>{' '}
              and donor <span className="mono">{confirmToggle.donor}</span>?
            </Text>
            <Group justify="flex-end" gap={12}>
              <Button
                variant="subtle"
                color="gray"
                onClick={confirmHandlers.close}
              >
                Cancel
              </Button>
              <Button
                color={confirmToggle.current ? 'red' : 'green'}
                onClick={handleConfirmToggle}
              >
                Confirm
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      {/* HLA Add Modal */}
      <FormModal
        opened={hlaModalOpen}
        onClose={() => {
          hlaModalHandlers.close();
          resetHlaForm();
        }}
        title="Add Allele"
        submitLabel="Add"
        onSubmit={handleHlaSubmit}
        size="md"
      >
        <Stack gap={16}>
          <TextInput
            label="Allele Code"
            required
            placeholder="e.g. A*02:01"
            value={hlaFormCode}
            onChange={(e) => setHlaFormCode(e.currentTarget.value)}
            error={hlaErrors.code}
          />
          <Select
            label="Locus"
            data={['A', 'B', 'DR']}
            required
            value={hlaFormLocus}
            onChange={setHlaFormLocus}
            error={hlaErrors.locus}
          />
          <TextInput
            label="Description"
            value={hlaFormDesc}
            onChange={(e) => setHlaFormDesc(e.currentTarget.value)}
          />
        </Stack>
      </FormModal>
    </Stack>
  );
}

/* ==========================================================================
   Tab 5 — Policy Weights
   ========================================================================== */

const DEFAULT_WEIGHTS = { urgency: 40, waitTime: 35, distance: 15, hlaMatch: 10 };

const WEIGHT_COLORS = {
  urgency: '#C75C5C',
  waitTime: '#D4A056',
  distance: '#5B8A9A',
  hlaMatch: '#6AB07B',
};

const WEIGHT_LABELS = [
  { key: 'urgency', label: 'Urgency Weight', icon: IconHeart },
  { key: 'waitTime', label: 'Wait Time Weight', icon: IconClock },
  { key: 'distance', label: 'Distance Weight', icon: IconMap },
  { key: 'hlaMatch', label: 'HLA Match Weight', icon: IconDna },
];

function PolicyWeightsTab() {
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);

  const total = Object.values(weights).reduce((a, b) => a + b, 0);

  return (
    <div className="neu-raised" style={{ padding: 32, borderRadius: 20 }}>
      <Stack gap={32}>
        <Title order={3}>Allocation Policy Weights</Title>
        <Text size="sm" c="dimmed">
          Adjust the relative importance of each factor in the matching
          algorithm. Weights are normalized to 100%.
        </Text>

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
              step={5}
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
            {Object.entries(weights).map(([key, val]) => {
              const pct = total > 0 ? (val / total) * 100 : 25;
              return (
                <Tooltip key={key} label={`${key}: ${pct.toFixed(0)}%`}>
                  <div
                    style={{
                      width: `${pct}%`,
                      background: WEIGHT_COLORS[key],
                      transition: 'width 300ms ease',
                    }}
                  />
                </Tooltip>
              );
            })}
          </div>
        </Stack>

        {/* Actions */}
        <Group justify="flex-end" gap={12}>
          <Button
            variant="subtle"
            color="gray"
            onClick={() => setWeights(DEFAULT_WEIGHTS)}
          >
            Reset to Defaults
          </Button>
          <Button
            className="neu-raised-sm neu-button"
            onClick={() => {
              notifications.show({
                title: 'Configuration Saved',
                message: 'Policy weights updated successfully',
                color: 'green',
              });
            }}
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
  const [hospitals, setHospitals] = useState(mockHospitals);

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
          />
        </Tabs.Panel>

        <Tabs.Panel value="regions">
          <RegionsTab hospitals={hospitals} />
        </Tabs.Panel>

        <Tabs.Panel value="organs">
          <OrganTypesTab />
        </Tabs.Panel>

        <Tabs.Panel value="compatibility">
          <CompatibilityTab />
        </Tabs.Panel>

        <Tabs.Panel value="weights">
          <PolicyWeightsTab />
        </Tabs.Panel>
      </Tabs>
    </section>
  );
}