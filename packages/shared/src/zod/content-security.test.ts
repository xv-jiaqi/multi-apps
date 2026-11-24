import { describe, expect, it } from 'vitest';
import {
  WECHAT_JS_CODE_MAX,
  recordMiniappVisitInput,
  recordMiniappVisitResult,
} from './content-security';

describe('recordMiniappVisitInput', () => {
  it('accepts a trimmed login code', () => {
    expect(recordMiniappVisitInput.parse({ code: '  abc123  ' })).toEqual({ code: 'abc123' });
  });

  it('rejects an empty or oversized code', () => {
    expect(recordMiniappVisitInput.safeParse({ code: '' }).success).toBe(false);
    expect(recordMiniappVisitInput.safeParse({ code: '   ' }).success).toBe(false);
    expect(recordMiniappVisitInput.safeParse({}).success).toBe(false);
    expect(
      recordMiniappVisitInput.safeParse({ code: 'x'.repeat(WECHAT_JS_CODE_MAX + 1) }).success,
    ).toBe(false);
  });

  it('does not keep a client-supplied openid', () => {
    const parsed = recordMiniappVisitInput.parse({ code: 'js-code', openid: 'o-spoofed' });
    expect(parsed).toEqual({ code: 'js-code' });
    expect(parsed).not.toHaveProperty('openid');
  });
});

describe('recordMiniappVisitResult', () => {
  it('only allows { ok: true }', () => {
    expect(recordMiniappVisitResult.parse({ ok: true })).toEqual({ ok: true });
    expect(recordMiniappVisitResult.safeParse({ ok: true, openid: 'o-1' }).success).toBe(true);
    expect(recordMiniappVisitResult.parse({ ok: true, openid: 'o-1' })).toEqual({ ok: true });
    expect(recordMiniappVisitResult.safeParse({ ok: false }).success).toBe(false);
  });
});
