import type { ReactElement } from 'react';
import { Outlet } from 'react-router';
import { TaskList } from './task-list/task-list';

export function TasksLayout(): ReactElement {
  return (
    <>
      <TaskList />
      <section aria-label="任务" className="row-start-2 min-h-0 min-w-0 overflow-hidden bg-white">
        <Outlet />
      </section>
    </>
  );
}
