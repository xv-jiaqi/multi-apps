import { Inject, Injectable } from '@nestjs/common';
import {
  isDeltaEvent,
  type DeltaEvent,
  type HubEvent,
  type HubEventEnvelope,
} from '@agent-hub/contract';
import { HUB_DB } from '../common/tokens';
import { EventsRepo } from '../db/repositories/events.repo';
import type { Db } from '../db/sqlite';
import { EventBus } from './event-bus';
import { splitForRedaction } from './secret-holdback';

export const DELTA_FLUSH_MS = 200;
export const DELTA_FLUSH_BYTES = 16 * 1024;
export const TOOL_OUTPUT_CAP_BYTES = 1024 * 1024;

interface Pending {
  turnId: string | null;
  event: DeltaEvent;
}

/** 结束哪些输出流：'all' = 本任务全部；字符串 = 这个 itemId 的各路输出。 */
export type StreamEnd = 'all' | string;

/** 这些事件表示对应 itemId 的输出已写完，扣住的尾巴可以放出来。 */
const ITEM_END_EVENTS = new Set(['message.completed', 'reasoning.completed', 'tool.completed']);

interface TaskBuffer {
  items: Pending[];
  bytes: number;
  timer: NodeJS.Timeout | null;
}

/** architecture.md §6：增量合并、分配 seq、先落库再广播。 */
@Injectable()
export class EventStore {
  private readonly repo: EventsRepo;
  private readonly buffers = new Map<string, TaskBuffer>();
  /** taskId → itemId → 已落库的工具输出字节数（-1 = 已截断）。 */
  private readonly toolBytes = new Map<string, Map<string, number>>();
  /** taskId → `${type}\u0000${itemId}` → 扣住的尾巴（secret-holdback.ts），等下一块或这一路结束。 */
  private readonly holds = new Map<string, Map<string, Pending>>();

  constructor(
    @Inject(HUB_DB) private readonly db: Db,
    private readonly bus: EventBus,
  ) {
    this.repo = new EventsRepo(db);
  }

  append(taskId: string, turnId: string | null, event: HubEvent): void {
    if (isDeltaEvent(event)) {
      this.bufferDelta(taskId, turnId, event);
      return;
    }
    let end: StreamEnd | undefined;
    if (event.type === 'turn.completed') end = 'all';
    else if (ITEM_END_EVENTS.has(event.type) && 'itemId' in event) end = event.itemId;
    this.flush(taskId, end);
    this.persist(taskId, turnId, event);
  }

  /** 在事务里写一条事件（调用方已在 db.tx 里时直接复用）。返回信封但不广播。 */
  persistInTx(taskId: string, turnId: string | null, event: HubEvent): HubEventEnvelope {
    const seq = this.repo.nextSeq(taskId);
    const env: HubEventEnvelope = { taskId, seq, turnId, ts: new Date().toISOString(), event };
    this.repo.insert(env, isDeltaEvent(event));
    return env;
  }

  publish(env: HubEventEnvelope): void {
    this.bus.publishEvent(env);
  }

  /**
   * 把缓冲的增量落库并广播。每路输出末尾可能是半个密钥的部分扣住不发（secret-holdback.ts），
   * 和下一块拼起来再切；end 指定的输出流（或 'all'）已经写完，整段放出。
   */
  flush(taskId: string, end?: StreamEnd): void {
    const buf = this.buffers.get(taskId);
    const held = this.holds.get(taskId);
    if ((!buf || buf.items.length === 0) && !(end && held?.size)) return;
    if (buf) {
      if (buf.timer) clearTimeout(buf.timer);
      this.buffers.delete(taskId);
    }
    const out = this.cutAtSafeBoundaries(taskId, buf?.items ?? [], end);
    if (out.length === 0) return;
    const envs = this.db.tx(() => out.map((p) => this.persistInTx(taskId, p.turnId, p.event)));
    for (const env of envs) this.publish(env);
  }

  /** 进程退出前：所有任务的所有输出都放出来。 */
  flushAll(): void {
    for (const taskId of new Set([...this.buffers.keys(), ...this.holds.keys()]))
      this.flush(taskId, 'all');
  }

