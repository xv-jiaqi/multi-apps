import type {
  AgentDto,
  ApiTokenDto,
  ApplyResponse,
  ApprovalDecision,
  ApprovalDto,
  ApprovalStatus,
  CreateTaskBody,
  CreatedApiTokenDto,
  DiagnosticsResponse,
  DiffDto,
  FollowUpBody,
  HealthResponse,
  HubConfig,
  ItemsResponse,
  ListAuditResponse,
  ListEventsResponse,
  ListTasksResponse,
  MeResponse,
  RepoDto,
  RepoInspectionDto,
  Scope,
  SettingsResponse,
  TaskDetailDto,
  TaskDto,
  TaskResultDto,
  TaskWithTurnResponse,
  WaitResponse,
} from '@agent-hub/contract';
import { z } from 'zod';
import type { HubClient, RequestOptions } from './client';
import { client, requestJson } from './client';
import {
  agentDtoSchema,
  applyResponseSchema,
  approvalDtoSchema,
  createdTokenSchema,
  diagnosticsSchema,
  diffSchema,
  healthResponseSchema,
  itemsSchema,
  listAuditSchema,
  listEventsSchema,
  listTasksSchema,
  meResponseSchema,
  repoDtoSchema,
  repoInspectionSchema,
  settingsResponseSchema,
  taskDetailSchema,
  taskDtoSchema,
  taskResultSchema,
  taskWithTurnSchema,
  tokenSchema,
  waitResponseSchema,
} from './schemas';
import type { QueryValue, TaskListFilter } from './types';

export interface HubApi {
  health(signal?: AbortSignal): Promise<HealthResponse>;
  me(signal?: AbortSignal): Promise<MeResponse>;
  listAgents(signal?: AbortSignal): Promise<ItemsResponse<AgentDto>>;
  refreshAgent(agentId: string, signal?: AbortSignal): Promise<AgentDto>;
  listRepos(refresh?: boolean, signal?: AbortSignal): Promise<ItemsResponse<RepoDto>>;
  listRepoRefs(repoId: string, signal?: AbortSignal): Promise<ItemsResponse<string>>;
  inspectRepo(path: string, signal?: AbortSignal): Promise<RepoInspectionDto>;
  disableOriginPush(repoId: string, signal?: AbortSignal): Promise<RepoDto>;
  createTask(body: CreateTaskBody, signal?: AbortSignal): Promise<TaskWithTurnResponse>;
  listTasks(filter: TaskListFilter, signal?: AbortSignal): Promise<ListTasksResponse>;
  getTask(id: string, signal?: AbortSignal): Promise<TaskDetailDto>;
  listTaskEvents(
    id: string,
    query: { afterSeq?: number; limit?: number },
    signal?: AbortSignal,
  ): Promise<ListEventsResponse>;
  waitTask(
    id: string,
    query: { until?: 'turn_end' | 'approval' | 'any'; afterSeq?: number; timeoutSec?: number },
    signal?: AbortSignal,
  ): Promise<WaitResponse>;
  getTaskResult(id: string, signal?: AbortSignal): Promise<TaskResultDto>;
  getTaskDiff(
    id: string,
    query: { scope?: 'task' | 'turn'; turn?: number; live?: boolean },
    signal?: AbortSignal,
  ): Promise<DiffDto>;
  followUp(id: string, body: FollowUpBody, signal?: AbortSignal): Promise<TaskWithTurnResponse>;
  cancelTask(id: string, body: { force?: boolean }, signal?: AbortSignal): Promise<TaskDto>;
  archiveTask(id: string, signal?: AbortSignal): Promise<TaskDto>;
  unarchiveTask(id: string, signal?: AbortSignal): Promise<TaskDto>;
  deleteTask(id: string, signal?: AbortSignal): Promise<void>;
  applyTask(id: string, body: { merge?: boolean }, signal?: AbortSignal): Promise<ApplyResponse>;
  completeRemoteTurn(id: string, signal?: AbortSignal): Promise<TaskDto>;
  setRemoteLink(id: string, url: string, signal?: AbortSignal): Promise<TaskDto>;
  listApprovals(
    query: { status?: ApprovalStatus; taskId?: string; limit?: number },
    signal?: AbortSignal,
  ): Promise<ItemsResponse<ApprovalDto>>;
  decideApproval(
    id: string,
    body: { decision: ApprovalDecision; note?: string },
    signal?: AbortSignal,
  ): Promise<ApprovalDto>;
  getSettings(signal?: AbortSignal): Promise<SettingsResponse>;
  putSettings(config: HubConfig, signal?: AbortSignal): Promise<SettingsResponse>;
  listTokens(signal?: AbortSignal): Promise<ItemsResponse<ApiTokenDto>>;
  createToken(
    body: { name: string; scopes: Scope[] },
    signal?: AbortSignal,
  ): Promise<CreatedApiTokenDto>;
  updateToken(id: string, scopes: Scope[], signal?: AbortSignal): Promise<ApiTokenDto>;
  revokeToken(id: string, signal?: AbortSignal): Promise<ApiTokenDto>;
  rotateDefaultToken(signal?: AbortSignal): Promise<CreatedApiTokenDto>;
  exportDiagnostics(signal?: AbortSignal): Promise<DiagnosticsResponse>;
  listAudit(
    query: { before?: number; action?: string; limit?: number },
    signal?: AbortSignal,
  ): Promise<ListAuditResponse>;
}

