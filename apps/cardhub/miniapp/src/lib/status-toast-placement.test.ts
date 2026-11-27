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

  it('shifts just below a top control rather than jumping to the bottom', () => {
    // Submit at y≈20 would be covered by the top slot. Prefer a mid slot
    // under that row so the toast does not land on a bottom composer.
    expect(
      pickStatusToastPlacement({
        viewport,
        toastSize,
        avoid: [box(16, 20, 274, 44), box(0, 33, 68, 19)],
      }),
    ).toEqual({ top: 80 });
  });

  it('stays at the top when only the bottom slot would cover a control', () => {
    expect(
      pickStatusToastPlacement({
        viewport,
        toastSize,
        avoid: [box(16, 748, 343, 44)],
      }),
    ).toBe('top');
  });

  it('shifts below the top avoid when both default slots would cover controls', () => {
    expect(
      pickStatusToastPlacement({
        viewport,
        toastSize,
        avoid: [box(16, 20, 343, 44), box(16, 683, 343, 80)],
      }),
    ).toEqual({ top: 80 });
  });

  it('does not sit on a bottom-of-viewport control when the top slot is blocked', () => {
    expect(
      pickStatusToastPlacement({
        viewport,
        toastSize,
        avoid: [box(16, 20, 274, 44), box(41, 777, 36, 44)],
      }),
    ).toEqual({ top: 80 });
  });

  it('yields below a focused breadcrumb instead of covering it', () => {
    // 颜如玉: 首页 at y=16–35 is 100% covered by the top toast (16–64).
    expect(
      pickStatusToastPlacement({
        viewport,
        toastSize,
        avoid: [box(16, 16, 24, 19), box(16, 748, 343, 44)],
      }),
    ).toEqual({ top: 51 });
  });

  it('yields below a focused breadcrumb even when the bottom slot is clear', () => {
    expect(
      pickStatusToastPlacement({
        viewport,
        toastSize,
        avoid: [box(16, 16, 24, 19)],
      }),
    ).toEqual({ top: 51 });
  });
});
