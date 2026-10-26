import type { ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import { Link } from 'react-router';
import { t } from '@repo/shared';
import { useStores } from '../stores/root-store';

export interface BreadcrumbItem {
  label: ReactNode;
  to?: string;
}

export const Breadcrumbs = observer(function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  const { locale } = useStores();
  const ariaLabel = t(locale.locale, 'breadcrumb.aria');

  return (
    <nav aria-label={ariaLabel} className="text-sm text-neutral-500">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={idx} className="flex items-center gap-1.5">
              {item.to && !isLast ? (
                <Link
                  to={item.to}
                  className="inline-flex min-h-6 items-center rounded-sm hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  className={isLast ? 'text-neutral-900' : undefined}
                >
                  {item.label}
                </span>
              )}
              {!isLast && (
                <span aria-hidden className="text-neutral-300">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
});
