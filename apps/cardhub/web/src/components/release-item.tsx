import type { ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import { Link } from 'react-router';
import { t } from '@repo/shared';
import { Artwork } from './artwork';
import type { ReleaseListItem, ReleaseRegion } from '../lib/releases-list';
import { formatCatalogDate } from '../lib/catalog-taxonomy';
import { useStores } from '../stores/root-store';

const shellClass = 'overflow-hidden rounded-2xl border border-card/60 bg-card/70 shadow-sm';
const motionClass =
  'transition-transform hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0';
const ringClass = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

function httpsSource(url: string | null): string | null {
  if (!url || !url.startsWith('https://')) return null;
  return url;
}

function regionLabel(region: ReleaseRegion | null, tt: (key: string) => string): string | null {
  if (region === 'CN') return tt('region.CN');
  if (region === 'JP') return tt('region.JP');
  if (region === 'GLOBAL') return tt('region.GLOBAL');
  return null;
}

function ReleaseTitle({ level, children }: { level: 'h3' | 'h4'; children: string }) {
  const className = 'text-lg font-semibold text-neutral-900 wrap-anywhere';
  if (level === 'h4') return <h4 className={className}>{children}</h4>;
  return <h3 className={className}>{children}</h3>;
}

function ReleaseArtwork({ series }: { series: NonNullable<ReleaseListItem['series']> }) {
  return (
    <div className="relative" aria-hidden>
      <Artwork
        kind="series"
        src={series.coverUrl}
        slug={series.slug}
        name={series.title}
        decorative
        className="w-full"
      />
    </div>
  );
}

function ReleaseMeta({
  item,
  showDate,
  dateLabel,
  locale,
  tt,
}: {
  item: ReleaseListItem;
  showDate: boolean;
  dateLabel?: string;
  locale: string;
  tt: (key: string) => string;
}) {
  const bits: Array<{ key: string; node: ReactNode }> = [];
  if (showDate) {
    bits.push({
      key: 'date',
      node: dateLabel ? (
        <span>{dateLabel}</span>
      ) : (
        <time dateTime={item.releaseDate}>{formatCatalogDate(locale, item.releaseDate)}</time>
      ),
    });
  }
  const region = regionLabel(item.region, tt);
  if (region) bits.push({ key: 'region', node: region });
  if (item.category) bits.push({ key: 'category', node: item.category.name });
  if (bits.length === 0) return null;
  return (
    <p className="text-sm text-neutral-600 tabular-nums">
      {bits.map((bit, index) => (
        <span key={bit.key}>
          {index > 0 ? ' · ' : null}
          {bit.node}
        </span>
      ))}
    </p>
  );
}

function ReleaseNote({ note }: { note: string | null }) {
  if (!note) return null;
  return <p className="line-clamp-3 min-w-0 text-sm text-neutral-600 wrap-anywhere">{note}</p>;
}

function ReleaseSource({ url, tt }: { url: string; tt: (key: string) => string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex min-h-6 items-center text-sm text-link hover:underline ${ringClass}`}
    >
      {tt('calendar.source')}
      <span className="sr-only">{tt('calendar.newWindow')}</span>
    </a>
  );
}

export const ReleaseItem = observer(function ReleaseItem({
  item,
  titleLevel,
  showDate,
  dateLabel,
}: {
  item: ReleaseListItem;
  titleLevel: 'h3' | 'h4';
  showDate: boolean;
  /** Replaces the formatted day, used for month-precision rows. */
  dateLabel?: string;
}) {
  const { locale } = useStores();
  const tt = (key: string) => t(locale.locale, key);
  const source = httpsSource(item.sourceUrl);
  const title = <ReleaseTitle level={titleLevel}>{item.title}</ReleaseTitle>;
  const meta = (
    <ReleaseMeta
      item={item}
      showDate={showDate}
      dateLabel={dateLabel}
      locale={locale.locale}
      tt={tt}
    />
  );
  const note = <ReleaseNote note={item.note} />;
  const sourceLink = source ? <ReleaseSource url={source} tt={tt} /> : null;

  if (!item.series) {
    return (
      <div className={`${shellClass} space-y-2 p-5`}>
        {title}
        {meta}
        {note}
        {sourceLink}
      </div>
    );
  }

  const artwork = <ReleaseArtwork series={item.series} />;
  if (sourceLink) {
    return (
      <div className={`${shellClass} ${motionClass}`}>
        <Link to={`/series/${item.series.slug}`} className={`group block ${ringClass}`}>
          {artwork}
          <div className="space-y-2 p-5">{title}</div>
        </Link>
        <div className="space-y-2 px-5 pb-5">
          {meta}
          {note}
          {sourceLink}
        </div>
      </div>
    );
  }

  return (
    <Link
      to={`/series/${item.series.slug}`}
      className={`group block ${shellClass} ${motionClass} ${ringClass}`}
    >
      {artwork}
      <div className="space-y-2 p-5">
        {title}
        {meta}
        {note}
      </div>
    </Link>
  );
});
