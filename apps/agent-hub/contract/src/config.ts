// contract/src/config.ts
import { z } from 'zod';

const idSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,31}$/, '只能用小写字母、数字和连字符，2–32 位');
const originSchema = z.string().regex(/^https?:\/\/[^/\s]+$/, '形如 https://chat.example');
const envNameSchema = z.string().regex(/^[A-Z_][A-Z0-9_]*$/);

const agentBase = {
  id: idSchema,
  displayName: z.string().min(1).max(40),
  enabled: z.boolean().default(true),
  maxConcurrentTasks: z.number().int().min(1).max(8).default(1),
  /** 额外透传给 Agent 子进程的环境变量名（值取自侧车自身环境）。 */
  envPassthrough: z.array(envNameSchema).default([]),
};

export const codexAgentSchema = z.object({
  ...agentBase,
  kind: z.literal('codex'),
  command: z.string().min(1).default('codex'),
  args: z.array(z.string()).default(['app-server']),
  defaultModel: z.string().nullable().default(null),
  defaultReasoningEffort: z.string().nullable().default(null),
  idleTimeoutMinutes: z.number().int().min(1).max(240).default(30),
});

export const acpAgentSchema = z.object({
  ...agentBase,
  kind: z.literal('acp'),
  profile: z.enum(['qoder', 'claude-code', 'gemini', 'generic']).default('generic'),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  defaultModel: z.string().nullable().default(null),
  defaultReasoningEffort: z.string().nullable().default(null),
  idleTimeoutMinutes: z.number().int().min(1).max(240).default(10),
});

export const webAgentSchema = z.object({
  ...agentBase,
  kind: z.literal('web'),
  driver: z.literal('manual').default('manual'),
  /** “打开 AoneD”按钮的地址；为 null 时按钮不可用。 */
  openUrl: z.url().nullable().default(null),
  pollIntervalSeconds: z.number().int().min(10).max(600).default(30),
  maxTurnMinutes: z.number().int().min(10).max(1440).default(240),
});

export const agentConfigSchema = z.discriminatedUnion('kind', [
  codexAgentSchema,
  acpAgentSchema,
  webAgentSchema,
]);

export const repoConfigSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(60),
  /** 绝对路径，允许以 ~/ 开头。 */
  path: z.string().regex(/^(\/|~\/)/, '必须是绝对路径'),
  /** 新任务的默认基线；null 表示仓库当前 HEAD。 */
  defaultBaseRef: z.string().min(1).nullable().default(null),
  worktreeSetup: z
    .object({
      command: z.array(z.string().min(1)).min(1),
      timeoutSeconds: z.number().int().min(10).max(3600).default(600),
    })
    .nullable()
    .default(null),
  internalRemote: z.string().min(1).default('internal'),
  /** 由 Hub 在保存设置时根据 internal 的推送地址推导，用户不填。 */
  allowedPushHosts: z.array(z.string()).default([]),
});

export const DEFAULT_AGENTS = [
  { id: 'codex', kind: 'codex', displayName: 'Codex', maxConcurrentTasks: 2 },
  {
    id: 'qoder',
    kind: 'acp',
    profile: 'qoder',
    displayName: 'Qoder',
    command: 'qodercli',
    args: ['--acp'],
  },
  {
    id: 'claude-code',
    kind: 'acp',
    profile: 'claude-code',
    displayName: 'Claude Code',
    command: 'claude-agent-acp',
    enabled: false,
  },
  {
    id: 'gemini',
    kind: 'acp',
    profile: 'gemini',
    displayName: 'Gemini CLI',
    command: 'gemini',
    args: ['--acp'],
    enabled: false,
  },
  { id: 'aoned', kind: 'web', displayName: 'AoneD', enabled: false },
] satisfies z.input<typeof agentConfigSchema>[];

export const hubConfigSchema = z
  .object({
    version: z.literal(1).default(1),
    server: z.object({ port: z.number().int().min(1024).max(65535).default(47821) }).prefault({}),
    scheduler: z
      .object({
        maxConcurrentTasks: z.number().int().min(1).max(10).default(3),
        maxQueuedTasks: z.number().int().min(1).max(500).default(50),
      })
      .prefault({}),
    agents: z.array(agentConfigSchema).prefault(DEFAULT_AGENTS),
    repos: z.array(repoConfigSchema).default([]),
    defaultRepoId: idSchema.nullable().default(null),
    bot: z
      .object({
        url: z.url().nullable().default(null),
        /** Bot 页面可以停留的 origin；url 自身的 origin 自动包含。 */
        allowedOrigins: z.array(originSchema).default([]),
        /** 允许以弹窗打开的登录页 origin（SSO）。 */
        authOrigins: z.array(originSchema).default([]),
        userAgent: z.string().min(1).nullable().default(null),
        /** R4 的退路：不内嵌，改为用系统浏览器打开。 */
        openExternally: z.boolean().default(false),
      })
      .prefault({}),
    security: z
      .object({
        approvalTimeoutMinutes: z.number().int().min(1).max(1440).default(60),
        maxBridgeDiffBytes: z.number().int().min(1024).max(5_242_880).default(524_288),
        blockedPushHosts: z
          .array(z.string())
          .default(['github.com', 'ssh.github.com', 'gist.github.com']),
      })
      .prefault({}),
    retention: z
      .object({
        deltaEventDays: z.number().int().min(1).max(3650).default(30),
        transcriptDays: z.number().int().min(1).max(3650).default(14),
        archivedWorktreeDays: z.number().int().min(1).max(3650).default(30),
        auditDays: z.number().int().min(1).max(3650).default(180),
        logDays: z.number().int().min(1).max(3650).default(14),
      })
      .prefault({}),
    diagnostics: z
      .object({
        recordTranscripts: z.boolean().default(false),
        logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
      })
      .prefault({}),
  })
  .superRefine((cfg, ctx) => {
    const dup = (ids: string[]) => ids.find((id, i) => ids.indexOf(id) !== i);
    const agentDup = dup(cfg.agents.map((a) => a.id));
    if (agentDup)
      ctx.addIssue({ code: 'custom', path: ['agents'], message: `Agent id 重复：${agentDup}` });
    const repoDup = dup(cfg.repos.map((r) => r.id));
    if (repoDup)
      ctx.addIssue({ code: 'custom', path: ['repos'], message: `仓库 id 重复：${repoDup}` });
    if (cfg.defaultRepoId && !cfg.repos.some((r) => r.id === cfg.defaultRepoId)) {
      ctx.addIssue({ code: 'custom', path: ['defaultRepoId'], message: '默认仓库不存在' });
    }
  });

export type HubConfig = z.output<typeof hubConfigSchema>;
export type HubConfigInput = z.input<typeof hubConfigSchema>;
export type AgentConfig = z.output<typeof agentConfigSchema>;
export type CodexAgentConfig = z.output<typeof codexAgentSchema>;
export type AcpAgentConfig = z.output<typeof acpAgentSchema>;
export type WebAgentConfig = z.output<typeof webAgentSchema>;
export type RepoConfig = z.output<typeof repoConfigSchema>;

export function createDefaultConfig(): HubConfig {
  return hubConfigSchema.parse({});
}
