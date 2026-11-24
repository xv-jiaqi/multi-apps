import type { HubEvent, HubEventEnvelope } from '@agent-hub/contract';
import type { Db } from '../sqlite';

export class EventsRepo {
  constructor(private readonly db: Db) {}

  /** 在调用方的事务里分配 seq（architecture.md §6 第 3 条）。 */
  nextSeq(taskId: string): number {
    const row = this.db.get<{ last_event_seq: number }>(
      `UPDATE tasks SET last_event_seq = last_event_seq + 1 WHERE id = :id RETURNING last_event_seq`,
      { id: taskId },
    );
    if (!row) throw new Error(`task ${taskId} missing`);
    return row.last_event_seq;
  }

  insert(env: HubEventEnvelope, isDelta: boolean): void {
    this.db.run(
      `INSERT INTO events (task_id, seq, turn_id, type, is_delta, payload, ts)
       VALUES (:task_id, :seq, :turn_id, :type, :is_delta, :payload, :ts)`,
      {
        task_id: env.taskId,
        seq: env.seq,
        turn_id: env.turnId,
        type: env.event.type,
        is_delta: isDelta ? 1 : 0,
        payload: JSON.stringify(env.event),
        ts: env.ts,
      },
    );
  }

  list(taskId: string, afterSeq: number, limit: number): HubEventEnvelope[] {
    return this.db
      .all<{
        task_id: string;
        seq: number;
        turn_id: string | null;
        payload: string;
        ts: string;
      }>(
        `SELECT task_id, seq, turn_id, payload, ts FROM events
         WHERE task_id = :task_id AND seq > :after
         ORDER BY seq ASC LIMIT :limit`,
        { task_id: taskId, after: afterSeq, limit },
      )
      .map((r) => ({
        taskId: r.task_id,
        seq: r.seq,
        turnId: r.turn_id,
        ts: r.ts,
        event: JSON.parse(r.payload) as HubEvent,
      }));
  }
}
