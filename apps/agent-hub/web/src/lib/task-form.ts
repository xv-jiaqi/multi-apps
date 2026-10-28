import type {
  AgentCapabilities,
  AgentDto,
  CreateTaskBody,
  FollowUpBody,
  ModelOption,
  ReasoningEffortOption,
  RepoDto,
  TaskDto,
  TaskMode,
  WorkspaceKind,
} from '@agent-hub/contract';
import { isTerminalStatus } from '@agent-hub/contract';

/** Radix Select 把空字符串当成未选择。进出表单时和真正的空值互换。 */
export const DEFAULT_OPTION = '__default__';

export const PROMPT_MAX = 200_000;
export const TITLE_MAX = 120;

export interface NewTaskForm {
  agentId: string;
  repoId: string;
  mode: '' | TaskMode;
  workspace: '' | WorkspaceKind;
  baseRef: string;
  model: string;
  reasoningEffort: string;
  title: string;
  prompt: string;
  userVisible: boolean;
}

export interface AgentDefaults {
  defaultModel: string | null;
  defaultReasoningEffort: string | null;
}

export type ModelChoices =
  | { kind: 'list'; models: readonly ModelOption[]; efforts: readonly ReasoningEffortOption[] }
  | { kind: 'fixed'; model: string | null }
  | { kind: 'none' };

export interface FormProblem {
  path: string;
  message: string;
}

export type FormProblems = readonly FormProblem[];

export interface FollowUpValues {
  prompt: string;
  /** 空字符串 = 没改；DEFAULT_OPTION = 改回 Agent 默认。 */
  model: string;
  reasoningEffort: string;
}

const blankForm: NewTaskForm = {
  agentId: '',
  repoId: '',
  mode: '',
  workspace: '',
  baseRef: '',
  model: '',
  reasoningEffort: '',
  title: '',
  prompt: '',
  userVisible: true,
};

export function initialForm(agents: readonly AgentDto[], repos: readonly RepoDto[]): NewTaskForm {
  const agent = agents.find((item) => item.enabled) ?? agents[0];
  const repo = repos.find((item) => item.isDefault) ?? repos[0];
  const form: NewTaskForm = {
    ...blankForm,
    agentId: agent?.id ?? '',
    repoId: repo?.id ?? '',
  };
  if (!agent) return form;
  return withAgent(form, agent);
}

/** 换 Agent 时模式和工作区回到默认（空字符串），模型也清空。 */
export function withAgent(form: NewTaskForm, agent: AgentDto): NewTaskForm {
  return {
    ...form,
    agentId: agent.id,
    mode: '',
    workspace: '',
    model: '',
    reasoningEffort: '',
    userVisible: agent.kind === 'codex',
  };
}

export function withMode(form: NewTaskForm, agent: AgentDto, mode: TaskMode): NewTaskForm {
  const workspace =
    form.workspace !== '' && allowedWorkspaces(agent).includes(form.workspace)
      ? form.workspace
      : '';
  return { ...form, mode, workspace };
}

export function modelChoices(
  agent: AgentDto,
  defaults: AgentDefaults,
  model: string,
): ModelChoices {
  const caps = agent.capabilities;
  if (!caps || caps.modelsSource === 'none') return { kind: 'none' };
  if (caps.models.length === 0) return { kind: 'fixed', model: defaults.defaultModel };
  const selectedId = model || defaults.defaultModel || '';
  const selected =
    caps.models.find((item) => item.id === selectedId) ??
    caps.models.find((item) => item.isDefault) ??
    caps.models[0];
  return { kind: 'list', models: caps.models, efforts: selected?.reasoningEfforts ?? [] };
}

export function validateForm(form: NewTaskForm, agent?: AgentDto, repo?: RepoDto): FormProblems {
  const problems: FormProblem[] = [];
  if (!form.agentId || !agent) problems.push({ path: 'agentId', message: '请选择 Agent' });
  if (!form.repoId || !repo) problems.push({ path: 'repoId', message: '请选择仓库' });
  const prompt = form.prompt.trim();
  if (!prompt) problems.push({ path: 'prompt', message: '提示词不能为空' });
  else if (countChars(prompt) > PROMPT_MAX) {
    problems.push({ path: 'prompt', message: '提示词最多 20 万字符' });
  }
  if (countChars(form.title.trim()) > TITLE_MAX) {
    problems.push({ path: 'title', message: '标题最多 120 个字符' });
  }
  if (agent && effectiveMode(agent, form) === 'read_only' && agent.kind === 'web') {
    problems.push({ path: 'mode', message: '网页 Agent 只支持可写任务' });
  }
  if (agent && form.workspace && !allowedWorkspaces(agent).includes(form.workspace)) {
    problems.push({ path: 'workspace', message: '这个 Agent 不支持该工作区' });
  }
  if (
    (form.workspace || defaultWorkspace(agent, effectiveMode(agent, form))) === 'in_place' &&
    form.baseRef.trim()
  ) {
    problems.push({ path: 'baseRef', message: '原目录不能指定基线' });
  }
  problems.push(...modelProblems(form, agent?.capabilities));
  return problems;
}

