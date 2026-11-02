import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@repo/ui-web';
import { MarkdownView } from './markdown-view';

/** CH-206 §2: rendered height above which the body starts collapsed (max-h-120 = 30rem). */
export const BODY_COLLAPSE_PX = 480;

interface CardBodyProps {
  body: string | null | undefined;
  description: string | null | undefined;
  title: string;
  expandLabel: string;
  collapseLabel: string;
  newTabLabel: string;
}

export function CardBody({
  body,
  description,
  title,
  expandLabel,
  collapseLabel,
  newTabLabel,
}: CardBodyProps) {
  const contentId = useId();
  const titleId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const [tall, setTall] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const markdown = body?.trim() ? body : null;

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el || !markdown) return;
    const measure = () => setTall(el.scrollHeight > BODY_COLLAPSE_PX);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [markdown]);

  if (!markdown && !description) return null;

  if (!markdown) {
    return (
      <section aria-labelledby={titleId} className="space-y-3">
        <h2 id={titleId} className="scroll-mt-24 text-base font-semibold">
          {title}
        </h2>
        <p className="min-w-0 text-neutral-600 wrap-anywhere">{description}</p>
      </section>
    );
  }

  const collapsed = tall && !expanded;
  return (
    <section aria-labelledby={titleId} className="space-y-3">
      <h2 id={titleId} className="scroll-mt-24 text-base font-semibold">
        {title}
      </h2>
      <div className="relative">
        <div
          id={contentId}
          ref={contentRef}
          data-collapsed={collapsed || undefined}
          className={collapsed ? 'max-h-120 overflow-hidden' : undefined}
        >
          <MarkdownView
            body={markdown}
            variant="card"
            newTabLabel={newTabLabel}
            className="space-y-4 text-base leading-7 text-neutral-800"
          />
        </div>
        {collapsed ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-page to-transparent"
          />
        ) : null}
      </div>
      {tall ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? collapseLabel : expandLabel}
        </Button>
      ) : null}
    </section>
  );
}
