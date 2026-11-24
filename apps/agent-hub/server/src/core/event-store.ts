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
import { guardCut, splitForRedaction } from './secret-holdback';

export const DELTA_FLUSH_MS = 200;
export const DELTA_FLUSH_BYTES = 16 * 1024;
export const TOOL_OUTPUT_CAP_BYTES = 1024 * 1024;
/**
 * 一个任务所有输出流扣住的尾巴合计最多这么多字符（审查 6041423500 第 4 条）。单路最多扣 64 KiB
 * （MAX_HOLD_CHARS），路数却没有上限；超过时从最久没更新的那一路开始整段放出。
 */
export const MAX_TASK_HOLD_CHARS = 1024 * 1024;

interface Pending {
  turnId: string | null;
  event: DeltaEvent;
}

/**
 * 结束哪些输出流：'all' = 本任务全部；'text' = 本任务的消息与推理（不含工具输出）；
 * 其他字符串 = 这个 itemId 的各路输出。
 */
export type StreamEnd = 'all' | 'text' | string;

const TEXT_DELTAS = new Set(['message.delta', 'reasoning.delta']);

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
    const ends = (ev: DeltaEvent) =>
      end === 'all' || end === ev.itemId || (end === 'text' && TEXT_DELTAS.has(ev.type));
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
    // 合计上限：Map 按最近一次扣住的先后排序，最前面的是最久没更新的。
    let total = 0;
    for (const p of held.values()) total += p.event.text.length;
    for (const [key, p] of held) {
      if (total <= MAX_TASK_HOLD_CHARS) break;
      held.delete(key);
      total -= p.event.text.length;
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
    if (event.type === 'tool.output.delta') {
      for (const ev of this.capToolOutput(taskId, turnId, event))
        this.pushDelta(taskId, turnId, ev);
      return;
    }
    this.pushDelta(taskId, turnId, event);
  }

  private pushDelta(taskId: string, turnId: string | null, ev: DeltaEvent): void {
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

  /**
   * 每个工具 item 的输出最多落库 TOOL_OUTPUT_CAP_BYTES（UTF-8 字节）。越界的那一块截到正好剩余的额度
   * （不切开 UTF-8 字符和代理对；截断点落在密钥中间时退到密钥前，guardCut），再跟一条 truncated 标记，
   * 之后的输出丢弃。
   */
  private capToolOutput(
    taskId: string,
    turnId: string | null,
    ev: Extract<DeltaEvent, { type: 'tool.output.delta' }>,
  ): DeltaEvent[] {
    let perTask = this.toolBytes.get(taskId);
    if (!perTask) {
      perTask = new Map();
      this.toolBytes.set(taskId, perTask);
    }
    const used = perTask.get(ev.itemId) ?? 0;
    if (used < 0) return [];
    const size = Buffer.byteLength(ev.text, 'utf8');
    if (used + size <= TOOL_OUTPUT_CAP_BYTES) {
      perTask.set(ev.itemId, used + size);
      return [ev];
    }
    perTask.set(ev.itemId, -1);
    const marker: DeltaEvent = {
      type: 'tool.output.delta',
      itemId: ev.itemId,
      text: '',
      truncated: true,
    };
    const keep = prefixWithinBytes(ev.text, TOOL_OUTPUT_CAP_BYTES - used);
    // 匹配要连同还没落库的同一路文字（扣住的尾巴 + 缓冲里的增量）一起找，密钥可能从前面开始。
    const before = this.pendingText(taskId, turnId, ev.itemId);
    const cut = guardCut(before + ev.text, before.length + keep) - before.length;
    if (cut <= 0) return [marker];
    return [{ ...ev, text: ev.text.slice(0, cut) }, marker];
  }

  /** 这一路工具输出还没落库的文字：扣住的尾巴 + 缓冲里的增量。 */
  private pendingText(taskId: string, turnId: string | null, itemId: string): string {
    const held = this.holds.get(taskId)?.get(`tool.output.delta\u0000${itemId}`);
    let text = held && held.turnId === turnId ? held.event.text : '';
    for (const p of this.buffers.get(taskId)?.items ?? []) {
      if (p.event.type === 'tool.output.delta' && p.event.itemId === itemId) text += p.event.text;
    }
    return text;
  }
}

/** text 的最长前缀，UTF-8 不超过 maxBytes 字节；按码点切，不会切开代理对。 */
function prefixWithinBytes(text: string, maxBytes: number): number {
  let bytes = 0;
  let i = 0;
  for (const ch of text) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (bytes + b > maxBytes) break;
    bytes += b;
    i += ch.length;
  }
  return i;
}
