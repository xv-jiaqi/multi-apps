import { Link } from 'react-router';
import { t, type Locale } from '@repo/shared';
import { formatCatalogDate } from '../lib/catalog-taxonomy';
import { monthHeading } from '../lib/calendar-month';

export type SeriesReleaseItem = {
  id: string;
  title: string;
  releaseDate: string;
  datePrecision: 'DAY' | 'MONTH';
  region: 'CN' | 'JP' | 'GLOBAL' | null;
  sourceUrl: string | null;
};

/** CH-206 §8: show five; the API sends a sixth only to say there are more. */
export const SERIES_RELEASES_SHOWN = 5;

/**
 * The API orders upcoming entries first, so the first item is the nearest
 * upcoming one, or the latest past one when everything is past. Its month is
 * where the calendar link lands.
 */
export function releasesCalendarHref(items: SeriesReleaseItem[]): string | null {
  if (items.length <= SERIES_RELEASES_SHOWN) return null;
  return `/calendar?month=${items[0]!.releaseDate.slice(0, 7)}`;
}

function httpsSource(url: string | null): string | null {
  return url && url.startsWith('https://') ? url : null;
}

export function SeriesReleases({ locale, items }: { locale: Locale; items: SeriesReleaseItem[] }) {
  if (items.length === 0) return null;
  const tt = (key: string) => t(locale, key);
  const shown = items.slice(0, SERIES_RELEASES_SHOWN);
  const more = releasesCalendarHref(items);
  return (
    <section
      aria-labelledby="series-releases-title"
      className="rounded-xl border border-neutral-200 bg-card p-4"
    >
      <h2 id="series-releases-title" className="scroll-mt-24 text-base font-semibold">
        {tt('series.releases.title')}
      </h2>
      <ul className="mt-3 space-y-2 text-sm text-neutral-800">
        {shown.map((item) => {
          const source = httpsSource(item.sourceUrl);
          const region = item.region ? tt(`region.${item.region}`) : null;
          return (
            <li key={item.id} className="flex flex-col gap-x-2 sm:flex-row sm:flex-wrap">
              <time dateTime={item.releaseDate} className="text-neutral-600 tabular-nums">
                {item.datePrecision === 'MONTH'
                  ? monthHeading(locale, item.releaseDate.slice(0, 7))
                  : formatCatalogDate(locale, item.releaseDate)}
              </time>
              <span className="wrap-anywhere">
                <span aria-hidden className="hidden text-neutral-600 sm:inline">
                  ·{' '}
                </span>
                {item.title}
                {region ? <span className="text-neutral-600"> · {region}</span> : null}
                {source ? (
                  <>
                    <span className="text-neutral-600"> · </span>
                    <a
                      href={source}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex min-h-6 items-center text-link underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    >
                      {tt('release.source')}
                      <span className="sr-only">{tt('a11y.newTab')}</span>
                    </a>
                  </>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      {more ? (
        <p className="mt-3 text-sm">
          <Link
            to={more}
            className="inline-flex min-h-6 items-center text-link underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {tt('series.releases.more')}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
