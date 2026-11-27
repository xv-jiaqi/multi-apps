import { useEffect, useRef, useState } from 'react';
import { useDidHide } from '@tarojs/taro';
import { readListScroll, writeListScroll, type ListSessionKey } from './list-session';

/** Remember a ScrollView offset and re-apply it after the page is shown again. */
export function useScrollRestore(selector: string, key: ListSessionKey) {
  const topRef = useRef(readListScroll(key));
  const skipRestore = useRef(false);
  const [scrollTop, setScrollTop] = useState(readListScroll(key));

  const apply = (top: number) => {
    setScrollTop(top);
    writeListScroll(key, top);
    if (typeof document === 'undefined') return;
    const nodes = [...document.querySelectorAll(selector)] as HTMLElement[];
    const visible = nodes.filter((el) => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && el.clientHeight > 0;
    });
    (visible.length > 0 ? visible : nodes).forEach((el) => {
      el.scrollTop = top;
    });
  };

  const capture = (top: number) => {
    topRef.current = top;
    writeListScroll(key, top);
  };

  const currentOffset = () => {
    if (typeof document === 'undefined') return Math.max(topRef.current, readListScroll(key));
    const nodes = [...document.querySelectorAll(selector)] as HTMLElement[];
    const visible = nodes.find((el) => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && el.clientHeight > 0;
    });
    if (visible && visible.scrollTop > 0) return visible.scrollTop;
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
    if (top <= 0) return;
    const timers = [0, 50, 400, 600].map((ms) => window.setTimeout(() => apply(top), ms));
    return () => timers.forEach((id) => window.clearTimeout(id));
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
