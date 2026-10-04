import { useMemo, useState } from 'react';
import { Button, SimpleGrid, Stack, TextInput, Title } from '@mantine/core';
import { IconActivity, IconClipboardCheck, IconHeart, IconUsers } from '@tabler/icons-react';

import DataTable from '../components/DataTable.jsx';
import FormModal from '../components/FormModal.jsx';
import StatCard from '../components/StatCard.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { mockCompatibility, mockHlaAlleles } from '../data/mockCompatibility.js';
import { mockDonors } from '../data/mockDonors.js';
import { mockHospitals } from '../data/mockHospitals.js';
import { mockOffers } from '../data/mockOffers.js';
import { mockOrgans } from '../data/mockOrgans.js';
import { mockRecipients } from '../data/mockRecipients.js';
import { mockRegions } from '../data/mockRegions.js';
import { mockTransports } from '../data/mockTransports.js';

const BADGE_STATES = [
  'ACCEPTED', 'DELIVERED', 'TRANSPLANTED', 'ACTIVE',
  'SENT', 'IN_TRANSIT', 'PENDING', '1B',
  'DECLINED', 'FAILED', 'EXPIRED', '1A',
  'CREATED', 'ALLOCATED', '2',
  'VOIDED', 'CANCELLED', 'DISCARDED', 'SUSPENDED', 'INACTIVE',
  // existing mock-style values
  'Active', 'Sent', 'In Transit', 'Waiting',
];

export default function Phase0SmokePage() {
  const [opened, setOpened] = useState(false);

  const columns = useMemo(
    () => [
      { accessorKey: 'id', header: 'Offer ID', Cell: ({ cell }) => <span className="mono">{cell.getValue()}</span> },
      { accessorKey: 'organType', header: 'Organ Type' },
      { accessorKey: 'recipientId', header: 'Recipient ID' },
      { accessorKey: 'status', header: 'Status', Cell: ({ cell }) => <StatusBadge status={cell.getValue()} /> },
    ],
    [],
  );

  const counts = [
    mockDonors.length,
    mockRecipients.length,
    mockOrgans.length,
    mockOffers.length,
    mockTransports.length,
    mockHospitals.length,
    mockRegions.length,
    mockCompatibility.length,
    mockHlaAlleles.length,
  ].join(' / ');

  return (
    <Stack gap="lg">
      <Title order={2}>Phase 0 smoke</Title>
      <div data-testid="mock-counts" className="mono">
        {counts}
      </div>

      <SimpleGrid cols={4} spacing={20}>
        <StatCard icon={IconHeart} color="danger" value={12} label="Available Organs" trend={3} />
        <StatCard icon={IconUsers} color="primary" value={847} label="Active Waitlist" trend={12} />
        <StatCard icon={IconClipboardCheck} color="warning" value={3} label="Pending Offers" trend={-2} />
        <StatCard icon={IconActivity} color="success" value={28} label="Transplants This Month" trend={5} />
      </SimpleGrid>

      <div data-testid="badge-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {BADGE_STATES.map((state) => (
          <StatusBadge key={state} status={state} />
        ))}
      </div>

      <Button onClick={() => setOpened(true)}>Open modal</Button>
      <FormModal
        opened={opened}
        onClose={() => setOpened(false)}
        title="Smoke modal"
        onSubmit={() => setOpened(false)}
      >
        <TextInput label="Full Name" />
      </FormModal>

      <DataTable columns={columns} data={mockOffers} />
      <DataTable columns={columns} data={[]} />
    </Stack>
  );
}
