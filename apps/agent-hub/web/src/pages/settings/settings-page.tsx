import { hubConfigSchema, type HubConfig, type SettingsResponse } from '@agent-hub/contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@repo/ui-web';
import { useMemo, useState, type ReactElement } from 'react';
import { NavLink, useBlocker, useParams } from 'react-router';
import { api } from '../../api/api';
import { ApiError, errorMessage } from '../../api/client';
import { settingsQuery } from '../../api/queries';
import { paths, parseSettingsSection, type SettingsSection } from '../../app/paths';
import { HubAlertDialog } from '../../components/hub-dialog';
import { focusRing } from '../../lib/format';
import { isDirty, sectionOfIssue } from '../../lib/settings-form';
import { AboutSection } from './about-section';
import { AgentsSection } from './agents-section';
import { BotSection } from './bot-section';
import { DataSection } from './data-section';
import { GeneralSection } from './general-section';
import { ReposSection } from './repos-section';
import { TokensSection } from './tokens-section';

const NAV: Array<{ id: SettingsSection; label: string }> = [
  { id: 'agents', label: 'Agent' },
  { id: 'repos', label: '仓库' },
  { id: 'bot', label: '本地郎' },
  { id: 'tokens', label: '桥接 token' },
  { id: 'general', label: '通用' },
  { id: 'data', label: '数据与诊断' },
  { id: 'about', label: '关于' },
];

export function SettingsPage(): ReactElement {
  const params = useParams();
  const section = parseSettingsSection(params.section);
  const settings = useQuery(settingsQuery());
  const [draft, setDraft] = useState<HubConfig | null>(null);
  const [serverIssues, setServerIssues] = useState<Map<string, string>>(new Map());
  const [banner, setBanner] = useState<{ id: number; text: string } | null>(null);
  const [disablePush, setDisablePush] = useState<ReadonlySet<string>>(new Set());
  const qc = useQueryClient();
  const remote = settings.data?.config;
  const config = draft ?? remote ?? null;
  const dirty = Boolean(remote && draft && isDirty(draft, remote));
  const localIssues = useMemo(() => issuesOf(config), [config]);
  const issues = new Map([...localIssues, ...serverIssues]);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      currentLocation.pathname.startsWith('/settings') &&
      !nextLocation.pathname.startsWith('/settings'),
  );

  const save = useMutation({
    meta: { silentError: true },
    mutationFn: async (next: HubConfig) => {
      const parsed = hubConfigSchema.safeParse(next);
      if (!parsed.success) throw new ApiError('CONFIG_INVALID', '配置不合法', 400, null);
      const previousIds = new Set(remote?.repos.map((repo) => repo.id) ?? []);
      const response = await api.putSettings(parsed.data);
      qc.setQueryData<SettingsResponse>(['settings'], response);
      await qc.invalidateQueries({ queryKey: ['agents'] });
      await qc.invalidateQueries({ queryKey: ['repos'] });
      for (const repo of response.config.repos) {
        if (!previousIds.has(repo.id) && disablePush.has(repo.id)) {
          await api.disableOriginPush(repo.id);
        }
      }
      return response;
    },
    onSuccess: (response) => {
      setDraft(null);
      setServerIssues(new Map());
      setBanner(
        response.restartRequired ? { id: Date.now(), text: '端口改动在重启本地服务后生效' } : null,
      );
    },
    onError: (error) => {
      if (error instanceof ApiError) setServerIssues(error.issues());
      setBanner({ id: Date.now(), text: errorMessage(error) });
    },
  });

  if (settings.isError) {
    return (
      <div className="p-4" role="alert">
        <p className="select-text text-sm text-red-700">{errorMessage(settings.error)}</p>
        <Button
          type="button"
          className="mt-2"
          variant="outline"
          onClick={() => void settings.refetch()}
        >
          重试
        </Button>
      </div>
    );
  }
  if (settings.isLoading || !config || !settings.data) {
    return <p className="p-4 text-sm text-neutral-700">正在加载设置…</p>;
  }

  const sectionProps = {
    draft: config,
    setDraft,
    issues,
    saved: settings.data,
    disablePush,
    setDisablePush,
  };

  return (
    <div className="flex h-full min-h-0">
      <nav
        className="w-40 shrink-0 overflow-y-auto border-r border-neutral-200 p-2"
        aria-label="设置分区"
      >
        {NAV.map((item) => {
          const hasError = [...issues.keys()].some((path) => sectionOfIssue(path) === item.id);
          return (
            <NavLink
              key={item.id}
              to={paths.settings(item.id)}
              className={({ isActive }) =>
                `flex h-8 items-center justify-between rounded-md px-2 text-sm ${isActive ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-700'} ${focusRing}`
              }
            >
              {item.label}
              {hasError ? (
                <span className="size-2 rounded-full bg-red-600" aria-label="有错误" />
              ) : null}
            </NavLink>
          );
        })}
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {banner ? (
            <p key={banner.id} role="status" className="select-text mb-3 text-sm text-neutral-800">
              {banner.text}
            </p>
          ) : null}
          {section === 'agents' ? <AgentsSection {...sectionProps} /> : null}
          {section === 'repos' ? <ReposSection {...sectionProps} /> : null}
          {section === 'bot' ? <BotSection {...sectionProps} /> : null}
          {section === 'tokens' ? <TokensSection /> : null}
          {section === 'general' ? <GeneralSection {...sectionProps} /> : null}
          {section === 'data' ? <DataSection {...sectionProps} /> : null}
          {section === 'about' ? <AboutSection saved={settings.data} /> : null}
        </div>
        {dirty ? (
          <div className="flex gap-2 border-t border-neutral-200 p-3">
            <Button type="button" disabled={save.isPending} onClick={() => save.mutate(config)}>
              {save.isPending ? '正在保存…' : '保存'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setDraft(null)}>
              放弃更改
            </Button>
          </div>
        ) : null}
      </div>
      <HubAlertDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked') blocker.reset();
        }}
        title="放弃未保存的更改？"
        description="离开设置页会丢掉还没保存的修改。"
        confirmText="离开"
        destructive
        onConfirm={() => {
          if (blocker.state === 'blocked') blocker.proceed();
        }}
      />
    </div>
  );
}

export interface SectionProps {
  draft: HubConfig;
  setDraft: (next: HubConfig) => void;
  issues: Map<string, string>;
  saved: SettingsResponse;
  disablePush: ReadonlySet<string>;
  setDisablePush: (next: ReadonlySet<string>) => void;
}

function issuesOf(config: HubConfig | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!config) return map;
  const parsed = hubConfigSchema.safeParse(config);
  if (parsed.success) return map;
  for (const issue of parsed.error.issues.slice(0, 20)) {
    const path = issue.path.map(String).join('.');
    if (!map.has(path)) map.set(path, issue.message);
  }
  return map;
}
