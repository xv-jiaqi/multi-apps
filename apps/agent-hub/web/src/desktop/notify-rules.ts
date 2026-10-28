// web/src/desktop/notify-rules.ts
import { TASK_STATUS_LABELS, type HubEventEnvelope, type TaskDto } from '@agent-hub/contract';

export interface NotificationText {
  title: string;
  body: string;
}

/** 早于这个时间的事件是断线重连时补回来的，不再通知。 */
export const NOTIFY_MAX_AGE_MS = 60_000;

const HANDOFF_ITEM = /^t\d+-handoff$/;

/**
 * D28 的三类系统通知：新审批、任务结束、网页任务的提示词已就绪。其余事件返回 `null`。
 * `agentName` 是任务所用 Agent 配置的 `displayName`。
 */
export function notificationFor(
  envelope: HubEventEnvelope,
  task: TaskDto,
  agentName: string,
  now: number,
): NotificationText | null {
  if (now - Date.parse(envelope.ts) > NOTIFY_MAX_AGE_MS) return null;
  const who = `${agentName} 任务 #${task.shortId}`;
  const { event } = envelope;
  switch (event.type) {
    case 'approval.requested': {
      const { approval } = event;
      return {
        title: `${who} 请求批准`,
        body: approval.command ? `${approval.title}：${approval.command}` : approval.title,
      };
    }
    case 'task.status':
      if (event.to === 'completed' || event.to === 'failed' || event.to === 'interrupted') {
        return { title: `${who} ${TASK_STATUS_LABELS[event.to]}`, body: task.title };
      }
      return null;
    case 'tool.completed':
      if (task.adapterKind === 'web' && HANDOFF_ITEM.test(event.itemId)) {
        return { title: `${who} 等你操作`, body: `提示词已就绪：${task.title}` };
      }
      return null;
    default:
      return null;
  }
}
