/**
 * PR3 待办 5（security.md §3.2）：Codex 的 shell_environment_policy 可能剥掉 git 推送守卫的环境变量。
 * thread/start 必须在 config 里把守卫变量逐个 set 回去，并清掉 include_only。
 * 真实 codex-cli 0.164.0 上的效果见 evidence/pr3-qoder/codex-env-policy.md。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WaitResponse } from '@agent-hub/contract';
import { GIT_GUARD } from '../src/common/tokens';
import type { GitGuard } from '../src/workspace/git-guard';
import { api, scenarioPath, startHub, waitAgentReady, type TestHub } from './helpers/hub';

describe('Codex shell_environment_policy 覆盖', () => {
  let hub: TestHub;
  let dir: string;
  let record: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ah-cxenv-'));
    record = join(dir, 'requests.jsonl');
    const base = JSON.parse(readFileSync(scenarioPath('codex-readonly-demo'), 'utf8')) as object;
    const scenario = join(dir, 'scenario.json');
    writeFileSync(scenario, JSON.stringify({ ...base, recordRequests: record }));
    hub = await startHub(scenario);
    await waitAgentReady(hub);
  });

  afterAll(async () => {
    await hub?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('thread/start 的 config 逐个 set 守卫变量、清掉 include_only', async () => {
    const created = await api<{ task: { id: string } }>(hub, 'POST', '/tasks', {
      agentId: 'codex',
      prompt: 'hi',
    });
    const end = await api<WaitResponse>(
      hub,
      'GET',
      `/tasks/${created.body.task.id}/wait?until=turn_end&timeoutSec=20`,
    );
    expect(end.body.task.status).toBe('completed');

    const start = readFileSync(record, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { method: string; params: { config?: Record<string, unknown> } })
      .find((m) => m.method === 'thread/start')!;
    const env = hub.app.get<GitGuard>(GIT_GUARD).agentEnv();
    expect(start.params.config).toEqual({
      'shell_environment_policy.include_only': [],
      'shell_environment_policy.set.GIT_ALLOW_PROTOCOL': 'file',
      'shell_environment_policy.set.GIT_TERMINAL_PROMPT': '0',
      'shell_environment_policy.set.GIT_ASKPASS': hub.paths.askpass,
      'shell_environment_policy.set.SSH_ASKPASS': hub.paths.askpass,
      'shell_environment_policy.set.GIT_CONFIG_COUNT': '1',
      'shell_environment_policy.set.GIT_CONFIG_KEY_0': 'core.hooksPath',
      'shell_environment_policy.set.GIT_CONFIG_VALUE_0': hub.paths.hooks,
      'shell_environment_policy.set.GH_CONFIG_DIR': hub.paths.ghConfig,
    });
    expect(env.GIT_CONFIG_VALUE_0).toBe(hub.paths.hooks);
  });
});
