import type { SurveyItem } from '@cis/survey';
import {
  ApiError,
  type AudienceCategory,
  type BatchReport,
  type Coordinator,
  type EditionDetail,
  type EditionSummary,
  type FirmReport,
  type FirmSummary,
  type IndexScoreView,
  type InstrumentsResponse,
  type InvitationRequestItem,
  type LoginResponse,
  type MessageAudienceKind,
  type MessageBatch,
  type MessageRecipient,
  type MessageTemplate,
  type MissionBoardResponse,
  type NationalReportDetailResponse,
  type NationalReportSection,
  type ReleaseFirmReportsResult,
  type SampleFloor,
  type ScoringCheckedAccount,
  type ScoringRunsResponse,
  type ScoringSignoff,
  type SendBatchResult,
  type UploadCheckResult,
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
  getMissionBoard(id: string): Promise<MissionBoardResponse>;
  // Scoring & sign-off (UX-ADM-004)
  triggerScoringRun(id: string): Promise<{ run: unknown }>;
  getScoringRuns(id: string): Promise<ScoringRunsResponse>;
  getScoreView(id: string, runId: string): Promise<{ scores: IndexScoreView[] }>;
  requestSignoff(
    id: string,
    runId: string,
    requestedBy: string,
    checkedAccount: ScoringCheckedAccount,
  ): Promise<{ signoff: ScoringSignoff }>;
  approveSignoff(signoffId: string, approvedBy: string): Promise<{ signoff: ScoringSignoff }>;
  // National report (UX-ADM-005)
  generateNationalReport(
    id: string,
    scoringRunId: string,
    context: {
      segments: Record<string, { meets: boolean; thin: boolean }>;
      regulatorsEngaged: number;
    },
  ): Promise<{ reportId: string; sections: NationalReportSection[] }>;
  getLatestNationalReport(id: string): Promise<{ report: { id: string } | null }>;
  getNationalReport(reportId: string): Promise<NationalReportDetailResponse>;
  openNationalDraft(reportId: string): Promise<{ opened: boolean }>;
  requestNationalApproval(
    reportId: string,
    requestedBy: string,
    reason: string,
  ): Promise<{ requested: boolean }>;
  approveNationalReport(reportId: string, approvedBy: string): Promise<{ status: string }>;
  // Firm reports (UX-ADM-006)
  getRegulators(id: string): Promise<{ regulators: { institutionId: string; status: string }[] }>;
  getFirmReports(id: string): Promise<{ reports: FirmReport[] }>;
  generateFirmReports(id: string, scoringRunId: string): Promise<unknown>;
  approveFirmReport(reportId: string): Promise<{ approvalState: string }>;
  releaseFirmReports(id: string): Promise<ReleaseFirmReportsResult>;
  // Invitations (UX-OPS-002)
  listAudiences(id: string): Promise<{ audiences: AudienceCategory[] }>;
  resolveFirmNames(
    id: string,
    firmNames: string[],
  ): Promise<{ resolved: Record<string, string | null> }>;
  listMessageTemplates(id: string): Promise<{ templates: MessageTemplate[] }>;
  saveMessageTemplate(
    id: string,
    body: {
      name: string;
      subject: string;
      body: string;
      audienceKind: MessageAudienceKind;
      requiresCode?: boolean;
    },
  ): Promise<{ template: MessageTemplate }>;
  validateUpload(
    id: string,
    templateId: string,
    rows: Array<{ firmName: string; email: string; organizationId?: string | null }>,
  ): Promise<UploadCheckResult>;
  sendInvitationBatch(
    id: string,
    body: {
      templateId: string;
      audienceId: string;
      uploadRows?: Array<{ firmName: string; email: string; organizationId?: string | null }>;
    },
  ): Promise<SendBatchResult>;
  listInvitationBatches(id: string): Promise<{ batches: MessageBatch[] }>;
  getInvitationBatchReport(batchId: string): Promise<{ report: BatchReport }>;
  getBouncedRecipients(batchId: string): Promise<{ bounced: MessageRecipient[] }>;
  listInvitationRequests(
    id: string,
    includeResolved?: boolean,
  ): Promise<{ requests: InvitationRequestItem[] }>;
  resolveInvitationRequest(
    requestId: string,
    resolution: 'code_issued' | 'marked_done',
    reissueTemplateId?: string,
  ): Promise<{ request: InvitationRequestItem }>;
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
    getMissionBoard: (id) => request(`/editions/${id}/mission-board`, { token }),
    triggerScoringRun: (id) => request(`/editions/${id}/scoring-runs`, { method: 'POST', token }),
    getScoringRuns: (id) => request(`/editions/${id}/scoring-runs`, { token }),
    getScoreView: (id, runId) => request(`/editions/${id}/scoring-runs/${runId}/scores`, { token }),
    requestSignoff: (id, runId, requestedBy, checkedAccount) =>
      request(`/editions/${id}/scoring-runs/${runId}/signoff/request`, {
        method: 'POST',
        body: { requestedBy, checkedAccount },
        token,
      }),
    approveSignoff: (signoffId, approvedBy) =>
      request(`/scoring-signoffs/${signoffId}/approve`, {
        method: 'POST',
        body: { approvedBy },
        token,
      }),
    generateNationalReport: (id, scoringRunId, context) =>
      request(`/editions/${id}/national-report`, {
        method: 'POST',
        body: { scoringRunId, context },
        token,
      }),
    getLatestNationalReport: (id) => request(`/editions/${id}/national-report`, { token }),
    getNationalReport: (reportId) => request(`/national-reports/${reportId}`, { token }),
    openNationalDraft: (reportId) =>
      request(`/national-reports/${reportId}/open`, { method: 'POST', token }),
    requestNationalApproval: (reportId, requestedBy, reason) =>
      request(`/national-reports/${reportId}/request-approval`, {
        method: 'POST',
        body: { requestedBy, reason },
        token,
      }),
    approveNationalReport: (reportId, approvedBy) =>
      request(`/national-reports/${reportId}/approve`, {
        method: 'POST',
        body: { approvedBy },
        token,
      }),
    getRegulators: (id) => request(`/editions/${id}/regulators`, { token }),
    getFirmReports: (id) => request(`/editions/${id}/firm-reports`, { token }),
    generateFirmReports: (id, scoringRunId) =>
      request(`/editions/${id}/firm-reports/generate`, {
        method: 'POST',
        body: { scoringRunId },
        token,
      }),
    approveFirmReport: (reportId) =>
      request(`/firm-reports/${reportId}/approve`, { method: 'POST', token }),
    releaseFirmReports: (id) =>
      request(`/editions/${id}/firm-reports/release`, { method: 'POST', token }),
    listAudiences: (id) => request(`/editions/${id}/invitations/audiences`, { token }),
    resolveFirmNames: (id, firmNames) =>
      request(`/editions/${id}/invitations/resolve-firm-names`, {
        method: 'POST',
        body: { firmNames },
        token,
      }),
    listMessageTemplates: (id) => request(`/editions/${id}/invitations/templates`, { token }),
    saveMessageTemplate: (id, body) =>
      request(`/editions/${id}/invitations/templates`, { method: 'POST', body, token }),
    validateUpload: (id, templateId, rows) =>
      request(`/editions/${id}/invitations/validate-upload`, {
        method: 'POST',
        body: { templateId, rows },
        token,
      }),
    sendInvitationBatch: (id, body) =>
      request(`/editions/${id}/invitations/send`, { method: 'POST', body, token }),
    listInvitationBatches: (id) => request(`/editions/${id}/invitations/batches`, { token }),
    getInvitationBatchReport: (batchId) =>
      request(`/invitations/batches/${batchId}/report`, { token }),
    getBouncedRecipients: (batchId) =>
      request(`/invitations/batches/${batchId}/bounced`, { token }),
    listInvitationRequests: (id, includeResolved) =>
      request(
        `/editions/${id}/invitations/requests${includeResolved ? '?includeResolved=true' : ''}`,
        { token },
      ),
    resolveInvitationRequest: (requestId, resolution, reissueTemplateId) =>
      request(`/invitations/requests/${requestId}/resolve`, {
        method: 'POST',
        body: { resolution, ...(reissueTemplateId ? { reissueTemplateId } : {}) },
        token,
      }),
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
