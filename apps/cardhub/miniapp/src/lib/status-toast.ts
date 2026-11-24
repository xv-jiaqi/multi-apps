import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { isWebEnv } from './env';
import { nextNoticeId, type Notice } from './notice';

const TOAST_MS = 3000;

export const STATUS_TOAST_DURATION_MS = TOAST_MS;

export type Rect = { x: number; y: number; width: number; height: number };

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return overlapArea(a, b) > 0;
}

export function overlapArea(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

export type StatusToastPlacement = 'top' | 'bottom' | { top: number };

function slotRect(y: number, toastSize: { width: number; height: number; inset: number }): Rect {
  return {
    x: toastSize.inset,
    y,
    width: toastSize.width,
    height: toastSize.height,
  };
}

function totalOverlap(slot: Rect, avoid: readonly Rect[]): number {
  return avoid.reduce((sum, box) => sum + overlapArea(slot, box), 0);
}

/**
 * Prefer the top of the viewport. Check both the top and bottom slots
 * against controls we must keep visible (submit, count, report form,
 * report/delete buttons). If both default slots would overlap, try a
 * mid-viewport slot that covers no avoid box (CH-301 §2.4 / WCAG 2.4.11).
 */
export function pickStatusToastPlacement(args: {
  viewport: { width: number; height: number };
  toastSize: { width: number; height: number; inset: number };
  avoid: readonly Rect[];
}): StatusToastPlacement {
  const { viewport, toastSize, avoid } = args;
  const topY = toastSize.inset;
  const bottomY = viewport.height - toastSize.inset - toastSize.height;
  const top = slotRect(topY, toastSize);
  const bottom = slotRect(bottomY, toastSize);
  const topArea = totalOverlap(top, avoid);
  const bottomArea = totalOverlap(bottom, avoid);
  if (topArea === 0) return 'top';
  if (bottomArea === 0) return 'bottom';

  const topHits = avoid.filter((box) => overlapArea(top, box) > 0);
  const belowTop = Math.max(...topHits.map((box) => box.y + box.height)) + toastSize.inset;
  if (belowTop + toastSize.height + toastSize.inset <= viewport.height) {
    if (totalOverlap(slotRect(belowTop, toastSize), avoid) === 0) {
      return { top: belowTop };
    }
  }

  const bottomHits = avoid.filter((box) => overlapArea(bottom, box) > 0);
  const aboveBottom =
    Math.min(...bottomHits.map((box) => box.y)) - toastSize.inset - toastSize.height;
  if (aboveBottom >= toastSize.inset) {
    if (totalOverlap(slotRect(aboveBottom, toastSize), avoid) === 0) {
      return { top: aboveBottom };
    }
  }

  return bottomArea < topArea ? 'bottom' : 'top';
}

export { isWebEnv };

export function useStatusToast(): {
  notice: Notice<{ text: string }> | null;
  show: (text: string) => void;
} {
  const [notice, setNotice] = useState<Notice<{ text: string }> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const show = (text: string) => {
    clearTimer();
    if (!isWebEnv()) {
      void Taro.showToast({ title: text, icon: 'none', duration: TOAST_MS });
      setNotice(null);
      return;
    }
    setNotice({ id: nextNoticeId(), text });
    timerRef.current = setTimeout(() => setNotice(null), TOAST_MS);
  };

  useEffect(() => () => clearTimer(), []);

  return { notice, show };
}

const DEFAULT_AVOID = '[data-toast-avoid]';
const DEFAULT_INSET = 16;
const DEFAULT_TOAST_HEIGHT = 48;

function rectOf(node: Element): Rect {
  const r = node.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

/** Avoid boxes plus the focused control, unless it already sits inside one. */
export function collectStatusToastAvoidRects(avoidSelector: string = DEFAULT_AVOID): Rect[] {
  if (typeof document === 'undefined') return [];
  const avoid = [...document.querySelectorAll(avoidSelector)]
    .map(rectOf)
    .filter((box) => box.width > 0 && box.height > 0);
  const active = document.activeElement;
  if (
    !(active instanceof HTMLElement) ||
    active === document.body ||
    active === document.documentElement ||
    active.closest('.miniapp-status-toast') ||
    active.closest(avoidSelector)
  ) {
    return avoid;
  }
  const focused = rectOf(active);
  if (focused.width > 0 && focused.height > 0) avoid.push(focused);
  return avoid;
}

/** Measure avoid boxes and pick top vs bottom while a toast is visible. */
export function useStatusToastPlacement(
  notice: Notice<{ text: string }> | null,
  avoidSelector: string = DEFAULT_AVOID,
): StatusToastPlacement {
  const [placement, setPlacement] = useState<StatusToastPlacement>('top');

  useLayoutEffect(() => {
    if (!notice || !isWebEnv()) {
      setPlacement('top');
      return;
    }
    const update = () => {
      const toastEl = document.querySelector('.miniapp-status-toast');
      const toastBox = toastEl?.getBoundingClientRect();
      const inset = toastBox && toastBox.x > 0 ? toastBox.x : DEFAULT_INSET;
      const height = toastBox && toastBox.height > 0 ? toastBox.height : DEFAULT_TOAST_HEIGHT;
      const width =
        toastBox && toastBox.width > 0
          ? toastBox.width
          : Math.max(0, window.innerWidth - inset * 2);
      setPlacement(
        pickStatusToastPlacement({
          viewport: { width: window.innerWidth, height: window.innerHeight },
          toastSize: { width, height, inset },
          avoid: collectStatusToastAvoidRects(avoidSelector),
        }),
      );
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      observer.disconnect();
    };
  }, [notice, avoidSelector]);

  return placement;
}
