import { z } from 'zod';

/**
 * CH-226 §7: forum text that was typed when the session ended. Lives only in
 * this tab's sessionStorage and is never sent anywhere. Every storage call is
 * guarded: when storage is missing or throws, drafts are silently skipped
 * (same as legacy-password-notice.tsx).
 */
export type TopicDraftTarget = { kind: 'new' } | { kind: 'edit'; topicId: string };
export type ReplyDraftTarget = { kind: 'reply'; topicId: string };
export type ForumDraftTarget = TopicDraftTarget | ReplyDraftTarget;

export type TopicDraft = { title: string; body: string };
export type ReplyDraft = { body: string };

export type DraftRestore<D> = { kind: 'restored'; draft: D } | { kind: 'none' };

export const FORUM_DRAFT_PREFIX = 'cardhub:draft:forum:';

/** §7-5: restore only when saved at most this long ago. */
export const FORUM_DRAFT_MAX_AGE_MS = 60 * 60_000;

/** §7-2: fixed key names. `topicId` is topic.id, never the slug. */
export function forumDraftKey(target: ForumDraftTarget): string {
  switch (target.kind) {
    case 'new':
      return `${FORUM_DRAFT_PREFIX}new`;
    case 'edit':
      return `${FORUM_DRAFT_PREFIX}edit:${target.topicId}`;
    case 'reply':
      return `${FORUM_DRAFT_PREFIX}reply:${target.topicId}`;
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

/** §7-3 value shape. Replies have no title. */
const draftEnvelope = {
  v: z.literal(1),
  userId: z.string().min(1),
  savedAt: z.number(),
  body: z.string(),
};
const topicDraftSchema = z.object({ ...draftEnvelope, title: z.string() });
const replyDraftSchema = z.object(draftEnvelope);

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function write({ key, record }: { key: string; record: object }): void {
  try {
    storage()?.setItem(key, JSON.stringify(record));
  } catch {
    // Quota or disabled storage: nothing to keep.
  }
}

function readAndRemove(key: string): unknown {
  let raw: string | null | undefined;
  try {
    const store = storage();
    raw = store?.getItem(key);
    store?.removeItem(key);
  } catch {
    return undefined;
  }
  if (raw == null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed;
  } catch {
    return undefined;
  }
}

function blank(text: string): boolean {
  return text.trim() === '';
}

/** §7-4: write (or overwrite). A title and body that are all whitespace are not written. */
export function saveTopicDraft({
  target,
  userId,
  draft,
  now = Date.now(),
}: {
  target: TopicDraftTarget;
  userId: string;
  draft: TopicDraft;
  now?: number;
}): void {
  if (blank(draft.title) && blank(draft.body)) return;
  write({
    key: forumDraftKey(target),
    record: { v: 1, userId, savedAt: now, title: draft.title, body: draft.body },
  });
}

export function saveReplyDraft({
  target,
  userId,
  draft,
  now = Date.now(),
}: {
  target: ReplyDraftTarget;
  userId: string;
  draft: ReplyDraft;
  now?: number;
}): void {
  if (blank(draft.body)) return;
  write({ key: forumDraftKey(target), record: { v: 1, userId, savedAt: now, body: draft.body } });
}

export function discardForumDraft(target: ForumDraftTarget): void {
  try {
    storage()?.removeItem(forumDraftKey(target));
  } catch {
    // Storage unavailable: there is nothing stored to remove.
  }
}

/** §7-7: signing out from the header drops every forum draft in this tab. */
export function discardAllForumDrafts(): void {
  try {
    const store = storage();
    if (!store) return;
    const keys: string[] = [];
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key?.startsWith(FORUM_DRAFT_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => store.removeItem(key));
  } catch {
    // Storage unavailable: there is nothing stored to remove.
  }
}

function usable({
  record,
  userId,
  now,
}: {
  record: { userId: string; savedAt: number };
  userId: string;
  now: number;
}): boolean {
  return record.userId === userId && now - record.savedAt <= FORUM_DRAFT_MAX_AGE_MS;
}

/**
 * §7-5: read and always delete. Restores only for the same user, `v === 1`,
 * and saved at most 60 minutes ago. Anything else (another account, too old,
 * broken JSON, another version, storage errors) is dropped without a word.
 */
export function takeTopicDraft({
  target,
  userId,
  now = Date.now(),
}: {
  target: TopicDraftTarget;
  userId: string;
  now?: number;
}): DraftRestore<TopicDraft> {
  const parsed = topicDraftSchema.safeParse(readAndRemove(forumDraftKey(target)));
  if (!parsed.success || !usable({ record: parsed.data, userId, now })) return { kind: 'none' };
  return { kind: 'restored', draft: { title: parsed.data.title, body: parsed.data.body } };
}

export function takeReplyDraft({
  target,
  userId,
  now = Date.now(),
}: {
  target: ReplyDraftTarget;
  userId: string;
  now?: number;
}): DraftRestore<ReplyDraft> {
  const parsed = replyDraftSchema.safeParse(readAndRemove(forumDraftKey(target)));
  if (!parsed.success || !usable({ record: parsed.data, userId, now })) return { kind: 'none' };
  return { kind: 'restored', draft: { body: parsed.data.body } };
}
