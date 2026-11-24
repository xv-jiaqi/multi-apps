import { describe, expect, it } from 'vitest';
import { pickStatusToastPlacement } from './status-toast';

function box(x: number, y: number, width: number, height: number) {
  return { x, y, width, height };
}

describe('pickStatusToastPlacement', () => {
  const viewport = { width: 375, height: 812 };
  const toastSize = { width: 343, height: 48, inset: 16 };

  it('stays at the top when the submit row is below the toast', () => {
    expect(
      pickStatusToastPlacement({
        viewport,
        toastSize,
        avoid: [box(16, 167, 343, 44)],
      }),
    ).toBe('top');
  });

  it('moves to the bottom when the submit row sits under the top toast', () => {
    // Button at y≈20, count at y 33–52 — the case 周扒皮 measured.
    expect(
      pickStatusToastPlacement({
        viewport,
        toastSize,
        avoid: [box(16, 20, 274, 44), box(0, 33, 68, 19)],
      }),
    ).toBe('bottom');
  });

  it('stays at the top when only the bottom slot would cover the report cancel button', () => {
    // Bottom toast is y=748–796 on a 812-tall viewport; a cancel row there
    // must not force the toast downward.
    expect(
      pickStatusToastPlacement({
        viewport,
        toastSize,
        avoid: [box(16, 748, 343, 44)],
      }),
    ).toBe('top');
  });

  it('shifts below the top avoid when both default slots would cover controls', () => {
    // Top toast (16–64) covers a submit row; bottom toast (748–796) clips
    // a textarea. A mid slot just below the submit row is clear.
    expect(
      pickStatusToastPlacement({
        viewport,
        toastSize,
        avoid: [box(16, 20, 343, 44), box(16, 683, 343, 80)],
      }),
    ).toEqual({ top: 80 });
  });

  it('does not sit on a bottom-of-viewport Report button when the submit row is at the top', () => {
    // 颜如玉: bottom toast 748–796 covered 举报 at y≈777. Mid slot is clear.
    expect(
      pickStatusToastPlacement({
        viewport,
        toastSize,
        avoid: [box(16, 20, 274, 44), box(41, 777, 36, 44)],
      }),
    ).toEqual({ top: 80 });
  });
});
