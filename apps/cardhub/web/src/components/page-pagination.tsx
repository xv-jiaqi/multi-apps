import { Link } from 'react-router';
import { Button, buttonVariants, cn } from '@repo/ui-web';
import { pageTokens } from '../lib/series-list-params';

/**
 * CH-241 §5: one page-number control for 375 and 1440 alike. Previous, page 1,
 * the current page ± 1, the last page, next. The ellipsis is aria-hidden, the
 * current page has aria-current="page", and a disabled edge is an
 * aria-disabled span. Callers render it above and below a list with distinct
 * labels («顶部分页» / «底部分页»).
 */
export function PagePagination({
  label,
  previousLabel,
  nextLabel,
  pageLabel,
  page,
  pageCount,
  hrefFor,
  onPage,
  className,
}: {
  label: string;
  previousLabel: string;
  nextLabel: string;
  pageLabel: (page: number) => string;
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
  onPage: () => void;
  className?: string;
}) {
  const tokens = pageTokens(page, pageCount);
  return (
    <nav aria-label={label} className={cn('flex flex-wrap items-center gap-2', className)}>
      <PageEdge
        label={previousLabel}
        href={hrefFor(page - 1)}
        disabled={page <= 1}
        onPage={onPage}
      />
      <ol className="contents">
        {tokens.map((token) =>
          token.kind === 'gap' ? (
            <li key={token.key} aria-hidden className="px-1 text-sm text-neutral-600">
              …
            </li>
          ) : (
            <li key={token.page} className="flex">
              <PageNumber
                page={token.page}
                current={token.page === page}
                href={hrefFor(token.page)}
                label={pageLabel(token.page)}
                onPage={onPage}
              />
            </li>
          ),
        )}
      </ol>
      <PageEdge
        label={nextLabel}
        href={hrefFor(page + 1)}
        disabled={page >= pageCount}
        onPage={onPage}
      />
    </nav>
  );
}

function PageEdge({
  label,
  href,
  disabled,
  onPage,
}: {
  label: string;
  href: string;
  disabled: boolean;
  onPage: () => void;
}) {
  if (disabled) {
    return (
      <span aria-disabled="true" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        {label}
      </span>
    );
  }
  return (
    <Button asChild variant="outline" size="sm">
      <Link to={href} onClick={onPage}>
        {label}
      </Link>
    </Button>
  );
}

function PageNumber({
  page,
  current,
  href,
  label,
  onPage,
}: {
  page: number;
  current: boolean;
  href: string;
  label: string;
  onPage: () => void;
}) {
  return (
    <Button
      asChild
      variant="outline"
      size="sm"
      className={
        current ? 'bg-brand-600 text-white hover:bg-brand-600 hover:text-white' : undefined
      }
    >
      <Link
        to={href}
        aria-label={label}
        aria-current={current ? 'page' : undefined}
        onClick={onPage}
      >
        {page}
      </Link>
    </Button>
  );
}
