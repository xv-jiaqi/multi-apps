import type { ApprovalDto, HubEventEnvelope, TaskDto } from '@agent-hub/contract';
import { WS_CLOSE_CODES } from '@agent-hub/contract';
import { wsServerMessageSchema } from './schemas';

const SOCKET_OPEN = 1;

export interface SocketLike {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  send(data: string): void;
  close(): void;
}

export function openBrowserSocket(url: string): SocketLike {
  const ws = new WebSocket(url);
  return {
    get readyState() {
      return ws.readyState;
    },
    send(data: string) {
      ws.send(data);
    },
    close() {
      ws.close();
    },
    set onopen(handler: (() => void) | null) {
      ws.onopen = handler ? () => handler() : null;
    },
    get onopen() {
      return null;
    },
    set onmessage(handler: ((event: { data: unknown }) => void) | null) {
      ws.onmessage = handler ? (event) => handler({ data: event.data }) : null;
    },
    get onmessage() {
      return null;
    },
    set onclose(handler: ((event: { code: number }) => void) | null) {
      ws.onclose = handler ? (event) => handler({ code: event.code }) : null;
    },
    get onclose() {
      return null;
    },
  };
}

export type SocketStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'stopped';

export interface TasksHandlers {
  onTask(task: TaskDto): void;
  onApproval(approval: ApprovalDto): void;
  onResync(): void;
}

export interface TaskHandlers {
  afterSeq(): number;
  onEvent(envelope: HubEventEnvelope): void;
  onGone(): void;
}

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000];
const STOP_CODES: ReadonlySet<number> = new Set([
  WS_CLOSE_CODES.BAD_MESSAGE,
  WS_CLOSE_CODES.UNAUTHORIZED,
  WS_CLOSE_CODES.FORBIDDEN,
]);

type Listener = () => void;

interface TaskSub {
  handlers: Set<TaskHandlers>;
  sentAfterSeq: number;
}

export interface HubSocket {
  connect(url: string, token: string): void;
  subscribeTasks(handlers: TasksHandlers): () => void;
  subscribeTask(taskId: string, handlers: TaskHandlers): () => void;
  getStatus(): SocketStatus;
  subscribeStatus(listener: Listener): () => void;
}

