import type { AcpAgentConfig, HubConfig, RepoConfig, RepoInspectionDto } from '@agent-hub/contract';
import type { SettingsSection } from '../app/paths';
import { canonicalJson } from './guard';

export const LOCKED_PUSH_HOSTS: readonly string[] = [
  'github.com',
  'ssh.github.com',
  'gist.github.com',
];

const SECTIONS: readonly SettingsSection[] = [
  'agents',
  'repos',
  'bot',
  'tokens',
  'general',
  'data',
  'about',
];

export function sectionOfIssue(path: string): SettingsSection {
  const head = path.split('.')[0] ?? '';
  if (head === 'agents') return 'agents';
  if (head === 'repos' || head === 'defaultRepoId') return 'repos';
  if (head === 'bot') return 'bot';
  if (head === 'retention' || head === 'diagnostics') return 'data';
  if (head === 'server' || head === 'scheduler' || head === 'security' || head === 'version') {
    return 'general';
  }
  return isSection(head) ? head : 'general';
}

export function uniqueId(name: string, taken: readonly string[], fallback: string): string {
  const base = slug(name) ?? slug(fallback) ?? 'item';
  if (!taken.includes(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = trimId(`${base}-${index}`);
    if (!taken.includes(candidate)) return candidate;
  }
  return trimId(`${base}-x`);
}

export function newRepo(path: string, _info: RepoInspectionDto, taken: string[]): RepoConfig {
  const folder =
    path
      .split('/')
      .filter((part) => part.length > 0)
      .at(-1) ?? 'repo';
  const id = uniqueId(folder, taken, 'repo');
  return {
    id,
    name: folder.slice(0, 60) || id,
    path,
    defaultBaseRef: null,
    worktreeSetup: null,
    internalRemote: 'internal',
    allowedPushHosts: [],
  };
}

/** command 留空，填了才能通过配置校验。 */
export function newAcpAgent(taken: readonly string[]): AcpAgentConfig {
  const id = uniqueId('acp', taken, 'agent');
  return {
    id,
    kind: 'acp',
    displayName: 'ACP Agent',
    enabled: true,
    maxConcurrentTasks: 1,
    envPassthrough: [],
    profile: 'generic',
    command: '',
    args: [],
    defaultModel: null,
    defaultReasoningEffort: null,
    idleTimeoutMinutes: 10,
  };
}

export function normalizeBlockedHosts(hosts: readonly string[]): string[] {
  const seen = new Set<string>(LOCKED_PUSH_HOSTS);
  const rest: string[] = [];
  for (const host of hosts) {
    const normalized = host.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    rest.push(normalized);
  }
  return [...LOCKED_PUSH_HOSTS, ...rest];
}

export function isDirty(draft: HubConfig, saved: HubConfig): boolean {
  return canonicalJson(draft) !== canonicalJson(saved);
}

/** 第一个仓库成为默认。已有仓库时不改默认。 */
export function withRepo(config: HubConfig, repo: RepoConfig): HubConfig {
  return {
    ...config,
    repos: [...config.repos, repo],
    defaultRepoId: config.repos.length === 0 ? repo.id : config.defaultRepoId,
  };
}

/** 删掉的是默认仓库时清空默认。 */
export function withoutRepo(config: HubConfig, repoId: string): HubConfig {
  return {
    ...config,
    repos: config.repos.filter((repo) => repo.id !== repoId),
    defaultRepoId: config.defaultRepoId === repoId ? null : config.defaultRepoId,
  };
}

function isSection(value: string): value is SettingsSection {
  return SECTIONS.some((section) => section === value);
}

function slug(input: string): string | null {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const clipped = cleaned.slice(0, 32).replace(/-+$/g, '');
  if (/^[a-z][a-z0-9-]{1,31}$/.test(clipped)) return clipped;
  return null;
}

function trimId(value: string): string {
  const clipped = value.slice(0, 32).replace(/-+$/g, '');
  return /^[a-z][a-z0-9-]{1,31}$/.test(clipped) ? clipped : 'item';
}
