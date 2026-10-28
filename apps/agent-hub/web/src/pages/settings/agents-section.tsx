import type { AgentConfig } from '@agent-hub/contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@repo/ui-web';
import { useState, type ReactElement } from 'react';
import { api } from '../../api/api';
import { errorMessage } from '../../api/client';
import { agentsQuery } from '../../api/queries';
import { healthText } from '../../lib/format';
import { newAcpAgent } from '../../lib/settings-form';
import { HubAlertDialog } from '../../components/hub-dialog';
import { focusRing } from '../../lib/format';
import type { SectionProps } from './settings-page';

export function AgentsSection(props: SectionProps): ReactElement {
  const agents = useQuery(agentsQuery());
  const qc = useQueryClient();
  const [removeId, setRemoveId] = useState<string | null>(null);
  const refresh = useMutation({
    mutationFn: (id: string) => api.refreshAgent(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['agents'] });
    },
  });

  function update(id: string, patch: (agent: AgentConfig) => AgentConfig): void {
    props.setDraft({
      ...props.draft,
      agents: props.draft.agents.map((agent) => (agent.id === id ? patch(agent) : agent)),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          onClick={() =>
            props.setDraft({
              ...props.draft,
              agents: [
                ...props.draft.agents,
                newAcpAgent(props.draft.agents.map((agent) => agent.id)),
              ],
            })
          }
        >
          添加 ACP Agent
        </Button>
      </div>
      {props.draft.agents.map((agent, index) => {
        const live = agents.data?.items.find((item) => item.id === agent.id);
        const commandError = props.issues.get(`agents.${index}.command`);
        return (
          <section key={agent.id} className="space-y-2 rounded-md border border-neutral-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-neutral-900">{agent.displayName}</h2>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setRemoveId(agent.id)}
              >
                删除
              </Button>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className={`size-4 ${focusRing}`}
                checked={agent.enabled}
                onChange={(event) =>
                  update(agent.id, (current) => ({ ...current, enabled: event.target.checked }))
                }
              />
              启用
            </label>
            <label className="block text-sm text-neutral-700">
              名称
              <input
                className={fieldClass}
                autoComplete="off"
                value={agent.displayName}
                onChange={(event) =>
                  update(agent.id, (current) => ({ ...current, displayName: event.target.value }))
                }
              />
            </label>
            {agent.kind !== 'web' ? (
              <label className="block text-sm text-neutral-700">
                命令
                <input
                  className={fieldClass}
                  autoComplete="off"
                  aria-invalid={Boolean(commandError)}
                  value={agent.command}
                  onChange={(event) =>
                    update(agent.id, (current) => commandAgent(current, event.target.value))
                  }
                />
                {commandError ? (
                  <span className="select-text text-red-700">{commandError}</span>
                ) : null}
              </label>
            ) : (
              <label className="block text-sm text-neutral-700">
                AoneD 地址
                <input
                  type="url"
                  autoComplete="url"
                  className={fieldClass}
                  value={agent.openUrl ?? ''}
                  onChange={(event) =>
                    update(agent.id, (current) =>
                      current.kind === 'web'
                        ? { ...current, openUrl: event.target.value || null }
                        : current,
                    )
                  }
                />
              </label>
            )}
            <p className="text-sm text-neutral-600">
              健康：{live ? healthText(live.health) : '尚未检查'}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate(agent.id)}
            >
              重新检查
            </Button>
            {refresh.isError ? (
              <p className="select-text text-sm text-red-700">{errorMessage(refresh.error)}</p>
            ) : null}
          </section>
        );
      })}
      <HubAlertDialog
        open={removeId !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveId(null);
        }}
        title="删除 Agent"
        description="从配置里移除这个 Agent。正在运行的任务结束后才真正替换。"
        confirmText="删除"
        destructive
        onConfirm={() => {
          if (!removeId) return;
          props.setDraft({
            ...props.draft,
            agents: props.draft.agents.filter((agent) => agent.id !== removeId),
          });
          setRemoveId(null);
        }}
      />
    </div>
  );
}

const fieldClass = `mt-1 h-10 w-full rounded-md border border-neutral-300 px-3 text-sm ${focusRing}`;

function commandAgent(agent: AgentConfig, command: string): AgentConfig {
  if (agent.kind === 'web') return agent;
  return { ...agent, command };
}
