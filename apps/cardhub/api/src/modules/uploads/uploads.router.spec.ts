import { APP_ERROR_CODES, UPLOAD_SIZE_MAX } from '@repo/shared';
import type { UserRateLimiter } from '../../bootstrap/rate-limiters';
import { TrpcBase } from '../../trpc/trpc-base';
import type { TrpcContext } from '../../trpc/context';
import { UploadsRouter, type PresignPutFn } from './uploads.router';

const listingInput = {
  purpose: 'listing' as const,
  contentType: 'image/png' as const,
  size: 1024,
};

const configuredEnv = {
  OSS_ENDPOINT: 'oss-cn-hongkong.aliyuncs.com',
  OSS_BUCKET: 'cardhub-uploads',
  OSS_ACCESS_KEY_ID: 'id',
  OSS_ACCESS_KEY_SECRET: 'secret',
  OSS_PUBLIC_BASE_URL: 'https://cdn.example.com',
};

const allowLimit: UserRateLimiter = {
  hit: async () => ({ limited: false, totalHits: 1, limit: 10 }),
};

function member(overrides: Partial<TrpcContext['user']> = {}): TrpcContext['user'] {
  return {
    sub: 'user-1',
    username: 'alice',
    role: 'user',
    tokenVersion: 1,
    bannedAt: null,
    ...overrides,
  };
}

function makeCaller(
  options: {
    env?: Readonly<Record<string, string | undefined>>;
    userRateLimit?: UserRateLimiter;
    presign?: PresignPutFn;
    now?: () => Date;
    newId?: () => string;
  } = {},
) {
  const router = new UploadsRouter(new TrpcBase()).build({
    env: () => options.env ?? {},
    presign: options.presign,
    now: options.now,
    newId: options.newId,
  });
  return (user: TrpcContext['user']) =>
    router.createCaller({
      req: {} as never,
      res: {} as never,
      user,
      userRateLimit: options.userRateLimit ?? allowLimit,
    });
}

describe('uploads.createPresignedPut', () => {
  it('45-1: with no OSS env, a signed-in user gets UPLOADS_NOT_CONFIGURED for listing', async () => {
    const caller = makeCaller({ env: {} })(member());
    await expect(caller.createPresignedPut(listingInput)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      cause: { appCode: APP_ERROR_CODES.UPLOADS_NOT_CONFIGURED },
    });
  });

  it('45-1: an admin gets the same code for purpose card', async () => {
    const caller = makeCaller({ env: {} })(member({ sub: 'admin-1', role: 'admin' }));
    await expect(
      caller.createPresignedPut({ ...listingInput, purpose: 'card' }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      cause: { appCode: APP_ERROR_CODES.UPLOADS_NOT_CONFIGURED },
    });
  });

  it('does not put env names or a stack in the client message', async () => {
    const caller = makeCaller({ env: {} })(member());
    const error = await caller.createPresignedPut(listingInput).catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({
      code: 'PRECONDITION_FAILED',
      cause: { appCode: APP_ERROR_CODES.UPLOADS_NOT_CONFIGURED },
    });
    const message = error instanceof Error ? error.message : '';
    expect(message).toBe('上传未配置，请稍后再试或联系管理员');
    expect(message).not.toMatch(/OSS_|ACCESS_KEY|process\.env|at\s+/);
  });

  it('45-2: a signed-out caller is UNAUTHORIZED for any purpose', async () => {
    const caller = makeCaller()(null);
    await expect(caller.createPresignedPut(listingInput)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      cause: { appCode: APP_ERROR_CODES.UNAUTHORIZED },
    });
    await expect(
      caller.createPresignedPut({ ...listingInput, purpose: 'card' }),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      cause: { appCode: APP_ERROR_CODES.UNAUTHORIZED },
    });
    await expect(
      caller.createPresignedPut({ ...listingInput, purpose: 'series' }),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      cause: { appCode: APP_ERROR_CODES.UNAUTHORIZED },
    });
  });

  it('45-2: a regular user cannot request card or series purposes', async () => {
    const caller = makeCaller({ env: {} })(member());
    await expect(
      caller.createPresignedPut({ ...listingInput, purpose: 'card' }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      cause: { appCode: APP_ERROR_CODES.FORBIDDEN },
    });
    await expect(
      caller.createPresignedPut({ ...listingInput, purpose: 'series' }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      cause: { appCode: APP_ERROR_CODES.FORBIDDEN },
    });
  });

  it('45-3: a gif or an oversized file is a validation error, not UPLOADS_NOT_CONFIGURED', async () => {
    const caller = makeCaller({ env: {} })(member());
    const gif = caller
      // @ts-expect-error image/gif is outside the allowed content types
      .createPresignedPut({ ...listingInput, contentType: 'image/gif' })
      .catch((thrown: unknown) => thrown);
    const oversized = caller
      .createPresignedPut({ ...listingInput, size: UPLOAD_SIZE_MAX + 1 })
      .catch((thrown: unknown) => thrown);
    const gifError = await gif;
    const sizeError = await oversized;
    expect(gifError).toMatchObject({ code: 'BAD_REQUEST' });
    expect(sizeError).toMatchObject({ code: 'BAD_REQUEST' });
    expect(gifError).not.toMatchObject({
      cause: { appCode: APP_ERROR_CODES.UPLOADS_NOT_CONFIGURED },
    });
    expect(sizeError).not.toMatchObject({
      cause: { appCode: APP_ERROR_CODES.UPLOADS_NOT_CONFIGURED },
    });
  });

  it('45-4: an exceeded user quota is TOO_MANY_REQUESTS', async () => {
    const caller = makeCaller({
      userRateLimit: {
        hit: async () => ({
          limited: true,
          totalHits: 11,
          limit: 10,
          retryAfterSeconds: 30,
        }),
      },
    })(member());
    await expect(caller.createPresignedPut(listingInput)).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      cause: { appCode: APP_ERROR_CODES.TOO_MANY_REQUESTS },
    });
  });

  it('returns the contracted success shape when a signer is injected', async () => {
    const presign: PresignPutFn = async ({ objectKey, contentType }) => ({
      uploadUrl: `https://oss.example/put?key=${objectKey}&type=${contentType}`,
    });
    const caller = makeCaller({
      env: configuredEnv,
      presign,
      now: () => new Date('2026-11-18T00:00:00.000Z'),
      newId: () => '11111111-2222-4333-8444-555555555555',
    })(member());
    await expect(caller.createPresignedPut(listingInput)).resolves.toEqual({
      uploadUrl:
        'https://oss.example/put?key=listing/user-1/202611/11111111-2222-4333-8444-555555555555.png&type=image/png',
      publicUrl:
        'https://cdn.example.com/listing/user-1/202611/11111111-2222-4333-8444-555555555555.png',
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      objectKey: 'listing/user-1/202611/11111111-2222-4333-8444-555555555555.png',
    });
  });

  it('does not call a cloud SDK when credentials are set but signing is not wired', async () => {
    const caller = makeCaller({ env: configuredEnv })(member());
    const error = await caller.createPresignedPut(listingInput).catch((thrown: unknown) => thrown);
    expect(error).toMatchObject({
      code: 'NOT_IMPLEMENTED',
      cause: { appCode: APP_ERROR_CODES.NOT_IMPLEMENTED },
    });
    const message = error instanceof Error ? error.message : '';
    expect(message).not.toMatch(/OSS_|ACCESS_KEY|secret|endpoint/i);
  });
});
