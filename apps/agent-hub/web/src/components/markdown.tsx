import type { ReactElement, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { cn } from '@repo/ui-web';

export function Markdown(props: { text: string; className?: string }): ReactElement {
  return (
    <div className={cn('markdown select-text text-sm text-neutral-900', props.className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          img: ({ src, alt }) => <ImageLink src={src} alt={alt} />,
          a: ({ href, children }) => <SafeLink href={href}>{children}</SafeLink>,
        }}
      >
        {props.text}
      </ReactMarkdown>
    </div>
  );
}

function ImageLink(props: {
  src?: string | undefined;
  alt?: string | undefined;
}): ReactElement | null {
  if (!props.src) return null;
  return (
    <a href={props.src} className="text-brand-700 underline">
      {props.alt && props.alt.length > 0 ? props.alt : props.src}
    </a>
  );
}

function SafeLink(props: { href?: string | undefined; children?: ReactNode }): ReactElement {
  if (!props.href || props.href.startsWith('javascript:')) return <span>{props.children}</span>;
  return (
    <a href={props.href} className="text-brand-700 underline">
      {props.children}
    </a>
  );
}
