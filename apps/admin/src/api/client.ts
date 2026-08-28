import type { SurveyItem } from '@cis/survey';
import {
  ApiError,
  type Coordinator,
  type EditionDetail,
  type EditionSummary,
  type FirmSummary,
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
  setOpeningDate(id: string, openDate: string | null): Promise<{ plannedOpenAt: string | null }>;
  requestLock(id: string, reason: string): Promise<{ criticalActionId: string }>;
  decideLock(
    id: string,
    actionId: string,
    approved: boolean,
    rejectionReason?: string,
  ): Promise<{ status: 'approved' | 'rejected'; editionStatus: string }>;
  getInstruments(id: string): Promise<InstrumentsResponse>;
  getInstrumentItems(code: string): Promise<SurveyItem[]>;
  requestFreeze(id: string, reason: string): Promise<{ criticalActionId: string }>;
  decideFreeze(
    id: string,
    actionId: string,
    approved: boolean,
    rejectionReason?: string,
  ): Promise<{ status: 'approved' | 'rejected'; frozen: boolean }>;
  // Firm coordinator team (UX-FRM-007) — ordinary account admin, not maker-checker.
  listFirms(): Promise<FirmSummary[]>;
  listCoordinators(orgId: string): Promise<Coordinator[]>;
  createLeadCoordinator(
    orgId: string,
    body: { name: string; email: string; role?: string; phone?: string },
  ): Promise<Coordinator>;
  addCoordinator(
    orgId: string,
    body: { name: string; email: string; role?: string; phone?: string },
  ): Promise<Coordinator>;
  setCoordinatorPin(
    orgId: string,
    coordinatorId: string,
    body: { newPin: string; currentPin?: string },
  ): Promise<{ ok: boolean }>;
  handoverLead(
    orgId: string,
    body: { actingCoordinatorId: string; newLeadCoordinatorId: string },
  ): Promise<{
    outgoing: { id: string; isLead: boolean };
    incoming: { id: string; isLead: boolean };
  }>;
  removeCoordinator(orgId: string, coordinatorId: string): Promise<{ removed: boolean }>;
  /** Generic escape hatch — used by surfaces that call many endpoints without adding per-method stubs. */
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body: unknown): Promise<T>;
  put<T = unknown>(path: string, body: unknown): Promise<T>;
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
    setOpeningDate: (id, openDate) =>
      request(`/editions/${id}/opening-date`, {
        method: 'PATCH',
        body: { openDate },
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
    getInstrumentItems: (code) =>
      request<{ items: SurveyItem[] }>(`/instruments/${encodeURIComponent(code)}/items`, {
        token,
      }).then((r) => r.items),
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
    listFirms: () => request<{ firms: FirmSummary[] }>('/firms', { token }).then((r) => r.firms),
    listCoordinators: (orgId) =>
      request<{ coordinators: Coordinator[] }>(`/firms/${orgId}/coordinators`, { token }).then(
        (r) => r.coordinators,
      ),
    createLeadCoordinator: (orgId, body) =>
      request<{ coordinator: Coordinator }>(`/firms/${orgId}/coordinators/lead`, {
        method: 'POST',
        body,
        token,
      }).then((r) => r.coordinator),
    addCoordinator: (orgId, body) =>
      request<{ coordinator: Coordinator }>(`/firms/${orgId}/coordinators`, {
        method: 'POST',
        body,
        token,
      }).then((r) => r.coordinator),
    setCoordinatorPin: (orgId, coordinatorId, body) =>
      request(`/firms/${orgId}/coordinators/${coordinatorId}/pin`, {
        method: 'POST',
        body,
        token,
      }),
    handoverLead: (orgId, body) =>
      request(`/firms/${orgId}/coordinators/handover`, { method: 'POST', body, token }),
    removeCoordinator: (orgId, coordinatorId) =>
      request(`/firms/${orgId}/coordinators/${coordinatorId}`, { method: 'DELETE', token }),
    get: <T = unknown>(path: string) => request<T>(path, { token }),
    post: <T = unknown>(path: string, body: unknown) =>
      request<T>(path, { method: 'POST', body, token }),
    put: <T = unknown>(path: string, body: unknown) =>
      request<T>(path, { method: 'PUT', body, token }),
  };
}
