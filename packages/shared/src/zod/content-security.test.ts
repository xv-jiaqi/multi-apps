import { describe, expect, it } from 'vitest';
import {
  WECHAT_JS_CODE_MAX,
  WECHAT_OPENID_MAX,
  recordMiniappVisitInput,
  recordMiniappVisitResult,
} from './content-security';

describe('recordMiniappVisitInput', () => {
  it('accepts a trimmed login code', () => {
    expect(recordMiniappVisitInput.parse({ code: '  abc123  ' })).toEqual({ code: 'abc123' });
  });

  it('accepts a legacy openid-only payload so old clients do not get a 400', () => {
    expect(recordMiniappVisitInput.parse({ openid: '  o-old  ' })).toEqual({ openid: 'o-old' });
  });

  it('accepts both fields; the server is responsible for ignoring openid', () => {
    expect(recordMiniappVisitInput.parse({ code: 'js-code', openid: 'o-spoofed' })).toEqual({
      code: 'js-code',
      openid: 'o-spoofed',
    });
  });

  it('accepts an empty object; the server must not record a visit', () => {
    expect(recordMiniappVisitInput.parse({})).toEqual({});
  });

  it('rejects an empty or oversized code when the field is present', () => {
    expect(recordMiniappVisitInput.safeParse({ code: '' }).success).toBe(false);
    expect(recordMiniappVisitInput.safeParse({ code: '   ' }).success).toBe(false);
    expect(
      recordMiniappVisitInput.safeParse({ code: 'x'.repeat(WECHAT_JS_CODE_MAX + 1) }).success,
    ).toBe(false);
  });

  it('rejects an undersized or oversized legacy openid when the field is present', () => {
    expect(recordMiniappVisitInput.safeParse({ openid: 'abc' }).success).toBe(false);
    expect(
      recordMiniappVisitInput.safeParse({ openid: 'x'.repeat(WECHAT_OPENID_MAX + 1) }).success,
    ).toBe(false);
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
