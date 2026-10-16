import type { RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

type RateLimitConfig = {
  windowMs: number;
  limit: number;
  skip: (req: { originalUrl?: string; url?: string }) => boolean;
};

export type RateLimitName =
  | 'authMutation'
  | 'forumTopicCreate'
  | 'forumReplyCreate'
  | 'listingPublish'
  | 'reportCreate';

export type RateLimitOverrides = Partial<Record<RateLimitName, Partial<RateLimitConfig>>>;

type MountedRateLimiter = {
  path: string;
  middleware: RequestHandler;
};

const ipKey = (req: { ip?: string | undefined }): string => ipKeyGenerator(req.ip ?? 'unknown');
const urlIncludes =
  (needle: string) =>
  (req: { originalUrl?: string; url?: string }): boolean =>
    !(req.originalUrl ?? req.url ?? '').includes(needle);

export const productionRateLimitConfigs: Record<RateLimitName, RateLimitConfig> = {
  authMutation: {
    windowMs: 60_000,
    limit: 10,
    skip: (req) => {
      const url = req.originalUrl ?? req.url ?? '';
      return !url.includes('auth.register') && !url.includes('auth.login');
    },
  },
  forumTopicCreate: {
    windowMs: 60 * 60_000,
    limit: 5,
    skip: urlIncludes('forum.topics.create'),
  },
  forumReplyCreate: {
    windowMs: 60 * 60_000,
    limit: 30,
    skip: urlIncludes('forum.replies.create'),
  },
  listingPublish: {
    windowMs: 60 * 60_000,
    limit: 10,
    skip: urlIncludes('listings.publish'),
  },
  reportCreate: {
    windowMs: 60 * 60_000,
    limit: 20,
    skip: urlIncludes('reports.create'),
  },
};

export function createRateLimiters(overrides: RateLimitOverrides = {}): MountedRateLimiter[] {
  return (Object.entries(productionRateLimitConfigs) as [RateLimitName, RateLimitConfig][]).map(
    ([name, config]) => {
      const resolved = { ...config, ...overrides[name] };
      return {
        path: '/trpc',
        middleware: rateLimit({
          windowMs: resolved.windowMs,
          limit: resolved.limit,
          standardHeaders: 'draft-7',
          legacyHeaders: false,
          keyGenerator: ipKey,
          skip: resolved.skip,
        }),
      };
    },
  );
}