export function createApi(http: HubClient = client): HubApi {
  const json = <S extends z.ZodType>(
    method: string,
    path: string,
    schema: S,
    options?: RequestOptions,
  ): Promise<z.output<S>> => requestJson(method, path, schema, options, http);

  return {
    health: (signal) => json('GET', '/health', healthResponseSchema, { signal }),
    me: (signal) => json('GET', '/me', meResponseSchema, { signal }),
    listAgents: (signal) => json('GET', '/agents', itemsSchema(agentDtoSchema), { signal }),
    refreshAgent: (id, signal) =>
      json('POST', `/agents/${encodeURIComponent(id)}/refresh`, agentDtoSchema, { signal }),
    listRepos: (refresh, signal) =>
      json('GET', '/repos', itemsSchema(repoDtoSchema), {
        query: refresh ? { refresh: 1 } : undefined,
        signal,
      }),
    listRepoRefs: (id, signal) =>
      json('GET', `/repos/${encodeURIComponent(id)}/refs`, itemsSchema(z.string()), { signal }),
    inspectRepo: (path, signal) =>
      json('POST', '/repos/inspect', repoInspectionSchema, { body: { path }, signal }),
    disableOriginPush: (id, signal) =>
      json('POST', `/repos/${encodeURIComponent(id)}/disable-origin-push`, repoDtoSchema, {
        signal,
      }),
    createTask: (body, signal) => json('POST', '/tasks', taskWithTurnSchema, { body, signal }),
    listTasks: (filter, signal) =>
      json('GET', '/tasks', listTasksSchema, { query: filterQuery(filter), signal }),
    getTask: (id, signal) => json('GET', taskPath(id), taskDetailSchema, { signal }),
    listTaskEvents: (id, query, signal) =>
      json('GET', `${taskPath(id)}/events`, listEventsSchema, { query, signal }),
    waitTask: (id, query, signal) =>
      json('GET', `${taskPath(id)}/wait`, waitResponseSchema, { query, signal }),
    getTaskResult: (id, signal) =>
      json('GET', `${taskPath(id)}/result`, taskResultSchema, { signal }),
    getTaskDiff: (id, query, signal) =>
      json('GET', `${taskPath(id)}/diff`, diffSchema, {
        query: { scope: query.scope, turn: query.turn, format: 'json', live: query.live },
        signal,
      }),
    followUp: (id, body, signal) =>
      json('POST', `${taskPath(id)}/turns`, taskWithTurnSchema, { body, signal }),
    cancelTask: (id, body, signal) =>
      json('POST', `${taskPath(id)}/cancel`, taskDtoSchema, { body, signal }),
    archiveTask: (id, signal) => json('POST', `${taskPath(id)}/archive`, taskDtoSchema, { signal }),
    unarchiveTask: (id, signal) =>
      json('POST', `${taskPath(id)}/unarchive`, taskDtoSchema, { signal }),
    deleteTask: async (id, signal) => {
      await http.request('DELETE', taskPath(id), { signal });
    },
    applyTask: (id, body, signal) =>
      json('POST', `${taskPath(id)}/apply`, applyResponseSchema, { body, signal }),
    completeRemoteTurn: (id, signal) =>
      json('POST', `${taskPath(id)}/remote/done`, taskDtoSchema, { signal }),
    setRemoteLink: (id, url, signal) =>
      json('POST', `${taskPath(id)}/remote/link`, taskDtoSchema, { body: { url }, signal }),
    listApprovals: (query, signal) =>
      json('GET', '/approvals', itemsSchema(approvalDtoSchema), { query, signal }),
    decideApproval: (id, body, signal) =>
      json('POST', `/approvals/${encodeURIComponent(id)}/decision`, approvalDtoSchema, {
        body,
        signal,
      }),
    getSettings: (signal) => json('GET', '/settings', settingsResponseSchema, { signal }),
    putSettings: (config, signal) =>
      json('PUT', '/settings', settingsResponseSchema, { body: config, signal }),
    listTokens: (signal) => json('GET', '/tokens', itemsSchema(tokenSchema), { signal }),
    createToken: (body, signal) => json('POST', '/tokens', createdTokenSchema, { body, signal }),
    updateToken: (id, scopes, signal) =>
      json('PATCH', `/tokens/${encodeURIComponent(id)}`, tokenSchema, { body: { scopes }, signal }),
    revokeToken: (id, signal) =>
      json('POST', `/tokens/${encodeURIComponent(id)}/revoke`, tokenSchema, { signal }),
    rotateDefaultToken: (signal) =>
      json('POST', '/tokens/rotate-default', createdTokenSchema, { signal }),
    exportDiagnostics: (signal) =>
      json('POST', '/diagnostics/export', diagnosticsSchema, { signal }),
    listAudit: (query, signal) => json('GET', '/audit', listAuditSchema, { query, signal }),
  };
}

export const api = createApi();

function taskPath(id: string): string {
  return `/tasks/${encodeURIComponent(id)}`;
}

function filterQuery(filter: TaskListFilter): Record<string, QueryValue | undefined> {
  return {
    archived: filter.archived,
    status: filter.status,
    agentId: filter.agentId,
    repoId: filter.repoId,
    source: filter.source,
    externalRef: filter.externalRef,
    q: filter.q,
    limit: filter.limit,
    cursor: filter.cursor,
  };
}
