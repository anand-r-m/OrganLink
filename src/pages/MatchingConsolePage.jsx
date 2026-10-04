import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  IconDna,
  IconMapPin,
  IconRefresh,
  IconUserCheck,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';

import CircularProgress from '../components/CircularProgress.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

import { getDefaultWeights, getLatestRun, runMatch } from '../api/matching.js';
import { runLabel } from '../api/adapters/matching.js';
import { showApiError } from '../api/notify.js';
import { createOffer } from '../api/offers.js';
import { listOrgans } from '../api/organs.js';

// Weight sliders: key, label, colour (06 Stage 3; the fourth slider is Waiting Time).
const SLIDERS = [
  { key: 'hla', label: 'HLA Compatibility Weight', color: 'var(--color-primary)', segment: 'weight-segment-hla' },
  { key: 'urgency', label: 'Medical Urgency Weight', color: 'var(--color-warning)', segment: 'weight-segment-urgency' },
  { key: 'distance', label: 'Geographic Proximity Weight', color: 'var(--color-info)', segment: 'weight-segment-distance' },
  { key: 'wait', label: 'Waiting Time Weight', color: 'var(--color-success)', segment: 'weight-segment-wait' },
];

// Only AVAILABLE, unexpired organs can be matched; the rest are listed but disabled.
const isMatchable = (o) => o.status === 'AVAILABLE' && !o.isExpired;
const organKey = (o) => String(o.dbId ?? o.id);
const organLabel = (o) => {
  const suffix = o.isExpired || o.status === 'EXPIRED' ? ' - Expired' : o.status === 'AVAILABLE' ? '' : ` - ${o.status.charAt(0)}${o.status.slice(1).toLowerCase()}`;
  return `${o.id} (${o.organType}, ${o.bloodGroup})${suffix}`;
};

const ACTIVE_OFFER_TOOLTIP = 'This organ already has an active offer';
const DECLINED_TOOLTIP = 'This recipient has already declined this organ';

const fmtScore = (n) => (n === null || n === undefined ? '—' : Number(n).toFixed(1));

