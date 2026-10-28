import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { openExternal } from './desktop/external';
import { sidecar, takeDevToken } from './desktop/sidecar';
import { errorMessage } from './api/client';
import { installLinkGuard } from './lib/links';
import { toast } from './lib/toast';
import { installConnection } from './app/connection';
import { connectionDeps, queryClient } from './app/singletons';
import { router } from './app/routes';
import './styles.css';

takeDevToken(window.location, window.history, window.sessionStorage);
installLinkGuard(document, openExternal, (error) => {
  toast.error(errorMessage(error));
});
installConnection(connectionDeps);
void sidecar.start();

const root = document.getElementById('root');
if (!root) throw new Error('找不到 #root');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
