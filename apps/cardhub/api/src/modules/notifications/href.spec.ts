import { commentHref, forumReplyHref, forumTopicHref, listingHref } from './href';

const id = '2a9b89a4-c6f5-4a1c-9e1f-12bb89a4c6f5';

describe('notification hrefs', () => {
  it('builds the content paths and rejects unsafe pieces', () => {
    expect(forumTopicHref('sky-dawn')).toBe('/forum/sky-dawn');
    expect(forumReplyHref('sky-dawn', id)).toBe(`/forum/sky-dawn#reply-${id}`);
    expect(commentHref('card', 'aurora-knight', id, null)).toBe(
      `/cards/aurora-knight#comment-${id}`,
    );
    expect(commentHref('series', 'sky-dawn', id, 'parent')).toBe(`/series/sky-dawn#reply-${id}`);
    expect(listingHref('aurora-knight')).toBe('/cards/aurora-knight');
    expect(forumTopicHref('../admin')).toBeNull();
    expect(forumReplyHref('sky-dawn', 'not-an-id')).toBeNull();
    expect(commentHref('card', 'HasSpace', id, null)).toBeNull();
    expect(listingHref('')).toBeNull();
  });
});