export function needsInPlaceWriteConfirm(form: NewTaskForm): boolean {
  return form.mode === 'write' && form.workspace === 'in_place';
}

/** D38：没有沙箱的 Agent 做只读任务时要提示。能力还没到时不提示。 */
export function readOnlyWithoutSandbox(agent: AgentDto, form: NewTaskForm): boolean {
  if (agent.kind === 'web') return false;
  if (!agent.capabilities) return false;
  if (agent.capabilities.sandbox) return false;
  return effectiveMode(agent, form) === 'read_only';
}

export function buildCreateBody(form: NewTaskForm, agent: AgentDto): CreateTaskBody {
  const body: CreateTaskBody = {
    agentId: form.agentId,
    prompt: form.prompt.trim(),
    userVisible: agent.kind === 'codex' ? form.userVisible : true,
  };
  if (form.repoId) body.repoId = form.repoId;
  const title = form.title.trim();
  if (title) body.title = title;
  if (form.mode) body.mode = form.mode;
  if (form.workspace) body.workspace = form.workspace;
  const baseRef = form.baseRef.trim();
  if (baseRef && form.workspace !== 'in_place') body.baseRef = baseRef;
  if (form.model) body.model = form.model;
  if (form.reasoningEffort) body.reasoningEffort = form.reasoningEffort;
  return body;
}

export function followUpBlocker(task: TaskDto): string | null {
  if (task.archivedAt) return '任务已归档，先取消归档才能追问';
  if (!isTerminalStatus(task.status)) return '本轮还没结束，不能追问';
  if (task.worktreeRemovedAt) return 'worktree 已清理，不能追问';
  return null;
}

export function buildFollowUpBody(task: TaskDto, values: FollowUpValues): FollowUpBody {
  const body: FollowUpBody = { prompt: values.prompt.trim() };
  const model = encodeOverride(values.model, task.model);
  if (model !== undefined) body.model = model;
  const effort = encodeOverride(values.reasoningEffort, task.reasoningEffort);
  if (effort !== undefined) body.reasoningEffort = effort;
  return body;
}

export function effectiveMode(agent: AgentDto | undefined, form: NewTaskForm): TaskMode {
  if (form.mode) return form.mode;
  return agent?.kind === 'web' ? 'write' : 'read_only';
}

export function defaultWorkspace(agent: AgentDto | undefined, mode: TaskMode): WorkspaceKind {
  if (agent?.kind === 'web') return 'remote_branch';
  return mode === 'write' ? 'worktree' : 'in_place';
}

export function allowedWorkspaces(agent: AgentDto): readonly WorkspaceKind[] {
  const fromCaps = agent.capabilities?.workspaces;
  if (fromCaps && fromCaps.length > 0) return fromCaps;
  if (agent.kind === 'web') return ['remote_branch'];
  return ['in_place', 'worktree'];
}

export function agentUnavailable(agent: AgentDto): string | null {
  if (agent.health.status === 'unavailable' || agent.health.status === 'auth_required') {
    return agent.health.message;
  }
  if (agent.health.status === 'disabled' || !agent.enabled) return '这个 Agent 已禁用';
  return null;
}

function modelProblems(
  form: NewTaskForm,
  caps: AgentCapabilities | null | undefined,
): FormProblem[] {
  if (!caps) return [];
  if (caps.modelsSource === 'none') {
    if (form.model || form.reasoningEffort) {
      return [{ path: 'model', message: '网页 Agent 不能选择模型' }];
    }
    return [];
  }
  if (caps.models.length === 0 || !form.model) return [];
  if (!caps.models.some((model) => model.id === form.model)) {
    return [{ path: 'model', message: '不支持这个模型' }];
  }
  return [];
}

function encodeOverride(value: string, current: string | null): string | null | undefined {
  if (value === '') return undefined;
  if (value === DEFAULT_OPTION) return current === null ? undefined : null;
  if (value === current) return undefined;
  return value;
}

function countChars(value: string): number {
  return [...value].length;
}
