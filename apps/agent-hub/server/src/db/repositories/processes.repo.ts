import type { ProcessRow, ProcessTable } from '../../adapters/process/supervisor';
import type { Db } from '../sqlite';

export function createProcessTable(db: Db): ProcessTable {
  return {
    insert(row: ProcessRow): void {
      db.run(
        `INSERT INTO processes (pid, pgid, label, command, task_id, started_at)
         VALUES (:pid, :pgid, :label, :command, :task_id, :started_at)`,
        {
          pid: row.pid,
          pgid: row.pgid,
          label: row.label,
          command: row.command,
          task_id: row.taskId,
          started_at: row.startedAt,
        },
      );
    },
    remove(pid: number): void {
      db.run(`DELETE FROM processes WHERE pid = :pid`, { pid });
    },
    list(): ProcessRow[] {
      return db
        .all<{
          pid: number;
          pgid: number;
          label: string;
          command: string;
          task_id: string | null;
          started_at: string;
        }>(`SELECT * FROM processes`)
        .map((r) => ({
          pid: r.pid,
          pgid: r.pgid,
          label: r.label,
          command: r.command,
          taskId: r.task_id,
          startedAt: r.started_at,
        }));
    },
  };
}
