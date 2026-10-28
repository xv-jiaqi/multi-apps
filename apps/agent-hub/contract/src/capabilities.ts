// contract/src/capabilities.ts
import type { WorkspaceKind } from './domain';
import type { AgentErrorCode } from './errors';

export interface ReasoningEffortOption {
  /** 原样传给 Agent 的值，例如 Codex 的 "medium"。 */
  id: string;
  /** 中文标签，由 reasoningEffortLabel(id) 生成。 */
  label: string;
  description?: string;
}

export interface ModelOption {
  id: string;
  label: string;
  description?: string;
  isDefault: boolean;
  /** 空数组 = 该模型不能选推理档位。 */
  reasoningEfforts: ReasoningEffortOption[];
  defaultReasoningEffort: string | null;
}

export interface AgentCapabilities {
  models: ModelOption[];
  /**
   * agent：Agent 主动告知（Codex model/list）；
   * session：只能从最近一次会话里得知（ACP），还没有会话时 models 为空；
   * none：不能选模型（网页 Agent）。
   */
  modelsSource: 'agent' | 'session' | 'none';
  /** Agent 自带、Hub 可以要求开启的沙箱（只有 Codex）。 */
  sandbox: boolean;
  /** 进程重启后能否恢复原生会话。 */
  resume: boolean;
  /** 会话能否出现在 Agent 自己的客户端里（Codex threadSource "user"）。 */
  userVisibleSessions: boolean;
  workspaces: WorkspaceKind[];
  fetchedAt: string;
}

export type AgentHealth =
  | { status: 'checking' }
  | {
      status: 'ready';
      version: string | null;
      /** 版本在适配器分册的兼容表里。 */
      versionVerified: boolean;
      executablePath: string | null;
    }
  | { status: 'auth_required'; message: string; version: string | null }
  | { status: 'unavailable'; code: AgentErrorCode; message: string }
  | { status: 'disabled' };
