import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { observer } from 'mobx-react-lite';
import { Eye, EyeOff } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@repo/ui-web';
import { APP_ERROR_CODES, passwordSchema, t } from '@repo/shared';
import { PageShell } from '../components/page-shell';
import { Breadcrumbs } from '../components/breadcrumbs';
import { PageMeta } from '../components/page-meta';
import { trpc } from '../lib/trpc';
import { LEGACY_PASSWORD_LATER_KEY } from '../components/legacy-password-notice';
import { useStores } from '../stores/root-store';

type FieldName = 'current' | 'next' | 'confirm';

type PasswordError = {
  message: string;
  data?: {
    code?: string;
    appCode?: string;
  };
};

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  error,
  hint,
  showLabel,
  hideLabel,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  error?: string;
  hint?: string;
  showLabel: string;
  hideLabel: string;
}) {
  const [visible, setVisible] = useState(false);
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
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
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="pr-10"
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center rounded-r-md text-neutral-500 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          aria-pressed={visible}
          aria-label={visible ? hideLabel : showLabel}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? (
            <EyeOff className="size-4" aria-hidden />
          ) : (
            <Eye className="size-4" aria-hidden />
          )}
        </button>
      </div>
      {hint ? (
        <p id={hintId} className="text-xs text-neutral-600">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const ChangePasswordPage = observer(function ChangePasswordPage() {
  const navigate = useNavigate();
  const { locale, session } = useStores();
  const tt = (key: string, vars?: Record<string, string | number>) => t(locale.locale, key, vars);
  const formId = useId();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [focusSubmit, setFocusSubmit] = useState(false);
  const submitRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!session.isAuthenticated) {
      navigate('/login', { replace: true, state: { from: '/me/password' } });
    }
  }, [navigate, session.isAuthenticated]);

  useEffect(() => {
    if (!focusTarget) return;
    document.getElementById(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  const clearFieldError = (field: FieldName) => {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const fieldLabel = (label: string) => (locale.locale === 'en-US' ? label.toLowerCase() : label);

  const mutation = trpc.auth.changePassword.useMutation({
    onSuccess(data) {
      if (session.user) {
        session.signIn(data.token, { ...session.user, passwordChangeRecommended: false });
      }
      try {
        window.sessionStorage.removeItem(LEGACY_PASSWORD_LATER_KEY);
      } catch {
        // sessionStorage may be unavailable.
      }
      navigate('/me#me-security', { replace: true, state: { notice: 'passwordChanged' } });
    },
    onError(error) {
      const data = (error as PasswordError).data;
      const appCode = data?.appCode;
      const code = data?.code;
      if (appCode === APP_ERROR_CODES.UNAUTHORIZED) return;

      if (appCode === APP_ERROR_CODES.WRONG_PASSWORD) {
        setCurrentPassword('');
        setFieldErrors({ current: tt('me.password.errors.wrong') });
        setFormError(null);
        setFocusTarget('password-current');
        return;
      }
      if (appCode === APP_ERROR_CODES.SAME_PASSWORD) {
        setFieldErrors({ next: tt('me.password.errors.same') });
        setFormError(null);
        setFocusTarget('password-new');
        return;
      }
      if (appCode === APP_ERROR_CODES.TOO_MANY_REQUESTS || code === 'TOO_MANY_REQUESTS') {
        setFormError(tt('me.password.errors.rateLimited'));
        setFocusSubmit(true);
        return;
      }
      setFormError(tt('me.password.errors.failed'));
      setFocusSubmit(true);
    },
  });

  const busy = mutation.isPending;

  useEffect(() => {
    if (!focusSubmit || busy) return;
    submitRef.current?.focus();
    setFocusSubmit(false);
  }, [focusSubmit, busy]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mutation.isPending) return;
    const nextErrors: Partial<Record<FieldName, string>> = {};
    if (!currentPassword) nextErrors.current = tt('me.password.errors.currentRequired');
    const parsed = passwordSchema.safeParse(newPassword);
    if (!parsed.success) {
      const code = parsed.error.issues[0]?.code;
      nextErrors.next =
        code === 'too_big' ? tt('me.password.errors.tooLong') : tt('auth.errors.password.short');
    } else if (newPassword === currentPassword) {
      nextErrors.next = tt('me.password.errors.same');
    }
    if (!confirmPassword) nextErrors.confirm = tt('me.password.errors.confirmRequired');
    else if (confirmPassword !== newPassword) {
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

  if (!session.isAuthenticated || !session.user) return null;

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
            <p className="text-sm text-neutral-600">{tt('me.password.subtitle')}</p>
          </CardHeader>
          <CardContent>
            <form
              id={formId}
              onSubmit={onSubmit}
              className="space-y-5"
              aria-busy={busy || undefined}
              noValidate
            >
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={session.user.username}
                readOnly
                hidden
              />
              <PasswordField
                id="password-current"
                label={tt('me.password.current')}
                value={currentPassword}
                onChange={(value) => {
                  setCurrentPassword(value);
                  clearFieldError('current');
                }}
                autoComplete="current-password"
                error={fieldErrors.current}
                showLabel={tt('me.password.show', { field: fieldLabel(tt('me.password.current')) })}
                hideLabel={tt('me.password.hide', { field: fieldLabel(tt('me.password.current')) })}
              />
              <PasswordField
                id="password-new"
                label={tt('me.password.new')}
                value={newPassword}
                onChange={(value) => {
                  setNewPassword(value);
                  clearFieldError('next');
                }}
                autoComplete="new-password"
                error={fieldErrors.next}
                hint={tt('me.password.newHint')}
                showLabel={tt('me.password.show', { field: fieldLabel(tt('me.password.new')) })}
                hideLabel={tt('me.password.hide', { field: fieldLabel(tt('me.password.new')) })}
              />
              <PasswordField
                id="password-confirm"
                label={tt('me.password.confirm')}
                value={confirmPassword}
                onChange={(value) => {
                  setConfirmPassword(value);
                  clearFieldError('confirm');
                }}
                autoComplete="new-password"
                error={fieldErrors.confirm}
                showLabel={tt('me.password.show', {
                  field: fieldLabel(tt('me.password.confirm')),
                })}
                hideLabel={tt('me.password.hide', {
                  field: fieldLabel(tt('me.password.confirm')),
                })}
              />
              {formError ? (
                <p
                  id="password-form-error"
                  role="alert"
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {formError}
                </p>
              ) : null}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" asChild>
                  <Link
                    to="/me#me-security"
                    aria-disabled={busy || undefined}
                    onClick={(event) => {
                      if (busy) event.preventDefault();
                    }}
                  >
                    {tt('me.password.cancel')}
                  </Link>
                </Button>
                <Button ref={submitRef} type="submit" disabled={busy}>
                  {busy ? tt('me.password.submitting') : tt('me.password.submit')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
});
