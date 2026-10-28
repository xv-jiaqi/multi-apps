import type { AgentConfig, AgentDto, RepoDto } from '@agent-hub/contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Combobox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui-web';
import { useEffect, useState, type FormEvent, type ReactElement, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api/api';
import { ApiError, errorMessage } from '../api/client';
import { agentsQuery, repoRefsQuery, reposQuery, settingsQuery } from '../api/queries';
import { paths } from '../app/paths';
import { HubAlertDialog } from '../components/hub-dialog';
import { focusRing } from '../lib/format';
import {
  DEFAULT_OPTION,
  agentUnavailable,
  allowedWorkspaces,
  buildCreateBody,
  defaultWorkspace,
  effectiveMode,
  initialForm,
  modelChoices,
  needsInPlaceWriteConfirm,
  type ModelChoices,
  readOnlyWithoutSandbox,
  validateForm,
  withAgent,
  withMode,
  type AgentDefaults,
  type NewTaskForm,
} from '../lib/task-form';
import { readNewTaskDraft, writeNewTaskDraft } from './new-task-draft';

export function NewTaskPage(): ReactElement {
  const agents = useQuery({ ...agentsQuery(), refetchOnMount: 'always' });
  const repos = useQuery(reposQuery());
  const settings = useQuery(settingsQuery());
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<NewTaskForm | null>(() => readNewTaskDraft());
  const [topError, setTopError] = useState<{ id: number; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Map<string, string>>(new Map());
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (form || !agents.data || !repos.data) return;
    const next = initialForm(agents.data.items, repos.data.items);
    setForm(next);
    writeNewTaskDraft(next);
  }, [agents.data, repos.data, form]);

  function update(next: NewTaskForm): void {
    setForm(next);
    writeNewTaskDraft(next);
  }

  const create = useMutation({
    meta: { silentError: true },
    mutationFn: (body: ReturnType<typeof buildCreateBody>) => api.createTask(body),
    onSuccess: (result) => {
      writeNewTaskDraft(null);
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void navigate(paths.task(result.task.id));
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        const issues = error.issues();
        if (issues.size > 0) {
          setFieldErrors(issues);
          setTopError(null);
          return;
        }
      }
      setFieldErrors(new Map());
      setTopError({ id: Date.now(), text: errorMessage(error) });
    },
  });

  if (agents.isError)
    return <Retry message={errorMessage(agents.error)} onRetry={() => void agents.refetch()} />;
  if (repos.isError)
    return <Retry message={errorMessage(repos.error)} onRetry={() => void repos.refetch()} />;
  if (agents.isLoading || repos.isLoading || !form || !agents.data || !repos.data) {
    return <p className="p-4 text-sm text-neutral-700">正在加载新建任务…</p>;
  }

  const agent = agents.data.items.find((item) => item.id === form.agentId);
  const repo = repos.data.items.find((item) => item.id === form.repoId);
  const defaults = defaultsFor(settings.data?.config.agents, form.agentId);
  const none: ModelChoices = { kind: 'none' };
  const choices = agent ? modelChoices(agent, defaults, form.model) : none;
  const mode = effectiveMode(agent, form);
  const workspace = form.workspace || defaultWorkspace(agent, mode);
  const showBase = workspace !== 'in_place';

  const currentForm = form;
  function submit(event?: FormEvent): void {
    event?.preventDefault();
    if (!agent) return;
    const problems = validateForm(currentForm, agent, repo);
    if (problems.length > 0) {
      setFieldErrors(new Map(problems.map((problem) => [problem.path, problem.message])));
      setTopError(null);
      return;
    }
    setFieldErrors(new Map());
    if (needsInPlaceWriteConfirm(currentForm)) {
      setConfirmOpen(true);
      return;
    }
    create.mutate(buildCreateBody(currentForm, agent));
  }

  return (
    <form
      className="flex h-full min-h-0 flex-col overflow-y-auto p-4"
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
      }}
    >
      <h1 className="mb-3 text-lg font-semibold text-neutral-900">新建任务</h1>
      {topError ? (
        <p key={topError.id} role="alert" className="select-text mb-3 text-sm text-red-700">
          {topError.text}
        </p>
      ) : null}
      <div className="space-y-3">
        <Field label="Agent" id="new-agent" error={fieldErrors.get('agentId')}>
          <Select
            value={form.agentId || undefined}
            onValueChange={(value) => {
              const nextAgent = agents.data?.items.find((item) => item.id === value);
              if (!nextAgent) return;
              update(withAgent(form, nextAgent));
            }}
          >
            <SelectTrigger
              id="new-agent"
              aria-label="Agent"
              aria-invalid={fieldErrors.has('agentId')}
            >
              <SelectValue placeholder="选择 Agent" />
            </SelectTrigger>
            <SelectContent position="popper" side="bottom" align="start">
              {agents.data.items.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="仓库" id="new-repo" error={fieldErrors.get('repoId')}>
          <Select
            value={form.repoId || undefined}
            onValueChange={(value) => update({ ...form, repoId: value })}
          >
            <SelectTrigger id="new-repo" aria-label="仓库" aria-invalid={fieldErrors.has('repoId')}>
              <SelectValue placeholder="选择仓库" />
            </SelectTrigger>
            <SelectContent position="popper" side="bottom" align="start">
              {repos.data.items.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="模式" id="new-mode" error={fieldErrors.get('mode')}>
          <Select
            value={form.mode || DEFAULT_OPTION}
            onValueChange={(value) => {
              if (!agent) return;
              if (value === DEFAULT_OPTION) update({ ...form, mode: '' });
              else if (value === 'read_only' || value === 'write')
                update(withMode(form, agent, value));
            }}
          >
            <SelectTrigger id="new-mode" aria-label="模式">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" side="bottom" align="start">
              <SelectItem value={DEFAULT_OPTION}>默认</SelectItem>
              <SelectItem value="read_only">只读</SelectItem>
              <SelectItem value="write">可写</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="工作区" id="new-workspace" error={fieldErrors.get('workspace')}>
          <Select
            value={form.workspace || DEFAULT_OPTION}
            onValueChange={(value) => {
              if (value === DEFAULT_OPTION) update({ ...form, workspace: '' });
              else if (value === 'in_place' || value === 'worktree' || value === 'remote_branch') {
                update({ ...form, workspace: value });
              }
            }}
          >
            <SelectTrigger id="new-workspace" aria-label="工作区">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" side="bottom" align="start">
              <SelectItem value={DEFAULT_OPTION}>默认</SelectItem>
              {(agent ? allowedWorkspaces(agent) : []).map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {kind === 'in_place' ? '原目录' : kind === 'worktree' ? 'worktree' : '远端分支'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {showBase && form.repoId ? (
          <BaseField
            repoId={form.repoId}
            value={form.baseRef}
            error={fieldErrors.get('baseRef')}
            onChange={(baseRef) => update({ ...form, baseRef })}
          />
        ) : null}
        {choices.kind === 'list' ? (
          <>
            <Field label="模型" id="new-model" error={fieldErrors.get('model')}>
              <Select
                value={form.model || DEFAULT_OPTION}
                onValueChange={(value) =>
                  update({ ...form, model: value === DEFAULT_OPTION ? '' : value })
                }
              >
                <SelectTrigger id="new-model" aria-label="模型">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" side="bottom" align="start">
                  <SelectItem value={DEFAULT_OPTION}>默认</SelectItem>
                  {choices.models.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="推理" id="new-effort" error={fieldErrors.get('reasoningEffort')}>
              <Select
                value={form.reasoningEffort || DEFAULT_OPTION}
                onValueChange={(value) =>
                  update({ ...form, reasoningEffort: value === DEFAULT_OPTION ? '' : value })
                }
              >
                <SelectTrigger id="new-effort" aria-label="推理">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" side="bottom" align="start">
                  <SelectItem value={DEFAULT_OPTION}>默认</SelectItem>
                  {choices.efforts.map((effort) => (
                    <SelectItem key={effort.id} value={effort.id}>
                      {effort.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </>
        ) : null}
        {choices.kind === 'fixed' ? (
          <p className="text-sm text-neutral-700">模型 {choices.model ?? '默认'}</p>
        ) : null}
        {agent?.kind === 'codex' ? (
          <label className="flex items-center gap-2 text-sm text-neutral-800">
            <input
              type="checkbox"
              className={`size-4 ${focusRing}`}
              checked={form.userVisible}
              onChange={(event) => update({ ...form, userVisible: event.target.checked })}
            />
            在 ChatGPT 应用里显示
          </label>
        ) : null}
        <Field label="标题" id="new-title" error={fieldErrors.get('title')}>
          <input
            id="new-title"
            name="title"
            autoComplete="off"
            maxLength={120}
            value={form.title}
            aria-invalid={fieldErrors.has('title')}
            className={`h-10 rounded-md border border-neutral-300 px-3 text-sm ${focusRing}`}
            onChange={(event) => update({ ...form, title: event.target.value })}
          />
        </Field>
        <Field label="提示词" id="new-prompt" error={fieldErrors.get('prompt')}>
          <textarea
            id="new-prompt"
            name="prompt"
            autoComplete="off"
            value={form.prompt}
            aria-invalid={fieldErrors.has('prompt')}
            className={`min-h-32 rounded-md border border-neutral-300 p-3 text-sm ${focusRing}`}
            onChange={(event) => update({ ...form, prompt: event.target.value })}
          />
        </Field>
      </div>
      <Hints agent={agent} repo={repo} form={form} />
      <div className="mt-4">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? '正在创建…' : '创建任务'}
        </Button>
      </div>
      <HubAlertDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="在原目录可写运行"
        description="可写任务会直接改当前仓库目录。确认继续？"
        confirmText="继续创建"
        onConfirm={() => {
          if (!agent) return;
          create.mutate(buildCreateBody(currentForm, agent));
        }}
      />
    </form>
  );
}

function Hints(props: {
  agent?: AgentDto;
  repo?: RepoDto;
  form: NewTaskForm;
}): ReactElement | null {
  if (!props.agent) return null;
  const unavailable = agentUnavailable(props.agent);
  const sandbox = readOnlyWithoutSandbox(props.agent, props.form);
  const workspace =
    props.form.workspace || defaultWorkspace(props.agent, effectiveMode(props.agent, props.form));
  const dirty = props.repo?.inspection.dirty && workspace === 'worktree';
  if (!unavailable && !sandbox && !dirty) return null;
  return (
    <div className="mt-3 space-y-1 text-sm text-amber-800">
      {unavailable ? <p>{unavailable}</p> : null}
      {sandbox ? <p>这个 Agent 没有沙箱，只读靠审批和轮后快照比对。</p> : null}
      {dirty ? <p>未提交的改动不会带进 worktree</p> : null}
    </div>
  );
}

function BaseField(props: {
  repoId: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}): ReactElement {
  const refs = useQuery(repoRefsQuery(props.repoId));
  const items = (refs.data?.items ?? []).filter((ref) =>
    ref.toLowerCase().includes(props.value.toLowerCase()),
  );
  return (
    <Field label="基线" id="new-base" error={props.error}>
      <Combobox
        mode="select"
        id="new-base"
        inputValue={props.value}
        onInputValueChange={props.onChange}
        value={props.value || null}
        onValueChange={(item) => props.onChange(item ?? '')}
        groups={[{ key: 'refs', items }]}
        getKey={(item) => item}
        getItemText={(item) => item}
        renderItem={(item) => item}
        status={refs.isError ? 'error' : refs.isLoading ? 'loading' : 'success'}
        onRetry={() => void refs.refetch()}
        labels={{
          empty: '没有匹配的基线',
          loading: '正在读取基线…',
          error: '基线加载失败',
          retry: '重试',
          clear: '清除',
          resultsCount: (count) => `${count} 个基线`,
        }}
        placeholder="留空用默认"
        aria-invalid={Boolean(props.error)}
        align="start"
      />
    </Field>
  );
}

function Field(props: {
  label: string;
  id: string;
  error?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={props.id} className="text-sm font-medium text-neutral-800">
        {props.label}
      </label>
      {props.children}
      {props.error ? (
        <p id={`${props.id}-error`} className="select-text text-sm text-red-700">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}

function Retry(props: { message: string; onRetry: () => void }): ReactElement {
  return (
    <div className="space-y-2 p-4" role="alert">
      <p className="select-text text-sm text-red-700">{props.message}</p>
      <Button type="button" variant="outline" onClick={props.onRetry}>
        重试
      </Button>
    </div>
  );
}

function defaultsFor(agents: readonly AgentConfig[] | undefined, agentId: string): AgentDefaults {
  const agent = agents?.find((item) => item.id === agentId);
  if (!agent || agent.kind === 'web') return { defaultModel: null, defaultReasoningEffort: null };
  return { defaultModel: agent.defaultModel, defaultReasoningEffort: agent.defaultReasoningEffort };
}
