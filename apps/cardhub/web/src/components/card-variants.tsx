import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { printRunLabel, t, type Locale } from '@repo/shared';
import { Button } from '@repo/ui-web';
import { CardThumb } from './card-thumb';

export type CardVariantItem = {
  slug: string;
  name: string;
  parallelName: string | null;
  printRun: number | null;
  imageUrl: string | null;
  isCurrent: boolean;
};

const itemClass =
  'flex min-h-12 min-w-0 items-center gap-3 rounded-lg p-2 hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

function useNarrowViewport() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const apply = () => setNarrow(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);
  return narrow;
}

function RunLine({ locale, printRun }: { locale: Locale; printRun: number | null }) {
  if (printRun === null) {
    return <span className="text-xs text-neutral-600">{printRunLabel(locale, null)}</span>;
  }
  const label = printRunLabel(locale, printRun);
  const slash = label.lastIndexOf('/');
  return (
    <span className="text-xs text-neutral-600">
      {slash < 0 ? (
        label
      ) : (
        <>
          {label.slice(0, slash)}
          <span className="font-mono tabular-nums">{label.slice(slash)}</span>
        </>
      )}
    </span>
  );
}

export function CardVariants({
  locale,
  variants,
}: {
  locale: Locale;
  variants: CardVariantItem[];
}) {
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale, key, vars);
  const narrow = useNarrowViewport();
  const [expanded, setExpanded] = useState(false);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const focusNext = useRef(false);
  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    itemRefs.current[6]?.focus();
  }, [expanded]);
  if (variants.length <= 1) return null;
  const collapsed = narrow && !expanded && variants.length > 6;
  const visible = collapsed ? variants.slice(0, 6) : variants;

  return (
    <section aria-labelledby="variants-title" className="space-y-3">
      <h2 id="variants-title" className="text-base font-semibold text-neutral-900">
        {tt('card.variants.title')}
      </h2>
      <ul id="card-variants" className="grid grid-cols-1 gap-1 md:grid-cols-3 md:gap-2">
        {visible.map((item, index) => {
          const title = item.parallelName?.trim() ? item.parallelName : tt('card.variants.base');
          const body = (
            <>
              <CardThumb src={item.imageUrl} slug={item.slug} width="w-12" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-neutral-900">
                  {title}
                  {item.isCurrent ? (
                    <span className="text-neutral-600"> {tt('card.variants.current')}</span>
                  ) : null}
                </span>
                <RunLine locale={locale} printRun={item.printRun} />
              </span>
            </>
          );
          if (item.isCurrent) {
            return (
              <li key={item.slug}>
                <span
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  tabIndex={-1}
                  aria-current="page"
                  className={`${itemClass} border-s-2 border-brand-600`}
                >
                  {body}
                </span>
              </li>
            );
          }
          return (
            <li key={item.slug}>
              <Link
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                to={`/cards/${item.slug}`}
                className={itemClass}
              >
                {body}
              </Link>
            </li>
          );
        })}
      </ul>
      {collapsed ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={false}
          aria-controls="card-variants"
          onClick={() => {
            focusNext.current = true;
            setExpanded(true);
          }}
        >
          {tt('card.variants.showAll', { n: variants.length })}
        </Button>
      ) : null}
    </section>
  );
}
