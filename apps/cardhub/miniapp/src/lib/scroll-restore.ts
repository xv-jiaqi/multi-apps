import { useEffect, useRef, useState } from 'react';
import { useDidHide } from '@tarojs/taro';
import { readListScroll, writeListScroll, type ListSessionKey } from './list-session';

function matchingScrollNodes(selector: string): HTMLElement[] {
  if (typeof document === 'undefined') return [];
  return [...document.querySelectorAll(selector)].filter((node) => {
    if (!(node instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && node.clientHeight > 0;
  });
}

/** Remember a ScrollView offset and re-apply it after the page is shown again. */
export function useScrollRestore(selector: string, key: ListSessionKey) {
  const topRef = useRef(readListScroll(key));
  const skipRestore = useRef(false);
  const applyGen = useRef(0);
  const applyTimers = useRef<number[]>([]);
  const [scrollTop, setScrollTop] = useState(readListScroll(key));

  const clearApplyTimers = () => {
    applyTimers.current.forEach((id) => window.clearTimeout(id));
    applyTimers.current = [];
  };

  const apply = (top: number) => {
    setScrollTop(top);
    writeListScroll(key, top);
    matchingScrollNodes(selector).forEach((el) => {
      el.scrollTop = top;
    });
  };

  const capture = (top: number) => {
    topRef.current = top;
    writeListScroll(key, top);
  };

  const currentOffset = () => {
    if (typeof document === 'undefined') return Math.max(topRef.current, readListScroll(key));
    const visible = matchingScrollNodes(selector);
    const fromDom = visible.find((el) => el.scrollTop > 0);
    if (fromDom) return fromDom.scrollTop;
    return Math.max(topRef.current, readListScroll(key));
  };

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onScroll = (event: Event) => {
      const node = event.target;
      if (!(node instanceof HTMLElement)) return;
      if (!node.matches(selector) && !node.closest(selector)) return;
      capture(node.scrollTop);
    };
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, [selector, key]);

  useDidHide(() => {
    capture(currentOffset());
  });

  const scheduleApply = (top: number) => {
    if (top <= 0) return undefined;
    clearApplyTimers();
    const gen = applyGen.current;
    const timers = [0, 50, 400, 600].map((ms) =>
      window.setTimeout(() => {
        if (applyGen.current !== gen) return;
        apply(top);
      }, ms),
    );
    applyTimers.current = timers;
    return () => clearApplyTimers();
  };

  useEffect(() => {
    const top = currentOffset();
    if (top <= 0) return undefined;
    return scheduleApply(top);
  }, [key]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onShow = () => {
      if (skipRestore.current) {
        skipRestore.current = false;
        return;
      }
      const top = currentOffset();
      if (top <= 0) return;
      scheduleApply(top);
    };
    window.addEventListener('hashchange', onShow);
    window.addEventListener('pageshow', onShow);
    return () => {
      window.removeEventListener('hashchange', onShow);
      window.removeEventListener('pageshow', onShow);
    };
  }, [selector, key]);

  const onScroll = (event: { detail: { scrollTop: number } }) => {
    capture(event.detail.scrollTop);
  };

  const restore = () => {
    if (skipRestore.current) {
      skipRestore.current = false;
      return;
    }
    const top = currentOffset();
    setScrollTop(top === 0 ? 0.01 : top + 0.01);
    scheduleApply(top);
  };

  const reset = () => {
    applyGen.current += 1;
    clearApplyTimers();
    topRef.current = 0;
    skipRestore.current = true;
    setScrollTop(0);
    writeListScroll(key, 0);
    if (typeof document !== 'undefined') {
      document.querySelectorAll(selector).forEach((el) => {
        (el as HTMLElement).scrollTop = 0;
      });
    }
  };

  return { scrollTop, onScroll, restore, reset };
}
