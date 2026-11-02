import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { APP_NAME, t } from '@repo/shared';
import { clearNotificationCache } from '../lib/notification-cache';
import { useStores } from '../stores/root-store';
import { HeaderSearch } from './header-search';
import { NotificationBell, NotificationUnreadProvider } from './notification-unread';

const navItemClass = ({ isActive }: { isActive: boolean }) =>
  `shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium transition-colors hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ${
    isActive ? 'text-neutral-900' : 'text-neutral-600'
  }`;

const mobileNavItemClass = ({ isActive }: { isActive: boolean }) =>
  `block rounded-md px-3 py-2 text-base transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
    isActive ? 'bg-neutral-100 font-medium text-neutral-900' : 'text-neutral-700'
  }`;

const adminLinkClass =
  'block whitespace-nowrap rounded-sm px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 aria-[current=page]:font-medium aria-[current=page]:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

const ADMIN_LINKS = [
  { to: '/admin/catalog', key: 'nav.catalog' },
  { to: '/admin/releases', key: 'nav.releases' },
  { to: '/admin/users', key: 'nav.users' },
  { to: '/reports', key: 'nav.reports' },
  { to: '/admin/audit', key: 'nav.audit' },
] as const;

const MAIN_LINKS = [
  { to: '/', key: 'nav.home', end: true },
  { to: '/categories', key: 'nav.categories', end: false },
  { to: '/series', key: 'nav.series', end: false },
  { to: '/calendar', key: 'nav.calendar', end: false },
  { to: '/forum', key: 'nav.forum', end: false },
  { to: '/trade', key: 'nav.trade', end: false },
] as const;

/** Tailwind `xl` breakpoint (80rem); the hamburger menu closes at and above it. */
const XL_QUERY = '(min-width: 80rem)';

