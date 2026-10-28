export type ToastTone = 'info' | 'error';
export type ToastItem = { id: number; text: string; tone: ToastTone };

const MAX_TOASTS = 3;
const INFO_MS = 4_000;
const ERROR_MS = 8_000;

type Listener = () => void;

export class ToastStore {
  private items: readonly ToastItem[] = [];
  private nextId = 1;
  private readonly listeners = new Set<Listener>();
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  readonly getSnapshot = (): readonly ToastItem[] => this.items;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  info(text: string): number {
    return this.push(text, 'info', INFO_MS);
  }

  error(text: string): number {
    return this.push(text, 'error', ERROR_MS);
  }

  dismiss(id: number): void {
    this.clearTimer(id);
    const next = this.items.filter((item) => item.id !== id);
    if (next.length === this.items.length) return;
    this.items = next;
    this.emit();
  }

  private push(text: string, tone: ToastTone, ttl: number): number {
    const id = this.nextId;
    this.nextId += 1;
    const item: ToastItem = { id, text, tone };
    const combined = [...this.items, item];
    const dropped =
      combined.length > MAX_TOASTS ? combined.slice(0, combined.length - MAX_TOASTS) : [];
    for (const old of dropped) this.clearTimer(old.id);
    this.items =
      combined.length > MAX_TOASTS ? combined.slice(combined.length - MAX_TOASTS) : combined;
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), ttl),
    );
    this.emit();
    return id;
  }

  private clearTimer(id: number): void {
    const timer = this.timers.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.timers.delete(id);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const toast = new ToastStore();
