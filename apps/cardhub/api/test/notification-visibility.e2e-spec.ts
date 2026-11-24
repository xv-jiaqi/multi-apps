import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap/create-app';
import { PrismaService } from '../src/modules/prisma/prisma.service';

/**
 * Notifications are read-time gated by the target's current visibility.
 *
 * The excerpt and href are frozen when a notification is written. When the
 * target (or the topic of a reply, or the parent of a comment reply) later
 * turns RISKY or REVIEW, `notifications.list` must not return that text or
 * link to anyone: the content author, the mentioned user, or a third party,
 * on web and on miniapp. Rows stay in the list (unread count unchanged) with
 * excerpt '' and href null, the shape a deleted target already has.
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

function expectString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('expected a string');
  return value;
}

type Surface = 'web' | 'miniapp';
const SURFACES: Surface[] = ['web', 'miniapp'];
type User = { token: string; id: string; username: string };
type Row = { id: string; type: string; excerpt: string; href: string | null; readAt: unknown };

describe('notifications follow the target visibility at read time', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cardSlug = '';
  let ipSeq = 0;

  async function register(label: string): Promise<User> {
    const identity = nextIdentity(label);
    const response = await request(app.getHttpServer())
      .post('/trpc/auth.register')
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', identity.ip)
      .send({ email: identity.email, username: identity.username, password: 'notify-password' });
    expect(response.status).toBe(200);
    const data = resultData(response.body);
    if (!isRecord(data) || typeof data.token !== 'string' || !isRecord(data.user)) {
      throw new Error('expected { token, user }');
    }
    return { token: data.token, id: expectString(data.user.id), username: identity.username };
  }

  async function mutate(path: string, input: unknown, token: string) {
    ipSeq += 1;
    const response = await request(app.getHttpServer())
      .post(`/trpc/${path}`)
      .set('Content-Type', 'application/json')
      .set('X-Forwarded-For', `203.0.113.${(ipSeq % 200) + 20}`)
      .set('Authorization', `Bearer ${token}`)
      .send(JSON.stringify(input));
    expect(response.status).toBe(200);
    return resultData(response.body);
  }

  async function listRaw(user: User, surface: Surface, via: 'header' | 'input') {
    const input = via === 'input' && surface === 'miniapp' ? { limit: 50, surface } : { limit: 50 };
    let req = request(app.getHttpServer())
      .get(`/trpc/notifications.list?input=${encodeURIComponent(JSON.stringify(input))}`)
      .set('X-Forwarded-For', '203.0.113.9')
      .set('Authorization', `Bearer ${user.token}`);
    if (via === 'header' && surface === 'miniapp') req = req.set('x-cardhub-surface', 'miniapp');
    const response = await req;
    expect(response.status).toBe(200);
    return response.body as unknown;
  }

  async function list(user: User, surface: Surface): Promise<Row[]> {
    const data = resultData(await listRaw(user, surface, 'header'));
    if (!isRecord(data) || !Array.isArray(data.items)) throw new Error('expected { items }');
    return data.items as Row[];
  }

  async function unread(user: User): Promise<number> {
    const response = await request(app.getHttpServer())
      .get('/trpc/notifications.unreadCount')
      .set('Authorization', `Bearer ${user.token}`);
    expect(response.status).toBe(200);
    const data = resultData(response.body);
    if (!isRecord(data) || typeof data.count !== 'number') throw new Error('expected count');
    return data.count;
  }

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
    const suffix = `${Date.now().toString(36)}`;
    const series = await prisma.series.create({
      data: { slug: `nv-series-${suffix}`, title: '通知可见性系列' },
    });
    cardSlug = `nv-card-${suffix}`;
    await prisma.card.create({
      data: { slug: cardSlug, name: '通知可见性卡', seriesId: series.id },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * A posts a topic @B; B replies @C (A gets TOPIC_REPLY, C a MENTION).
   * A comments on a card @B; C answers that comment @X (A gets COMMENT_REPLY,
   * X a MENTION). Everything is then set to PASS so both surfaces show it.
   */
  async function scenario(tag: string) {
    const a = await register('nva');
    const b = await register('nvb');
    const c = await register('nvc');
    const x = await register('nvx');
    const text = {
      topic: `话题原文${tag}`,
      reply: `回帖原文${tag}`,
      comment: `评论原文${tag}`,
      child: `楼中楼原文${tag}`,
    };
    const topic = await mutate(
      'forum.topics.create',
      { title: `通知标题 ${tag}`, body: `${text.topic} @${b.username}` },
      a.token,
    );
    if (!isRecord(topic)) throw new Error('expected topic');
    const topicId = expectString(topic.id);
    const topicSlug = expectString(topic.slug);
    const reply = await mutate(
      'forum.replies.create',
      { topicId, body: `${text.reply} @${c.username}` },
      b.token,
    );
    if (!isRecord(reply)) throw new Error('expected reply');
    const replyId = expectString(reply.id);
    const comment = await mutate(
      'comments.create',
      { cardSlug, content: `${text.comment} @${b.username}` },
      a.token,
    );
    if (!isRecord(comment)) throw new Error('expected comment');
    const commentId = expectString(comment.id);
    const child = await mutate(
      'comments.create',
      { cardSlug, content: `${text.child} @${x.username}`, parentId: commentId },
      c.token,
    );
    if (!isRecord(child)) throw new Error('expected child comment');
    const childId = expectString(child.id);

    await prisma.topic.update({ where: { id: topicId }, data: { safetyStatus: 'PASS' } });
    await prisma.reply.update({ where: { id: replyId }, data: { safetyStatus: 'PASS' } });
    await prisma.comment.updateMany({
      where: { id: { in: [commentId, childId] } },
      data: { safetyStatus: 'PASS' },
    });

    const users = { a, b, c, x };
    // Positive control: every recipient sees its text on both surfaces first.
    const expected: Array<[User, string]> = [
      [b, text.topic],
      [a, text.reply],
      [c, text.reply],
      [b, text.comment],
      [a, text.child],
      [x, text.child],
    ];
    for (const surface of SURFACES) {
      for (const [user, snippet] of expected) {
        const rows = await list(user, surface);
        expect(rows.some((row) => row.excerpt.includes(snippet) && row.href !== null)).toBe(true);
      }
    }
    return { users, text, ids: { topicId, topicSlug, replyId, commentId, childId } };
  }

  type Scenario = Awaited<ReturnType<typeof scenario>>;

  async function expectWithheld(
    s: Scenario,
    hidden: string[],
    hiddenLinks: string[],
    stillShown: Array<[User, string]>,
  ) {
    const all = [s.users.a, s.users.b, s.users.c, s.users.x];
    const unreadBefore = await Promise.all(all.map((user) => unread(user)));
    for (const surface of SURFACES) {
      for (const user of all) {
        for (const via of ['header', 'input'] as const) {
          const serialized = JSON.stringify(await listRaw(user, surface, via));
          for (const snippet of hidden) expect(serialized).not.toContain(snippet);
          for (const link of hiddenLinks) expect(serialized).not.toContain(link);
        }
      }
      for (const [user, snippet] of stillShown) {
        const rows = await list(user, surface);
        expect(rows.some((row) => row.excerpt.includes(snippet))).toBe(true);
      }
    }
    // Rows are kept (placeholder shape), so the unread badge does not move.
    expect(await Promise.all(all.map((user) => unread(user)))).toEqual(unreadBefore);
  }

  for (const status of ['RISKY', 'REVIEW'] as const) {
    it(`topic turns ${status}: topic and reply text leave every recipient's list`, async () => {
      const s = await scenario(`t${status}${sequence}`);
      await prisma.topic.update({ where: { id: s.ids.topicId }, data: { safetyStatus: status } });
      await expectWithheld(
        s,
        [s.text.topic, s.text.reply],
        [`/forum/${s.ids.topicSlug}`],
        [
          [s.users.b, s.text.comment],
          [s.users.x, s.text.child],
        ],
      );
      // The topic author's own TOPIC_REPLY row and B's mention stay as placeholders.
      for (const surface of SURFACES) {
        for (const user of [s.users.a, s.users.b, s.users.c]) {
          const forumRows = (await list(user, surface)).filter(
            (row) => row.type === 'TOPIC_REPLY' || (row.type === 'MENTION' && row.href === null),
          );
          for (const row of forumRows) {
            expect(row.href).toBeNull();
            expect(row.excerpt).toBe('');
          }
        }
      }
    });

    it(`reply turns ${status}: reply text leaves the topic author and the mentioned user`, async () => {
      const s = await scenario(`r${status}${sequence}`);
      await prisma.reply.update({ where: { id: s.ids.replyId }, data: { safetyStatus: status } });
      await expectWithheld(
        s,
        [s.text.reply],
        [`reply-${s.ids.replyId}`],
        [
          [s.users.b, s.text.topic],
          [s.users.b, s.text.comment],
        ],
      );
    });

    it(`parent comment turns ${status}: its text and its replies' text are withheld`, async () => {
      const s = await scenario(`p${status}${sequence}`);
      await prisma.comment.update({
        where: { id: s.ids.commentId },
        data: { safetyStatus: status },
      });
      await expectWithheld(
        s,
        [s.text.comment, s.text.child],
        [`comment-${s.ids.commentId}`, `reply-${s.ids.childId}`],
        [
          [s.users.b, s.text.topic],
          [s.users.a, s.text.reply],
        ],
      );
    });

    it(`comment reply turns ${status}: its text leaves the parent author and the mention`, async () => {
      const s = await scenario(`c${status}${sequence}`);
      await prisma.comment.update({ where: { id: s.ids.childId }, data: { safetyStatus: status } });
      await expectWithheld(
        s,
        [s.text.child],
        [`reply-${s.ids.childId}`],
        [
          [s.users.b, s.text.comment],
          [s.users.c, s.text.reply],
        ],
      );
    });
  }

  it('closes notifications stored before this change (listing snapshot, RISKY target)', async () => {
    const owner = await register('nvl');
    const listing = await prisma.listing.create({
      data: {
        userId: owner.id,
        cardSlug,
        kind: 'SELL',
        contact: 'wx-nv',
        note: '挂单原文快照',
        safetyStatus: 'PASS',
      },
    });
    await prisma.notification.create({
      data: {
        userId: owner.id,
        type: 'CONTENT_RESOLVED',
        action: 'MARK_RESOLVED',
        targetType: 'LISTING',
        targetId: listing.id,
        excerpt: '挂单原文快照',
        href: `/cards/${cardSlug}`,
      },
    });
    for (const surface of SURFACES) {
      expect((await list(owner, surface))[0]?.excerpt).toBe('挂单原文快照');
    }
    await prisma.listing.update({ where: { id: listing.id }, data: { safetyStatus: 'RISKY' } });
    for (const surface of SURFACES) {
      const rows = await list(owner, surface);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ excerpt: '', href: null, type: 'CONTENT_RESOLVED' });
      expect(JSON.stringify(rows)).not.toContain('挂单原文快照');
    }
  });

  it('miniapp withholds an UNCHECKED target; web keeps it (public surface rule)', async () => {
    const s = await scenario(`u${sequence}`);
    await prisma.reply.update({
      where: { id: s.ids.replyId },
      data: { safetyStatus: 'UNCHECKED' },
    });
    const webRows = await list(s.users.c, 'web');
    expect(webRows.some((row) => row.excerpt.includes(s.text.reply))).toBe(true);
    const miniRows = await list(s.users.c, 'miniapp');
    expect(JSON.stringify(miniRows)).not.toContain(s.text.reply);
  });
});
