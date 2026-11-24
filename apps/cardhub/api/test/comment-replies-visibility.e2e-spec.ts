import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';

/**
 * comments.listReplies / comments.create(parentId) follow the parent
 * comment's visibility (resolveSafetyView, public scope, per surface).
 *
 * A parent the viewer cannot see (RISKY for everyone; REVIEW for anyone but
 * its author; UNCHECKED on miniapp) answers exactly like a missing parent:
 * listReplies returns the same empty page, a reply is refused with the same
 * NOT_FOUND (COMMENT_PARENT_GONE) as a deleted parent.
 */

let sequence = 0;

function nextIdentity(label: string) {
  sequence += 1;
  const suffix = `${Date.now().toString(36)}${sequence.toString(36)}`;
  return {
    email: `${label}-${suffix}@cardhub.test`,
    username: `${label}${suffix}`.replace(/[^a-z0-9]/gi, '').slice(0, 24),
    ip: `198.51.100.${(sequence % 200) + 1}`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resultData(body: unknown): unknown {
  if (!isRecord(body) || !isRecord(body.result)) {
    throw new Error(`expected a tRPC result, got ${JSON.stringify(body)}`);
  }
  return body.result.data;
}

/** Error body without the per-request parts (path is the same, stack is absent). */
function errorShape(body: unknown): unknown {
  if (!isRecord(body) || !isRecord(body.error)) return body;
  const { data, ...rest } = body.error;
  return { ...rest, data };
}

type Surface = 'web' | 'miniapp';
type Viewer = 'author' | 'other' | 'anon';
type Status = 'RISKY' | 'REVIEW';
const SURFACES: Surface[] = ['web', 'miniapp'];
const VIEWERS: Viewer[] = ['author', 'other', 'anon'];
const STATUSES: Status[] = ['RISKY', 'REVIEW'];
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const PARENT_TEXT = '父评论原文甲';
const CHILD_TEXT = '楼中楼原文乙';

describe('comment replies follow the parent comment visibility', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const users: Record<'author' | 'other' | 'replier', { token: string; id: string }> = {
    author: { token: '', id: '' },
    other: { token: '', id: '' },
    replier: { token: '', id: '' },
  };
  let cardSlug = '';
  let seriesSlug = '';
  let cardId = '';
  let seriesId = '';
  let ipSeq = 0;
  /** parents[status][kind] = { parentId, childId } */
  const parents = {} as Record<
    Status | 'UNCHECKED',
    Record<'card' | 'series', { parentId: string; childId: string }>
  >;

  async function register(label: string) {
    const identity = nextIdentity(label);
    const response = await request(app.getHttpServer())
      .post('/trpc/auth.register')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', identity.ip)
      .send({ email: identity.email, username: identity.username, password: 'replies-password' });
    expect(response.status).toBe(200);
    const data = resultData(response.body);
    if (!isRecord(data) || typeof data.token !== 'string' || !isRecord(data.user)) {
      throw new Error('expected { token, user }');
    }
    return { token: data.token, id: String(data.user.id) };
  }

  function tokenOf(viewer: Viewer): string | undefined {
    return viewer === 'anon' ? undefined : users[viewer].token;
  }

  async function listReplies(
    input: Record<string, unknown>,
    viewer: Viewer,
    surface: Surface,
    via: 'input' | 'header',
  ) {
    const body = via === 'input' && surface === 'miniapp' ? { ...input, surface } : input;
    let req = request(app.getHttpServer())
      .get(`/trpc/comments.listReplies?input=${encodeURIComponent(JSON.stringify(body))}`)
      .set('X-Forwarded-For', '203.0.113.150');
    const token = tokenOf(viewer);
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    if (via === 'header' && surface === 'miniapp') req = req.set('x-cardhub-surface', 'miniapp');
    return req;
  }

  async function createReply(
    kind: 'card' | 'series',
    parentId: string,
    viewer: Viewer,
    surface: Surface,
  ) {
    ipSeq += 1;
    const path = kind === 'card' ? 'comments.create' : 'comments.createForSeries';
    const input =
      kind === 'card'
        ? { cardSlug, content: `回复 ${ipSeq}`, parentId }
        : { seriesSlug, content: `回复 ${ipSeq}`, parentId };
    let req = request(app.getHttpServer())
      .post(`/trpc/${path}`)
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', `203.0.113.${(ipSeq % 100) + 20}`);
    const token = tokenOf(viewer);
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    if (surface === 'miniapp') req = req.set('x-cardhub-surface', 'miniapp');
    return req.send(JSON.stringify(input));
  }

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
    users.author = await register('crva');
    users.other = await register('crvo');
    users.replier = await register('crvr');
    const suffix = `${Date.now().toString(36)}`;
    const series = await prisma.series.create({
      data: { slug: `crv-series-${suffix}`, title: '楼中楼可见性系列' },
    });
    seriesSlug = series.slug;
    seriesId = series.id;
    cardSlug = `crv-card-${suffix}`;
    cardId = (
      await prisma.card.create({
        data: { slug: cardSlug, name: '楼中楼可见性卡', seriesId: series.id },
        select: { id: true },
      })
    ).id;
    for (const status of [...STATUSES, 'UNCHECKED'] as const) {
      parents[status] = {} as (typeof parents)[Status];
      for (const kind of ['card', 'series'] as const) {
        const scope = kind === 'card' ? { cardId } : { seriesId };
        const parent = await prisma.comment.create({
          data: {
            ...scope,
            userId: users.author.id,
            content: `${PARENT_TEXT}${status}`,
            safetyStatus: status,
          },
        });
        const child = await prisma.comment.create({
          data: {
            ...scope,
            parentId: parent.id,
            userId: users.replier.id,
            content: `${CHILD_TEXT}${status}`,
            safetyStatus: 'PASS',
          },
        });
        parents[status][kind] = { parentId: parent.id, childId: child.id };
      }
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  function authorSees(viewer: Viewer, status: Status): boolean {
    return viewer === 'author' && status === 'REVIEW';
  }

  describe('comments.listReplies', () => {
    for (const status of STATUSES) {
      for (const viewer of VIEWERS) {
        for (const surface of SURFACES) {
          const visible = authorSees(viewer, status);
          it(`${status} parent, ${viewer}, ${surface}: ${visible ? 'lists replies' : 'same as a missing parent'}`, async () => {
            for (const kind of ['card', 'series'] as const) {
              const { parentId, childId } = parents[status][kind];
              for (const via of ['input', 'header'] as const) {
                const variants = [
                  { parentId, limit: 20 },
                  { parentId, limit: 20, aroundId: childId },
                ];
                for (const input of variants) {
                  const response = await listReplies(input, viewer, surface, via);
                  expect(response.status).toBe(200);
                  if (visible) {
                    expect(JSON.stringify(response.body)).toContain(`${CHILD_TEXT}${status}`);
                    continue;
                  }
                  const missing = await listReplies(
                    { ...input, parentId: MISSING_ID },
                    viewer,
                    surface,
                    via,
                  );
                  expect(response.body).toEqual(missing.body);
                  expect(JSON.stringify(response.body)).not.toContain(CHILD_TEXT);
                }
              }
            }
          });
        }
      }
    }

    it('keeps a PASS parent listing replies for everyone on both surfaces (control)', async () => {
      const parent = await prisma.comment.create({
        data: { cardId, userId: users.author.id, content: '正常父评论', safetyStatus: 'PASS' },
      });
      await prisma.comment.create({
        data: {
          cardId,
          parentId: parent.id,
          userId: users.replier.id,
          content: '正常楼中楼',
          safetyStatus: 'PASS',
        },
      });
      for (const viewer of VIEWERS) {
        for (const surface of SURFACES) {
          const response = await listReplies(
            { parentId: parent.id, limit: 20 },
            viewer,
            surface,
            'header',
          );
          expect(JSON.stringify(response.body)).toContain('正常楼中楼');
        }
      }
    });

    it('hides an UNCHECKED parent on miniapp only (public surface rule)', async () => {
      const { parentId } = parents.UNCHECKED.card;
      const web = await listReplies({ parentId, limit: 20 }, 'other', 'web', 'header');
      expect(JSON.stringify(web.body)).toContain(`${CHILD_TEXT}UNCHECKED`);
      const mini = await listReplies({ parentId, limit: 20 }, 'other', 'miniapp', 'header');
      const missing = await listReplies(
        { parentId: MISSING_ID, limit: 20 },
        'other',
        'miniapp',
        'header',
      );
      expect(mini.body).toEqual(missing.body);
    });
  });

  describe('comments.create / createForSeries with parentId', () => {
    for (const status of STATUSES) {
      for (const viewer of ['author', 'other'] as const) {
        for (const surface of SURFACES) {
          const visible = authorSees(viewer, status);
          it(`${status} parent, ${viewer}, ${surface}: ${visible ? 'accepts the reply' : 'NOT_FOUND like a missing parent'}`, async () => {
            for (const kind of ['card', 'series'] as const) {
              const { parentId } = parents[status][kind];
              const before = await prisma.comment.count({ where: { parentId } });
              const response = await createReply(kind, parentId, viewer, surface);
              if (visible) {
                expect(response.status).toBe(200);
                expect(await prisma.comment.count({ where: { parentId } })).toBe(before + 1);
                continue;
              }
              const missing = await createReply(kind, MISSING_ID, viewer, surface);
              expect(missing.status).toBe(404);
              expect(response.status).toBe(404);
              expect(errorShape(response.body)).toEqual(errorShape(missing.body));
              expect(await prisma.comment.count({ where: { parentId } })).toBe(before);
            }
          });
        }
      }
    }

    it.each(STATUSES)(
      'rejects an anonymous reply to a %s parent before any lookup',
      async (status) => {
        for (const surface of SURFACES) {
          const response = await createReply(
            'card',
            parents[status].card.parentId,
            'anon',
            surface,
          );
          expect(response.status).toBe(401);
        }
      },
    );

    it('refuses a reply to an UNCHECKED parent on miniapp, accepts it on web', async () => {
      const { parentId } = parents.UNCHECKED.card;
      const web = await createReply('card', parentId, 'other', 'web');
      expect(web.status).toBe(200);
      const mini = await createReply('card', parentId, 'other', 'miniapp');
      const missing = await createReply('card', MISSING_ID, 'other', 'miniapp');
      expect(mini.status).toBe(404);
      expect(errorShape(mini.body)).toEqual(errorShape(missing.body));
    });
  });
});
