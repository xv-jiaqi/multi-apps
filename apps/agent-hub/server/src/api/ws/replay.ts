import type { HubEventEnvelope } from '@agent-hub/contract';

export interface EventFeed {
  /** seq > afterSeq 的事件，按 seq 升序，最多 limit 条（events.repo 的 listEvents）。 */
  list(taskId: string, afterSeq: number, limit: number): HubEventEnvelope[];
  /** 订阅该任务落库之后广播的事件（EventBus）；返回取消函数。 */
  subscribe(taskId: string, listener: (env: HubEventEnvelope) => void): () => void;
}

const PAGE = 500;

/**
 * 先订阅（回放期间只占位、不缓存），再分页回放库里 seq > afterSeq 的事件，直到某次读库读不到新事件，
 * 在同一个同步段里切到跟随，之后直接转发。读空与切换之间没有 await，按 seq 去重，衔接处不重不漏。
 *
 * - 回放：逐条等 send 写完再发下一条，包括回放期间新落库的事件（追赶）。历史在库里，按客户端的速度补，
 *   不占内存也不占待发送额度；重连补几 MB 的历史或追赶时不会被误判为慢消费者（PR3 待办 6：原来的
 *   追赶是一次性同步写出，回放期间积累的事件多时会再次 4008，慢客户端可能永远追不上）。
 *   生产快于客户端时一直停在回放，不会断开。
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
    while (!signal.aborted) {
      const page = feed.list(taskId, lastSent, PAGE);
      if (page.length === 0) {
        // 读空到切换是同步的，中间没有新事件能插进来。
        following = true;
        break;
      }
      for (const env of page) {
        if (signal.aborted) break;
        push(env);
        await tail;
      }
    }
  } catch (err) {
    unsubscribe();
    throw err;
  }
  return unsubscribe;
}
