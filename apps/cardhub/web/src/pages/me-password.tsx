import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { observer } from 'mobx-react-lite';
import { Eye, EyeOff } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@repo/ui-web';
import { APP_ERROR_CODES, t } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { PageMeta } from '../components/page-meta';
import { trpc } from '../lib/trpc';
import { useStores } from '../stores/root-store';

const NEW_PASSWORD_MIN = 8;
const NEW_PASSWORD_MAX = 72;

type FieldName = 'current' | 'next' | 'confirm';

type PasswordError = {
  message: string;
  data?: {
    code?: string;
    appCode?: string;
    zodError?: { fieldErrors?: Record<string, string[] | undefined> };
  };
};

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  error,
  errorId,
  showLabel,
  hideLabel,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  error?: string;
  errorId: string;
  showLabel: string;
  hideLabel: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium text-neutral-800">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="pr-12"
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-md text-neutral-600 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          aria-pressed={visible}
          aria-label={visible ? hideLabel : showLabel}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? (
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Eye className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>
      {error ? (
        <p id={errorId} className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const ChangePasswordPage = observer(function ChangePasswordPage() {
  const navigate = useNavigate();
  const { locale, session } = useStores();
  const tt = (key: string) => t(locale.locale, key);
  const formId = useId();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const formErrorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!session.isAuthenticated) {
      navigate('/login', { replace: true, state: { from: '/me/password' } });
    }
  }, [navigate, session.isAuthenticated]);

  useEffect(() => {
    if (!focusTarget) return;
    if (focusTarget === 'password-form-error') {
      formErrorRef.current?.focus();
    } else {
      document.getElementById(focusTarget)?.focus();
    }
    setFocusTarget(null);
  }, [focusTarget]);

  const mutation = trpc.auth.changePassword.useMutation({
    onSuccess(data) {
      if (session.user) session.signIn(data.token, session.user);
      navigate('/me#me-security', { replace: true, state: { notice: 'passwordChanged' } });
    },
    onError(error) {
      const data = (error as PasswordError).data;
      const appCode = data?.appCode;
      const code = data?.code;
      if (code === 'UNAUTHORIZED' && appCode !== APP_ERROR_CODES.WRONG_PASSWORD) return;

      if (appCode === APP_ERROR_CODES.WRONG_PASSWORD) {
        setFieldErrors({ current: tt('me.password.errors.wrong') });
        setFocusTarget('password-current');
        return;
      }
      if (appCode === APP_ERROR_CODES.SAME_PASSWORD) {
        setFieldErrors({ next: tt('me.password.errors.same') });
        setFocusTarget('password-new');
        return;
      }
      if (appCode === APP_ERROR_CODES.TOO_MANY_REQUESTS || code === 'TOO_MANY_REQUESTS') {
        setFormError(tt('me.password.errors.rateLimit'));
        setFocusTarget('password-form-error');
        return;
      }
      const newPasswordIssue = data?.zodError?.fieldErrors?.newPassword;
      if (newPasswordIssue && newPasswordIssue.length > 0) {
        setFieldErrors({ next: tt('me.password.errors.newLength') });
        setFocusTarget('password-new');
        return;
      }
      setFormError(tt('me.password.errors.failed'));
      setFocusTarget('password-form-error');
    },
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending) return;
    const nextErrors: Partial<Record<FieldName, string>> = {};
    if (!currentPassword) nextErrors.current = tt('me.password.errors.currentRequired');
    if (!newPassword) nextErrors.next = tt('me.password.errors.newRequired');
    else if (newPassword.length < NEW_PASSWORD_MIN || newPassword.length > NEW_PASSWORD_MAX) {
      nextErrors.next = tt('me.password.errors.newLength');
    }
    if (newPassword && !nextErrors.next && newPassword !== confirmPassword) {
      nextErrors.confirm = tt('me.password.errors.mismatch');
    }
    setFieldErrors(nextErrors);
    setFormError(null);
    if (nextErrors.current) {
      setFocusTarget('password-current');
      return;
    }
    if (nextErrors.next) {
      setFocusTarget('password-new');
      return;
    }
    if (nextErrors.confirm) {
      setFocusTarget('password-confirm');
      return;
    }
    mutation.mutate({ currentPassword, newPassword });
  };

  if (!session.isAuthenticated) return null;

  return (
    <PageShell>
      <PageMeta title={tt('me.password.title')} />
      <div className="mx-auto max-w-md space-y-6">
        <Breadcrumbs
          items={[
            { label: tt('breadcrumb.home'), to: '/' },
            { label: tt('me.title'), to: '/me' },
            { label: tt('me.password.title') },
          ]}
        />
        <Card className="border-white/60 bg-white/80 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-2xl">{tt('me.password.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              id={formId}
              onSubmit={onSubmit}
              className="space-y-4"
              aria-busy={mutation.isPending || undefined}
              noValidate
            >
              <PasswordField
                id="password-current"
                label={tt('me.password.current')}
                value={currentPassword}
                onChange={setCurrentPassword}
                autoComplete="current-password"
                error={fieldErrors.current}
                errorId="password-current-error"
                showLabel={tt('me.password.show')}
                hideLabel={tt('me.password.hide')}
              />
              <PasswordField
                id="password-new"
                label={tt('me.password.new')}
                value={newPassword}
                onChange={setNewPassword}
                autoComplete="new-password"
                error={fieldErrors.next}
                errorId="password-new-error"
                showLabel={tt('me.password.show')}
                hideLabel={tt('me.password.hide')}
              />
              <PasswordField
                id="password-confirm"
                label={tt('me.password.confirm')}
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
                error={fieldErrors.confirm}
                errorId="password-confirm-error"
                showLabel={tt('me.password.show')}
                hideLabel={tt('me.password.hide')}
              />
              {formError ? (
                <p
                  ref={formErrorRef}
                  id="password-form-error"
                  role="alert"
                  tabIndex={-1}
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  {formError}
                </p>
              ) : null}
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? tt('me.password.submitting') : tt('me.password.submit')}
              </Button>
            </form>
            <p className="mt-4 text-sm">
              <Link
                to="/me#me-security"
                className="text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                {tt('me.title')}
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
});
