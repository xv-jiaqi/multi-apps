import type { TaskSource } from '@agent-hub/contract';

/** GET /tasks 的查询参数。archived 必填，空字段不出现。 */
export interface TaskListFilter {
  archived: boolean;
  status?: string;
  agentId?: string;
  repoId?: string;
  source?: TaskSource;
  externalRef?: string;
  q?: string;
  limit?: number;
  cursor?: string;
}

export type QueryValue = string | number | boolean;
