import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { isWebEnv } from './env';
import { nextNoticeId, type Notice } from './notice';

const TOAST_MS = 3000;

export const STATUS_TOAST_DURATION_MS = TOAST_MS;

export type Rect = { x: number; y: number; width: number; height: number };

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

/**
 * Prefer the top of the viewport; if that would cover a control we must
 * keep visible (submit button, character count), place the toast at the
 * bottom instead (CH-301 §2.4 / WCAG 2.4.11).
 */
export function pickStatusToastPlacement(args: {
  viewport: { width: number; height: number };
  toastSize: { width: number; height: number; inset: number };
  avoid: readonly Rect[];
}): 'top' | 'bottom' {
  const { toastSize, avoid } = args;
  const top: Rect = {
    x: toastSize.inset,
    y: toastSize.inset,
    width: toastSize.width,
    height: toastSize.height,
  };
  if (avoid.some((box) => rectsOverlap(top, box))) return 'bottom';
  return 'top';
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

/** Measure avoid boxes and pick top vs bottom while a toast is visible. */
export function useStatusToastPlacement(
  notice: Notice<{ text: string }> | null,
  avoidSelector: string = DEFAULT_AVOID,
): 'top' | 'bottom' {
  const [placement, setPlacement] = useState<'top' | 'bottom'>('top');

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
      const avoid = [...document.querySelectorAll(avoidSelector)].map((node) => {
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      setPlacement(
        pickStatusToastPlacement({
          viewport: { width: window.innerWidth, height: window.innerHeight },
          toastSize: { width, height, inset },
          avoid,
        }),
      );
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [notice, avoidSelector]);

  return placement;
}
