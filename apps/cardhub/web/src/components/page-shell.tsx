import type { PropsWithChildren } from 'react';
import { observer } from 'mobx-react-lite';
import { t } from '@repo/shared';
import { LegacyPasswordNotice } from './legacy-password-notice';
import { SiteHeader } from './site-header';
import { useStores } from '../stores/root-store';

export const PageShell = observer(function PageShell({ children }: PropsWithChildren) {
  const { locale } = useStores();
  const tt = (key: string) => t(locale.locale, key);

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-white via-neutral-50 to-neutral-100 text-neutral-900">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-neutral-900 focus:px-3 focus:py-2 focus:text-sm focus:text-white focus:shadow-lg"
      >
        {tt('a11y.skipToContent')}
      </a>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 h-[28rem] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(165,180,252,0.4),rgba(255,255,255,0))]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 top-40 h-96 w-96 rounded-full bg-rose-200/50 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 top-80 h-96 w-96 rounded-full bg-sky-200/50 blur-3xl"
      />
      <SiteHeader />
      <main
        id="main"
        tabIndex={-1}
        className="app-safe-x app-safe-bottom relative mx-auto w-full max-w-6xl py-10 focus:outline-none"
      >
        <LegacyPasswordNotice />
        {children}
      </main>
    </div>
  );
});
