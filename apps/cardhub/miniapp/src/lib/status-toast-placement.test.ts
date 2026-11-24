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
});
