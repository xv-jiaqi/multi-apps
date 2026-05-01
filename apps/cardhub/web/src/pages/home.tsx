import { observer } from 'mobx-react-lite';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui-web';
import { APP_NAME, t } from '@repo/shared';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';

export const HomePage = observer(function HomePage() {
  const { locale } = useStores();
  const ping = trpc.health.ping.useQuery();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 px-6 py-16">
      <header className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-neutral-900">
          {t(locale.locale, 'welcome.title')}
        </h1>
        <p className="mt-3 text-base text-neutral-600">{t(locale.locale, 'welcome.subtitle')}</p>
      </header>

      <Card className="w-full">
        <CardHeader>
          <CardTitle>{APP_NAME} · 端到端类型安全演示</CardTitle>
          <CardDescription>
            这个卡片通过 tRPC 调用 <code className="rounded bg-neutral-100 px-1">health.ping</code>
            ， 返回值的类型完全由后端 AppRouter 推导。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {ping.isLoading ? (
            <p className="text-sm text-neutral-500">{t(locale.locale, 'health.fail')}…</p>
          ) : ping.isError ? (
            <p className="text-sm text-red-600">
              {t(locale.locale, 'health.fail')}: {ping.error.message}
            </p>
          ) : ping.data ? (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-neutral-500">status</dt>
              <dd className="font-mono">{ping.data.status}</dd>
              <dt className="text-neutral-500">timestamp</dt>
              <dd className="font-mono">{new Date(ping.data.timestamp).toLocaleString()}</dd>
              <dt className="text-neutral-500">message</dt>
              <dd>{ping.data.message}</dd>
            </dl>
          ) : null}
          <div className="flex gap-2">
            <Button onClick={() => ping.refetch()}>重新检查</Button>
            <Button
              variant="outline"
              onClick={() => locale.setLocale(locale.locale === 'zh-CN' ? 'en-US' : 'zh-CN')}
            >
              切换语言 · {locale.locale}
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
});