function AccountMenu({
  tt,
  username,
  isAdmin,
}: {
  tt: (key: string, vars?: Record<string, string | number>) => string;
  username: string;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();
  const inAccountArea =
    pathname === '/me' || pathname === '/reports' || pathname.startsWith('/admin');

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
      className="relative shrink-0"
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
        aria-label={tt('nav.meAria', { user: username })}
        aria-expanded={open}
        aria-controls="account-menu"
        className={`inline-flex size-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
          inAccountArea ? 'ring-2 ring-brand-500' : ''
        }`}
        onClick={() => setOpen((current) => !current)}
      >
        <span
          aria-hidden
          className="inline-flex size-9 items-center justify-center rounded-full bg-neutral-200 text-sm font-medium text-neutral-700"
        >
          {Array.from(username)[0] ?? ''}
        </span>
      </button>
      {open ? (
        <ul
          id="account-menu"
          className="absolute right-0 top-full z-40 mt-2 min-w-40 rounded-md border border-neutral-200 bg-white p-1 shadow-lg"
        >
          <li>
            <NavLink to="/me" className={adminLinkClass}>
              {tt('nav.me')}
            </NavLink>
          </li>
          <li>
            <NavLink to="/notifications" className={adminLinkClass}>
              {tt('nav.notifications')}
            </NavLink>
          </li>
          {isAdmin ? (
            <>
              <li role="separator" className="my-1 border-t border-neutral-200" />
              <li className="px-3 pt-2 text-xs font-medium text-neutral-600">{tt('nav.admin')}</li>
              {ADMIN_LINKS.map((link) => (
                <li key={link.to}>
                  <NavLink to={link.to} className={adminLinkClass}>
                    {tt(link.key)}
                  </NavLink>
                </li>
              ))}
            </>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

const iconButtonClass =
  'inline-flex size-11 shrink-0 items-center justify-center rounded-md text-neutral-700 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

const pillClass =
  'shrink-0 whitespace-nowrap rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

export const SiteHeader = observer(function SiteHeader() {
  const { locale, session } = useStores();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const closeMenu = () => setMenuOpen(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(XL_QUERY);
    if (query.matches) {
      setMenuOpen(false);
      return;
    }
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setMenuOpen(false);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [menuOpen]);

  const signOut = () => {
    clearNotificationCache();
    session.signOut();
    closeMenu();
    navigate('/');
  };

  const localeButton = (className: string) => (
    <button
      type="button"
      aria-label={
        locale.locale === 'zh-CN' ? tt('a11y.localeSwitchToEn') : tt('a11y.localeSwitchToZh')
      }
      onClick={() => locale.setLocale(locale.locale === 'zh-CN' ? 'en-US' : 'zh-CN')}
      className={className}
    >
      {locale.locale === 'zh-CN' ? tt('a11y.localeEn') : tt('a11y.localeZh')}
    </button>
  );

  const drawerButtonClass =
    'block w-full rounded-md px-3 py-2 text-left text-base text-neutral-700 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

  return (
    <NotificationUnreadProvider enabled={session.isAuthenticated}>
      <header
        className="app-safe-top sticky top-0 z-30 border-b border-white/40 bg-white/60 backdrop-blur-xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && menuOpen) {
            setMenuOpen(false);
            menuButtonRef.current?.focus();
          }
        }}
      >
        <div className="app-safe-x mx-auto flex h-16 w-full max-w-6xl flex-nowrap items-center gap-4">
          <Link
            to="/"
            className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
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

          {/* Desktop nav (xl+) */}
          <nav className="ml-2 hidden shrink-0 items-center gap-1 xl:flex">
            {MAIN_LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end} className={navItemClass}>
                {tt(link.key)}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto hidden w-56 shrink-0 lg:block">
            <HeaderSearch placement="inline" />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2 lg:ml-0">
            <NavLink
              to="/search"
              aria-label={tt('nav.search')}
              className={`${iconButtonClass} lg:hidden`}
            >
              <Search className="size-5" aria-hidden />
            </NavLink>

            {localeButton(`${pillClass} hidden xl:inline-flex`)}

            {session.isAuthenticated ? (
              <>
                <NotificationBell />
                <AccountMenu
                  tt={tt}
                  username={session.user?.username ?? ''}
                  isAdmin={session.isAdmin}
                />
                <button
                  type="button"
                  onClick={signOut}
                  className={`${pillClass} hidden xl:inline-flex`}
                >
                  {tt('nav.logout')}
                </button>
              </>
            ) : (
              <>
                <NavLink
                  to="/login"
                  className="shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-sm text-neutral-600 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  {tt('nav.login')}
                </NavLink>
                <NavLink
                  to="/register"
                  className="hidden shrink-0 whitespace-nowrap rounded-full bg-neutral-900 px-3 py-1 text-sm text-white transition-colors hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 xl:inline-flex"
                >
                  {tt('nav.register')}
                </NavLink>
              </>
            )}

            {/* Hamburger (below xl) */}
            <button
              ref={menuButtonRef}
              type="button"
              aria-label={menuOpen ? tt('a11y.closeMenu') : tt('a11y.openMenu')}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              onClick={() => setMenuOpen((prev) => !prev)}
              className={`${iconButtonClass} xl:hidden`}
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

        {/* Hamburger menu */}
        {menuOpen && (
          <div id="mobile-nav" className="border-t border-neutral-200 bg-white xl:hidden">
            <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3">
              {MAIN_LINKS.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.end}
                  className={mobileNavItemClass}
                  onClick={closeMenu}
                >
                  {tt(link.key)}
                </NavLink>
              ))}
              <hr className="my-2 border-neutral-200" />
              {session.isAuthenticated ? (
                <>
                  {localeButton(drawerButtonClass)}
                  <button type="button" onClick={signOut} className={drawerButtonClass}>
                    {tt('nav.logout')}
                  </button>
                </>
              ) : (
                <>
                  <NavLink to="/register" className={mobileNavItemClass} onClick={closeMenu}>
                    {tt('nav.register')}
                  </NavLink>
                  {localeButton(drawerButtonClass)}
                </>
              )}
            </nav>
          </div>
        )}
      </header>
    </NotificationUnreadProvider>
  );
});
