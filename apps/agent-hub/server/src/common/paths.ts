import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface HubPaths {
  home: string;
  config: string;
  db: string;
  lock: string;
  bridgeToken: string;
  logs: string;
  transcripts: string;
  worktrees: string;
  probe: string;
  guard: string;
  hooks: string;
  askpass: string;
  ghConfig: string;
  guardLog: string;
}

export function resolvePaths(env: NodeJS.ProcessEnv = process.env): HubPaths {
  const home = env.AGENT_HUB_HOME
    ? resolve(env.AGENT_HUB_HOME)
    : join(homedir(), 'Library', 'Application Support', 'AgentHub');
  const guard = join(home, 'guard');
  return {
    home,
    config: join(home, 'config.json'),
    db: join(home, 'hub.db'),
    lock: join(home, 'server.lock'),
    bridgeToken: join(home, 'bridge-token'),
    logs: join(home, 'logs'),
    transcripts: join(home, 'transcripts'),
    worktrees: join(home, 'worktrees'),
    probe: join(home, 'probe'),
    guard,
    hooks: join(guard, 'hooks'),
    askpass: join(guard, 'askpass'),
    ghConfig: join(guard, 'gh'),
    guardLog: join(guard, 'blocked.ndjson'),
  };
}

export const HUB_PATHS = Symbol('HUB_PATHS');
