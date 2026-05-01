import type { ReactNode } from 'react';
import { Link } from 'react-router';

export interface BreadcrumbItem {
  label: ReactNode;
  to?: string;
}

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-neutral-500">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={idx} className="flex items-center gap-1.5">
              {item.to && !isLast ? (
                <Link to={item.to} className="hover:text-neutral-900">
                  {item.label}
                </Link>
              ) : (
                <span className={isLast ? 'text-neutral-900' : undefined}>{item.label}</span>
              )}
              {!isLast && <span className="text-neutral-300">/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
