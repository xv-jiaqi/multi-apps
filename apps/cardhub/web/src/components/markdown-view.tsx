import type { ComponentProps } from 'react';
import ReactMarkdown, { type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

interface MarkdownViewProps {
  body: string;
  className?: string;
}

const codeBlockClass =
  'max-w-full overflow-x-auto whitespace-pre rounded-md bg-neutral-50 p-3 font-mono text-xs';

function MarkdownPre({ node: _node, ...props }: ComponentProps<'pre'> & ExtraProps) {
  return <pre {...props} className={codeBlockClass} />;
}

function MarkdownTable({ node: _node, ...props }: ComponentProps<'table'> & ExtraProps) {
  return (
    <div className="max-w-full overflow-x-auto">
      <table {...props} />
    </div>
  );
}

/**
 * Renders forum / topic body Markdown safely. The combination is:
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
export function MarkdownView({ body, className }: MarkdownViewProps) {
  return (
    <div
      className={['min-w-0 wrap-anywhere text-neutral-800', className].filter(Boolean).join(' ')}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{ pre: MarkdownPre, table: MarkdownTable }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
