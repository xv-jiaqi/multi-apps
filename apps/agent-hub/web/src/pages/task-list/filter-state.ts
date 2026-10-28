import type { ListFilterState } from '../../lib/list-filter';

let state: ListFilterState = { status: 'all', agentId: '', source: '', q: '' };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export const listFilterStore = {
  get: (): ListFilterState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  set(patch: Partial<ListFilterState>): void {
    state = { ...state, ...patch };
    emit();
  },
  clear(): void {
    state = { status: 'all', agentId: '', source: '', q: '' };
    emit();
  },
};
