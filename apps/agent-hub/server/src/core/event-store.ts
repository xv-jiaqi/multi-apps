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

export const DELTA_FLUSH_MS = 200;
export const DELTA_FLUSH_BYTES = 16 * 1024;
export const TOOL_OUTPUT_CAP_BYTES = 1024 * 1024;

interface Pending {
  turnId: string | null;
  event: DeltaEvent;
}

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
    this.flush(taskId);
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

  flush(taskId: string): void {
    const buf = this.buffers.get(taskId);
    if (!buf || buf.items.length === 0) return;
    if (buf.timer) clearTimeout(buf.timer);
    this.buffers.delete(taskId);
    const envs = this.db.tx(() =>
      buf.items.map((p) => this.persistInTx(taskId, p.turnId, p.event)),
    );
    for (const env of envs) this.publish(env);
  }

  flushAll(): void {
    for (const taskId of [...this.buffers.keys()]) this.flush(taskId);
  }

  list(taskId: string, afterSeq: number, limit: number): HubEventEnvelope[] {
    return this.repo.list(taskId, afterSeq, limit);
  }

  forgetTask(taskId: string): void {
    this.flush(taskId);
    this.toolBytes.delete(taskId);
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
