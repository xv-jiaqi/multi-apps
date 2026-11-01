import { observer } from 'mobx-react-lite';
import { Link } from 'react-router';
import { t } from '@repo/shared';
import { useStores } from '../stores/root-store';

/** CH-205 §5 / §7: the calendar page and this link ship together. */
export const FOOTER_LINKS: ReadonlyArray<{ href: string; labelKey: string }> = [
  { href: '/categories', labelKey: 'nav.categories' },
  { href: '/series', labelKey: 'nav.series' },
  { href: '/calendar', labelKey: 'nav.calendar' },
  { href: '/forum', labelKey: 'nav.forum' },
  { href: '/trade', labelKey: 'nav.trade' },
];

const footerLinkClass =
  'inline-flex min-h-6 items-center hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

export const SiteFooter = observer(function SiteFooter() {
  const { locale } = useStores();
  const tt = (key: string) => t(locale.locale, key);
  const nextIsEnglish = locale.locale === 'zh-CN';

  return (
    <footer className="app-safe-x app-safe-bottom mx-auto w-full max-w-6xl border-t border-neutral-200 py-8 text-sm text-neutral-600">
      <nav aria-label={tt('footer.nav')} className="flex flex-wrap gap-x-4 gap-y-2">
        {FOOTER_LINKS.map((link) => (
          <Link key={link.href} to={link.href} className={footerLinkClass}>
            {tt(link.labelKey)}
          </Link>
        ))}
      </nav>
      <p className="mt-4">{tt('footer.unofficial')}</p>
      <p className="mt-2">{tt('trade.list.disclaimer')}</p>
      <button
        type="button"
        lang={nextIsEnglish ? 'en' : 'zh'}
        onClick={() => locale.setLocale(nextIsEnglish ? 'en-US' : 'zh-CN')}
        className="mt-4 inline-flex min-h-6 items-center rounded-md border border-neutral-300 px-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {tt('footer.locale')}
      </button>
    </footer>
  );
});
