import type { HubEventEnvelope } from '@agent-hub/contract';

export interface EventFeed {
  /** seq > afterSeq 的事件，按 seq 升序，最多 limit 条（events.repo 的 listEvents）。 */
  list(taskId: string, afterSeq: number, limit: number): HubEventEnvelope[];
  /** 订阅该任务落库之后广播的事件（EventBus）；返回取消函数。 */
  subscribe(taskId: string, listener: (env: HubEventEnvelope) => void): () => void;
}

const PAGE = 500;

/**
 * 先订阅实时事件并缓冲，再分页回放库里 seq > afterSeq 的事件，最后输出缓冲里更新的部分，
 * 之后直接转发。按 seq 去重，衔接处不重不漏。
 * send 在数据写入 socket 后 resolve（背压），连接断开时也要 resolve，不能 reject。
 */
export async function replayThenFollow(
  feed: EventFeed,
  taskId: string,
  afterSeq: number,
  send: (env: HubEventEnvelope) => Promise<void>,
  signal: AbortSignal,
): Promise<() => void> {
  let lastSent = afterSeq;
  let buffered: HubEventEnvelope[] | null = [];
  let tail: Promise<void> = Promise.resolve();
  const push = (env: HubEventEnvelope): void => {
    if (env.seq <= lastSent) return;
    lastSent = env.seq;
    tail = tail.then(() => send(env));
  };
  const unsubscribe = feed.subscribe(taskId, (env) => {
    if (buffered) buffered.push(env);
    else push(env);
  });
  try {
    for (;;) {
      if (signal.aborted) break;
      const page = feed.list(taskId, lastSent, PAGE);
      for (const env of page) push(env);
      await tail;
      if (page.length < PAGE) break;
    }
    const pending = buffered;
    buffered = null;
    for (const env of pending) push(env);
  } catch (err) {
    unsubscribe();
    throw err;
  }
  return unsubscribe;
}
