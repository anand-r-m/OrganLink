// Pure helpers for the Settings page (OL-024): API rows -> table rows, form <-> request body,
// and the region <-> slider mapping used by the Policy Weights tab. No React, so node --test covers them.

export const WEIGHT_KEYS = ['hla', 'urgency', 'distance', 'wait'];

// Mock-mode starting weights (the tab's long-standing mock numbers, mapped to the API keys).
export const MOCK_DEFAULT_WEIGHTS = { hla: 10, urgency: 40, distance: 15, wait: 35 };

const num = (v) => (v === '' || v === null || v === undefined ? undefined : Number(v));

/* ---------- Regions ---------- */

// API Region -> Regions-tab row. allocationPolicy is mock-only text, so it is null in live mode.
export function adaptRegion(r) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    allocationPolicy: null,
    hospitalCount: r.hospitalCount,
    weights: { ...r.weights },
  };
}
export const adaptRegions = (rows) => rows.map(adaptRegion);

// Select options for a region dropdown: value is the id as a string.
export const regionOptions = (regions) => regions.map((r) => ({ value: String(r.id), label: r.name }));

// Region id (string or number) -> slider values {hla, urgency, distance, wait}; unknown id -> null.
export function regionToSliderValues(regions, regionId) {
  const r = regions.find((x) => String(x.id) === String(regionId));
  if (!r) return null;
  return Object.fromEntries(WEIGHT_KEYS.map((k) => [k, Number(r.weights?.[k] ?? 0)]));
}

// Slider values -> PATCH /api/regions/:id body. The DB decides whether the values are acceptable.
export function sliderValuesToPatch(values) {
  return { weights: Object.fromEntries(WEIGHT_KEYS.map((k) => [k, Number(values[k])])) };
}

export const sliderValuesChanged = (a, b) => WEIGHT_KEYS.some((k) => Number(a?.[k]) !== Number(b?.[k]));

// Share of each weight in the total, for the distribution bar. All zeros -> equal shares.
export function weightShares(values) {
  const total = WEIGHT_KEYS.reduce((s, k) => s + Number(values[k] || 0), 0);
  return Object.fromEntries(
    WEIGHT_KEYS.map((k) => [k, total > 0 ? (Number(values[k] || 0) / total) * 100 : 100 / WEIGHT_KEYS.length]),
  );
}

export const emptyRegionForm = () => ({ code: '', name: '' });
export const regionToForm = (r) => ({ code: r.code ?? '', name: r.name ?? '' });
export const regionFormToBody = (f) => ({ code: f.code.trim(), name: f.name.trim() });

/* ---------- Hospitals ---------- */

export const emptyHospitalForm = () => ({
  name: '', address: '', phone: '', latitude: '', longitude: '', regionId: null, status: 'ACTIVE',
});

// Adapted live hospital row (adaptHospital) + regions list -> form. Region is matched by code.
export function hospitalToForm(h, regions) {
  const r = regions.find((x) => x.code === h.regionCode);
  return {
    name: h.name ?? '',
    address: h.address ?? '',
    phone: h.phone ?? '',
    latitude: h.lat ?? '',
    longitude: h.lng ?? '',
    regionId: r ? String(r.id) : null,
    status: String(h.status ?? 'active').toUpperCase(),
  };
}

export function hospitalFormToBody(f) {
  return {
    name: f.name.trim(),
    address: f.address.trim(),
    phone: f.phone.trim(),
    latitude: num(f.latitude),
    longitude: num(f.longitude),
    regionId: f.regionId ? Number(f.regionId) : undefined,
    status: f.status,
  };
}

/* ---------- Organ types ---------- */

export const adaptOrganType = (t) => ({
  id: t.id,
  name: t.name,
  maxViability: t.maxViabilityHours,
  responseWindow: t.responseWindowHours,
  minRatio: t.minWeightRatio,
  maxRatio: t.maxWeightRatio,
  priorityWeight: t.priorityWeight,
});
export const adaptOrganTypes = (rows) => rows.map(adaptOrganType);

// 0.5, 3 -> "0.50–3.00"
export const formatRatioRange = (min, max) => `${Number(min).toFixed(2)}–${Number(max).toFixed(2)}`;

export const emptyOrganTypeForm = () => ({
  name: '', maxViability: '', responseWindow: '', priorityWeight: '', minRatio: '', maxRatio: '',
});

export const organTypeToForm = (t) => ({
  name: t.name ?? '',
  maxViability: t.maxViability ?? '',
  responseWindow: t.responseWindow ?? '',
  priorityWeight: t.priorityWeight ?? '',
  minRatio: t.minRatio ?? '',
  maxRatio: t.maxRatio ?? '',
});

export const organTypeFormToBody = (f) => ({
  name: f.name.trim(),
  maxViabilityHours: num(f.maxViability),
  responseWindowHours: num(f.responseWindow),
  priorityWeight: num(f.priorityWeight),
  minWeightRatio: num(f.minRatio),
  maxWeightRatio: num(f.maxRatio),
});

/* ---------- Errors ---------- */

// Server error -> { field, message } so a form can mark the field and always show the DB message.
export function settingsErrorToForm(err) {
  const message = err?.message || 'Request failed';
  const hay = `${err?.details?.constraint ?? ''} ${(err?.details?.fields ?? []).join(' ')}`.toLowerCase();
  const field = /region_?id/.test(hay)
    ? 'region'
    : ['latitude', 'longitude', 'name', 'code'].find((f) => hay.includes(f)) ??
      (err?.code === 'DUPLICATE' ? 'name' : null);
  return { field, message };
}
