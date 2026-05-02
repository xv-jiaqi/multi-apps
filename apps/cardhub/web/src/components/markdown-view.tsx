import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

interface MarkdownViewProps {
  body: string;
  className?: string;
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
 */
export function MarkdownView({ body, className }: MarkdownViewProps) {
  return (
    <div
      className={`prose prose-sm prose-neutral max-w-none break-words text-neutral-800 ${className ?? ''}`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {body}
      </ReactMarkdown>
    </div>
  );
}
