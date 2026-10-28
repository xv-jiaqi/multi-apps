import type { Scope } from '@agent-hub/contract';
import { scopeLabel } from '@agent-hub/contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@repo/ui-web';
import { useState, type ReactElement } from 'react';
import { api } from '../../api/api';
import { errorMessage } from '../../api/client';
import { settingsQuery, tokensQuery } from '../../api/queries';
import { HubAlertDialog } from '../../components/hub-dialog';
import { focusRing } from '../../lib/format';

const SCOPES: readonly Scope[] = ['tasks:read', 'tasks:write', 'approvals:decide'];

export function TokensSection(): ReactElement {
  const tokens = useQuery(tokensQuery());
  const settings = useQuery(settingsQuery());
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Scope[]>(['tasks:read']);
  const [plaintext, setPlaintext] = useState<{ id: number; token: string; file?: string } | null>(
    null,
  );
  const [confirmScopes, setConfirmScopes] = useState<{ id: string; scopes: Scope[] } | null>(null);
  const [error, setError] = useState<{ id: number; text: string } | null>(null);

  async function refresh(): Promise<void> {
    await qc.invalidateQueries({ queryKey: ['tokens'] });
  }

  const create = useMutation({
    meta: { silentError: true },
    mutationFn: () => api.createToken({ name, scopes }),
    onSuccess: async (created) => {
      setPlaintext({ id: Date.now(), token: created.token });
      setName('');
      await refresh();
    },
    onError: (caught) => setError({ id: Date.now(), text: errorMessage(caught) }),
  });
  const update = useMutation({
    meta: { silentError: true },
    mutationFn: (input: { id: string; scopes: Scope[] }) => api.updateToken(input.id, input.scopes),
    onSuccess: () => void refresh(),
    onError: (caught) => setError({ id: Date.now(), text: errorMessage(caught) }),
  });
  const revoke = useMutation({
    meta: { silentError: true },
    mutationFn: (id: string) => api.revokeToken(id),
    onSuccess: () => void refresh(),
    onError: (caught) => setError({ id: Date.now(), text: errorMessage(caught) }),
  });
  const rotate = useMutation({
    meta: { silentError: true },
    mutationFn: () => api.rotateDefaultToken(),
    onSuccess: async (created) => {
      setPlaintext({ id: Date.now(), token: created.token, file: settings.data?.bridgeTokenFile });
      await refresh();
    },
    onError: (caught) => setError({ id: Date.now(), text: errorMessage(caught) }),
  });

  if (tokens.isError) {
    return (
      <div role="alert">
        <p className="select-text text-sm text-red-700">{errorMessage(tokens.error)}</p>
        <Button
          type="button"
          className="mt-2"
          variant="outline"
          onClick={() => void tokens.refetch()}
        >
          重试
        </Button>
      </div>
    );
  }
  if (tokens.isLoading || !tokens.data)
    return <p className="text-sm text-neutral-700">正在加载 token…</p>;

  return (
    <div className="space-y-4 text-sm">
      {error ? (
        <p key={error.id} role="alert" className="select-text text-red-700">
          {error.text}
        </p>
      ) : null}
      {plaintext ? (
        <div
          key={plaintext.id}
          className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3"
        >
          <p>明文只显示这一次</p>
          <p className="select-text break-all font-mono">{plaintext.token}</p>
          {plaintext.file ? <p className="select-text">文件 {plaintext.file}</p> : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(plaintext.token);
            }}
          >
            复制
          </Button>
        </div>
      ) : null}
      <ul className="space-y-2">
        {tokens.data.items.map((token) => (
          <li key={token.id} className="rounded-md border border-neutral-200 p-3">
            <p className="font-medium">{token.name}</p>
            <p className="select-text text-neutral-600">{token.prefix}</p>
            <p>{token.scopes.map((scope) => scopeLabel(scope)).join('、')}</p>
            {token.revokedAt ? <p className="text-neutral-500">已吊销</p> : null}
            {!token.revokedAt ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {SCOPES.map((scope) => {
                  const checked = token.scopes.includes(scope);
                  return (
                    <label key={scope} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        className={`size-4 ${focusRing}`}
                        checked={checked}
                        onChange={() => {
                          const next = checked
                            ? token.scopes.filter((item) => item !== scope)
                            : [...token.scopes, scope];
                          if (!checked && scope === 'approvals:decide')
                            setConfirmScopes({ id: token.id, scopes: next });
                          else update.mutate({ id: token.id, scopes: next });
                        }}
                      />
                      {scopeLabel(scope)}
                    </label>
                  );
                })}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => revoke.mutate(token.id)}
                >
                  吊销
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <label className="block">
          名称
          <input
            name="token-name"
            autoComplete="off"
            className={`mt-1 h-10 w-full rounded-md border border-neutral-300 px-3 ${focusRing}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-3">
          {SCOPES.map((scope) => (
            <label key={scope} className="flex items-center gap-1">
              <input
                type="checkbox"
                className={`size-4 ${focusRing}`}
                checked={scopes.includes(scope)}
                onChange={() =>
                  setScopes((current) =>
                    current.includes(scope)
                      ? current.filter((item) => item !== scope)
                      : [...current, scope],
                  )
                }
              />
              {scopeLabel(scope)}
            </label>
          ))}
        </div>
        <Button
          type="submit"
          disabled={create.isPending || name.trim().length === 0 || scopes.length === 0}
        >
          新建
        </Button>
      </form>
      <Button
        type="button"
        variant="outline"
        disabled={rotate.isPending}
        onClick={() => rotate.mutate()}
      >
        轮换默认 token
      </Button>
      <HubAlertDialog
        open={confirmScopes !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmScopes(null);
        }}
        title="允许代替你审批"
        description="这个 token 将可以批准或拒绝命令。"
        confirmText="确认添加"
        onConfirm={() => {
          if (!confirmScopes) return;
          update.mutate(confirmScopes);
          setConfirmScopes(null);
        }}
      />
    </div>
  );
}