export function createSocket(
  connectTransport: (url: string) => SocketLike = openBrowserSocket,
): HubSocket {
  let url = '';
  let token = '';
  let status: SocketStatus = 'idle';
  let attempt = 0;
  let generation = 0;
  let socket: SocketLike | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<Listener>();
  const taskListHandlers = new Set<TasksHandlers>();
  const taskSubs = new Map<string, TaskSub>();
  const tasksSubId = 'tasks';

  function setStatus(next: SocketStatus): void {
    if (status === next) return;
    status = next;
    for (const listener of listeners) listener();
  }

  function clearTimer(): void {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  function usable(): boolean {
    return status === 'connecting' || status === 'open' || status === 'reconnecting';
  }

  function send(message: unknown): void {
    if (!socket || socket.readyState !== SOCKET_OPEN) return;
    socket.send(JSON.stringify(message));
  }

  function sendSubscriptions(): void {
    if (taskListHandlers.size > 0) {
      send({ op: 'subscribe', id: tasksSubId, topic: 'tasks' });
    }
    for (const [taskId, sub] of taskSubs) {
      const afterSeq = minAfterSeq(sub.handlers);
      sub.sentAfterSeq = afterSeq;
      send({ op: 'subscribe', id: taskSubId(taskId), topic: 'task', taskId, afterSeq });
    }
  }

  function openSocket(nextStatus: 'connecting' | 'reconnecting'): void {
    clearTimer();
    generation += 1;
    const currentGeneration = generation;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.close();
    }
    setStatus(nextStatus);
    const ws = connectTransport(url);
    socket = ws;
    ws.onopen = () => {
      if (currentGeneration !== generation) return;
      ws.send(JSON.stringify({ op: 'auth', token }));
    };
    ws.onmessage = (event) => {
      if (currentGeneration !== generation) return;
      handleMessage(event.data);
    };
    ws.onclose = (event) => {
      if (currentGeneration !== generation) return;
      socket = null;
      handleClose(event.code);
    };
  }

  function handleClose(code: number): void {
    if (STOP_CODES.has(code)) {
      setStatus('stopped');
      return;
    }
    const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)] ?? 10_000;
    attempt += 1;
    setStatus('reconnecting');
    timer = setTimeout(() => openSocket('reconnecting'), delay);
  }

  function handleMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    const message = wsServerMessageSchema.safeParse(parsed);
    if (!message.success) return;
    const body = message.data;
    if (body.op === 'ready') {
      attempt = 0;
      setStatus('open');
      sendSubscriptions();
      return;
    }
    if (body.op === 'subscribed') {
      if (body.id === tasksSubId) {
        for (const handlers of taskListHandlers) handlers.onResync();
      }
      return;
    }
    if (body.op === 'task') {
      for (const handlers of taskListHandlers) handlers.onTask(body.task);
      return;
    }
    if (body.op === 'approval') {
      for (const handlers of taskListHandlers) handlers.onApproval(body.approval);
      return;
    }
    if (body.op === 'event') {
      const taskId = taskIdFromSub(body.id) ?? body.taskId;
      const sub = taskSubs.get(taskId);
      if (!sub) return;
      const envelope: HubEventEnvelope = {
        taskId: body.taskId,
        seq: body.seq,
        turnId: body.turnId,
        ts: body.ts,
        event: body.event,
      };
      for (const handlers of sub.handlers) handlers.onEvent(envelope);
      return;
    }
    if (body.op === 'error' && body.code === 'TASK_NOT_FOUND' && body.id) {
      const taskId = taskIdFromSub(body.id);
      if (!taskId) return;
      const sub = taskSubs.get(taskId);
      taskSubs.delete(taskId);
      if (!sub) return;
      for (const handlers of sub.handlers) handlers.onGone();
    }
  }

  return {
    connect(nextUrl, nextToken) {
      if (nextUrl === url && nextToken === token && usable()) return;
      url = nextUrl;
      token = nextToken;
      attempt = 0;
      openSocket('connecting');
    },
    subscribeTasks(handlers) {
      taskListHandlers.add(handlers);
      if (status === 'open' && taskListHandlers.size === 1) {
        send({ op: 'subscribe', id: tasksSubId, topic: 'tasks' });
      }
      return () => {
        taskListHandlers.delete(handlers);
        if (taskListHandlers.size === 0 && status === 'open') {
          send({ op: 'unsubscribe', id: tasksSubId });
        }
      };
    },
    subscribeTask(taskId, handlers) {
      let sub = taskSubs.get(taskId);
      if (!sub) {
        sub = { handlers: new Set(), sentAfterSeq: handlers.afterSeq() };
        taskSubs.set(taskId, sub);
      }
      sub.handlers.add(handlers);
      const afterSeq = minAfterSeq(sub.handlers);
      if (status === 'open' && (sub.handlers.size === 1 || afterSeq < sub.sentAfterSeq)) {
        if (sub.handlers.size > 1) send({ op: 'unsubscribe', id: taskSubId(taskId) });
        sub.sentAfterSeq = afterSeq;
        send({ op: 'subscribe', id: taskSubId(taskId), topic: 'task', taskId, afterSeq });
      }
      return () => {
        const current = taskSubs.get(taskId);
        if (!current) return;
        current.handlers.delete(handlers);
        if (current.handlers.size === 0) {
          taskSubs.delete(taskId);
          if (status === 'open') send({ op: 'unsubscribe', id: taskSubId(taskId) });
        }
      };
    },
    getStatus: () => status,
    subscribeStatus(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const socket = createSocket();

function taskSubId(taskId: string): string {
  return `task:${taskId}`;
}

function taskIdFromSub(id: string): string | null {
  return id.startsWith('task:') ? id.slice('task:'.length) : null;
}

function minAfterSeq(handlers: Set<TaskHandlers>): number {
  let min = Number.POSITIVE_INFINITY;
  for (const handlersItem of handlers) {
    const value = handlersItem.afterSeq();
    if (value < min) min = value;
  }
  if (!Number.isFinite(min)) return 0;
  return min;
}
