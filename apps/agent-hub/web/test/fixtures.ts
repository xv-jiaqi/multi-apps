import type {
  AgentDto,
  ApprovalDto,
  HubEventEnvelope,
  RepoDto,
  TaskDto,
  TurnDto,
} from '@agent-hub/contract';

export function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: '5f0c2a9e-6b1d-4c8e-9a7f-3d2b1c0e9f84',
    shortId: '5f0c2a9e',
    title: '修复空指针',
    agentId: 'codex',
    adapterKind: 'codex',
    repoId: 'demo',
    repoPath: '/tmp/demo',
    source: 'ui',
    sourceTokenId: null,
    externalRef: null,
    mode: 'read_only',
    workspace: 'in_place',
    workspacePath: '/tmp/demo',
    branch: null,
    baseRef: null,
    baseCommit: null,
    model: null,
    reasoningEffort: null,
    userVisible: true,
    nativeSessionId: null,
    remoteUrl: null,
    status: 'queued',
    pendingApprovals: 0,
    turnCount: 1,
    lastEventSeq: 0,
    lastError: null,
    readOnlyViolation: false,
    createdAt: '2026-10-28T03:15:00.000Z',
    updatedAt: '2026-10-28T03:15:00.000Z',
    startedAt: null,
    endedAt: null,
    archivedAt: null,
    worktreeRemovedAt: null,
    ...overrides,
  };
}

export function turn(overrides: Partial<TurnDto> = {}): TurnDto {
  return {
    id: 'turn-1',
    taskId: task().id,
    index: 1,
    prompt: '看一下',
    model: null,
    reasoningEffort: null,
    status: 'running',
    stopReason: null,
    error: null,
    nativeTurnId: null,
    turnStats: null,
    taskStats: null,
    patchTruncated: false,
    usage: null,
    finalMessage: null,
    createdAt: '2026-10-28T03:15:00.000Z',
    startedAt: '2026-10-28T03:15:01.000Z',
    endedAt: null,
    ...overrides,
  };
}

export function agent(overrides: Partial<AgentDto> = {}): AgentDto {
  return {
    id: 'codex',
    displayName: 'Codex',
    kind: 'codex',
    profile: null,
    enabled: true,
    health: { status: 'ready', version: null, versionVerified: true, executablePath: null },
    capabilities: {
      models: [],
      modelsSource: 'agent',
      sandbox: true,
      resume: true,
      userVisibleSessions: true,
      workspaces: ['in_place', 'worktree'],
      fetchedAt: '2026-10-28T03:00:00.000Z',
    },
    maxConcurrentTasks: 1,
    runningTasks: 0,
    queuedTasks: 0,
    ...overrides,
  };
}

export function repo(overrides: Partial<RepoDto> = {}): RepoDto {
  return {
    id: 'demo',
    name: 'demo',
    path: '/tmp/demo',
    defaultBaseRef: null,
    isDefault: true,
    inspection: {
      ok: true,
      problems: [],
      topLevel: '/tmp/demo',
      currentBranch: 'main',
      head: 'abc',
      dirty: false,
      remotes: [],
      originPushDisabled: false,
      internalPushHost: null,
    },
    ...overrides,
  };
}

export function approval(overrides: Partial<ApprovalDto> = {}): ApprovalDto {
  return {
    id: 'ap-1',
    taskId: task().id,
    turnId: 'turn-1',
    kind: 'command',
    title: '执行命令',
    command: 'pnpm test',
    cwd: '/tmp/demo',
    paths: null,
    reason: '要跑测试',
    detail: null,
    options: ['allow_once', 'reject', 'cancel_turn'],
    status: 'pending',
    decision: null,
    decidedBy: null,
    decidedByTokenId: null,
    note: null,
    createdAt: '2026-10-28T03:16:00.000Z',
    expiresAt: '2026-10-28T04:16:00.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

export function envelope(
  event: HubEventEnvelope['event'],
  overrides: Partial<Omit<HubEventEnvelope, 'event'>> = {},
): HubEventEnvelope {
  return {
    taskId: task().id,
    seq: 1,
    turnId: 'turn-1',
    ts: '2026-10-28T03:16:00.000Z',
    event,
    ...overrides,
  };
}
