// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const taro = vi.hoisted(() => ({
  showToast: vi.fn(async () => undefined),
  getEnv: vi.fn(() => 'WEB'),
  ENV_TYPE: { WEB: 'WEB', WEAPP: 'WEAPP' },
}));

vi.mock('@tarojs/taro', () => ({ default: taro, ...taro }));
vi.mock('@tarojs/components', () => import('../test-stubs/taro-dom'));

import { StatusToast } from '../components/status-toast';
import {
  announceStatusToast,
  STATUS_TOAST_DURATION_MS,
  resetQueuedStatusToast,
  collectStatusToastAvoidRects,
  useStatusToast,
} from './status-toast';

function Probe({ persist }: { persist?: boolean }) {
  const toast = useStatusToast();
  return (
    <div>
      <button
        type="button"
        onClick={() => toast.show('hello', persist ? { persistAcrossPages: true } : undefined)}
      >
        show
      </button>
      <button type="button" onClick={() => toast.consumeQueued()}>
        consume
      </button>
      <StatusToast notice={toast.notice} />
    </div>
  );
}

afterEach(() => {
  cleanup();
  resetQueuedStatusToast();
  taro.showToast.mockReset();
  taro.getEnv.mockReturnValue('WEB');
  vi.useRealTimers();
});

describe('useStatusToast', () => {
  beforeEach(() => {
    taro.getEnv.mockReturnValue('WEB');
  });

  it('renders a role=status node on H5 and auto-dismisses', () => {
    vi.useFakeTimers();
    render(<Probe />);
    act(() => {
      screen.getByText('show').click();
    });
    expect(screen.getByRole('status').textContent).toBe('hello');
    act(() => {
      vi.advanceTimersByTime(STATUS_TOAST_DURATION_MS);
    });
    expect(screen.queryByRole('status')).toBeNull();
    expect(taro.showToast).not.toHaveBeenCalled();
  });

  it('on weapp uses Taro.showToast and does not render the bar', () => {
    taro.getEnv.mockReturnValue('WEAPP');
    render(<Probe />);
    act(() => {
      screen.getByText('show').click();
    });
    expect(taro.showToast).toHaveBeenCalledWith({ title: 'hello', icon: 'none', duration: 3000 });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('queues the message when leaving the page so the next page can show it', () => {
    render(<Probe persist />);
    act(() => {
      screen.getByText('show').click();
    });
    expect(screen.queryByRole('status')).toBeNull();
    cleanup();
    const next = render(<Probe />);
    act(() => {
      next.getByText('consume').click();
    });
    expect(next.getByRole('status').textContent).toBe('hello');
  });

  it('displays a non-persist announceStatusToast when a hook is mounted', () => {
    render(<Probe />);
    act(() => {
      announceStatusToast('from-announce');
    });
    expect(screen.getByRole('status').textContent).toBe('from-announce');
  });
});

describe('StatusToast pointer events and avoid rects', () => {
  it('sets pointer-events: none so the bar cannot intercept clicks', () => {
    render(<Probe />);
    act(() => {
      screen.getByText('show').click();
    });
    const node = screen.getByRole('status') as HTMLElement;
    expect(node.style.pointerEvents).toBe('none');
  });

  it('includes the focused control in avoid rects', () => {
    const link = document.createElement('a');
    link.href = '#/pages/index/index';
    link.textContent = '首页';
    document.body.appendChild(link);
    link.getBoundingClientRect = () =>
      ({
        x: 16,
        y: 16,
        width: 24,
        height: 19,
        top: 16,
        left: 16,
        right: 40,
        bottom: 35,
        toJSON() {},
      }) as DOMRect;
    link.focus();
    expect(collectStatusToastAvoidRects()).toEqual([{ x: 16, y: 16, width: 24, height: 19 }]);
    link.remove();
  });

  it('does not duplicate a focused control already inside data-toast-avoid', () => {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-toast-avoid', 'true');
    const btn = document.createElement('button');
    wrap.appendChild(btn);
    document.body.appendChild(wrap);
    wrap.getBoundingClientRect = () =>
      ({
        x: 16,
        y: 748,
        width: 343,
        height: 44,
        top: 748,
        left: 16,
        right: 359,
        bottom: 792,
        toJSON() {},
      }) as DOMRect;
    btn.focus();
    expect(collectStatusToastAvoidRects()).toEqual([{ x: 16, y: 748, width: 343, height: 44 }]);
    wrap.remove();
  });
});
