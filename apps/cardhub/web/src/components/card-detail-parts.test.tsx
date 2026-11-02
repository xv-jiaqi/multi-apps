import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { CardAdjacentNav, cameFromAdjacent } from './card-adjacent-nav';
import { CardArtLightbox } from './card-art-lightbox';
import { CardBody } from './card-body';
import { MarkdownView } from './markdown-view';
import { SeriesReleases, releasesCalendarHref, type SeriesReleaseItem } from './series-releases';

const labels = {
  title: '介绍',
  expandLabel: '展开全文',
  collapseLabel: '收起',
  newTabLabel: '（新窗口打开）',
};

describe('MarkdownView card variant (CH-206 §2)', () => {
  it('sanitizes scripts, handlers and javascript: links and demotes headings', () => {
    const { container } = render(
      <MarkdownView
        variant="card"
        newTabLabel="（新窗口打开）"
        body={[
          '# Big',
          '## Mid',
          '<script>alert(1)</script>',
          '<img src="https://x.invalid/a.png" onerror="alert(1)">',
          '[bad](javascript:alert(1)) [ext](https://example.invalid) @someone',
          '![a](http://insecure.invalid/a.png) ![b](https://secure.invalid/b.png)',
        ].join('\n\n')}
      />,
    );
    expect(container.querySelector('h1, h2')).toBeNull();
    expect(container.querySelector('h3')).toHaveTextContent('Big');
    expect(container.querySelector('h4')).toHaveTextContent('Mid');
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('onerror');
    expect(container.innerHTML).not.toContain('javascript:');
    const ext = screen.getByRole('link', { name: /ext/ });
    expect(ext).toHaveAttribute('target', '_blank');
    expect(ext).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(container.querySelector('a[href*="someone"]')).toBeNull();
    const srcs = [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(srcs).not.toContain('http://insecure.invalid/a.png');
    expect(srcs).toContain('https://secure.invalid/b.png');
  });
});

describe('CardBody (CH-206 §2)', () => {
  it('falls back to the description, and renders nothing when both are empty', () => {
    const { rerender, container } = render(
      <CardBody body={null} description="短描述" {...labels} />,
    );
    expect(screen.getByRole('heading', { level: 2, name: '介绍' })).toBeInTheDocument();
    expect(screen.getByText('短描述')).toBeInTheDocument();
    rerender(<CardBody body="   " description={null} {...labels} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('collapses a tall body and toggles aria-expanded', async () => {
    const spy = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 2000,
    });
    try {
      render(<CardBody body={'段落\n\n'.repeat(80)} description="d" {...labels} />);
      const button = screen.getByRole('button', { name: '展开全文' });
      expect(button).toHaveAttribute('aria-expanded', 'false');
      const region = document.getElementById(button.getAttribute('aria-controls')!);
      expect(region).toHaveClass('max-h-120');
      await userEvent.click(button);
      expect(screen.getByRole('button', { name: '收起' })).toHaveAttribute('aria-expanded', 'true');
      expect(region).not.toHaveClass('max-h-120');
    } finally {
      if (spy) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', spy);
      else delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
    }
  });

  it('shows no toggle for a short body', () => {
    render(<CardBody body="短正文" description={null} {...labels} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('CardArtLightbox (CH-206 §3)', () => {
  const props = {
    slug: 'aurora',
    name: '极光骑士',
    openLabel: '查看大图：极光骑士',
    closeLabel: '关闭',
    failedLabel: '图片加载失败',
  };

  it('opens with Enter, closes with Escape and returns focus to the art', async () => {
    const user = userEvent.setup();
    render(<CardArtLightbox src="https://x.invalid/a.png" {...props} />);
    const trigger = screen.getByRole('button', { name: '查看大图：极光骑士' });
    trigger.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: '关闭' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('shows a failure message when the large image fails', async () => {
    const user = userEvent.setup();
    render(<CardArtLightbox src="https://x.invalid/a.png" {...props} />);
    await user.click(screen.getByRole('button', { name: '查看大图：极光骑士' }));
    const dialog = await screen.findByRole('dialog');
    const img = dialog.querySelector('img')!;
    act(() => {
      fireEvent.error(img);
    });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('图片加载失败');
  });

  it('keeps a placeholder as a plain picture', () => {
    render(<CardArtLightbox src={null} {...props} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('CardAdjacentNav (CH-206 §5)', () => {
  it('links neighbours with route state and leaves a missing side empty', () => {
    render(
      <MemoryRouter>
        <CardAdjacentNav
          locale="zh-CN"
          adjacent={{ prev: null, next: { slug: 'b', name: '下一张卡', imageUrl: null } }}
        />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation');
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/cards/b');
    expect(links[0]).toHaveAttribute('title', '下一张卡');
    expect(links[0]).toHaveClass('col-start-2');
  });

  it('renders nothing without neighbours, and reads the via flag only from state', () => {
    const { container } = render(
      <MemoryRouter>
        <CardAdjacentNav locale="zh-CN" adjacent={{ prev: null, next: null }} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(cameFromAdjacent({ via: 'adjacent' })).toBe(true);
    expect(cameFromAdjacent({ via: 'x' })).toBe(false);
    expect(cameFromAdjacent(null)).toBe(false);
  });
});

describe('SeriesReleases (CH-206 §8)', () => {
  const item = (id: string, date: string, extra: Partial<SeriesReleaseItem> = {}) =>
    ({
      id,
      title: `发售 ${id}`,
      releaseDate: date,
      datePrecision: 'DAY',
      region: 'JP',
      sourceUrl: null,
      ...extra,
    }) satisfies SeriesReleaseItem;

  it('shows at most five and links the first entry month when there are more', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => item(id, `2026-12-0${i + 1}`));
    render(
      <MemoryRouter>
        <SeriesReleases locale="zh-CN" items={items} />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByRole('link', { name: /发售日历/ })).toHaveAttribute(
      'href',
      '/calendar?month=2026-12',
    );
    expect(releasesCalendarHref(items.slice(0, 5))).toBeNull();
  });

  it('shows month precision, https sources only, and nothing when empty', () => {
    const { container, rerender } = render(
      <MemoryRouter>
        <SeriesReleases
          locale="zh-CN"
          items={[
            item('m', '2027-01-01', { datePrecision: 'MONTH', sourceUrl: 'http://x.invalid' }),
            item('d', '2026-12-05', { sourceUrl: 'https://src.invalid' }),
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('2027年1月')).toHaveAttribute('dateTime', '2027-01-01');
    const sources = screen.getAllByRole('link');
    expect(sources).toHaveLength(1);
    expect(sources[0]).toHaveAttribute('href', 'https://src.invalid');
    expect(sources[0]).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    rerender(
      <MemoryRouter>
        <SeriesReleases locale="zh-CN" items={[]} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
