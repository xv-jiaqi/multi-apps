// web/src/desktop/hooks.ts
import { useEffect, useSyncExternalStore, type RefObject } from 'react';
import { botPanel, type BotPanelState } from './bot-panel';
import { sidecar, type SidecarState } from './sidecar';

export function useSidecarState(): SidecarState {
  return useSyncExternalStore(sidecar.subscribe, sidecar.getState);
}

export function useBotPanelState(): BotPanelState {
  return useSyncExternalStore(botPanel.subscribe, botPanel.getState);
}

/** 浮层打开期间隐藏 Bot 面板（§5.3）。`HubDialog` / `HubAlertDialog` 里调用，其他地方不用。 */
export function useBotOcclusion(active: boolean): void {
  useEffect(() => (active ? botPanel.occlude() : undefined), [active]);
}

/** 把 `BotSlot` 元素的位置与大小同步给 Bot 面板；元素卸载（左栏收起）时隐藏面板。 */
export function useBotSlot(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    const report = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        botPanel.setSlot({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
      });
    };
    const observer = new ResizeObserver(report);
    observer.observe(element);
    window.addEventListener('resize', report);
    report();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', report);
      botPanel.setSlot(null);
    };
  }, [ref]);
}
