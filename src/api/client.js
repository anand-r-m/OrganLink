// Fetch wrapper for the live API. Sends the session cookie and throws ApiError built from the
// server's {error:{code,message,details}} envelope (API_CONTRACT "Standard error envelope").
// import.meta.env is optional-chained so node:test can import this module.
export const USE_LIVE_API = import.meta.env?.VITE_DATA_SOURCE === 'api';

export class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// params: query-string values; undefined/null/'' entries are skipped.
function buildQuery(params) {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

export async function apiFetch(path, { method = 'GET', body, params } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}${buildQuery(params)}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Unable to reach the server');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? 'UNKNOWN', e?.message ?? 'Request failed', e?.details ?? {});
  }
  return data;
}