export default function MatchingConsolePage() {
  const [organs, setOrgans] = useState([]);
  const [organsLoading, setOrgansLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState(null);
  const [weights, setWeights] = useState({ hla: 0, urgency: 0, distance: 0, wait: 0 });
  const [run, setRun] = useState(null);
  const [isComputing, setIsComputing] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [reviewCandidate, setReviewCandidate] = useState(null);
  const [creatingFor, setCreatingFor] = useState(null);
  // Ignores responses for an organ that is no longer selected.
  const selectionToken = useRef(0);

  // The dropdown comes from /api/organs; expired organs stay listed but disabled.
  useEffect(() => {
    let cancelled = false;
    listOrgans()
      .then((rows) => {
        if (cancelled) return;
        setOrgans(rows);
        const first = rows.find(isMatchable);
        if (first) setSelectedKey(organKey(first));
      })
      .catch((err) => !cancelled && showApiError(err, 'Could not load organs'))
      .finally(() => !cancelled && setOrgansLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedOrgan = useMemo(() => organs.find((o) => organKey(o) === selectedKey) ?? null, [organs, selectedKey]);

  // On organ change: preset sliders to the organ's regional weights and load its latest saved run.
  useEffect(() => {
    if (!selectedOrgan) return;
    const token = ++selectionToken.current;
    setRun(null);
    setRunLoading(true);
    Promise.all([getDefaultWeights(selectedOrgan), getLatestRun(selectedOrgan)])
      .then(([defaults, latest]) => {
        if (token !== selectionToken.current) return;
        setWeights(defaults);
        setRun(latest);
      })
      .catch((err) => token === selectionToken.current && showApiError(err, 'Could not load matching data'))
      .finally(() => token === selectionToken.current && setRunLoading(false));
    // Keyed on the selection: refreshing the organ list after an offer must not reset weights or run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const totalWeight = weights.hla + weights.urgency + weights.distance + weights.wait;
  const canRun = !!selectedOrgan && isMatchable(selectedOrgan) && totalWeight > 0 && !isComputing;

  const handleRunMatch = useCallback(async () => {
    if (!selectedOrgan) return;
    const token = selectionToken.current;
    setIsComputing(true);
    try {
      const result = await runMatch(selectedOrgan, weights);
      if (token === selectionToken.current) setRun(result);
    } catch (err) {
      showApiError(err, 'Match run failed');
    } finally {
      setIsComputing(false);
    }
  }, [selectedOrgan, weights]);

  // Why Create Offer is disabled for a candidate, or null when it is allowed (07 §6).
  const offerBlockReason = (candidate) => {
    if (selectedOrgan?.hasActiveOffer) return ACTIVE_OFFER_TOOLTIP;
    if (candidate.offerStatus === 'DECLINED') return DECLINED_TOOLTIP;
    return null;
  };

  async function handleCreateOffer(candidate) {
    if (!selectedOrgan || !run) return;
    setCreatingFor(candidate.key);
    try {
      const offer = await createOffer({ organ: selectedOrgan, candidate, run });
      notifications.show({
        title: 'Offer created',
        message: `${offer.id} created for ${candidate.recipient} (rank ${candidate.rank})`,
        color: 'green',
      });
      setRun((r) =>
        r && { ...r, qualified: r.qualified.map((q) => (q.key === candidate.key ? { ...q, offerStatus: offer.status } : q)) },
      );
    } catch (err) {
      showApiError(err, 'Could not create offer');
    } finally {
      setCreatingFor(null);
      // Success or failure (e.g. 409 on a stale view), re-read the organs so the button state is current.
      listOrgans().then(setOrgans).catch(() => {});
    }
  }

  const organOptions = useMemo(
    () => organs.map((o) => ({ value: organKey(o), label: organLabel(o), disabled: !isMatchable(o) })),
    [organs],
  );

  const qualified = run?.qualified ?? [];
  const excluded = run?.excluded ?? [];
  const viabilityRemaining = selectedOrgan ? Math.max(0, selectedOrgan.viabilityHours - selectedOrgan.elapsedHours) : 0;
  const pct = (k) => (totalWeight === 0 ? 25 : (weights[k] / totalWeight) * 100);

  return (
    <Stack gap="lg" className="page-fade-in">
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

      <div className="matching-layout">
        <section className="neu-raised matching-panel-left" aria-label="Matching Algorithm Configuration">
          <Group gap="xs" align="center">
            <IconAdjustments size={22} color="var(--color-primary)" />
            <Title order={3} style={{ fontSize: 18, fontWeight: 600 }}>
              Matching Algorithm
            </Title>
          </Group>

          <Stack gap="xs">
            <Text fw={600} size="sm" c="var(--text-primary)">
              Select Organ for Allocation
            </Text>
            <Select
              data={organOptions}
              value={selectedKey}
              onChange={(val) => val && setSelectedKey(val)}
              className="neu-inset"
              aria-label="Select Organ for Allocation"
              placeholder={organsLoading ? 'Loading organs...' : 'Choose an organ...'}
              nothingFoundMessage="No organs"
              comboboxProps={{ shadow: 'md' }}
            />
          </Stack>

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
                  <span className="donor-info-value mono">{selectedOrgan.donor}</span>
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
                      {viabilityRemaining.toFixed(1).replace(/\.0$/, '')}h / {selectedOrgan.viabilityHours}h
                    </Text>
                  </Group>
                </div>
              </div>
            </div>
          ) : (
            <Paper p="md" radius="md" style={{ background: 'var(--bg-base)' }}>
              <Text size="sm" c="var(--text-muted)">
                {organsLoading ? 'Loading organs...' : 'No available organs. Procure an organ from a donor first.'}
              </Text>
            </Paper>
          )}

          <Stack gap="md">
            <Group justify="space-between" align="center">
              <Text fw={600} size="sm" c="var(--text-primary)">
                Algorithm Weights
              </Text>
              <Text size="xs" c="var(--text-muted)" className="mono">
                Sum: {totalWeight}% {totalWeight !== 100 ? '(Normalized)' : ''}
              </Text>
            </Group>

            <div className="weight-summary-bar" title="Weight distribution: HLA / Urgency / Distance / Waiting Time">
              {SLIDERS.map((s) => (
                <div key={s.key} className={s.segment} style={{ width: `${pct(s.key)}%` }} />
              ))}
            </div>

            <div className="slider-group">
              {SLIDERS.map((s) => (
                <div className="slider-item" key={s.key}>
                  <div className="slider-header">
                    <Text size="sm" c="var(--text-secondary)">{s.label}</Text>
                    <Text size="sm" fw={700} className="mono" c={s.color}>{weights[s.key]}%</Text>
                  </div>
                  <Slider
                    value={weights[s.key]}
                    onChange={(v) => setWeights((w) => ({ ...w, [s.key]: v }))}
                    min={0}
                    max={100}
                    step={5}
                    color={s.color}
                    aria-label={`${s.label.replace(' Weight', '')} Weight Slider`}
                    thumbSize={20}
                  />
                </div>
              ))}
            </div>
            {totalWeight === 0 ? (
              <Text size="xs" c="var(--color-danger)">At least one weight must be greater than zero.</Text>
            ) : null}
          </Stack>

          <Button
            fullWidth
            h={48}
            className="neu-button"
            onClick={handleRunMatch}
            loading={isComputing}
            disabled={!canRun}
            loaderProps={{ type: 'dots' }}
            style={{
              background: canRun || isComputing ? 'var(--color-primary)' : undefined,
              borderRadius: 'var(--radius-button)',
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            {isComputing ? 'Computing matches...' : 'Run Match'}
          </Button>
        </section>

        <section className="matching-panel-right" aria-label="Ranked Match Candidates">
          <Group justify="space-between" align="center">
            <Group gap="xs">
              <IconDna size={22} color="var(--color-primary)" />
              <Title order={3} style={{ fontSize: 18, fontWeight: 600 }}>
                Ranked Match Candidates
              </Title>
            </Group>

            <Group gap="xs">
              {run ? (
                <>
                  <Text size="xs" className="mono" c="var(--text-secondary)" data-testid="run-label">
                    {runLabel(run)}
                  </Text>
                  <Button
                    size="xs"
                    variant="light"
                    color="var(--color-primary)"
                    leftSection={<IconRefresh size={14} />}
                    onClick={handleRunMatch}
                    disabled={!canRun}
                  >
                    Re-run Match
                  </Button>
                </>
              ) : null}
              <Badge variant="light" color="var(--color-primary)" radius="sm">
                {qualified.length} Eligible Candidates
              </Badge>
            </Group>
          </Group>

          {isComputing || runLoading ? (
            <Card className="neu-raised" p="xl" style={{ textAlign: 'center' }}>
              <Stack align="center" gap="md">
                <Loader color="var(--color-primary)" size="lg" />
                <Text c="var(--text-secondary)">
                  {isComputing
                    ? 'Computing optimal allocation matches across HLA profiles and urgency scores...'
                    : 'Loading latest match run...'}
                </Text>
              </Stack>
            </Card>
          ) : !run ? (
            <Card className="neu-raised" p="xl" style={{ textAlign: 'center' }}>
              <Stack align="center" gap="sm">
                <IconDna size={40} color="var(--color-primary)" />
                <Title order={4}>No match run yet</Title>
                <Text size="sm" c="var(--text-secondary)">
                  Adjust the weights and click Run Match to rank the waitlist for this organ.
                </Text>
              </Stack>
            </Card>
          ) : qualified.length > 0 ? (
            <Stack gap="md">
              {qualified.map((item, index) => (
                <article key={item.key} className="candidate-card stagger-in" style={{ '--stagger-index': index }}>
                  <div className="candidate-rank">#{item.rank}</div>

                  <div className="candidate-main">
                    <div className="candidate-top">
                      <Text fw={700} size="md" c="var(--text-primary)">
                        {item.name}
                      </Text>
                      <span className="mono">{item.recipient}</span>
                      <Badge size="xs" variant="outline" color="gray">
                        ABO: {item.bloodGroup}
                      </Badge>
                      {item.rank === 1 ? (
                        <Badge size="xs" color="var(--color-success)" variant="filled">
                          TOP MATCH
                        </Badge>
                      ) : null}
                      {item.offerStatus ? <StatusBadge status={item.offerStatus} /> : null}
                    </div>

                    <div className="candidate-details">
                      <Group gap={4}>
                        <IconBuildingHospital size={14} color="var(--text-muted)" />
                        <span>{item.hospital}</span>
                      </Group>
                      <Group gap={4} className="distance-badge">
                        <IconMapPin size={14} color="var(--color-primary)" />
                        <span>{Math.round(item.distanceKm)} km</span>
                      </Group>
                    </div>

                    <Group gap="xs" align="center" mt={4}>
                      <Text size="xs" c="var(--text-muted)" style={{ minWidth: 90 }}>
                        Distance Score:
                      </Text>
                      <Progress value={item.distanceScore} color="var(--color-info)" size="xs" style={{ flex: 1, maxWidth: 160 }} radius="xl" />
                      <Text size="xs" className="mono" c="var(--text-secondary)">
                        {fmtScore(item.distanceScore)}/100
                      </Text>
                    </Group>

                    <Accordion variant="contained" radius="md" mt="xs">
                      <Accordion.Item value="score-breakdown">
                        <Accordion.Control style={{ padding: '4px 10px', fontSize: 12 }}>
                          <Text size="xs" fw={600} c="var(--color-primary)">
                            Show Detailed Match Factors
                          </Text>
                        </Accordion.Control>
                        <Accordion.Panel>
                          <Grid gap="xs" p="xs" style={{ fontSize: 12 }}>
                            <Grid.Col span={12}>
                              <Text size="xs" fw={700} c="var(--text-muted)">WEIGHTED FACTORS</Text>
                              <Text size="xs">HLA Score: <span className="mono">{fmtScore(item.hlaScore)}/100</span></Text>
                              <Text size="xs">Urgency Score: <span className="mono">{fmtScore(item.urgencyScore)}/100</span></Text>
                              <Text size="xs">Distance Score: <span className="mono">{fmtScore(item.distanceScore)}/100</span></Text>
                              <Text size="xs">Waiting Time Score: <span className="mono">{fmtScore(item.waitScore)}/100</span></Text>
                            </Grid.Col>
                          </Grid>
                        </Accordion.Panel>
                      </Accordion.Item>
                    </Accordion>
                  </div>

                  <div style={{ padding: '0 8px' }}>
                    <CircularProgress value={item.matchScore} label="Match Score" />
                  </div>

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

                    <Tooltip label={offerBlockReason(item)} disabled={!offerBlockReason(item)} withArrow>
                      {/* The wrapper receives hover; a disabled button does not. */}
                      <span>
                        <Button
                          size="xs"
                          color="var(--color-primary)"
                          onClick={() => handleCreateOffer(item)}
                          loading={creatingFor === item.key}
                          disabled={!!offerBlockReason(item) || creatingFor !== null}
                          leftSection={<IconUserCheck size={14} />}
                        >
                          Create Offer
                        </Button>
                      </span>
                    </Tooltip>
                  </div>
                </article>
              ))}
            </Stack>
          ) : (
            <Card className="neu-raised" p="xl" style={{ textAlign: 'center' }}>
              <Stack align="center" gap="sm">
                <IconAlertCircle size={40} color="var(--color-warning)" />
                <Title order={4}>No Compatible Candidates Found</Title>
                <Text size="sm" c="var(--text-secondary)">
                  Every waitlist candidate for this organ was excluded. See the reasons below.
                </Text>
              </Stack>
            </Card>
          )}

          {run && excluded.length > 0 ? (
            <Accordion variant="separated" radius="lg" className="filtered-out-accordion">
              <Accordion.Item value="filtered-out">
                <Accordion.Control>
                  <Group justify="space-between">
                    <Text size="sm" fw={600}>
                      {excluded.length} Candidates Excluded
                    </Text>
                    <Badge size="xs" color="gray" variant="light">
                      Exclusions
                    </Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap={0}>
                    {excluded.map((e) => (
                      <div key={e.key} className="filtered-out-row">
                        <Group gap="xs">
                          <Text size="sm" fw={600}>
                            {e.name}
                          </Text>
                          <span className="mono">{e.recipient}</span>
                          <Text size="xs" c="var(--text-muted)">
                            (ABO: {e.bloodGroup}, {e.hospital})
                          </Text>
                        </Group>

                        <Group gap="xs">
                          <Text size="xs" c="var(--text-secondary)">
                            {e.description}
                          </Text>
                          <Badge size="xs" color={e.code === 'ABO_INCOMPATIBLE' ? 'var(--color-danger)' : 'gray'}>
                            {e.code}
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

      {reviewCandidate ? (
        <Modal
          opened={!!reviewCandidate}
          onClose={() => setReviewCandidate(null)}
          title={`Candidate Compatibility Review — ${reviewCandidate.name}`}
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
                  {reviewCandidate.recipient}
                </Title>
              </div>
              <CircularProgress value={reviewCandidate.matchScore} label="Overall Match" />
            </Group>

            <Paper p="md" radius="md" style={{ background: 'var(--bg-base)' }}>
              <Grid gap="md">
                <Grid.Col span={6}>
                  <Text size="xs" fw={700} c="var(--text-muted)">RECIPIENT</Text>
                  <Text size="sm">Name: <strong>{reviewCandidate.name}</strong></Text>
                  <Text size="sm">Blood Group: <strong className="mono">{reviewCandidate.bloodGroup}</strong></Text>
                  <Text size="sm">Hospital: <strong>{reviewCandidate.hospital}</strong></Text>
                  <Text size="sm">Distance: <strong className="mono">{Math.round(reviewCandidate.distanceKm)} km</strong></Text>
                </Grid.Col>

                <Grid.Col span={6}>
                  <Text size="xs" fw={700} c="var(--text-muted)">DONOR ORGAN</Text>
                  <Text size="sm">Organ ID: <strong className="mono">{selectedOrgan?.id}</strong></Text>
                  <Text size="sm">Type: <strong>{selectedOrgan?.organType}</strong></Text>
                  <Text size="sm">Donor Blood: <strong className="mono">{selectedOrgan?.bloodGroup}</strong></Text>
                  <Text size="sm">Hospital: <strong>{selectedOrgan?.hospital}</strong></Text>
                </Grid.Col>
              </Grid>
            </Paper>

            <Title order={4} style={{ fontSize: 15, fontWeight: 600 }}>
              Compatibility Score Breakdown
            </Title>

            <Stack gap="xs">
              {[
                ['HLA Match', reviewCandidate.hlaScore, 'var(--color-primary)'],
                ['Medical Urgency', reviewCandidate.urgencyScore, 'var(--color-warning)'],
                ['Geographic Proximity', reviewCandidate.distanceScore, 'var(--color-info)'],
                ['Waiting Time', reviewCandidate.waitScore, 'var(--color-success)'],
              ].map(([label, value, color]) => (
                <div key={label}>
                  <Group justify="space-between" mb={2}>
                    <Text size="xs" fw={600}>{label}</Text>
                    <Text size="xs" className="mono">{fmtScore(value)}/100</Text>
                  </Group>
                  <Progress value={value} color={color} radius="xl" />
                </div>
              ))}
            </Stack>

            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={() => setReviewCandidate(null)}>
                Close
              </Button>
              <Tooltip label={offerBlockReason(reviewCandidate)} disabled={!offerBlockReason(reviewCandidate)} withArrow>
                <span>
                  <Button
                    color="var(--color-primary)"
                    disabled={!!offerBlockReason(reviewCandidate) || creatingFor !== null}
                    onClick={() => {
                      const c = reviewCandidate;
                      setReviewCandidate(null);
                      handleCreateOffer(c);
                    }}
                    leftSection={<IconUserCheck size={16} />}
                  >
                    Create Offer for {reviewCandidate.recipient}
                  </Button>
                </span>
              </Tooltip>
            </Group>
          </Stack>
        </Modal>
      ) : null}
    </Stack>
  );
}
