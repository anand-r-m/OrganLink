import { useState, useMemo } from 'react';
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
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconUserPlus } from '@tabler/icons-react';
import DataTable from '../components/DataTable.jsx';
import FormModal from '../components/FormModal.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { mockDonors } from '../data/mockDonors.js';
import { mockHospitals } from '../data/mockHospitals.js';

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const ORGAN_TYPES = ['Kidney', 'Liver', 'Heart', 'Lung', 'Pancreas'];

function calcAge(dob) {
  if (!dob) return 0;
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
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
  const [donors, setDonors] = useState(mockDonors);
  const [registerOpen, registerHandlers] = useDisclosure(false);
  const [selectedDonor, setSelectedDonor] = useState(null);
  const [drawerOpen, drawerHandlers] = useDisclosure(false);

  // Form state
  const [editingDonor, setEditingDonor] = useState(null);
  const [errors, setErrors] = useState({});
  const [formName, setFormName] = useState('');
  const [formDob, setFormDob] = useState(null);
  const [formBlood, setFormBlood] = useState(null);
  const [formHospital, setFormHospital] = useState(null);
  const [formRegion, setFormRegion] = useState('');
  const [formOrganType, setFormOrganType] = useState([]);
  const [formHlaA, setFormHlaA] = useState('');
  const [formHlaB, setFormHlaB] = useState('');
  const [formHlaDR, setFormHlaDR] = useState('');
  const [formHeight, setFormHeight] = useState(null);
  const [formWeight, setFormWeight] = useState(null);

  const HLA_PATTERN = /^[A-Za-z]+\*\d{2}:\d{2}$/;

  function validate() {
    const e = {};
    if (!formName || formName.trim().length < 2) e.name = 'Name is required';
    if (!formDob) e.dob = 'Valid date of birth required';
    else if (new Date(formDob) >= new Date()) e.dob = 'Valid date of birth required';
    if (!formBlood) e.bloodGroup = 'Select blood group';
    if (!formHospital) e.hospital = 'Select hospital';
    if (!formOrganType || formOrganType.length === 0) e.organType = 'Select at least one organ type';
    if (formHeight && (formHeight < 100 || formHeight > 220)) e.height = 'Height must be between 100–220 cm';
    if (formWeight && (formWeight < 20 || formWeight > 200)) e.weight = 'Weight must be between 20–200 kg';
    if (formHlaA && !HLA_PATTERN.test(formHlaA)) e.hlaA = 'Format should be like A*02:01';
    if (formHlaB && !HLA_PATTERN.test(formHlaB)) e.hlaB = 'Format should be like B*07:02';
    if (formHlaDR && !HLA_PATTERN.test(formHlaDR)) e.hlaDR = 'Format should be like DRB1*03:01';
    setErrors(e);
    return Object.keys(e).length === 0;
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
      { accessorKey: 'organType', header: 'Organ Type', size: 120 },
      { accessorKey: 'hospital', header: 'Hospital', size: 200, Cell: ({ cell }) => <span className="cell-truncate">{cell.getValue()}</span> },
      { accessorKey: 'region', header: 'Region', size: 120 },
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
        Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span>,
      },
    ],
    [],
  );

  function resetForm() {
    setFormName('');
    setFormDob(null);
    setFormBlood(null);
    setFormHospital(null);
    setFormRegion('');
    setFormOrganType([]);
    setFormHlaA('');
    setFormHlaB('');
    setFormHlaDR('');
    setFormHeight(null);
    setFormWeight(null);
    setErrors({});
  }

  function openRegisterModal() {
    resetForm();
    setEditingDonor(null);
    registerHandlers.open();
  }

  function openEditModal(donor) {
    setFormName(donor.name || '');
    setFormDob(donor.dob ? new Date(donor.dob) : null);
    setFormBlood(donor.bloodGroup || null);
    setFormHospital(donor.hospital || null);
    setFormRegion(donor.region || '');
    setFormOrganType(
      donor.organType
        ? donor.organType.split(', ').map((o) => o.trim())
        : [],
    );
    setFormHlaA(donor.hlaA || '');
    setFormHlaB(donor.hlaB || '');
    setFormHlaDR(donor.hlaDR || '');
    setFormHeight(donor.height ?? null);
    setFormWeight(donor.weight ?? null);
    setEditingDonor(donor);
    drawerHandlers.close();
    registerHandlers.open();
  }

  function handleHospitalChange(value) {
    setFormHospital(value);
    const hospital = mockHospitals.find((h) => h.name === value);
    setFormRegion(hospital ? hospital.region : '');
  }

  function handleSubmit() {
    if (!validate()) return;

    const organTypeStr = Array.isArray(formOrganType)
      ? formOrganType.join(', ')
      : formOrganType || '';

    if (editingDonor) {
      const updated = {
        ...editingDonor,
        name: formName,
        bloodGroup: formBlood,
        age: calcAge(formDob),
        organType: organTypeStr,
        hospital: formHospital,
        region: formRegion,
        hlaA: formHlaA,
        hlaB: formHlaB,
        hlaDR: formHlaDR,
        height: formHeight,
        weight: formWeight,
      };
      setDonors((prev) =>
        prev.map((d) => (d.id === editingDonor.id ? updated : d)),
      );
      notifications.show({
        title: 'Donor Updated',
        message: 'Donor updated successfully',
        color: 'blue',
      });
    } else {
      const maxIdNum = donors.reduce((max, d) => {
        const num = parseInt(d.id.replace('DNR-', ''), 10);
        return isNaN(num) ? max : Math.max(max, num);
      }, 1000);
      const newId = `DNR-${String(maxIdNum + 1).padStart(4, '0')}`;
      const newDonor = {
        id: newId,
        name: formName,
        bloodGroup: formBlood,
        age: calcAge(formDob),
        organType: organTypeStr,
        hospital: formHospital,
        region: formRegion,
        status: 'Active',
        dateRegistered: todayISO(),
        hlaA: formHlaA,
        hlaB: formHlaB,
        hlaDR: formHlaDR,
        height: formHeight,
        weight: formWeight,
      };
      setDonors((prev) => [newDonor, ...prev]);
      notifications.show({
        title: 'Donor Registered',
        message: `${newId} added successfully`,
        color: 'green',
      });
    }
    registerHandlers.close();
    resetForm();
    setEditingDonor(null);
  }

  function handleDeactivate() {
    if (!selectedDonor) return;
    setDonors((prev) =>
      prev.map((d) =>
        d.id === selectedDonor.id ? { ...d, status: 'Inactive' } : d,
      ),
    );
    notifications.show({
      title: 'Donor Deactivated',
      message: `${selectedDonor.id} has been deactivated`,
      color: 'orange',
    });
    drawerHandlers.close();
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
        <Button
          leftSection={<IconUserPlus size={18} />}
          onClick={openRegisterModal}
        >
          Register Donor
        </Button>
      </Group>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={donors}
        emptyMessage="No donors registered"
        mantineTableBodyRowProps={({ row }) => ({
          onClick: () => {
            setSelectedDonor(row.original);
            drawerHandlers.open();
          },
          style: { cursor: 'pointer' },
        })}
      />

      {/* Register / Edit Modal */}
      <FormModal
        opened={registerOpen}
        onClose={() => {
          registerHandlers.close();
          resetForm();
          setEditingDonor(null);
        }}
        title={editingDonor ? 'Edit Donor' : 'Register Donor'}
        submitLabel={editingDonor ? 'Update' : 'Register'}
        onSubmit={handleSubmit}
        size="md"
      >
        <Stack gap={16}>
          <TextInput
            label="Full Name"
            required
            value={formName}
            onChange={(e) => setFormName(e.currentTarget.value)}
            error={errors.name}
          />
          <DatePickerInput
            label="Date of Birth"
            required
            value={formDob}
            onChange={setFormDob}
            error={errors.dob}
          />
          <Select
            label="Blood Group"
            data={BLOOD_GROUPS}
            required
            value={formBlood}
            onChange={setFormBlood}
            error={errors.bloodGroup}
          />
          <Select
            label="Hospital"
            data={mockHospitals.map((h) => h.name)}
            required
            value={formHospital}
            onChange={handleHospitalChange}
            error={errors.hospital}
          />
          <TextInput
            label="Region"
            readOnly
            value={formRegion}
          />
          <MultiSelect
            label="Organ Type"
            data={ORGAN_TYPES}
            required
            value={formOrganType}
            onChange={setFormOrganType}
            error={errors.organType}
          />
          <TextInput
            label="HLA-A"
            placeholder="e.g. A*02:01"
            value={formHlaA}
            onChange={(e) => setFormHlaA(e.currentTarget.value)}
            error={errors.hlaA}
          />
          <TextInput
            label="HLA-B"
            placeholder="e.g. B*07:02"
            value={formHlaB}
            onChange={(e) => setFormHlaB(e.currentTarget.value)}
            error={errors.hlaB}
          />
          <TextInput
            label="HLA-DR"
            placeholder="e.g. DRB1*03:01"
            value={formHlaDR}
            onChange={(e) => setFormHlaDR(e.currentTarget.value)}
            error={errors.hlaDR}
          />
          <NumberInput
            label="Height (cm)"
            min={100}
            max={220}
            value={formHeight}
            onChange={setFormHeight}
            error={errors.height}
          />
          <NumberInput
            label="Weight (kg)"
            min={20}
            max={200}
            value={formWeight}
            onChange={setFormWeight}
            error={errors.weight}
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
            <StatusBadge status={selectedDonor.status} />

            <div style={sectionLabelStyle}>Medical Data</div>
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>Blood Group</span>
              <span className="mono">{selectedDonor.bloodGroup}</span>
            </div>
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>HLA-A</span>
              <span className="mono">{selectedDonor.hlaA}</span>
            </div>
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>HLA-B</span>
              <span className="mono">{selectedDonor.hlaB}</span>
            </div>
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>HLA-DR</span>
              <span className="mono">{selectedDonor.hlaDR}</span>
            </div>

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
              <span style={fieldLabelStyle}>Organ Type</span>
              <span>{selectedDonor.organType}</span>
            </div>
            <div style={fieldRowStyle}>
              <span style={fieldLabelStyle}>Date</span>
              <span className="mono">{selectedDonor.dateRegistered}</span>
            </div>

            <Group gap={12} style={{ marginTop: 24 }}>
              <Button
                variant="filled"
                onClick={() => openEditModal(selectedDonor)}
              >
                Edit
              </Button>
              <Button
                variant="light"
                color="red"
                onClick={handleDeactivate}
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