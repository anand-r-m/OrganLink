import { useState, useMemo } from 'react';
import {
  Button,
  Title,
  Group,
  Stack,
  Select,
  TextInput,
  NumberInput,
  Tooltip,
  Text,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconHeartbeat } from '@tabler/icons-react';
import DataTable from '../components/DataTable.jsx';
import FormModal from '../components/FormModal.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { mockRecipients } from '../data/mockRecipients.js';
import { mockHospitals } from '../data/mockHospitals.js';

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const ORGAN_TYPES = ['Kidney', 'Liver', 'Heart', 'Lung', 'Pancreas'];
const URGENCY_LEVELS = ['1A', '1B', '2'];
const STATUS_OPTIONS = ['Waiting', 'Offered', 'Transplanted', 'Inactive'];

const NEU_INSET_INPUT_STYLES = {
  input: {
    border: 'none',
    background: 'var(--bg-base)',
    borderRadius: 'var(--radius-input)',
    boxShadow:
      'inset 4px 4px 8px var(--shadow-dark), inset -4px -4px 8px var(--shadow-light)',
  },
};

function calcPriorityScore(urgency) {
  const base = urgency === '1A' ? 90 : urgency === '1B' ? 70 : 40;
  const range = urgency === '1A' ? 10 : 20;
  return parseFloat((base + Math.random() * range).toFixed(1));
}

function randomWaitTime() {
  return `${Math.floor(Math.random() * 30) + 1} months`;
}

