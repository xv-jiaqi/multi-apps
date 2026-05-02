import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { observer } from 'mobx-react-lite';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@repo/ui-web';
import { registerInput, t } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { useStores } from '../stores/root-store';
import { trpc } from '../lib/trpc';

export const RegisterPage = observer(function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { locale, session } = useStores();
  const tt = (key: string) => t(locale.locale, key);

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const redirectTo =
    (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/';

  const mutation = trpc.auth.register.useMutation({
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
    const parsed = registerInput.safeParse({ email, username, password });
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
          items={[{ label: tt('breadcrumb.home'), to: '/' }, { label: tt('auth.register.title') }]}
        />

        <Card className="border-white/60 bg-white/80 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-2xl">{tt('auth.register.title')}</CardTitle>
            <p className="text-sm text-neutral-600">{tt('auth.register.subtitle')}</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <Field
                label={tt('auth.fields.email')}
                type="email"
                value={email}
                onChange={setEmail}
                autoComplete="email"
                required
              />
              <Field
                label={tt('auth.fields.username')}
                type="text"
                value={username}
                onChange={setUsername}
                autoComplete="username"
                required
                minLength={3}
              />
              <Field
                label={tt('auth.fields.password')}
                type="password"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                required
                minLength={8}
              />

              {error ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                </p>
              ) : null}

              <Button type="submit" className="w-full" disabled={mutation.isPending}>
                {mutation.isPending ? tt('auth.actions.submitting') : tt('auth.actions.register')}
              </Button>

              <p className="text-center text-xs text-neutral-500">
                <Link to="/login" className="text-brand-600 hover:underline">
                  {tt('auth.actions.toLogin')}
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
});

interface FieldProps {
  label: string;
  type: 'text' | 'email' | 'password';
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
}

function Field({ label, type, value, onChange, autoComplete, required, minLength }: FieldProps) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-xs font-medium uppercase tracking-widest text-neutral-500">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-base text-neutral-900 shadow-sm transition-shadow focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-300"
      />
    </label>
  );
}
