import { Link } from 'react-router';
import { t } from '@repo/shared';
import { observer } from 'mobx-react-lite';
import { Button } from '@repo/ui-web';
import { PageShell } from '../components/page-shell';
import { PageMeta } from '../components/page-meta';
import { useStores } from '../stores/root-store';

export const NotFoundPage = observer(function NotFoundPage() {
  const { locale } = useStores();
  const tt = (key: string) => t(locale.locale, key);
  return (
    <PageShell>
      <PageMeta title={tt('state.notFound')} />
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="text-6xl font-black tracking-tight text-neutral-300">404</p>
        <h1 className="text-2xl font-semibold">{tt('state.notFound')}</h1>
        <Button asChild>
          <Link to="/">{tt('breadcrumb.home')}</Link>
        </Button>
      </div>
    </PageShell>
  );
});
