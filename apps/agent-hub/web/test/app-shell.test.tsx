import { createDefaultConfig } from '@agent-hub/contract';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider } from 'react-router';
import { router } from '../src/app/routes';
import { installConnection } from '../src/app/connection';
import { connectionDeps, queryClient } from '../src/app/singletons';
import { sidecar } from '../src/desktop/sidecar';
import type { SocketLike } from '../src/api/socket';

function readMessage(data: string): { op?: string; id?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};
  const op = 'op' in parsed && typeof parsed.op === 'string' ? parsed.op : undefined;
  const id = 'id' in parsed && typeof parsed.id === 'string' ? parsed.id : undefined;
  return { op, id };
}

class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  sent: string[] = [];
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
    const message = readMessage(data);
    if (message.op === 'auth') {
      queueMicrotask(() =>
        this.onmessage?.({
          data: JSON.stringify({ op: 'ready', kind: 'ui', scopes: ['tasks:read'], admin: true }),
        }),
      );
    }
    if (message.op === 'subscribe' && message.id === 'tasks') {
      queueMicrotask(() =>
        this.onmessage?.({ data: JSON.stringify({ op: 'subscribed', id: 'tasks' }) }),
      );
    }
  }
  close(): void {
    this.readyState = 3;
  }
}

describe('浏览器开发模式 AppShell', () => {
  it('启动失败后重试进入主界面，顶栏圆点、待审批和 WebSocket 地址都对', async () => {
    sessionStorage.clear();
    FakeSocket.instances = [];
    const Original = globalThis.WebSocket;
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('/agents')) {
          return Response.json({
            items: [
              {
                id: 'codex',
                displayName: 'Codex',
                kind: 'codex',
                profile: null,
                enabled: true,
                health: {
                  status: 'ready',
                  version: null,
                  versionVerified: true,
                  executablePath: null,
                },
                capabilities: null,
                maxConcurrentTasks: 1,
                runningTasks: 1,
                queuedTasks: 0,
              },
            ],
          });
        }
        if (url.pathname.endsWith('/approvals')) {
          return Response.json({
            items: [
              {
                id: 'ap-1',
                taskId: '5f0c2a9e-6b1d-4c8e-9a7f-3d2b1c0e9f84',
                turnId: 'turn-1',
                kind: 'command',
                title: '执行命令',
                command: 'pnpm test',
                cwd: null,
                paths: null,
                reason: null,
                detail: null,
                options: ['allow_once'],
                status: 'pending',
                decision: null,
                decidedBy: null,
                decidedByTokenId: null,
                note: null,
                createdAt: '2026-10-28T03:16:00.000Z',
                expiresAt: '2026-10-28T04:16:00.000Z',
                resolvedAt: null,
              },
            ],
          });
        }
        if (url.pathname.endsWith('/tasks')) {
          return Response.json({ items: [], nextCursor: null });
        }
        if (url.pathname.endsWith('/settings')) {
          return Response.json({
            config: createDefaultConfig(),
            restartRequired: false,
            dataDir: '/tmp/agent-hub',
            bridgeTokenFile: '/tmp/agent-hub/bridge-token',
          });
        }
        if (url.pathname.endsWith('/repos')) return Response.json({ items: [] });
        return Response.json(
          { error: { code: 'NOT_FOUND', message: '接口不存在' } },
          { status: 404 },
        );
      }),
    );
    installConnection(connectionDeps);
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    void sidecar.start();
    expect(await screen.findByRole('heading', { name: '本地服务没有启动' })).toBeTruthy();
    sessionStorage.setItem('agent-hub.devUiToken', `ahu_${'x'.repeat(43)}`);
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByTitle('Codex：就绪')).toBeTruthy();
    const pending = await screen.findByRole('link', { name: '待审批 1' });
    await user.click(pending);
    await waitFor(() => {
      expect(window.location.hash).toContain('/tasks/5f0c2a9e-6b1d-4c8e-9a7f-3d2b1c0e9f84');
      expect(window.location.hash).toContain('tab=approvals');
    });
    expect(FakeSocket.instances[0]?.url).toBe('ws://127.0.0.1:47821/api/v1/ws');
    vi.unstubAllGlobals();
    globalThis.WebSocket = Original;
  });
});
