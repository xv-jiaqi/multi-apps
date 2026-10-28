import type { NewTaskForm } from '../lib/task-form';

let draft: NewTaskForm | null = null;

export function readNewTaskDraft(): NewTaskForm | null {
  return draft;
}

export function writeNewTaskDraft(next: NewTaskForm | null): void {
  draft = next;
}
