import type { HubEventEnvelope } from '@agent-hub/contract';

export interface EventFeed {
  /** seq > afterSeq 的事件，按 seq 升序，最多 limit 条（events.repo 的 listEvents）。 */
  list(taskId: string, afterSeq: number, limit: number): HubEventEnvelope[];
  /** 订阅该任务落库之后广播的事件（EventBus）；返回取消函数。 */
  subscribe(taskId: string, listener: (env: HubEventEnvelope) => void): () => void;
}

const PAGE = 500;

/**
 * 先订阅（回放期间只占位、不缓存），再分页回放库里 seq > afterSeq 的事件，然后同步补齐回放期间
 * 落库的事件并切到跟随，之后直接转发。补齐与切换之间没有 await，按 seq 去重，衔接处不重不漏。
 *
 * - 回放：逐条等 send 写完再发下一条。历史在库里，按客户端的速度补，不占内存也不占待发送额度，
 *   断线重连补大量历史时不会被误判为慢消费者。
 * - 跟随：send 立即把消息交给 socket（ws 自己保证顺序），不串成 Promise 链。积压留在 socket 上，
 *   调用方按待发送字节数判断慢消费者并以 4008 关闭（§6.4）。
 *
 * send 在数据写出后 resolve；连接断开时也要 resolve，不能 reject。
 */
export async function replayThenFollow(
  feed: EventFeed,
  taskId: string,
  afterSeq: number,
  send: (env: HubEventEnvelope) => Promise<void>,
  signal: AbortSignal,
): Promise<() => void> {
  let lastSent = afterSeq;
  let following = false;
  let tail: Promise<void> = Promise.resolve();
  const push = (env: HubEventEnvelope): void => {
    if (env.seq <= lastSent) return;
    lastSent = env.seq;
    tail = send(env);
  };
  // 回放期间到达的事件已经在库里（先落库后广播），由下面的补齐读出来，这里不缓存。
  const unsubscribe = feed.subscribe(taskId, (env) => {
    if (following) push(env);
  });
  try {
    for (;;) {
      if (signal.aborted) break;
      const page = feed.list(taskId, lastSent, PAGE);
      for (const env of page) {
        if (signal.aborted) break;
        push(env);
        await tail;
      }
      if (page.length < PAGE) break;
    }
    // 补齐并切到跟随：同步完成，中间没有新事件能插进来。
    while (!signal.aborted) {
      const page = feed.list(taskId, lastSent, PAGE);
      for (const env of page) push(env);
      if (page.length < PAGE) break;
    }
    following = true;
  } catch (err) {
    unsubscribe();
    throw err;
  }
  return unsubscribe;
}
