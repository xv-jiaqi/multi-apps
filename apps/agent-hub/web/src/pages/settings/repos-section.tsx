import { useState, type ReactElement } from 'react';
import { Button } from '@repo/ui-web';
import { api } from '../../api/api';
import { errorMessage } from '../../api/client';
import { focusRing } from '../../lib/format';
import { newRepo, withRepo, withoutRepo } from '../../lib/settings-form';
import type { SectionProps } from './settings-page';

export function ReposSection(props: SectionProps): ReactElement {
  const [path, setPath] = useState('');
  const [error, setError] = useState<{ id: number; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function detect(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const info = await api.inspectRepo(path);
      const repo = newRepo(
        path,
        info,
        props.draft.repos.map((item) => item.id),
      );
      props.setDraft(withRepo(props.draft, repo));
      const next = new Set(props.disablePush);
      next.add(repo.id);
      props.setDisablePush(next);
      setPath('');
    } catch (caught) {
      setError({ id: Date.now(), text: errorMessage(caught) });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <label className="min-w-0 flex-1 text-sm text-neutral-700">
          路径
          <input
            className={`mt-1 h-10 w-full rounded-md border border-neutral-300 px-3 ${focusRing}`}
            autoComplete="off"
            value={path}
            onChange={(event) => setPath(event.target.value)}
          />
        </label>
        <Button
          type="button"
          className="self-end"
          disabled={pending || path.length === 0}
          onClick={() => void detect()}
        >
          {pending ? '正在检测…' : '检测'}
        </Button>
      </div>
      {error ? (
        <p key={error.id} role="alert" className="select-text text-sm text-red-700">
          {error.text}
        </p>
      ) : null}
      {props.draft.repos.map((repo) => (
        <section
          key={repo.id}
          className="space-y-2 rounded-md border border-neutral-200 p-3 text-sm"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-neutral-900">{repo.name}</h2>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => props.setDraft(withoutRepo(props.draft, repo.id))}
            >
              移除
            </Button>
          </div>
          <p className="select-text text-neutral-700">{repo.path}</p>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="default-repo"
              className={focusRing}
              checked={props.draft.defaultRepoId === repo.id}
              onChange={() => props.setDraft({ ...props.draft, defaultRepoId: repo.id })}
            />
            默认仓库
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className={`size-4 ${focusRing}`}
              checked={props.disablePush.has(repo.id)}
              onChange={(event) => {
                const next = new Set(props.disablePush);
                if (event.target.checked) next.add(repo.id);
                else next.delete(repo.id);
                props.setDisablePush(next);
              }}
            />
            禁用 origin 推送
          </label>
          <ul className="text-neutral-600">
            {(props.saved.config.repos.find((item) => item.id === repo.id) ? [] : []).length ===
            0 ? (
              <li>远端在保存并刷新后显示</li>
            ) : null}
          </ul>
        </section>
      ))}
    </div>
  );
}
