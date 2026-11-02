import type { PropsWithChildren } from 'react';
import { observer } from 'mobx-react-lite';
import { t } from '@repo/shared';
import { LegacyPasswordNotice } from './legacy-password-notice';
import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';
import { useStores } from '../stores/root-store';

export const PageShell = observer(function PageShell({ children }: PropsWithChildren) {
  const { locale, session } = useStores();
  const tt = (key: string) => t(locale.locale, key);

  return (
    <div className="min-h-screen bg-page text-neutral-900">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-neutral-900 focus:px-3 focus:py-2 focus:text-sm focus:text-white focus:shadow-lg"
      >
        {tt('a11y.skipToContent')}
      </a>
      <SiteHeader />
      <main
        id="main"
        tabIndex={-1}
        className="app-safe-x app-safe-bottom relative mx-auto w-full max-w-6xl py-10 focus:outline-none"
      >
        {session.isBanned ? (
          <section
            aria-labelledby="ban-banner-title"
            className="mb-6 rounded-lg border border-neutral-300 bg-neutral-100 px-4 py-3 text-sm text-neutral-800"
          >
            <h2 id="ban-banner-title" className="font-semibold text-neutral-900">
              {tt('ban.banner.title')}
            </h2>
            <p className="mt-1">{tt('ban.banner.body')}</p>
          </section>
        ) : null}
        <LegacyPasswordNotice />
        {children}
      </main>
      <SiteFooter />
    </div>
  );
});
