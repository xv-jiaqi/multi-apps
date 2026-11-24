import type { AcpAgentConfig, TaskMode } from '@agent-hub/contract';

/** 取自配置 schema 的枚举：在 acpAgentSchema.profile 里加了值而这里没加，ACP_PROFILES 编译不过。 */
export type AcpProfileId = AcpAgentConfig['profile'];

export interface AcpProfile {
  id: AcpProfileId;
  /** AGENT_AUTH_REQUIRED 的说明，也是健康 auth_required 的文案。 */
  authHint(displayName: string): string;
  /**
   * 每种任务模式依次尝试的会话模式 id，取第一个 Agent 提供的作为本会话的目标模式（D37）；
   * 一个都没有时不管理模式。
   */
  modes: Record<TaskMode, readonly string[]>;
  /** 兼容表（§10）里核对过的 agentInfo.version。 */
  verifiedVersions: readonly string[];
}

export const ACP_PROFILES: Record<AcpProfileId, AcpProfile> = {
  qoder: {
    id: 'qoder',
    authHint: () => 'Qoder 未登录：请在终端运行 qodercli，按提示登录后重试',
    modes: { read_only: ['default'], write: ['default'] },
    verifiedVersions: ['1.1.80'],
  },
  'claude-code': {
    id: 'claude-code',
    authHint: () => 'Claude Code 未登录：请在终端运行 claude，用 /login 登录后重试',
    modes: { read_only: ['plan', 'default'], write: ['default'] },
    verifiedVersions: ['0.97.0'],
  },
  gemini: {
    id: 'gemini',
    authHint: () =>
      'Gemini CLI 未登录：请在终端运行 gemini 完成登录；用 API key 时把 GEMINI_API_KEY 加进该 Agent 的“透传环境变量”',
    modes: { read_only: ['plan', 'default'], write: ['default'] },
    verifiedVersions: ['0.65.0'],
  },
  generic: {
    id: 'generic',
    authHint: (displayName) => `${displayName} 未登录：请先在终端完成该 Agent 的登录`,
    modes: { read_only: ['plan', 'default'], write: ['default'] },
    verifiedVersions: [],
  },
};