  list(taskId: string, afterSeq: number, limit: number): HubEventEnvelope[] {
    return this.repo.list(taskId, afterSeq, limit);
  }

  forgetTask(taskId: string): void {
    this.flush(taskId, 'all');
    this.toolBytes.delete(taskId);
    this.holds.delete(taskId);
  }

  private cutAtSafeBoundaries(taskId: string, items: Pending[], end?: StreamEnd): Pending[] {
    let held = this.holds.get(taskId);
    if (!held) {
      held = new Map();
      this.holds.set(taskId, held);
    }
    const ends = (ev: DeltaEvent) => end === 'all' || end === ev.itemId;
    const out: Pending[] = [];
    const emit = (p: Pending) => {
      if (p.event.text !== '' || ('truncated' in p.event && p.event.truncated)) out.push(p);
    };
    for (const item of items) {
      const key = `${item.event.type}\u0000${item.event.itemId}`;
      const prev = held.get(key);
      held.delete(key);
      const truncated = 'truncated' in item.event && item.event.truncated === true;
      let text = item.event.text;
      if (prev && (prev.turnId !== item.turnId || truncated)) emit(prev);
      else if (prev) text = prev.event.text + text;
      if (truncated) {
        emit(item);
        continue;
      }
      const turnId = prev && prev.turnId === item.turnId ? prev.turnId : item.turnId;
      const { emit: now, hold } = splitForRedaction(text, ends(item.event));
      emit({ turnId, event: { ...item.event, text: now } as DeltaEvent });
      if (hold) held.set(key, { turnId, event: { ...item.event, text: hold } as DeltaEvent });
    }
    // 这次没有新增量、但已经结束的输出流：把扣住的尾巴放出来。
    for (const [key, p] of [...held]) {
      if (!ends(p.event)) continue;
      held.delete(key);
      emit(p);
    }
    if (held.size === 0) this.holds.delete(taskId);
    return out;
  }

  private persist(taskId: string, turnId: string | null, event: HubEvent): HubEventEnvelope {
    const env = this.db.tx(() => this.persistInTx(taskId, turnId, event));
    this.publish(env);
    return env;
  }

  private bufferDelta(taskId: string, turnId: string | null, event: DeltaEvent): void {
    let ev = event;
    if (ev.type === 'tool.output.delta') {
      const capped = this.capToolOutput(taskId, ev);
      if (!capped) return;
      ev = capped;
    }
    let buf = this.buffers.get(taskId);
    if (!buf) {
      buf = { items: [], bytes: 0, timer: null };
      this.buffers.set(taskId, buf);
    }
    const last = buf.items[buf.items.length - 1];
    if (
      last &&
      last.turnId === turnId &&
      last.event.type === ev.type &&
      last.event.itemId === ev.itemId &&
      !('truncated' in ev && ev.truncated)
    ) {
      last.event = { ...last.event, text: last.event.text + ev.text } as DeltaEvent;
    } else {
      buf.items.push({ turnId, event: ev });
    }
    buf.bytes += Buffer.byteLength(ev.text, 'utf8');
    if (buf.bytes >= DELTA_FLUSH_BYTES) {
      this.flush(taskId);
      return;
    }
    buf.timer ??= setTimeout(() => this.flush(taskId), DELTA_FLUSH_MS);
  }

  private capToolOutput(
    taskId: string,
    ev: Extract<DeltaEvent, { type: 'tool.output.delta' }>,
  ): DeltaEvent | null {
    let perTask = this.toolBytes.get(taskId);
    if (!perTask) {
      perTask = new Map();
      this.toolBytes.set(taskId, perTask);
    }
    const used = perTask.get(ev.itemId) ?? 0;
    if (used < 0) return null;
    const size = Buffer.byteLength(ev.text, 'utf8');
    if (used + size > TOOL_OUTPUT_CAP_BYTES) {
      perTask.set(ev.itemId, -1);
      return { type: 'tool.output.delta', itemId: ev.itemId, text: '', truncated: true };
    }
    perTask.set(ev.itemId, used + size);
    return ev;
  }
}
