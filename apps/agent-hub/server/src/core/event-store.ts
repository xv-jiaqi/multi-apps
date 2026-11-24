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
import { splitForRedaction, type ReleaseMode } from './secret-holdback';

export const DELTA_FLUSH_MS = 200;
export const DELTA_FLUSH_BYTES = 16 * 1024;
export const TOOL_OUTPUT_CAP_BYTES = 1024 * 1024;
/**
 * 一个任务所有输出流扣住的尾巴合计最多这么多字符（审查 6041423500 第 4 条）。单路最多扣 64 KiB
 * （MAX_HOLD_CHARS），路数却没有上限；超过时从最久没更新的那一路开始用 splitForRedaction(..., 'force')
 * 放出安全前段，短尾继续扣着（审查 6042585463）。
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
  /**
   * force 整段放出一个完整匹配之后，这一路后续文字要先拼上这段再切（审查 6042585463）。
   * 避免 greedy 规则（如 sk- 后面还能加长）把后半段单独落成一条明文。
   */
  private readonly stitch = new Map<string, Map<string, string>>();

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
    this.stitch.delete(taskId);
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
    const stitchOf = (key: string) => this.stitch.get(taskId)?.get(key) ?? '';
    const setStitch = (key: string, value: string) => {
      let m = this.stitch.get(taskId);
      if (!value) {
        m?.delete(key);
        if (m && m.size === 0) this.stitch.delete(taskId);
        return;
      }
      if (!m) {
        m = new Map();
        this.stitch.set(taskId, m);
      }
      m.set(key, value);
    };
    /** 所有放出只走 splitForRedaction。返回仍需扣住的尾巴。 */
    const release = (p: Pending, mode: ReleaseMode, key: string): string => {
      const sticky = stitchOf(key);
      const text =
        sticky && !p.event.text.startsWith(sticky) ? sticky + p.event.text : p.event.text;
      const { emit: now, hold } = splitForRedaction(text, mode);
      let visible = now;
      if (sticky && now.startsWith(sticky)) visible = now.slice(sticky.length);
      else if (sticky && sticky.startsWith(now)) visible = '';
      emit({ turnId: p.turnId, event: { ...p.event, text: visible } as DeltaEvent });
      if (mode === 'force' && now && !hold && now === text) setStitch(key, now);
      else if (!(hold && sticky && hold.startsWith(sticky))) setStitch(key, '');
      return hold;
    };
    for (const item of items) {
      const key = `${item.event.type}\u0000${item.event.itemId}`;
      const prev = held.get(key);
      held.delete(key);
      const truncated = 'truncated' in item.event && item.event.truncated === true;
      let text = item.event.text;
      if (prev && (prev.turnId !== item.turnId || truncated)) {
        // 换轮或已经截断：这一路不会再有下文，整段放出（仍走 splitForRedaction）。
        release(prev, 'end', key);
      } else if (prev) text = prev.event.text + text;
      if (truncated) {
        emit(item);
        continue;
      }
      const turnId = prev && prev.turnId === item.turnId ? prev.turnId : item.turnId;
      const hold = release(
        { turnId, event: { ...item.event, text } as DeltaEvent },
        ends(item.event) ? 'end' : 'continue',
        key,
      );
      if (hold) held.set(key, { turnId, event: { ...item.event, text: hold } as DeltaEvent });
    }
    // 这次没有新增量、但已经结束的输出流：把扣住的尾巴放出来。
    for (const [key, p] of [...held]) {
      if (!ends(p.event)) continue;
      held.delete(key);
      release(p, 'end', key);
    }
    // 合计上限：Map 按最近一次扣住的先后排序，最前面的是最久没更新的。
    let total = 0;
    for (const p of held.values()) total += p.event.text.length;
    for (const [key, p] of held) {
      if (total <= MAX_TASK_HOLD_CHARS) break;
      const left = release(p, 'force', key);
      total -= p.event.text.length - left.length;
      if (left)
        held.set(key, { turnId: p.turnId, event: { ...p.event, text: left } as DeltaEvent });
      else held.delete(key);
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
   * 每个工具 item 的输出最多落库 TOOL_OUTPUT_CAP_BYTES（UTF-8 字节）。越界的那一块先按剩余额度取前缀
   * （不切开 UTF-8 字符和代理对），再交给 splitForRedaction(..., 'truncate')：截断点前那段连续非空白
   * 退到最后一个空白之后，再走切点保护（审查 6042585463）。截断后的安全前缀写回还没落库的同一路文字，
   * 再跟一条 truncated 标记，之后的输出丢弃。
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
    const before = this.pendingText(taskId, turnId, ev.itemId);
    const { emit } = splitForRedaction(before + ev.text, 'truncate', before.length + keep);
    this.replacePending(taskId, turnId, ev.itemId, emit);
    return [marker];
  }

  /** 把这一路还没落库的文字换成截断后的安全前缀（扣住的尾巴和缓冲里的增量一并替换）。 */
  private replacePending(
    taskId: string,
    turnId: string | null,
    itemId: string,
    text: string,
  ): void {
    const key = `tool.output.delta\u0000${itemId}`;
    this.holds.get(taskId)?.delete(key);
    const buf = this.buffers.get(taskId);
    if (buf) {
      const kept: Pending[] = [];
      for (const p of buf.items) {
        if (p.event.type === 'tool.output.delta' && p.event.itemId === itemId) {
          buf.bytes -= Buffer.byteLength(p.event.text, 'utf8');
        } else kept.push(p);
      }
      buf.items = kept;
      if (buf.items.length === 0 && buf.bytes < 0) buf.bytes = 0;
    }
    if (text) this.pushDelta(taskId, turnId, { type: 'tool.output.delta', itemId, text });
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
