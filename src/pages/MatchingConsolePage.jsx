import { useMemo, useState } from 'react';
import {
  Accordion,
  Badge,
  Button,
  Card,
  Grid,
  Group,
  Loader,
  Modal,
  Paper,
  Progress,
  Select,
  Slider,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAdjustments,
  IconAlertCircle,
  IconArrowRight,
  IconBuildingHospital,
  IconChartBar,
  IconCheck,
  IconClock,
  IconDna,
  IconHeart,
  IconMapPin,
  IconUserCheck,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';

import CircularProgress from '../components/CircularProgress.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

import { mockCompatibility } from '../data/mockCompatibility.js';
import { mockDonors } from '../data/mockDonors.js';
import { mockOrgans } from '../data/mockOrgans.js';
import { mockRecipients } from '../data/mockRecipients.js';

function isAboCompatible(donorBloodGroup, recipientBloodGroup) {
  const compat = mockCompatibility.find((c) => c.bloodGroup === donorBloodGroup);
  return compat ? compat.compatibleWith.includes(recipientBloodGroup) : false;
}

function getDistanceInfo(organHospital, organRegion, recipientHospital) {
  if (organHospital === recipientHospital) {
    return { miles: 15, category: 'Local', progressValue: 15, score: 100 };
  }
  // Check regional match
  const northHospitals = ['AIIMS New Delhi', 'PGIMER Chandigarh', 'KGMU Lucknow'];
  const southHospitals = ['Apollo Chennai', 'CMC Vellore', 'Narayana Bangalore'];
  const westHospitals = ['KEM Mumbai'];

  const isOrganNorth = northHospitals.includes(organHospital);
  const isRecipNorth = northHospitals.includes(recipientHospital);
  const isOrganSouth = southHospitals.includes(organHospital);
  const isRecipSouth = southHospitals.includes(recipientHospital);
  const isOrganWest = westHospitals.includes(organHospital);
  const isRecipWest = westHospitals.includes(recipientHospital);

  if ((isOrganNorth && isRecipNorth) || (isOrganSouth && isRecipSouth) || (isOrganWest && isRecipWest)) {
    return { miles: 45, category: 'Local', progressValue: 35, score: 90 };
  }

  if ((isOrganNorth && isOrganWest) || (isOrganSouth && isOrganWest)) {
    return { miles: 120, category: 'Regional', progressValue: 65, score: 70 };
  }

  return { miles: 350, category: 'National', progressValue: 90, score: 40 };
}

export default function MatchingConsolePage() {
  const navigate = useNavigate();

  // Find first available organ as default
  const defaultOrganId = useMemo(() => {
    const avail = mockOrgans.find((o) => o.status === 'Available');
    return avail ? avail.id : mockOrgans[0]?.id ?? '';
  }, []);

  const [selectedOrganId, setSelectedOrganId] = useState(defaultOrganId);
  const [hlaWeight, setHlaWeight] = useState(40);
  const [urgencyWeight, setUrgencyWeight] = useState(35);
  const [distanceWeight, setDistanceWeight] = useState(25);
  const [isComputing, setIsComputing] = useState(false);
  const [reviewCandidate, setReviewCandidate] = useState(null);

  // Selected Organ object
  const selectedOrgan = useMemo(
    () => mockOrgans.find((o) => o.id === selectedOrganId),
    [selectedOrganId],
  );

  // Linked Donor object
  const linkedDonor = useMemo(() => {
    if (!selectedOrgan) return null;
    return mockDonors.find((d) => d.id === selectedOrgan.donorId) ?? null;
  }, [selectedOrgan]);

  // Dropdown options
  const organOptions = useMemo(
    () =>
      mockOrgans
        .filter((organ) => organ.status === 'Available')
        .map((organ) => ({
          value: organ.id,
          label: `${organ.id} (${organ.organType}, ${organ.bloodGroup})`,
        })),
    [],
  );

  // Calculate sum & normalized weights
  const totalWeight = hlaWeight + urgencyWeight + distanceWeight;
  const normalizedWeights = useMemo(() => {
    if (totalWeight === 0) return { hla: 0.333, urgency: 0.333, distance: 0.334 };
    return {
      hla: hlaWeight / totalWeight,
      urgency: urgencyWeight / totalWeight,
      distance: distanceWeight / totalWeight,
    };
  }, [hlaWeight, urgencyWeight, distanceWeight, totalWeight]);

  // Ranking calculation engine
  const rankingResult = useMemo(() => {
    if (!selectedOrgan) return { ranked: [], filteredOut: [] };

    const ranked = [];
    const filteredOut = [];

    mockRecipients.forEach((recipient) => {
      // Filter 1: Organ Type mismatch
      if (recipient.organNeeded !== selectedOrgan.organType) {
        filteredOut.push({
          recipient,
          reason: 'Organ Mismatch',
          detail: `Needs ${recipient.organNeeded}, available ${selectedOrgan.organType}`,
          badgeVariant: 'muted',
        });
        return;
      }

      // Filter 2: ABO Blood Group incompatibility
      if (!isAboCompatible(selectedOrgan.bloodGroup, recipient.bloodGroup)) {
        filteredOut.push({
          recipient,
          reason: 'ABO Incompatible',
          detail: `Donor ${selectedOrgan.bloodGroup} → Recipient ${recipient.bloodGroup}`,
          badgeVariant: 'danger',
        });
        return;
      }

      // Filter 3: Inactive or Transplanted status
      if (recipient.status === 'Transplanted') {
        filteredOut.push({
          recipient,
          reason: 'Already Transplanted',
          detail: 'Recipient has completed transplant',
          badgeVariant: 'completed',
        });
        return;
      }
      if (recipient.status === 'Inactive') {
        filteredOut.push({
          recipient,
          reason: 'Recipient Inactive',
          detail: 'Recipient record is currently inactive',
          badgeVariant: 'muted',
        });
        return;
      }

      // Calculate factor scores for eligible candidates
      const donorA = linkedDonor?.hlaA ?? 'A*02:01';
      const donorB = linkedDonor?.hlaB ?? 'B*07:02';
      const donorDR = linkedDonor?.hlaDR ?? 'DRB1*03:01';

      const recipA = recipient.hlaA ?? '';
      const recipB = recipient.hlaB ?? '';
      const recipDR = recipient.hlaDR ?? '';

      const matchA = donorA === recipA ? 1 : (recipA && donorA.slice(0, 4) === recipA.slice(0, 4)) ? 0.5 : 0;
      const matchB = donorB === recipB ? 1 : (recipB && donorB.slice(0, 4) === recipB.slice(0, 4)) ? 0.5 : 0;
      const matchDR = donorDR === recipDR ? 1 : (recipDR && donorDR.slice(0, 4) === recipDR.slice(0, 4)) ? 0.5 : 0;

      const hlaScore = Math.round(((matchA + matchB + matchDR) / 3) * 100);

      // Urgency score: 1A = 100, 1B = 75, 2 = 50
      const urgencyScore = recipient.urgency === '1A' ? 100 : recipient.urgency === '1B' ? 75 : 50;

      // Distance score
      const distInfo = getDistanceInfo(selectedOrgan.hospital, selectedOrgan.region, recipient.hospital);

      // Calculate weighted overall score
      const rawWeighted =
        hlaScore * normalizedWeights.hla +
        urgencyScore * normalizedWeights.urgency +
        distInfo.score * normalizedWeights.distance;

      // Blend with priority score for realistic 60-99% score distribution
      const overallScore = Math.min(
        99,
        Math.max(52, Math.round(rawWeighted * 0.75 + (recipient.priorityScore ?? 70) * 0.25)),
      );

      // Size match info
      const donorH = linkedDonor?.height ?? 170;
      const donorW = linkedDonor?.weight ?? 70;
      const recipH = recipient.height ?? 170;
      const recipW = recipient.weight ?? 70;
      const hDiff = Math.abs(donorH - recipH);
      const wDiff = Math.abs(donorW - recipW);
      const sizeStatus = hDiff <= 15 && wDiff <= 15 ? 'Optimal Match' : 'Acceptable';

      ranked.push({
        recipient,
        overallScore,
        hlaScore,
        urgencyScore,
        distInfo,
        sizeStatus,
        matchDetails: {
          matchA: matchA === 1 ? 'Exact Match' : matchA > 0 ? 'Partial Match' : 'Mismatch',
          matchB: matchB === 1 ? 'Exact Match' : matchB > 0 ? 'Partial Match' : 'Mismatch',
          matchDR: matchDR === 1 ? 'Exact Match' : matchDR > 0 ? 'Partial Match' : 'Mismatch',
        },
      });
    });

    // Sort descending by overall score
    ranked.sort((a, b) => b.overallScore - a.overallScore);

    return { ranked, filteredOut };
  }, [selectedOrgan, linkedDonor, normalizedWeights]);

  // Handle Run Match button click
  function handleRunMatch() {
    setIsComputing(true);
    setTimeout(() => {
      setIsComputing(false);
    }, 350);
  }

  // Handle Create Offer action
  function handleCreateOffer(recipientId) {
    if (!selectedOrgan) return;
    navigate('/offers', {
      state: {
        organId: selectedOrgan.id,
        recipientId,
      },
    });
  }

  const viabilityRemaining = selectedOrgan
    ? selectedOrgan.viabilityHours - selectedOrgan.elapsedHours
    : 0;

  return (
    <Stack gap="lg" className="page-fade-in">
      {/* Header Bar */}
      <Group justify="space-between" align="center">
        <div>
          <Title order={2} c="var(--text-primary)">
            Matching Console
          </Title>
          <Text c="var(--text-secondary)" size="sm">
            Run automated compatibility & urgency algorithms for organ allocation
          </Text>
        </div>

        {selectedOrgan ? (
          <Group gap="xs">
            <Badge variant="outline" color="var(--color-primary)" radius="sm" className="mono">
              Organ: {selectedOrgan.id}
            </Badge>
            <StatusBadge status={selectedOrgan.status} />
          </Group>
        ) : null}
      </Group>

      {/* Main Two-Panel Layout */}
      <div className="matching-layout">
        {/* Left Panel: Match Configuration */}
        <section className="neu-raised matching-panel-left" aria-label="Matching Algorithm Configuration">
          <Group gap="xs" align="center">
            <IconAdjustments size={22} color="var(--color-primary)" />
            <Title order={3} style={{ fontSize: 18, fontWeight: 600 }}>
              Matching Algorithm
            </Title>
          </Group>

          {/* Section 1: Select Organ */}
          <Stack gap="xs">
            <Text fw={600} size="sm" c="var(--text-primary)">
              Select Organ for Allocation
            </Text>
            <Select
              data={organOptions}
              value={selectedOrganId}
              onChange={(val) => val && setSelectedOrganId(val)}
              className="neu-inset"
              aria-label="Select Organ for Allocation"
              placeholder="Choose an organ..."
              comboboxProps={{ shadow: 'md' }}
            />
          </Stack>

          {/* Linked Donor Info Card */}
          {selectedOrgan ? (
            <div className="donor-info-card">
              <Group justify="space-between" mb="xs">
                <Text size="xs" fw={700} c="var(--color-primary)" style={{ letterSpacing: 0.5 }}>
                  DONOR & ORGAN SPECIFICATION
                </Text>
                <Badge size="xs" color="var(--color-primary)" variant="light">
                  {selectedOrgan.organType}
                </Badge>
              </Group>

              <div className="donor-info-grid">
                <div className="donor-info-item">
                  <span className="donor-info-label">Donor ID</span>
                  <span className="donor-info-value mono">{selectedOrgan.donorId}</span>
                </div>
                <div className="donor-info-item">
                  <span className="donor-info-label">Blood Group</span>
                  <span className="donor-info-value mono">{selectedOrgan.bloodGroup}</span>
                </div>
                <div className="donor-info-item">
                  <span className="donor-info-label">Hospital</span>
                  <span className="donor-info-value">{selectedOrgan.hospital}</span>
                </div>
                <div className="donor-info-item">
                  <span className="donor-info-label">Region</span>
                  <span className="donor-info-value">{selectedOrgan.region}</span>
                </div>
                <div className="donor-info-item" style={{ gridColumn: 'span 2' }}>
                  <span className="donor-info-label">HLA Alleles</span>
                  <span className="donor-info-value mono" style={{ fontSize: 12 }}>
                    {linkedDonor ? `${linkedDonor.hlaA} | ${linkedDonor.hlaB} | ${linkedDonor.hlaDR}` : 'A*02:01 | B*07:02 | DRB1*03:01'}
                  </span>
                </div>
                <div className="donor-info-item" style={{ gridColumn: 'span 2' }}>
                  <span className="donor-info-label">Viability Remaining</span>
                  <Group gap="xs" align="center" mt={2}>
                    <Progress
                      value={(viabilityRemaining / selectedOrgan.viabilityHours) * 100}
                      color={viabilityRemaining < 3 ? 'var(--color-danger)' : 'var(--color-primary)'}
                      size="sm"
                      style={{ flex: 1 }}
                      radius="xl"
                    />
                    <Text size="xs" fw={700} className="mono" c={viabilityRemaining < 3 ? 'var(--color-danger)' : 'var(--color-primary)'}>
                      {viabilityRemaining}h / {selectedOrgan.viabilityHours}h
                    </Text>
                  </Group>
                </div>
              </div>
            </div>
          ) : (
            <Paper p="md" radius="md" style={{ background: 'var(--bg-base)' }}>
              <Text size="sm" c="var(--text-muted)">
                No organ selected. Please choose an organ from the dropdown above.
              </Text>
            </Paper>
          )}

          {/* Section 2: Algorithm Parameters */}
          <Stack gap="md">
            <Group justify="space-between" align="center">
              <Text fw={600} size="sm" c="var(--text-primary)">
                Algorithm Weights
              </Text>
              <Text size="xs" c="var(--text-muted)" className="mono">
                Sum: {totalWeight}% {totalWeight !== 100 ? `(Normalized)` : ''}
              </Text>
            </Group>

            {/* Visual Weight Distribution Bar */}
            <div className="weight-summary-bar" title="Weight distribution: HLA / Urgency / Distance">
              <div
                className="weight-segment-hla"
                style={{ width: `${normalizedWeights.hla * 100}%` }}
              />
              <div
                className="weight-segment-urgency"
                style={{ width: `${normalizedWeights.urgency * 100}%` }}
              />
              <div
                className="weight-segment-distance"
                style={{ width: `${normalizedWeights.distance * 100}%` }}
              />
            </div>

            <div className="slider-group">
              {/* HLA Weight Slider */}
              <div className="slider-item">
                <div className="slider-header">
                  <Text size="sm" c="var(--text-secondary)">HLA Compatibility Weight</Text>
                  <Text size="sm" fw={700} className="mono" c="var(--color-primary)">{hlaWeight}%</Text>
                </div>
                <Slider
                  value={hlaWeight}
                  onChange={setHlaWeight}
                  min={0}
                  max={100}
                  step={5}
                  color="var(--color-primary)"
                  aria-label="HLA Weight Slider"
                  thumbSize={20}
                />
              </div>

              {/* Urgency Weight Slider */}
              <div className="slider-item">
                <div className="slider-header">
                  <Text size="sm" c="var(--text-secondary)">Medical Urgency Weight</Text>
                  <Text size="sm" fw={700} className="mono" c="var(--color-warning)">{urgencyWeight}%</Text>
                </div>
                <Slider
                  value={urgencyWeight}
                  onChange={setUrgencyWeight}
                  min={0}
                  max={100}
                  step={5}
                  color="var(--color-warning)"
                  aria-label="Urgency Weight Slider"
                  thumbSize={20}
                />
              </div>

              {/* Distance Weight Slider */}
              <div className="slider-item">
                <div className="slider-header">
                  <Text size="sm" c="var(--text-secondary)">Geographic Proximity Weight</Text>
                  <Text size="sm" fw={700} className="mono" c="var(--color-info)">{distanceWeight}%</Text>
                </div>
                <Slider
                  value={distanceWeight}
                  onChange={setDistanceWeight}
                  min={0}
                  max={100}
                  step={5}
                  color="var(--color-info)"
                  aria-label="Distance Weight Slider"
                  thumbSize={20}
                />
              </div>
            </div>
          </Stack>

          {/* Section 3: Run Match Button */}
          <Button
            fullWidth
            h={48}
            className="neu-button"
            onClick={handleRunMatch}
            loading={isComputing}
            loaderProps={{ type: 'dots' }}
            style={{
              background: 'var(--color-primary)',
              borderRadius: 'var(--radius-button)',
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            {isComputing ? 'Computing matches...' : 'Run Match'}
          </Button>
        </section>

        {/* Right Panel: Ranked Candidate Results */}
        <section className="matching-panel-right" aria-label="Ranked Match Candidates">
          <Group justify="space-between" align="center">
            <Group gap="xs">
              <IconDna size={22} color="var(--color-primary)" />
              <Title order={3} style={{ fontSize: 18, fontWeight: 600 }}>
                Ranked Match Candidates
              </Title>
            </Group>

            <Badge variant="light" color="var(--color-primary)" radius="sm">
              {rankingResult.ranked.length} Eligible Candidates
            </Badge>
          </Group>

          {/* Candidates List */}
          {isComputing ? (
            <Card className="neu-raised" p="xl" style={{ textAlign: 'center' }}>
              <Stack align="center" gap="md">
                <Loader color="var(--color-primary)" size="lg" />
                <Text c="var(--text-secondary)">
                  Computing optimal allocation matches across HLA profiles and urgency scores...
                </Text>
              </Stack>
            </Card>
          ) : rankingResult.ranked.length > 0 ? (
            <Stack gap="md">
              {rankingResult.ranked.map((item, index) => {
                const rankNum = index + 1;
                const isTopCandidate = rankNum === 1;

                return (
                  <article
                    key={item.recipient.id}
                    className="candidate-card stagger-in"
                    style={{ '--stagger-index': index }}
                  >
                    {/* Rank Number */}
                    <div className="candidate-rank">#{rankNum}</div>

                    {/* Main Info */}
                    <div className="candidate-main">
                      <div className="candidate-top">
                        <Text fw={700} size="md" c="var(--text-primary)">
                          {item.recipient.name}
                        </Text>
                        <span className="mono">{item.recipient.id}</span>
                        <StatusBadge status={item.recipient.urgency} />
                        <Badge size="xs" variant="outline" color="gray">
                          ABO: {item.recipient.bloodGroup}
                        </Badge>
                        {isTopCandidate ? (
                          <Badge size="xs" color="var(--color-success)" variant="filled">
                            TOP MATCH
                          </Badge>
                        ) : null}
                      </div>

                      <div className="candidate-details">
                        <Group gap={4}>
                          <IconBuildingHospital size={14} color="var(--text-muted)" />
                          <span>{item.recipient.hospital}</span>
                        </Group>

                        <Group gap={4} className="distance-badge">
                          <IconMapPin size={14} color="var(--color-primary)" />
                          <span>{item.distInfo.miles} Mi ({item.distInfo.category})</span>
                        </Group>

                        <Group gap={4}>
                          <IconClock size={14} color="var(--text-muted)" />
                          <span>Wait: {item.recipient.waitTime}</span>
                        </Group>

                        <Group gap={4}>
                          <IconCheck size={14} color="var(--color-success)" />
                          <span>Body Size: {item.sizeStatus}</span>
                        </Group>
                      </div>

                      {/* Proximity / Progress Bar */}
                      <Group gap="xs" align="center" mt={4}>
                        <Text size="xs" c="var(--text-muted)" style={{ minWidth: 90 }}>
                          Distance Score:
                        </Text>
                        <Progress
                          value={item.distInfo.progressValue}
                          color="var(--color-info)"
                          size="xs"
                          style={{ flex: 1, maxWidth: 160 }}
                          radius="xl"
                        />
                        <Text size="xs" className="mono" c="var(--text-secondary)">
                          {item.distInfo.score}/100
                        </Text>
                      </Group>

                      {/* Expandable Accordion Score Explanation */}
                      <Accordion variant="contained" radius="md" mt="xs">
                        <Accordion.Item value="score-breakdown">
                          <Accordion.Control style={{ padding: '4px 10px', fontSize: 12 }}>
                            <Text size="xs" fw={600} c="var(--color-primary)">
                              Show Detailed Match Factors & HLA Profile
                            </Text>
                          </Accordion.Control>
                          <Accordion.Panel>
                            <Grid gap="xs" p="xs" style={{ fontSize: 12 }}>
                              <Grid.Col span={6}>
                                <Text size="xs" fw={700} c="var(--text-muted)">HLA MATCH DETAILS</Text>
                                <Text size="xs" className="mono">HLA-A: {item.matchDetails.matchA} ({item.recipient.hlaA})</Text>
                                <Text size="xs" className="mono">HLA-B: {item.matchDetails.matchB} ({item.recipient.hlaB})</Text>
                                <Text size="xs" className="mono">HLA-DR: {item.matchDetails.matchDR} ({item.recipient.hlaDR})</Text>
                              </Grid.Col>

                              <Grid.Col span={6}>
                                <Text size="xs" fw={700} c="var(--text-muted)">WEIGHTED FACTORS</Text>
                                <Text size="xs">HLA Score: <span className="mono">{item.hlaScore}/100</span></Text>
                                <Text size="xs">Urgency Score: <span className="mono">{item.urgencyScore}/100</span></Text>
                                <Text size="xs">Distance Score: <span className="mono">{item.distInfo.score}/100</span></Text>
                                <Text size="xs">Waitlist Priority: <span className="mono">{item.recipient.priorityScore}/100</span></Text>
                              </Grid.Col>
                            </Grid>
                          </Accordion.Panel>
                        </Accordion.Item>
                      </Accordion>
                    </div>

                    {/* Circular Match Score Visualization */}
                    <div style={{ padding: '0 8px' }}>
                      <CircularProgress value={item.overallScore} label="Match Score" />
                    </div>

                    {/* Actions */}
                    <div className="candidate-actions">
                      <Button
                        size="xs"
                        variant="subtle"
                        color="var(--color-primary)"
                        onClick={() => setReviewCandidate(item)}
                        rightSection={<IconArrowRight size={14} />}
                      >
                        Review →
                      </Button>

                      {isTopCandidate ? (
                        <Button
                          size="xs"
                          color="var(--color-primary)"
                          onClick={() => handleCreateOffer(item.recipient.id)}
                          leftSection={<IconUserCheck size={14} />}
                        >
                          Create Offer
                        </Button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </Stack>
          ) : (
            <Card className="neu-raised" p="xl" style={{ textAlign: 'center' }}>
              <Stack align="center" gap="sm">
                <IconAlertCircle size={40} color="var(--color-warning)" />
                <Title order={4}>No Compatible Candidates Found</Title>
                <Text size="sm" c="var(--text-secondary)">
                  All waitlist candidates were filtered out due to organ type mismatch, blood group incompatibility, or inactive status.
                </Text>
              </Stack>
            </Card>
          )}

          {/* Filtered-Out Candidates Accordion */}
          {rankingResult.filteredOut.length > 0 ? (
            <Accordion variant="separated" radius="lg" className="filtered-out-accordion">
              <Accordion.Item value="filtered-out">
                <Accordion.Control>
                  <Group justify="space-between">
                    <Text size="sm" fw={600}>
                      {rankingResult.filteredOut.length} Candidates Filtered Out
                    </Text>
                    <Badge size="xs" color="gray" variant="light">
                      Exclusions
                    </Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap={0}>
                    {rankingResult.filteredOut.map((excluded) => (
                      <div key={excluded.recipient.id} className="filtered-out-row">
                        <Group gap="xs">
                          <Text size="sm" fw={600}>
                            {excluded.recipient.name}
                          </Text>
                          <span className="mono">{excluded.recipient.id}</span>
                          <Text size="xs" c="var(--text-muted)">
                            ({excluded.recipient.organNeeded}, ABO: {excluded.recipient.bloodGroup})
                          </Text>
                        </Group>

                        <Group gap="xs">
                          <Text size="xs" c="var(--text-secondary)">
                            {excluded.detail}
                          </Text>
                          <Badge size="xs" color={excluded.badgeVariant === 'danger' ? 'var(--color-danger)' : 'gray'}>
                            {excluded.reason}
                          </Badge>
                        </Group>
                      </div>
                    ))}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          ) : null}
        </section>
      </div>

      {/* Candidate Review Detail Modal */}
      {reviewCandidate ? (
        <Modal
          opened={!!reviewCandidate}
          onClose={() => setReviewCandidate(null)}
          title={`Candidate Compatibility Review — ${reviewCandidate.recipient.name}`}
          size="lg"
          radius="lg"
          padding="xl"
          overlayProps={{ blur: 4, opacity: 0.3 }}
        >
          <Stack gap="md">
            <Group justify="space-between">
              <div>
                <Text size="xs" c="var(--text-muted)" className="mono">RECIPIENT ID</Text>
                <Title order={3} className="mono" c="var(--color-primary)">
                  {reviewCandidate.recipient.id}
                </Title>
              </div>

              <CircularProgress value={reviewCandidate.overallScore} label="Overall Match" />
            </Group>

            <Paper p="md" radius="md" style={{ background: 'var(--bg-base)' }}>
              <Grid gap="md">
                <Grid.Col span={6}>
                  <Text size="xs" fw={700} c="var(--text-muted)">RECIPIENT CLINICAL DATA</Text>
                  <Text size="sm">Name: <strong>{reviewCandidate.recipient.name}</strong></Text>
                  <Text size="sm">Organ Needed: <strong>{reviewCandidate.recipient.organNeeded}</strong></Text>
                  <Text size="sm">Blood Group: <strong className="mono">{reviewCandidate.recipient.bloodGroup}</strong></Text>
                  <Text size="sm">Hospital: <strong>{reviewCandidate.recipient.hospital}</strong></Text>
                  <Text size="sm">Wait Time: <strong>{reviewCandidate.recipient.waitTime}</strong></Text>
                </Grid.Col>

                <Grid.Col span={6}>
                  <Text size="xs" fw={700} c="var(--text-muted)">DONOR ORGAN SPEC</Text>
                  <Text size="sm">Organ ID: <strong className="mono">{selectedOrgan?.id}</strong></Text>
                  <Text size="sm">Type: <strong>{selectedOrgan?.organType}</strong></Text>
                  <Text size="sm">Donor Blood: <strong className="mono">{selectedOrgan?.bloodGroup}</strong></Text>
                  <Text size="sm">Hospital: <strong>{selectedOrgan?.hospital}</strong></Text>
                  <Text size="sm">Viability: <strong className="mono">{viabilityRemaining} hrs remaining</strong></Text>
                </Grid.Col>
              </Grid>
            </Paper>

            <Title order={4} style={{ fontSize: 15, fontWeight: 600 }}>
              Compatibility Score Breakdown
            </Title>

            <Stack gap="xs">
              <div>
                <Group justify="space-between" mb={2}>
                  <Text size="xs" fw={600}>HLA Allele Match ({reviewCandidate.hlaScore}%)</Text>
                  <Text size="xs" className="mono">{reviewCandidate.hlaScore}/100</Text>
                </Group>
                <Progress value={reviewCandidate.hlaScore} color="var(--color-primary)" radius="xl" />
              </div>

              <div>
                <Group justify="space-between" mb={2}>
                  <Text size="xs" fw={600}>Medical Urgency ({reviewCandidate.urgencyScore}%)</Text>
                  <Text size="xs" className="mono">{reviewCandidate.urgencyScore}/100</Text>
                </Group>
                <Progress value={reviewCandidate.urgencyScore} color="var(--color-warning)" radius="xl" />
              </div>

              <div>
                <Group justify="space-between" mb={2}>
                  <Text size="xs" fw={600}>Geographic Proximity ({reviewCandidate.distInfo.score}%)</Text>
                  <Text size="xs" className="mono">{reviewCandidate.distInfo.score}/100</Text>
                </Group>
                <Progress value={reviewCandidate.distInfo.score} color="var(--color-info)" radius="xl" />
              </div>
            </Stack>

            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={() => setReviewCandidate(null)}>
                Close
              </Button>

              <Button
                color="var(--color-primary)"
                onClick={() => {
                  const rId = reviewCandidate.recipient.id;
                  setReviewCandidate(null);
                  handleCreateOffer(rId);
                }}
                leftSection={<IconUserCheck size={16} />}
              >
                Create Offer for {reviewCandidate.recipient.id}
              </Button>
            </Group>
          </Stack>
        </Modal>
      ) : null}
    </Stack>
  );
}

