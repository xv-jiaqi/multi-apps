import type { QueryClient } from '@tanstack/react-query';
import type { ListTasksResponse, TaskDto } from '@agent-hub/contract';
import { applyApproval, applyTask, resyncAll } from '../api/cache';
import type { TaskListFilter } from '../api/types';
import type { HubClient } from '../api/client';
import type { HubSocket } from '../api/socket';
import type { SidecarState } from '../desktop/sidecar';

export interface ConnectionDeps {
  sidecar: { getState(): SidecarState; subscribe(listener: () => void): () => void };
  client: Pick<HubClient, 'configure'>;
  socket: Pick<HubSocket, 'connect' | 'subscribeTasks'>;
  queryClient: QueryClient;
  watcher: { onTask(task: TaskDto): void; stop(): void };
  listTasks: (filter: TaskListFilter, signal?: AbortSignal) => Promise<ListTasksResponse>;
}

export function installConnection(deps: ConnectionDeps): () => void {
  let readyKey = '';
  const unsubscribeTasks = deps.socket.subscribeTasks({
    onTask(task) {
      applyTask(deps.queryClient, task);
      deps.watcher.onTask(task);
    },
    onApproval(approval) {
      applyApproval(deps.queryClient, approval);
    },
    onResync() {
      resyncAll(deps.queryClient);
      void deps
        .listTasks({ archived: false, status: 'queued,preparing,running', limit: 50 })
        .then((page) => {
          for (const task of page.items) deps.watcher.onTask(task);
        })
        .catch(() => {
          // 同一条列表查询会在中栏原位显示错误，这里只是给通知观察者补进行中的任务。
        });
    },
  });

  const sync = (): void => {
    const state = deps.sidecar.getState();
    if (state.kind === 'ready') {
      const key = `${state.info.baseUrl}\n${state.info.wsUrl}\n${state.info.uiToken}`;
      if (key === readyKey) return;
      readyKey = key;
      deps.client.configure({ baseUrl: state.info.baseUrl, uiToken: state.info.uiToken });
      deps.socket.connect(state.info.wsUrl, state.info.uiToken);
      resyncAll(deps.queryClient);
      return;
    }
    if (readyKey) {
      readyKey = '';
      deps.client.configure(null);
    }
  };

  const unsubscribeSidecar = deps.sidecar.subscribe(sync);
  sync();
  return () => {
    unsubscribeTasks();
    unsubscribeSidecar();
    deps.watcher.stop();
  };
}
