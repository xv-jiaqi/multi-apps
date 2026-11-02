import { memo, type ComponentProps, type ReactNode } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { observer } from 'mobx-react-lite';
import { t } from '@repo/shared';
import { ScrollRegion } from '@repo/ui-web';
import { rehypeMentions } from '../lib/rehype-mentions';
import { useStores } from '../stores/root-store';

interface MarkdownViewProps {
  body: string;
  className?: string;
  /**
   * `forum` (default) keeps @mentions. `card` is the CH-206 card body:
   * no mentions, headings demoted so the page keeps one h1, links get the
   * new-tab rule and images must be https.
   */
  variant?: 'forum' | 'card';
  /** Screen-reader suffix for links that open a new tab (`a11y.newTab`). */
  newTabLabel?: string;
}

const codeBlockClass =
  'max-w-full overflow-x-auto whitespace-pre rounded-md bg-neutral-50 p-3 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2';

// tabIndex=0: the block scrolls horizontally, so keyboard users must be able
// to focus it to scroll (WCAG 2.1.1, axe scrollable-region-focusable).
// role=region + aria-label give the focus stop a name (CH-206 §2, WCAG 4.1.2).
const MarkdownPre = observer(function MarkdownPre({
  node: _node,
  ...props
}: ComponentProps<'pre'> & ExtraProps) {
  const { locale } = useStores();
  return (
    <pre
      {...props}
      tabIndex={0}
      role="region"
      aria-label={t(locale.locale, 'card.body.codeBlock')}
      className={codeBlockClass}
    />
  );
});

// Markdown tables have no visible heading, so the region falls back to
// a11y.scrollTable (CH-220 §2-2).
const MarkdownTable = observer(function MarkdownTable({
  node: _node,
  ...props
}: ComponentProps<'table'> & ExtraProps) {
  const { locale } = useStores();
  const name = t(locale.locale, 'a11y.table');
  return (
    <ScrollRegion label={t(locale.locale, 'a11y.scrollTable', { name })} className="max-w-full">
      <table {...props} />
    </ScrollRegion>
  );
});

function isExternal(href: string | undefined): boolean {
  return !!href && /^https?:\/\//i.test(href);
}

function cardComponents(newTabLabel: string | undefined): Components {
  const heading =
    (Tag: 'h3' | 'h4' | 'h5' | 'h6', className: string) =>
    ({ node: _node, ...props }: ComponentProps<'h1'> & ExtraProps) => (
      <Tag {...props} className={className} />
    );
  return {
    pre: (props: ComponentProps<'pre'> & ExtraProps) => (
      <div className="mt-3">
        <MarkdownPre {...props} />
      </div>
    ),
    table: (props: ComponentProps<'table'> & ExtraProps) => (
      <div className="mt-3 text-sm">
        <MarkdownTable {...props} />
      </div>
    ),
    h1: heading('h3', 'mt-6 text-lg font-semibold text-neutral-900'),
    h2: heading('h4', 'mt-5 text-base font-semibold text-neutral-900'),
    h3: heading('h5', 'mt-4 text-base font-medium text-neutral-900'),
    h4: heading('h6', 'mt-4 text-sm font-medium text-neutral-900'),
    h5: heading('h6', 'mt-4 text-sm font-medium text-neutral-900'),
    h6: heading('h6', 'mt-4 text-sm font-medium text-neutral-900'),
    p: ({ node: _node, ...props }: ComponentProps<'p'> & ExtraProps) => (
      <p {...props} className="mt-3 first:mt-0" />
    ),
    ul: ({ node: _node, ...props }: ComponentProps<'ul'> & ExtraProps) => (
      <ul {...props} className="mt-3 list-disc space-y-1 pl-6" />
    ),
    ol: ({ node: _node, ...props }: ComponentProps<'ol'> & ExtraProps) => (
      <ol {...props} className="mt-3 list-decimal space-y-1 pl-6" />
    ),
    blockquote: ({ node: _node, ...props }: ComponentProps<'blockquote'> & ExtraProps) => (
      <blockquote {...props} className="mt-3 border-l-4 border-neutral-200 pl-4 text-neutral-600" />
    ),
    th: ({ node: _node, ...props }: ComponentProps<'th'> & ExtraProps) => (
      <th {...props} className="border-b border-neutral-200 px-3 py-2 text-left font-semibold" />
    ),
    td: ({ node: _node, ...props }: ComponentProps<'td'> & ExtraProps) => (
      <td {...props} className="border-b border-neutral-200 px-3 py-2" />
    ),
    a: ({ node: _node, href, children, ...props }: ComponentProps<'a'> & ExtraProps) => {
      const external = isExternal(href);
      let suffix: ReactNode = null;
      if (external && newTabLabel) suffix = <span className="sr-only">{newTabLabel}</span>;
      return (
        <a
          {...props}
          href={href}
          className="text-brand-600 underline underline-offset-2"
          {...(external ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})}
        >
          {children}
          {suffix}
        </a>
      );
    },
    img: ({ node: _node, src, alt }: ComponentProps<'img'> & ExtraProps) => {
      if (typeof src !== 'string' || !/^https:\/\//i.test(src)) return null;
      return (
        <img
          src={src}
          alt={alt ?? ''}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-auto max-w-full rounded-lg"
        />
      );
    },
  };
}

/**
 * Renders forum / topic / card body Markdown safely. The combination is:
 *   - remark-gfm: tables, autolinks, strikethrough, task lists.
 *   - rehype-sanitize: strips <script> / event handlers / arbitrary HTML
 *     so an attacker can't smuggle XSS through Markdown raw HTML.
 *
 * NEVER replace this with `dangerouslySetInnerHTML` — losing the sanitize
 * pass would let a single malicious topic body run JS in every reader's
 * session.
 *
 * Long URLs and inline code use `wrap-anywhere` (overflow-wrap: anywhere).
 * Fenced code stays on one line and scrolls inside its own `pre`.
 */
export const MarkdownView = memo(function MarkdownView({
  body,
  className,
  variant = 'forum',
  newTabLabel,
}: MarkdownViewProps) {
  const card = variant === 'card';
  return (
    <div
      className={[
        'min-w-0 wrap-anywhere text-neutral-800',
        card && 'text-base leading-7',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={card ? [rehypeSanitize] : [rehypeSanitize, rehypeMentions]}
        components={card ? cardComponents(newTabLabel) : { pre: MarkdownPre, table: MarkdownTable }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
});
