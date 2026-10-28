import { reasoningEffortLabel } from '@agent-hub/contract';
import type { AgentHealth } from '@agent-hub/contract';

export type HealthTone = 'ok' | 'warn' | 'bad' | 'muted';

export function healthTone(status: AgentHealth['status']): HealthTone {
  switch (status) {
    case 'ready':
      return 'ok';
    case 'auth_required':
      return 'warn';
    case 'unavailable':
      return 'bad';
    default:
      return 'muted';
  }
}

/** 圆点 title 的后半段。显示名由调用方拼在前面。 */
export function healthText(health: AgentHealth): string {
  switch (health.status) {
    case 'checking':
      return '正在检查';
    case 'disabled':
      return '已禁用';
    case 'auth_required':
    case 'unavailable':
      return health.message;
    case 'ready':
      if (!health.versionVerified) return '未验证的版本';
      return health.version ?? '就绪';
  }
}

/** “模型 默认 · 推理 高”。空模型显示“默认”，空推理档按 default。 */
export function modelLine(model: string | null, effort: string | null): string {
  const modelText = model && model.length > 0 ? model : '默认';
  const effortText = reasoningEffortLabel(effort && effort.length > 0 ? effort : 'default');
  return `模型 ${modelText} · 推理 ${effortText}`;
}

/** 当天显示时刻，否则显示月日。解析失败时原样返回。 */
export function formatTime(iso: string, now = Date.now()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const current = new Date(now);
  const sameDay =
    date.getFullYear() === current.getFullYear() &&
    date.getMonth() === current.getMonth() &&
    date.getDate() === current.getDate();
  if (sameDay) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function formatDuration(ms: number): string {
  const safe = Number.isFinite(ms) ? Math.max(0, Math.floor(ms)) : 0;
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
  }
  return `${seconds} 秒`;
}

/** 0 返回空串，调用方据此决定要不要渲染。 */
export function countLabel(n: number, noun: string): string {
  if (n <= 0) return '';
  return `${noun} ${n}`;
}

export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2';
