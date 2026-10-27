import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { APP_NAME, t } from '@repo/shared';
import { useStores } from '../stores/root-store';
import { HeaderSearch } from './header-search';

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-2 py-1 text-sm font-medium transition-colors hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
    isActive ? 'text-neutral-900' : 'text-neutral-500'
  }`;

const mobileNavItemClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-md px-3 py-2 text-base transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
    isActive ? 'bg-neutral-100 font-medium text-neutral-900' : 'text-neutral-700'
  }`;

const adminLinkClass =
  'block rounded-sm px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 aria-[current=page]:font-medium aria-[current=page]:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

function AdminNav({ tt, onAdminRoute }: { tt: (key: string) => string; onAdminRoute: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls="admin-nav"
        className={`${navItemClass({ isActive: onAdminRoute })} inline-flex items-center gap-1`}
        onClick={() => setOpen((current) => !current)}
      >
        {tt('nav.admin')}
        <ChevronDown className="size-4" aria-hidden />
      </button>
      {open ? (
        <ul
          id="admin-nav"
          className="absolute left-0 top-full z-40 mt-2 min-w-40 rounded-md border border-neutral-200 bg-white p-1 shadow-lg"
        >
          <li>
            <NavLink to="/admin/catalog" className={adminLinkClass}>
              {tt('nav.catalog')}
            </NavLink>
          </li>
          <li>
            <NavLink to="/admin/users" className={adminLinkClass}>
              {tt('nav.users')}
            </NavLink>
          </li>
          <li>
            <NavLink to="/reports" className={adminLinkClass}>
              {tt('nav.reports')}
            </NavLink>
          </li>
        </ul>
      ) : null}
    </div>
  );
}

const mobileAdminNavItemClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-md py-2 pl-6 pr-3 text-base transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
    isActive ? 'bg-neutral-100 font-medium text-neutral-900' : 'text-neutral-700'
  }`;

export const SiteHeader = observer(function SiteHeader() {
  const { locale, session } = useStores();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const [menuOpen, setMenuOpen] = useState(false);
  const onAdminRoute = pathname === '/reports' || pathname.startsWith('/admin');

  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="app-safe-top sticky top-0 z-30 border-b border-white/40 bg-white/60 backdrop-blur-xl">
      <div className="app-safe-x mx-auto flex h-16 w-full max-w-6xl items-center gap-4">
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
          <NavLink to="/search" className={(state) => `${navItemClass(state)} lg:hidden`}>
            {tt('nav.search')}
          </NavLink>
          <NavLink to="/forum" className={navItemClass}>
            {tt('nav.forum')}
          </NavLink>
          <NavLink to="/trade" className={navItemClass}>
            {tt('nav.trade')}
          </NavLink>
          {session.isAdmin ? <AdminNav tt={tt} onAdminRoute={onAdminRoute} /> : null}
        </nav>

        <div className="ml-auto hidden w-56 lg:block xl:w-72">
          <HeaderSearch placement="inline" />
        </div>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <button
            type="button"
            aria-label={
              locale.locale === 'zh-CN' ? tt('a11y.localeSwitchToEn') : tt('a11y.localeSwitchToZh')
            }
            onClick={() => locale.setLocale(locale.locale === 'zh-CN' ? 'en-US' : 'zh-CN')}
            className="rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {locale.locale === 'zh-CN' ? tt('a11y.localeEn') : tt('a11y.localeZh')}
          </button>

          {/* Auth controls (desktop) */}
          <div className="hidden items-center gap-2 md:flex">
            {session.isAuthenticated ? (
              <>
                <NavLink
                  to="/me"
                  aria-label={tt('nav.meAria', { user: session.user?.username ?? '' })}
                  className="rounded-full px-3 py-1 text-sm text-neutral-700 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 aria-[current=page]:font-medium aria-[current=page]:text-neutral-900"
                >
                  @{session.user?.username}
                </NavLink>
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
            <div className="pb-2">
              <HeaderSearch placement="drawer" onAfterNavigate={closeMenu} />
            </div>
            <NavLink to="/" end className={mobileNavItemClass} onClick={closeMenu}>
              {tt('nav.home')}
            </NavLink>
            <NavLink to="/series" className={mobileNavItemClass} onClick={closeMenu}>
              {tt('nav.series')}
            </NavLink>
            <NavLink to="/search" className={mobileNavItemClass} onClick={closeMenu}>
              {tt('nav.search')}
            </NavLink>
            <NavLink to="/forum" className={mobileNavItemClass} onClick={closeMenu}>
              {tt('nav.forum')}
            </NavLink>
            <NavLink to="/trade" className={mobileNavItemClass} onClick={closeMenu}>
              {tt('nav.trade')}
            </NavLink>
            {session.isAdmin ? (
              <>
                <p className="px-3 pt-2 text-xs font-medium text-neutral-500">{tt('nav.admin')}</p>
                <NavLink
                  to="/admin/catalog"
                  className={mobileAdminNavItemClass}
                  onClick={closeMenu}
                >
                  {tt('nav.catalog')}
                </NavLink>
                <NavLink to="/admin/users" className={mobileAdminNavItemClass} onClick={closeMenu}>
                  {tt('nav.users')}
                </NavLink>
                <NavLink to="/reports" className={mobileAdminNavItemClass} onClick={closeMenu}>
                  {tt('nav.reports')}
                </NavLink>
              </>
            ) : null}
            <hr className="my-2 border-neutral-200" />
            {session.isAuthenticated ? (
              <>
                <NavLink to="/me" className={mobileNavItemClass} onClick={closeMenu}>
                  {tt('nav.me')}{' '}
                  <span className="text-sm text-neutral-500">@{session.user?.username}</span>
                </NavLink>
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
