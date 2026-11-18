import { Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { randomUUID } from 'node:crypto';
import {
  APP_ERROR_CODES,
  createPresignedPutInput,
  t,
  type CreatePresignedPutResult,
  type UploadContentType,
} from '@repo/shared';
import { TrpcBase } from '../../trpc/trpc-base';
import { readUploadsConfig, type UploadsConfig } from './uploads.config';
import { buildPresignedPutResult, buildUploadObjectKey } from './uploads.object-key';

type EnvMap = Readonly<Record<string, string | undefined>>;

export type PresignPutFn = (input: {
  config: UploadsConfig;
  objectKey: string;
  contentType: UploadContentType;
}) => Promise<{ uploadUrl: string }>;

export type UploadsRouterDeps = {
  env?: () => EnvMap;
  presign?: PresignPutFn;
  now?: () => Date;
  newId?: () => string;
};

function notConfigured(): TRPCError {
  return new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: t('zh-CN', 'error.app.UPLOADS_NOT_CONFIGURED'),
    cause: { appCode: APP_ERROR_CODES.UPLOADS_NOT_CONFIGURED },
  });
}

function forbidden(): TRPCError {
  return new TRPCError({
    code: 'FORBIDDEN',
    message: t('zh-CN', 'error.app.FORBIDDEN'),
    cause: { appCode: APP_ERROR_CODES.FORBIDDEN },
  });
}

function signingNotWired(): TRPCError {
  return new TRPCError({
    code: 'NOT_IMPLEMENTED',
    message: t('zh-CN', 'error.app.NOT_IMPLEMENTED'),
    cause: { appCode: APP_ERROR_CODES.NOT_IMPLEMENTED },
  });
}

@Injectable()
export class UploadsRouter {
  constructor(private readonly t: TrpcBase) {}

  build(deps: UploadsRouterDeps = {}) {
    const t = this.t;
    const env = deps.env ?? (() => process.env);
    const now = deps.now ?? (() => new Date());
    const newId = deps.newId ?? (() => randomUUID());
    const procedure = t.activeUserProcedure.use(t.userRateLimit('uploadCreatePresignedPut'));

    return t.router({
      createPresignedPut: procedure
        .input(createPresignedPutInput)
        .mutation(async ({ ctx, input }): Promise<CreatePresignedPutResult> => {
          if (!ctx.user) {
            throw new TRPCError({
              code: 'UNAUTHORIZED',
              cause: { appCode: APP_ERROR_CODES.UNAUTHORIZED },
            });
          }
          if (input.purpose !== 'listing' && ctx.user.role !== 'admin') {
            throw forbidden();
          }
          const config = readUploadsConfig(env());
          if (!config) {
            throw notConfigured();
          }
          if (!deps.presign) {
            // Credentials may be present, but this cut does not talk to a bucket.
            throw signingNotWired();
          }
          const objectKey = buildUploadObjectKey({
            purpose: input.purpose,
            userId: ctx.user.sub,
            contentType: input.contentType,
            now: now(),
            id: newId(),
          });
          const signed = await deps.presign({
            config,
            objectKey,
            contentType: input.contentType,
          });
          return buildPresignedPutResult({
            uploadUrl: signed.uploadUrl,
            publicBaseUrl: config.publicBaseUrl,
            objectKey,
            contentType: input.contentType,
          });
        }),
    });
  }
}
