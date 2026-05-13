import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { observer } from 'mobx-react-lite';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@repo/ui-web';
import { loginInput, t } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { resolvePostAuthRedirect } from '../lib/auth-redirect';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';

export const LoginPage = observer(function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { locale, session } = useStores();
  const tt = (key: string) => t(locale.locale, key);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Pages that redirect anonymous visitors should call navigate('/login',
  // { state: { from: location } }) so we can restore them post-login.
  const redirectTo = resolvePostAuthRedirect(location.state);

  const mutation = trpc.auth.login.useMutation({
    onSuccess(data) {
      session.signIn(data.token, data.user);
      navigate(redirectTo, { replace: true });
    },
    onError(err) {
      setError(err.message);
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const parsed = loginInput.safeParse({ identifier, password });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue?.message ?? tt('auth.errors.required'));
      return;
    }
    mutation.mutate(parsed.data);
  };

  return (
    <PageShell>
      <div className="mx-auto max-w-md space-y-6">
        <Breadcrumbs
          items={[{ label: tt('breadcrumb.home'), to: '/' }, { label: tt('auth.login.title') }]}
        />

        <Card className="border-white/60 bg-white/80 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-2xl">{tt('auth.login.title')}</CardTitle>
            <p className="text-sm text-neutral-600">{tt('auth.login.subtitle')}</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <label className="block space-y-1 text-sm">
                <span className="text-xs font-medium uppercase tracking-widest text-neutral-500">
                  {tt('auth.fields.identifier')}
                </span>
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  autoComplete="username"
                  required
                  className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-base text-neutral-900 shadow-sm transition-shadow focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-300"
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="text-xs font-medium uppercase tracking-widest text-neutral-500">
                  {tt('auth.fields.password')}
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  minLength={8}
                  className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-base text-neutral-900 shadow-sm transition-shadow focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-300"
                />
              </label>

              {error ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                </p>
              ) : null}

              <Button type="submit" className="w-full" disabled={mutation.isPending}>
                {mutation.isPending ? tt('auth.actions.submitting') : tt('auth.actions.login')}
              </Button>

              <p className="text-center text-xs text-neutral-500">
                <Link to="/register" className="text-brand-600 hover:underline">
                  {tt('auth.actions.toRegister')}
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
});
