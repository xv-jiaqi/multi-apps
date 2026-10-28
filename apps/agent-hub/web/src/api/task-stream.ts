import type { HubEventEnvelope } from '@agent-hub/contract';
import type { TimelineSnapshot } from '../lib/timeline';
import { timeline } from '../lib/timeline';
import { socket } from './socket';

const EMPTY: TimelineSnapshot = { items: [], usage: new Map(), lastSeq: 0 };

type Listener = () => void;

interface OpenHooks {
  onGone?: () => void;
}

class TaskStreamStore {
  private readonly listeners = new Set<Listener>();
  private readonly refs = new Map<string, number>();
  private readonly gone = new Set<string>();
  private readonly buffers = new Map<string, HubEventEnvelope[]>();
  private frame = 0;
  private snapshotCache = new Map<string, TimelineSnapshot>();

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot(taskId: string): TimelineSnapshot {
    if (this.gone.has(taskId)) return this.snapshotCache.get(taskId) ?? EMPTY;
    const current = timeline.snapshot(taskId);
    const cached = this.snapshotCache.get(taskId);
    if (
      cached &&
      cached.items === current.items &&
      cached.lastSeq === current.lastSeq &&
      cached.usage === current.usage
    ) {
      return cached;
    }
    this.snapshotCache.set(taskId, current);
    return current;
  }

  isGone(taskId: string): boolean {
    return this.gone.has(taskId);
  }

  open(taskId: string, hooks?: OpenHooks): () => void {
    this.refs.set(taskId, (this.refs.get(taskId) ?? 0) + 1);
    timeline.touch(taskId);
    timeline.evict((id) => (this.refs.get(id) ?? 0) > 0);
    const unsubscribe = socket.subscribeTask(taskId, {
      afterSeq: () => timeline.snapshot(taskId).lastSeq,
      onEvent: (envelope) => this.push(envelope),
      onGone: () => {
        this.gone.add(taskId);
        hooks?.onGone?.();
        this.emit();
      },
    });
    return () => {
      unsubscribe();
      const next = (this.refs.get(taskId) ?? 1) - 1;
      if (next <= 0) this.refs.delete(taskId);
      else this.refs.set(taskId, next);
    };
  }

  private push(envelope: HubEventEnvelope): void {
    const list = this.buffers.get(envelope.taskId) ?? [];
    list.push(envelope);
    this.buffers.set(envelope.taskId, list);
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const batches = [...this.buffers.values()];
      this.buffers.clear();
      let changed = false;
      for (const batch of batches) {
        if (timeline.apply(batch)) changed = true;
      }
      if (changed) this.emit();
    });
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const taskStreams = new TaskStreamStore();
