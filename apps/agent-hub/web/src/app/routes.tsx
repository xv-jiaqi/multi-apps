import { createHashRouter, Navigate } from 'react-router';
import { AppShell } from './shell';
import { TasksLayout } from '../pages/tasks-layout';
import { NoTaskSelected } from '../pages/no-task-selected';
import { NewTaskPage } from '../pages/new-task';
import { TaskDetailPage } from '../pages/task-detail/task-detail';
import { SettingsPage } from '../pages/settings/settings-page';

export const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      {
        element: <TasksLayout />,
        children: [
          { index: true, element: <NoTaskSelected /> },
          { path: 'tasks/:taskId', element: <TaskDetailPage /> },
          { path: 'new', element: <NewTaskPage /> },
        ],
      },
      { path: 'settings/:section?', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
