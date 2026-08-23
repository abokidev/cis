import {
  ApiError,
  type EditionDetail,
  type EditionSummary,
  type InstrumentsResponse,
  type LoginResponse,
  type SampleFloor,
} from './types';

// All API calls go through this single typed layer so later admin surfaces
// share it rather than scattering fetch() through components. The base path is
// proxied to the Fastify server (see vite.config.ts).
const BASE = '/api';

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;

  const init: RequestInit = { method: opts.method ?? 'GET', headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

  const res = await fetch(`${BASE}${path}`, init);

  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'message' in data
        ? String((data as { message: unknown }).message)
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export function login(email: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/login', { method: 'POST', body: { email, password } });
}

export interface AdminClient {
  listEditions(): Promise<EditionSummary[]>;
  getEdition(id: string): Promise<EditionDetail>;
  setFloors(id: string, floors: SampleFloor[]): Promise<{ floors: SampleFloor[] }>;
  setClosingDate(id: string, closingDate: string): Promise<{ surveyCloseAt: string | null }>;
  requestLock(id: string, reason: string): Promise<{ criticalActionId: string }>;
  decideLock(
    id: string,
    actionId: string,
    approved: boolean,
    rejectionReason?: string,
  ): Promise<{ status: 'approved' | 'rejected'; editionStatus: string }>;
  getInstruments(id: string): Promise<InstrumentsResponse>;
  requestFreeze(id: string, reason: string): Promise<{ criticalActionId: string }>;
  decideFreeze(
    id: string,
    actionId: string,
    approved: boolean,
    rejectionReason?: string,
  ): Promise<{ status: 'approved' | 'rejected'; frozen: boolean }>;
}

/** Build a client bound to an auth token. */
export function createClient(token: string | null): AdminClient {
  return {
    listEditions: () => request('/editions', { token }),
    getEdition: (id) => request(`/editions/${id}`, { token }),
    setFloors: (id, floors) =>
      request(`/editions/${id}/floors`, { method: 'PATCH', body: { floors }, token }),
    setClosingDate: (id, closingDate) =>
      request(`/editions/${id}/closing-date`, {
        method: 'PATCH',
        body: { closingDate },
        token,
      }),
    requestLock: (id, reason) =>
      request(`/editions/${id}/lock/request`, { method: 'POST', body: { reason }, token }),
    decideLock: (id, actionId, approved, rejectionReason) =>
      request(`/editions/${id}/lock/${actionId}/decide`, {
        method: 'POST',
        body: { approved, rejectionReason },
        token,
      }),
    getInstruments: (id) => request(`/editions/${id}/instruments`, { token }),
    requestFreeze: (id, reason) =>
      request(`/editions/${id}/instruments/freeze/request`, {
        method: 'POST',
        body: { reason },
        token,
      }),
    decideFreeze: (id, actionId, approved, rejectionReason) =>
      request(`/editions/${id}/instruments/freeze/${actionId}/decide`, {
        method: 'POST',
        body: { approved, rejectionReason },
        token,
      }),
  };
}
