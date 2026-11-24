import { describe, expect, it } from 'vitest';
import { LocalNotFoundError, classifyLoadError, mutationErrorMessage } from './load-error';

function trpcLikeError(message: string, data: unknown): Error {
  const error = new Error(message);
  Object.defineProperty(error, 'data', { value: data, enumerable: true });
  return error;
}

describe('classifyLoadError', () => {
  it('treats NOT_FOUND as not found, by tRPC code or appCode', () => {
    expect(classifyLoadError(trpcLikeError('卡牌不存在', { code: 'NOT_FOUND' }))).toEqual({
      kind: 'notFound',
    });
    expect(classifyLoadError(trpcLikeError('x', { appCode: 'NOT_FOUND' }))).toEqual({
      kind: 'notFound',
    });
    expect(classifyLoadError(new LocalNotFoundError('missing slug'))).toEqual({
      kind: 'notFound',
    });
  });

  it('treats 5xx, network failures and unknown values as a failed block', () => {
    expect(classifyLoadError(trpcLikeError('Internal', { code: 'INTERNAL_SERVER_ERROR' }))).toEqual(
      { kind: 'failed' },
    );
    expect(classifyLoadError(new Error('request:fail timeout'))).toEqual({ kind: 'failed' });
    expect(classifyLoadError('boom')).toEqual({ kind: 'failed' });
    expect(classifyLoadError(null)).toEqual({ kind: 'failed' });
  });
});

describe('mutationErrorMessage', () => {
  const serverText = 'PrismaClientKnownRequestError: secret detail at db:5432';

  it('never returns the raw server message', () => {
    for (const data of [
      { code: 'INTERNAL_SERVER_ERROR' },
      { code: 'BAD_REQUEST', appCode: 'NOT_A_REAL_CODE' },
      undefined,
    ]) {
      const text = mutationErrorMessage({
        locale: 'zh-CN',
        error: trpcLikeError(serverText, data),
      });
      expect(text).not.toContain('Prisma');
      expect(text).toBe('出了点问题，请稍后再试');
    }
  });

  it('localizes known app codes', () => {
    expect(
      mutationErrorMessage({
        locale: 'en-US',
        error: trpcLikeError(serverText, { appCode: 'TOO_MANY_REQUESTS' }),
      }),
    ).toBe('Too many actions. Try again later.');
  });

  it('prefers page copy for a given app code', () => {
    expect(
      mutationErrorMessage({
        locale: 'zh-CN',
        error: trpcLikeError(serverText, { appCode: 'INVALID_CREDENTIALS' }),
        copy: { INVALID_CREDENTIALS: '账号或密码不正确' },
      }),
    ).toBe('账号或密码不正确');
  });
});
