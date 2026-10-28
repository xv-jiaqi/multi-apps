import { api } from '../api/api';
import { AttentionWatcher, agentDisplayNameFromQuery } from '../api/attention-watcher';
import { client } from '../api/client';
import { socket } from '../api/socket';
import { notifyInBackground } from '../desktop/attention';
import { sidecar } from '../desktop/sidecar';
import type { ConnectionDeps } from './connection';
import { queryClient } from './query-client';

export const watcher = new AttentionWatcher({
  subscribeTask: (taskId, handlers) => socket.subscribeTask(taskId, handlers),
  notify: (text) => {
    void notifyInBackground(text);
  },
  isBackground: () => document.hidden || !document.hasFocus(),
  agentDisplayName: (agentId) => agentDisplayNameFromQuery(queryClient, agentId),
});

export const connectionDeps: ConnectionDeps = {
  sidecar,
  client,
  socket,
  queryClient,
  watcher,
  listTasks: api.listTasks,
};

export { queryClient };
