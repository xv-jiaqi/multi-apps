import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import { APP_NAME, t } from '@repo/shared';
import { useStores } from '../stores/root-store';

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-2 py-1 text-sm font-medium transition-colors hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
    isActive ? 'text-neutral-900' : 'text-neutral-500'
  }`;

const mobileNavItemClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-md px-3 py-2 text-base transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
    isActive ? 'bg-neutral-100 font-medium text-neutral-900' : 'text-neutral-700'
  }`;

export const SiteHeader = observer(function SiteHeader() {
  const { locale, session } = useStores();
  const navigate = useNavigate();
  const tt = (key: string) => t(locale.locale, key);
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="app-safe-top sticky top-0 z-30 border-b border-white/40 bg-white/60 backdrop-blur-xl">
      <div className="app-safe-x mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link
          to="/"
          className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          onClick={closeMenu}
        >
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

        {/* Desktop nav (md+) */}
        <nav className="ml-2 hidden items-center gap-1 md:flex">
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

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            aria-label={tt('a11y.toggleLocale')}
            onClick={() => locale.setLocale(locale.locale === 'zh-CN' ? 'en-US' : 'zh-CN')}
            className="rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {locale.locale === 'zh-CN' ? 'EN' : '中'}
          </button>

          {/* Auth controls (desktop) */}
          <div className="hidden items-center gap-2 md:flex">
            {session.isAuthenticated ? (
              <>
                <span className="text-sm text-neutral-700">@{session.user?.username}</span>
                <button
                  type="button"
                  onClick={() => {
                    session.signOut();
                    navigate('/');
                  }}
                  className="rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  {tt('nav.logout')}
                </button>
              </>
            ) : (
              <>
                <NavLink
                  to="/login"
                  className="rounded-full px-3 py-1 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  {tt('nav.login')}
                </NavLink>
                <NavLink
                  to="/register"
                  className="rounded-full bg-neutral-900 px-3 py-1 text-sm text-white transition-colors hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  {tt('nav.register')}
                </NavLink>
              </>
            )}
          </div>

          {/* Hamburger (mobile) */}
          <button
            type="button"
            aria-label={menuOpen ? tt('a11y.closeMenu') : tt('a11y.openMenu')}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((prev) => !prev)}
            className="md:hidden rounded-md p-2 text-neutral-700 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <svg
              aria-hidden
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {menuOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {menuOpen && (
        <div
          id="mobile-nav"
          className="md:hidden border-t border-neutral-200 bg-white/95 backdrop-blur"
        >
          <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3">
            <NavLink to="/" end className={mobileNavItemClass} onClick={closeMenu}>
              {tt('nav.home')}
            </NavLink>
            <NavLink to="/series" className={mobileNavItemClass} onClick={closeMenu}>
              {tt('nav.series')}
            </NavLink>
            <NavLink to="/search" className={mobileNavItemClass} onClick={closeMenu}>
              {tt('nav.search')}
            </NavLink>
            <hr className="my-2 border-neutral-200" />
            {session.isAuthenticated ? (
              <>
                <p className="px-3 py-2 text-sm text-neutral-500">@{session.user?.username}</p>
                <button
                  type="button"
                  onClick={() => {
                    session.signOut();
                    closeMenu();
                    navigate('/');
                  }}
                  className="block rounded-md px-3 py-2 text-left text-base text-neutral-700 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  {tt('nav.logout')}
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login" className={mobileNavItemClass} onClick={closeMenu}>
                  {tt('nav.login')}
                </NavLink>
                <NavLink to="/register" className={mobileNavItemClass} onClick={closeMenu}>
                  {tt('nav.register')}
                </NavLink>
              </>
            )}
          </nav>
        </div>
      )}
    </header>
  );
});
