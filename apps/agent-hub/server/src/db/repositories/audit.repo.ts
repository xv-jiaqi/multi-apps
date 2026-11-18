import { toJson, type Db } from '../sqlite';

export function appendAudit(
  db: Db,
  entry: {
    actor: string;
    action: string;
    taskId?: string | null;
    detail?: unknown;
  },
): void {
  db.run(
    `INSERT INTO audit_log (ts, actor, action, task_id, detail)
     VALUES (:ts, :actor, :action, :task_id, :detail)`,
    {
      ts: new Date().toISOString(),
      actor: entry.actor,
      action: entry.action,
      task_id: entry.taskId ?? null,
      detail: entry.detail === undefined ? null : toJson(entry.detail),
    },
  );
}

export function listAuditByAction(
  db: Db,
  action: string,
  limit = 50,
): Array<{
  id: number;
  ts: string;
  actor: string;
  action: string;
  task_id: string | null;
  detail: string | null;
}> {
  return db.all(
    `SELECT id, ts, actor, action, task_id, detail
     FROM audit_log WHERE action = :action
     ORDER BY id DESC LIMIT :limit`,
    { action, limit },
  );
}
