import { useEffect, useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { nextNoticeId, type Notice } from './notice';

const TOAST_MS = 3000;

let queued: string | null = null;

export function enqueueStatusToast(text: string): void {
  queued = text;
}

export function consumeQueuedStatusToast(): string | null {
  const text = queued;
  queued = null;
  return text;
}

/** For tests. */
export function resetQueuedStatusToast(): void {
  queued = null;
}

export function isWebEnv(): boolean {
  const env = typeof Taro.getEnv === 'function' ? String(Taro.getEnv()) : '';
  return env === '' || env === 'WEB';
}

/**
 * Native Toast on weapp (auto-dismisses, no custom bar). On H5, a
 * role=status node that auto-dismisses after 3s. When leaving the
 * current page, pass `persistAcrossPages` so the next page can show
 * the H5 node; weapp still uses Taro.showToast which survives navigation.
 */
export function announceStatusToast(
  text: string,
  options?: { persistAcrossPages?: boolean },
): void {
  if (!isWebEnv()) {
    void Taro.showToast({ title: text, icon: 'none', duration: TOAST_MS });
    if (options?.persistAcrossPages) enqueueStatusToast(text);
    return;
  }
  if (options?.persistAcrossPages) {
    enqueueStatusToast(text);
    return;
  }
  enqueueStatusToast(text);
}

export function useStatusToast(): {
  notice: Notice<{ text: string }> | null;
  show: (text: string, options?: { persistAcrossPages?: boolean }) => void;
  consumeQueued: () => void;
} {
  const [notice, setNotice] = useState<Notice<{ text: string }> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const display = (text: string) => {
    clearTimer();
    if (!isWebEnv()) {
      void Taro.showToast({ title: text, icon: 'none', duration: TOAST_MS });
      setNotice(null);
      return;
    }
    setNotice({ id: nextNoticeId(), text });
    timerRef.current = setTimeout(() => setNotice(null), TOAST_MS);
  };

  const show = (text: string, options?: { persistAcrossPages?: boolean }) => {
    if (options?.persistAcrossPages) {
      if (!isWebEnv()) {
        void Taro.showToast({ title: text, icon: 'none', duration: TOAST_MS });
      }
      enqueueStatusToast(text);
      return;
    }
    display(text);
  };

  const consumeQueued = () => {
    const text = consumeQueuedStatusToast();
    if (text) display(text);
  };

  useEffect(() => () => clearTimer(), []);

  return { notice, show, consumeQueued };
}

export const STATUS_TOAST_DURATION_MS = TOAST_MS;
