import { observer } from 'mobx-react-lite';
import { Link, NavLink } from 'react-router';
import { APP_NAME, t } from '@repo/shared';
import { useStores } from '../stores/root-store';

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm font-medium transition-colors hover:text-neutral-900 ${
    isActive ? 'text-neutral-900' : 'text-neutral-500'
  }`;

export const SiteHeader = observer(function SiteHeader() {
  const { locale } = useStores();
  const tt = (key: string) => t(locale.locale, key);

  return (
    <header className="sticky top-0 z-30 border-b border-white/40 bg-white/60 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-6">
        <Link to="/" className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-orange-400 text-sm font-black text-white shadow-md"
          >
            C
          </span>
          <span className="text-base font-semibold tracking-tight text-neutral-900">
            {APP_NAME}
          </span>
        </Link>

        <nav className="ml-4 flex items-center gap-5">
          <NavLink to="/" end className={navItemClass}>
            {tt('nav.home')}
          </NavLink>
          <NavLink to="/series" className={navItemClass}>
            {tt('nav.series')}
          </NavLink>
          <NavLink to="/search" className={navItemClass}>
            {tt('nav.search')}
          </NavLink>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => locale.setLocale(locale.locale === 'zh-CN' ? 'en-US' : 'zh-CN')}
            className="rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-100"
          >
            {locale.locale === 'zh-CN' ? 'EN' : '中'}
          </button>
        </div>
      </div>
    </header>
  );
});