export default function RecipientWaitlistPage() {
  const [recipients, setRecipients] = useState(mockRecipients);
  const [addOpen, addHandlers] = useDisclosure(false);

  // Filter state
  const [filterOrgan, setFilterOrgan] = useState(null);
  const [filterBlood, setFilterBlood] = useState(null);
  const [filterUrgency, setFilterUrgency] = useState(null);
  const [filterStatus, setFilterStatus] = useState(null);

  // Form state
  const [errors, setErrors] = useState({});
  const [formName, setFormName] = useState('');
  const [formDob, setFormDob] = useState(null);
  const [formBlood, setFormBlood] = useState(null);
  const [formOrganNeeded, setFormOrganNeeded] = useState(null);
  const [formHospital, setFormHospital] = useState(null);
  const [formUrgency, setFormUrgency] = useState(null);
  const [formHlaA, setFormHlaA] = useState('');
  const [formHlaB, setFormHlaB] = useState('');
  const [formHlaDR, setFormHlaDR] = useState('');
  const [formHeight, setFormHeight] = useState(null);
  const [formWeight, setFormWeight] = useState(null);

  function validate() {
    const e = {};
    if (!formName || formName.trim().length < 2) e.name = 'Name is required';
    if (!formDob) e.dob = 'Valid date of birth required';
    else if (new Date(formDob) >= new Date()) e.dob = 'Valid date of birth required';
    if (!formBlood) e.bloodGroup = 'Select blood group';
    if (!formOrganNeeded) e.organNeeded = 'Select organ needed';
    if (!formHospital) e.hospital = 'Select hospital';
    if (!formUrgency) e.urgency = 'Select urgency level';
    if (formHeight && (formHeight < 100 || formHeight > 220)) e.height = 'Height must be between 100–220 cm';
    if (formWeight && (formWeight < 20 || formWeight > 200)) e.weight = 'Weight must be between 20–200 kg';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  const filteredRecipients = useMemo(() => {
    return recipients.filter((r) => {
      if (filterOrgan && r.organNeeded !== filterOrgan) return false;
      if (filterBlood && r.bloodGroup !== filterBlood) return false;
      if (filterUrgency && r.urgency !== filterUrgency) return false;
      if (filterStatus && r.status !== filterStatus) return false;
      return true;
    });
  }, [recipients, filterOrgan, filterBlood, filterUrgency, filterStatus]);

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
      { accessorKey: 'organNeeded', header: 'Organ Needed', size: 120 },
      {
        accessorKey: 'urgency',
        header: 'Urgency',
        size: 80,
        Cell: ({ cell }) => <StatusBadge status={cell.getValue()} />,
      },
      {
        accessorKey: 'priorityScore',
        header: 'Priority Score',
        size: 100,
        Cell: ({ cell }) => {
          const score = cell.getValue();
          const urgencyW = (score * 0.4).toFixed(1);
          const waitW = (score * 0.32).toFixed(1);
          const policyW = (score * 0.28).toFixed(1);
          return (
            <Tooltip
              label={
                <Stack
                  gap={4}
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 12,
                  }}
                >
                  <Text size="xs">Urgency Weight:   {urgencyW}  (40%)</Text>
                  <Text size="xs">Wait Time Weight: {waitW}  (32%)</Text>
                  <Text size="xs">Policy Bonus:     {policyW}  (28%)</Text>
                  <Text size="xs" fw={700}>
                    Total Score:      {score}
                  </Text>
                </Stack>
              }
              multiline
              withArrow
              position="top"
            >
              <span className="mono" style={{ cursor: 'help' }}>
                {score}
              </span>
            </Tooltip>
          );
        },
      },
      { accessorKey: 'waitTime', header: 'Wait Time', size: 100 },
      {
        accessorKey: 'status',
        header: 'Status',
        size: 110,
        Cell: ({ cell }) => <StatusBadge status={cell.getValue()} />,
      },
      { accessorKey: 'hospital', header: 'Hospital', size: 180, Cell: ({ cell }) => <span className="cell-truncate">{cell.getValue()}</span> },
    ],
    [],
  );

  function resetForm() {
    setFormName('');
    setFormDob(null);
    setFormBlood(null);
    setFormOrganNeeded(null);
    setFormHospital(null);
    setFormUrgency(null);
    setFormHlaA('');
    setFormHlaB('');
    setFormHlaDR('');
    setFormHeight(null);
    setFormWeight(null);
    setErrors({});
  }

  function openAddModal() {
    resetForm();
    addHandlers.open();
  }

  function handleSubmit() {
    if (!validate()) return;

    const maxIdNum = recipients.reduce((max, r) => {
      const match = r.id.match(/RCP-(\d+)/);
      const num = match ? parseInt(match[1], 10) : 0;
      return Math.max(max, num);
    }, 400);
    const newId = `RCP-${String(maxIdNum + 1)}-${String.fromCharCode(
      65 + Math.floor(Math.random() * 26),
    )}`;
    const newRecipient = {
      id: newId,
      name: formName,
      bloodGroup: formBlood,
      organNeeded: formOrganNeeded,
      urgency: formUrgency,
      priorityScore: calcPriorityScore(formUrgency),
      waitTime: randomWaitTime(),
      status: 'Waiting',
      hospital: formHospital,
      hlaA: formHlaA,
      hlaB: formHlaB,
      hlaDR: formHlaDR,
      height: formHeight,
      weight: formWeight,
    };
    setRecipients((prev) => [newRecipient, ...prev]);
    notifications.show({
      title: 'Recipient Added',
      message: 'Recipient added to waitlist',
      color: 'green',
    });
    addHandlers.close();
    resetForm();
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

      {/* Filter bar */}
      <Group gap={12} style={{ marginBottom: 20 }}>
        <Select
          placeholder="Organ Needed"
          data={ORGAN_TYPES}
          value={filterOrgan}
          onChange={setFilterOrgan}
          clearable
          styles={NEU_INSET_INPUT_STYLES}
        />
        <Select
          placeholder="Blood Group"
          data={BLOOD_GROUPS}
          value={filterBlood}
          onChange={setFilterBlood}
          clearable
          styles={NEU_INSET_INPUT_STYLES}
        />
        <Select
          placeholder="Urgency"
          data={URGENCY_LEVELS}
          value={filterUrgency}
          onChange={setFilterUrgency}
          clearable
          styles={NEU_INSET_INPUT_STYLES}
        />
        <Select
          placeholder="Status"
          data={STATUS_OPTIONS}
          value={filterStatus}
          onChange={setFilterStatus}
          clearable
          styles={NEU_INSET_INPUT_STYLES}
        />
      </Group>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={filteredRecipients}
        emptyMessage="No recipients found"
      />

      {/* Add Recipient Modal */}
      <FormModal
        opened={addOpen}
        onClose={() => {
          addHandlers.close();
          resetForm();
        }}
        title="Add Recipient"
        submitLabel="Add"
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
            label="Organ Needed"
            data={ORGAN_TYPES}
            required
            value={formOrganNeeded}
            onChange={setFormOrganNeeded}
            error={errors.organNeeded}
          />
          <Select
            label="Hospital"
            data={mockHospitals.map((h) => h.name)}
            required
            value={formHospital}
            onChange={setFormHospital}
            error={errors.hospital}
          />
          <Select
            label="Urgency Level"
            data={URGENCY_LEVELS}
            required
            value={formUrgency}
            onChange={setFormUrgency}
            error={errors.urgency}
          />
          <TextInput
            label="HLA-A"
            placeholder="e.g. A*02:01"
            value={formHlaA}
            onChange={(e) => setFormHlaA(e.currentTarget.value)}
          />
          <TextInput
            label="HLA-B"
            placeholder="e.g. B*44:02"
            value={formHlaB}
            onChange={(e) => setFormHlaB(e.currentTarget.value)}
          />
          <TextInput
            label="HLA-DR"
            placeholder="e.g. DRB1*03:01"
            value={formHlaDR}
            onChange={(e) => setFormHlaDR(e.currentTarget.value)}
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
    </section>
  );
}