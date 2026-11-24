import {
  excerptOf,
  extractHttpsImageUrls,
  MSG_SEC_CHECK_MAX_CHARS,
  splitTextForMsgSecCheck,
  worstTextSuggest,
} from './image-urls';

describe('extractHttpsImageUrls', () => {
  it('collects listing urls and markdown or file-extension https images', () => {
    expect(
      extractHttpsImageUrls({
        imageUrls: ['https://cdn.example/a.png', 'http://insecure.example/x.png'],
        texts: ['see ![alt](https://cdn.example/b.jpg) and https://cdn.example/c.webp?w=1'],
      }),
    ).toEqual([
      'https://cdn.example/a.png',
      'https://cdn.example/b.jpg',
      'https://cdn.example/c.webp?w=1',
    ]);
  });
});

describe('splitTextForMsgSecCheck', () => {
  it('splits by character count at the 2500 limit', () => {
    const text = '字'.repeat(MSG_SEC_CHECK_MAX_CHARS + 2);
    const chunks = splitTextForMsgSecCheck(text);
    expect(chunks).toHaveLength(2);
    expect(Array.from(chunks[0] ?? [])).toHaveLength(MSG_SEC_CHECK_MAX_CHARS);
    expect(Array.from(chunks[1] ?? [])).toHaveLength(2);
  });
});

describe('worstTextSuggest', () => {
  it('treats risky as worse than review, and review as worse than pass', () => {
    expect(worstTextSuggest(['pass', 'review', 'pass'])).toBe('review');
    expect(worstTextSuggest(['review', 'risky'])).toBe('risky');
    expect(worstTextSuggest(['pass'])).toBe('pass');
  });
});

describe('excerptOf', () => {
  it('caps the stored excerpt at 120 characters', () => {
    expect(excerptOf(['a'.repeat(200)])).toHaveLength(120);
  });
});
