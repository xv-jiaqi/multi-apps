import type { AgentDto, TaskDto } from '@agent-hub/contract';
import { useMutation } from '@tanstack/react-query';
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui-web';
import { useRef, useState, type ReactElement, type RefObject } from 'react';
import { api } from '../../api/api';
import { errorMessage } from '../../api/client';
import { focusRing } from '../../lib/format';
import {
  DEFAULT_OPTION,
  buildFollowUpBody,
  followUpBlocker,
  modelChoices,
  type AgentDefaults,
  type FollowUpValues,
  type ModelChoices,
} from '../../lib/task-form';
import { readFollowUp, writeFollowUp } from './follow-up-drafts';

export function Composer(props: {
  task: TaskDto;
  agent?: AgentDto;
  defaults: AgentDefaults;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}): ReactElement {
  const blocker = followUpBlocker(props.task);
  const [values, setValues] = useState<FollowUpValues>(
    () =>
      readFollowUp(props.task.id) ?? {
        prompt: '',
        model: props.task.model ?? '',
        reasoningEffort: props.task.reasoningEffort ?? '',
      },
  );
  const [error, setError] = useState<{ id: number; text: string } | null>(null);
  const localRef = useRef<HTMLTextAreaElement>(null);
  const none: ModelChoices = { kind: 'none' };
  const choices = props.agent ? modelChoices(props.agent, props.defaults, values.model) : none;
  const send = useMutation({
    meta: { silentError: true },
    mutationFn: () => api.followUp(props.task.id, buildFollowUpBody(props.task, values)),
    onSuccess: () => {
      const next = { ...values, prompt: '' };
      setValues(next);
      writeFollowUp(props.task.id, next);
      setError(null);
    },
    onError: (caught) => setError({ id: Date.now(), text: errorMessage(caught) }),
  });

  function update(next: FollowUpValues): void {
    setValues(next);
    writeFollowUp(props.task.id, next);
  }

  return (
    <form
      className="space-y-2 border-t border-neutral-200 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (blocker || send.isPending) return;
        send.mutate();
      }}
    >
      {blocker ? <p className="text-sm text-neutral-700">{blocker}</p> : null}
      {choices.kind === 'list' ? (
        <div className="flex gap-2">
          <Select
            value={values.model === '' ? DEFAULT_OPTION : values.model}
            onValueChange={(value) => update({ ...values, model: value })}
            disabled={Boolean(blocker)}
          >
            <SelectTrigger aria-label="追问模型" size="sm" className="w-40">
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
          <Select
            value={values.reasoningEffort === '' ? DEFAULT_OPTION : values.reasoningEffort}
            onValueChange={(value) => update({ ...values, reasoningEffort: value })}
            disabled={Boolean(blocker)}
          >
            <SelectTrigger aria-label="追问推理" size="sm" className="w-32">
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
        </div>
      ) : null}
      <textarea
        ref={(node) => {
          localRef.current = node;
          props.inputRef.current = node;
        }}
        name="follow-up"
        autoComplete="off"
        disabled={Boolean(blocker)}
        value={values.prompt}
        placeholder={blocker ?? '追问'}
        className={`min-h-20 w-full rounded-md border border-neutral-300 p-2 text-sm ${focusRing}`}
        onChange={(event) => update({ ...values, prompt: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (!blocker) send.mutate();
          }
        }}
      />
      {error ? (
        <p key={error.id} role="alert" className="select-text text-sm text-red-700">
          {error.text}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={Boolean(blocker) || send.isPending || values.prompt.trim().length === 0}
      >
        {send.isPending ? '正在发送…' : '发送'}
      </Button>
    </form>
  );
}
