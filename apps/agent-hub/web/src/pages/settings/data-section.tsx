import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@repo/ui-web';
import { useState, type ReactElement } from 'react';
import { api } from '../../api/api';
import { errorMessage } from '../../api/client';
import { auditQuery } from '../../api/queries';
import { focusRing } from '../../lib/format';
import type { SectionProps } from './settings-page';

export function DataSection(props: SectionProps): ReactElement {
  const [before, setBefore] = useState<number | null>(null);
  const audit = useQuery(auditQuery(before));
  const exportPack = useMutation({
    meta: { silentError: true },
    mutationFn: () => api.exportDiagnostics(),
  });
  const retention = props.draft.retention;
  return (
    <div className="space-y-3 text-sm">
      <NumberField
        label="增量事件保留天数"
        value={retention.deltaEventDays}
        onChange={(deltaEventDays) =>
          props.setDraft({ ...props.draft, retention: { ...retention, deltaEventDays } })
        }
      />
      <NumberField
        label="审计保留天数"
        value={retention.auditDays}
        onChange={(auditDays) =>
          props.setDraft({ ...props.draft, retention: { ...retention, auditDays } })
        }
      />
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className={`size-4 ${focusRing}`}
          checked={props.draft.diagnostics.recordTranscripts}
          onChange={(event) =>
            props.setDraft({
              ...props.draft,
              diagnostics: { ...props.draft.diagnostics, recordTranscripts: event.target.checked },
            })
          }
        />
        记录 transcript
      </label>
      <p className="select-text text-neutral-700">数据目录 {props.saved.dataDir}</p>
      <Button
        type="button"
        variant="outline"
        disabled={exportPack.isPending}
        onClick={() => exportPack.mutate()}
      >
        导出诊断包
      </Button>
      {exportPack.data ? <p className="select-text">已导出 {exportPack.data.file}</p> : null}
      {exportPack.isError ? (
        <p className="select-text text-red-700">{errorMessage(exportPack.error)}</p>
      ) : null}
      <h2 className="font-medium text-neutral-900">审计日志</h2>
      {audit.isError ? (
        <div role="alert">
          <p className="select-text text-red-700">{errorMessage(audit.error)}</p>
          <button
            type="button"
            className={`mt-1 h-8 ${focusRing}`}
            onClick={() => void audit.refetch()}
          >
            重试
          </button>
        </div>
      ) : null}
      {audit.isLoading ? <p>正在加载审计…</p> : null}
      <ul className="space-y-1">
        {(audit.data?.items ?? []).map((item) => (
          <li key={item.id} className="select-text text-neutral-700">
            {item.ts} {item.action}
          </li>
        ))}
      </ul>
      {audit.data?.nextBefore ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setBefore(audit.data?.nextBefore ?? null)}
        >
          更早
        </Button>
      ) : null}
    </div>
  );
}

function NumberField(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}): ReactElement {
  return (
    <label className="block text-neutral-700">
      {props.label}
      <input
        type="number"
        autoComplete="off"
        className={`mt-1 h-10 w-full rounded-md border border-neutral-300 px-3 ${focusRing}`}
        value={props.value}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) props.onChange(next);
        }}
      />
    </label>
  );
}
