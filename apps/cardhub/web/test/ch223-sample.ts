import { expect } from 'vitest';

// CH-223 §6 sample F: one two-column table under each heading (CH-220 naming).
const table = '| a | b |\n| --- | --- |\n| 1 | 2 |';
export const SAMPLE_F = [
  '## ![价格图](x.png)',
  table,
  '## 文字 ![图](/a.png) 尾',
  table,
  '## ![外链](//evil.test/a.png)',
  table,
  '## ![](http://evil.test/b.png)',
  table,
  '## ![https图](https://img.test/c.png)',
  table,
  '正文：![rel](x.png) ![root](/a.png) ![http](http://evil.test/d.png) ![pr](//evil.test/e.png) ![data](data:image/png;base64,AAAA) ![ok](https://img.test/f.png)',
].join('\n\n');

const REJECTED = ['x.png', '/a.png', 'evil.test', 'data:'];

/** CH-223 23-1 / 23-2: asserts the forum DOM of sample F inside `root`. */
export function expectSampleFDom(root: Element) {
  const h2s = [...root.querySelectorAll('h2')];
  expect(h2s).toHaveLength(5);
  const at = (i: number): Element => h2s[i]!;
  const onlyImg = at(0);
  const mixed = at(1);
  const protoRel = at(2);
  const emptyAlt = at(3);
  const https = at(4);
  expect(onlyImg.innerHTML).toBe('<span>价格图</span>');
  expect([...mixed.childNodes].map((n) => [n.nodeName, n.textContent])).toEqual([
    ['#text', '文字 '],
    ['SPAN', '图'],
    ['#text', ' 尾'],
  ]);
  expect(protoRel.innerHTML).toBe('<span>外链</span>');
  expect(emptyAlt.childNodes).toHaveLength(0);
  expect(https.children).toHaveLength(1);
  const hImg = https.firstElementChild!;
  expect(hImg.tagName).toBe('IMG');
  expect(hImg).toHaveAttribute('alt', 'https图');
  expect(hImg).toHaveAttribute('src', 'https://img.test/c.png');
  expect(hImg).toHaveAttribute('loading', 'lazy');
  expect(hImg).toHaveAttribute('referrerpolicy', 'no-referrer');
  expect(hImg).toHaveClass('h-auto max-w-full rounded-lg', { exact: true });

  const para = [...root.querySelectorAll('p')].find((p) => p.textContent?.startsWith('正文'))!;
  const imgs = para.querySelectorAll('img');
  expect(imgs).toHaveLength(1);
  expect(imgs[0]).toHaveAttribute('alt', 'ok');
  expect(imgs[0]).toHaveAttribute('src', 'https://img.test/f.png');
  expect(para.querySelector('span')).toBeNull();

  for (const img of root.querySelectorAll('img')) {
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img.getAttribute('src')).toMatch(/^https:\/\//);
  }
  const attrs = [...root.querySelectorAll('*')].flatMap((el) =>
    [...el.attributes].map((a) => a.value),
  );
  for (const bad of REJECTED) {
    expect(attrs.filter((v) => v.includes(bad))).toEqual([]);
  }
}

/** The Markdown roots that render sample F: the parent of each "价格图" heading. */
export function sampleFRoots(doc: ParentNode = document): Element[] {
  return [...doc.querySelectorAll('h2')]
    .filter((h) => h.textContent === '价格图')
    .map((h) => h.parentElement!);
}
