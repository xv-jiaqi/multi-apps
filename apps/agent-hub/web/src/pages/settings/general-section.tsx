import type { ReactElement } from 'react';
import { focusRing } from '../../lib/format';
import { LOCKED_PUSH_HOSTS, normalizeBlockedHosts } from '../../lib/settings-form';
import type { SectionProps } from './settings-page';

export function GeneralSection(props: SectionProps): ReactElement {
  const security = props.draft.security;
  return (
    <div className="space-y-3 text-sm">
      <NumberField
        label="端口"
        value={props.draft.server.port}
        onChange={(port) => props.setDraft({ ...props.draft, server: { port } })}
      />
      <NumberField
        label="同时运行的任务数"
        value={props.draft.scheduler.maxConcurrentTasks}
        onChange={(maxConcurrentTasks) =>
          props.setDraft({
            ...props.draft,
            scheduler: { ...props.draft.scheduler, maxConcurrentTasks },
          })
        }
      />
      <NumberField
        label="排队上限"
        value={props.draft.scheduler.maxQueuedTasks}
        onChange={(maxQueuedTasks) =>
          props.setDraft({
            ...props.draft,
            scheduler: { ...props.draft.scheduler, maxQueuedTasks },
          })
        }
      />
      <NumberField
        label="审批超时（分钟）"
        value={security.approvalTimeoutMinutes}
        onChange={(approvalTimeoutMinutes) =>
          props.setDraft({ ...props.draft, security: { ...security, approvalTimeoutMinutes } })
        }
      />
      <NumberField
        label="桥接 diff 上限（字节）"
        value={security.maxBridgeDiffBytes}
        onChange={(maxBridgeDiffBytes) =>
          props.setDraft({ ...props.draft, security: { ...security, maxBridgeDiffBytes } })
        }
      />
      <div>
        <p className="mb-1 text-neutral-700">推送黑名单</p>
        <ul className="space-y-1">
          {security.blockedPushHosts.map((host) => {
            const locked = LOCKED_PUSH_HOSTS.includes(host);
            return (
              <li key={host} className="flex items-center justify-between gap-2">
                <span>{host}</span>
                {locked ? (
                  <span className="text-neutral-500">锁定</span>
                ) : (
                  <button
                    type="button"
                    className={`h-8 rounded-md px-2 ${focusRing}`}
                    onClick={() =>
                      props.setDraft({
                        ...props.draft,
                        security: {
                          ...security,
                          blockedPushHosts: normalizeBlockedHosts(
                            security.blockedPushHosts.filter((item) => item !== host),
                          ),
                        },
                      })
                    }
                  >
                    移除
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const host = String(data.get('host') ?? '');
            props.setDraft({
              ...props.draft,
              security: {
                ...security,
                blockedPushHosts: normalizeBlockedHosts([...security.blockedPushHosts, host]),
              },
            });
            event.currentTarget.reset();
          }}
        >
          <input
            name="host"
            autoComplete="off"
            className={`h-8 flex-1 rounded-md border border-neutral-300 px-2 ${focusRing}`}
          />
          <button
            type="submit"
            className={`h-8 rounded-md border border-neutral-300 px-3 ${focusRing}`}
          >
            添加
          </button>
        </form>
      </div>
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
