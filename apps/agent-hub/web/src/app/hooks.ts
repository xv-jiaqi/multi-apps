import { useEffect, useState, useSyncExternalStore } from 'react';
import { taskStreams } from '../api/task-stream';
import type { TimelineSnapshot } from '../lib/timeline';
import type { HubConfig } from '@agent-hub/contract';
import { botPanel } from '../desktop/bot-panel';
import { setTrayCount } from '../desktop/attention';
import { useSidecarState } from '../desktop/hooks';

export function useTaskTimeline(taskId: string): TimelineSnapshot {
  const snapshot = useSyncExternalStore(
    taskStreams.subscribe,
    () => taskStreams.getSnapshot(taskId),
    () => taskStreams.getSnapshot(taskId),
  );
  useEffect(() => taskStreams.open(taskId), [taskId]);
  return snapshot;
}

export function useTaskGone(taskId: string): boolean {
  return useSyncExternalStore(
    taskStreams.subscribe,
    () => taskStreams.isGone(taskId),
    () => taskStreams.isGone(taskId),
  );
}

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = (): void => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

export function useDesktopSync(input: {
  settings: HubConfig | undefined;
  pendingCount: number;
}): void {
  const sidecar = useSidecarState();
  useEffect(() => {
    if (sidecar.kind !== 'ready' || !input.settings) return;
    void botPanel.configure(input.settings.bot);
  }, [sidecar, input.settings]);
  useEffect(() => {
    void setTrayCount(input.pendingCount);
  }, [input.pendingCount]);
}
